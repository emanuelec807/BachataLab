/* StemPlayer core. Expects SoundTouch (soundtouchjs) in scope. Built into src/player.js by build/build-player.js */
var STEM_ORDER = ['vocals', 'guitar', 'bass', 'bongo', 'guira', 'altro'];
var FEED = 1024;          // input frames pushed into SoundTouch per step
var FADE_FRAMES = 256;    // fade-in after any reset (seek / start / tempo-mode switch)
var XFADE = 192;          // loop-wrap crossfade length (stem frames)
var CLICK_SEC = 0.012;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function lowerBound(arr, t) {
  var lo = 0, hi = arr.length;
  while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Headless mixing/time-stretching engine (no AudioContext). Output rate = outRate; stems are at srcRate.
 */
function Engine(stems, srcRate, outRate) {
  this.srcRate = srcRate || 44100;
  this.outRate = outRate || this.srcRate;
  this.step = this.srcRate / this.outRate;            // stem frames per output frame (at tempo 1)
  this.ids = [];
  this.L = []; this.R = [];
  this.cur = []; this.tgt = [];
  var keys = Object.keys(stems);
  var len = 0;
  for (var i = 0; i < keys.length; i++) {
    var ch = stems[keys[i]];
    if (!ch || !ch[0]) continue;
    this.ids.push(keys[i]);
    this.L.push(ch[0]); this.R.push(ch[1] || ch[0]);
    this.cur.push(1); this.tgt.push(1);
    len = Math.max(len, ch[0].length);
  }
  this.len = len;                                      // stem frames
  this.duration = len / this.srcRate;
  this.gainCoef = 1 - Math.exp(-1 / (0.012 * this.outRate));

  this.tempo = 1;
  this.bypass = true;
  this.st = new SoundTouch();
  this.st.stretch.setParameters(this.outRate, 0, 0, 8);
  this.st.stretch.quickSeek = false;
  this.st.pitch = 1; this.st.tempo = 1;
  this.latCorr = 0;                                    // extra pending (output-rate input frames); tuned in tests

  this.loopOn = false; this.loopStart = 0; this.loopEnd = 0;
  this.readPos = 0;           // stem frames; next frame to be fed
  this.inTotal = 0;           // output-rate frames fed since reset
  this.wraps = [];            // {at, jump}
  this.fadeLeft = FADE_FRAMES;
  this.endedFlag = false;
  this.blockSong = 0;         // song seconds of first frame of last rendered block
  this.blockRate = 1;         // song seconds per real second
  this.framesIn = 0;          // stats: output-rate frames fed to the time-stretcher/bypass since construct
  this.framesOut = 0;         // stats: frames rendered

  this._tmpL = new Float32Array(FEED); this._tmpR = new Float32Array(FEED);
  this._tmpI = new Float32Array(FEED * 2);
  this._xL = new Float32Array(4096); this._xR = new Float32Array(4096);
  this._outI = new Float32Array(16384);

  // metronome
  this.met = { enabled: false, beats: new Float64Array(0), accents: new Set(), volume: 0.6 };
  this._buildClicks();
  this.active = [];           // active clicks {start, k, w, amp}
  this.metAcc = 0; this.metLast = -1; this.metValid = false;
}

Engine.prototype._buildClicks = function () {
  var n = Math.max(8, Math.round(CLICK_SEC * this.outRate));
  var mk = function (f, rate) {
    var w = new Float32Array(n);
    for (var k = 0; k < n; k++) w[k] = Math.sin(2 * Math.PI * f * k / rate) * Math.exp(-k / (0.0025 * rate));
    return w;
  };
  this.clickN = mk(1500, this.outRate);
  this.clickA = mk(2500, this.outRate);
};

Engine.prototype.setGain = function (id, g) {
  var i = this.ids.indexOf(id);
  if (i < 0) return;
  this.tgt[i] = clamp(+g || 0, 0, 2);
};

Engine.prototype.getGain = function (id) { var i = this.ids.indexOf(id); return i < 0 ? 0 : this.tgt[i]; };

/** current head position in stem frames (fractional) - the frame being output right now (start of next block) */
Engine.prototype.headFrames = function () {
  if (this.bypass || this.inTotal === 0) return this.readPos;
  var st = this.st;
  var P = st._intermediateBuffer.frameCount + st.inputBuffer.frameCount +
          st.outputBuffer.frameCount * this.tempo + this.latCorr;
  var headTotal = this.inTotal - P;
  var pos = this.readPos - P * this.step;
  for (var i = 0; i < this.wraps.length; i++) if (this.wraps[i].at > headTotal) pos += this.wraps[i].jump;
  // WSOLA reads ahead of its nominal window by ~half the seek range; empirical fit (see test/calib.js)
  pos += (0.0863 - 0.0626 * this.tempo) * this.srcRate;
  return pos;
};

Engine.prototype.getPosition = function () { return clamp(this.headFrames() / this.srcRate, 0, this.duration); };

Engine.prototype._reset = function (frames) {
  this.readPos = clamp(Math.round(frames), 0, Math.max(0, this.len));
  this.inTotal = 0;
  this.wraps.length = 0;
  this.st.clear();
  this.fadeLeft = FADE_FRAMES;
  this.endedFlag = false;
  this.active.length = 0;
  this.metValid = false;
};

Engine.prototype.seek = function (sec) { this._reset(sec * this.srcRate); };

Engine.prototype.setTempo = function (r) {
  r = clamp(+r || 1, 0.5, 1.2);
  var nb = Math.abs(r - 1) < 0.0005;
  if (nb) r = 1;
  if (nb !== this.bypass) {
    var head = this.headFrames();
    this.tempo = r; this.bypass = nb;
    if (!nb) { this.st.tempo = r; }
    this._reset(head);
  } else {
    this.tempo = r;
    if (!nb) this.st.tempo = r;
  }
};

Engine.prototype.setLoop = function (a, b) {
  var fa = Math.round(a * this.srcRate), fb = Math.round(b * this.srcRate);
  fa = clamp(fa, 0, this.len); fb = clamp(fb, 0, this.len);
  if (!(fb - fa >= 0.05 * this.srcRate)) { this.clearLoop(); return; }
  this.loopOn = true; this.loopStart = fa; this.loopEnd = fb;
  if (this.headFrames() >= fb) this._reset(fa);
};

Engine.prototype.clearLoop = function () { this.loopOn = false; };

Engine.prototype.setMetronome = function (o) {
  o = o || {};
  var m = this.met;
  if (o.enabled !== undefined) m.enabled = !!o.enabled;
  if (o.beats !== undefined) { m.beats = o.beats instanceof Float64Array ? o.beats : Float64Array.from(o.beats || []); this.metValid = false; }
  if (o.accents !== undefined) m.accents = o.accents instanceof Set ? o.accents : new Set(o.accents || []);
  if (o.volume !== undefined) m.volume = clamp(+o.volume || 0, 0, 2);
  this.active.length = 0;
};

/** mix all stems (with gains) from stem position pos into out[off..off+count) */
Engine.prototype._mixRaw = function (outL, outR, off, count, pos, smooth, stepEff) {
  var i, s, n = this.ids.length;
  for (i = 0; i < count; i++) { outL[off + i] = 0; outR[off + i] = 0; }
  var step = stepEff || this.step, len = this.len, ga = this.gainCoef;
  for (s = 0; s < n; s++) {
    var cur = this.cur[s], tgt = this.tgt[s];
    if (cur === 0 && tgt === 0) continue;
    var L = this.L[s], R = this.R[s];
    var settled = (cur === tgt) || !smooth;
    if (!smooth) tgt = cur;
    if (step === 1) {
      var p0 = Math.round(pos);
      var i0 = Math.max(0, -p0), i1 = Math.min(count, len - p0);
      var sl = L.length, sr2 = R.length;
      if (i1 > i0) {
        if (settled) {
          for (i = i0; i < i1; i++) { var ix = p0 + i; outL[off + i] += L[ix] * cur; outR[off + i] += R[ix] * cur; }
        } else {
          // gain ramps from sample 0 (so keep it advancing even for skipped head samples)
          for (i = 0; i < count; i++) {
            cur += (tgt - cur) * ga;
            if (i >= i0 && i < i1) { var jx = p0 + i; outL[off + i] += L[jx] * cur; outR[off + i] += R[jx] * cur; }
          }
          if (Math.abs(tgt - cur) < 1e-4) cur = tgt;
          this.cur[s] = cur;
        }
      } else if (!settled) {
        for (i = 0; i < count; i++) cur += (tgt - cur) * ga;
        if (Math.abs(tgt - cur) < 1e-4) cur = tgt;
        this.cur[s] = cur;
      }
    } else {
      for (i = 0; i < count; i++) {
        if (!settled) cur += (tgt - cur) * ga;
        var p = pos + i * step, ip = Math.floor(p), fr = p - ip;
        if (ip >= 0 && ip + 1 < len) {
          outL[off + i] += (L[ip] + (L[ip + 1] - L[ip]) * fr) * cur;
          outR[off + i] += (R[ip] + (R[ip + 1] - R[ip]) * fr) * cur;
        } else if (ip >= 0 && ip < len) { outL[off + i] += L[ip] * cur; outR[off + i] += R[ip] * cur; }
      }
      if (!settled) { if (Math.abs(tgt - cur) < 1e-4) cur = tgt; this.cur[s] = cur; }
    }
  }
};

Engine.prototype._wrap = function () {
  var len = this.loopEnd - this.loopStart;
  var np = this.loopStart + ((this.readPos - this.loopStart) % len);
  this.wraps.push({ at: this.inTotal, jump: this.readPos - np });
  this.readPos = np;
};

/** produce `count` output-rate input frames at readPos (loop-aware) into out[off..] and advance */
Engine.prototype._produce = function (outL, outR, off, count) {
  var done = 0, step = this.step;
  while (done < count) {
    var seg = count - done;
    if (this.loopOn) {
      if (this.readPos >= this.loopEnd) this._wrap();
      var until = Math.ceil((this.loopEnd - this.readPos) / step);
      if (until < 1) until = 1;
      if (until < seg) seg = until;
    }
    this._mixRaw(outL, outR, off + done, seg, this.readPos, true);
    if (this.loopOn && this.loopStart >= XFADE) {
      var xs = this.loopEnd - XFADE;
      var i0 = Math.max(0, Math.ceil((xs - this.readPos) / step));
      var cnt = seg - i0;
      if (cnt > 0 && cnt <= this._xL.length) {
        var p0 = this.readPos + i0 * step, len = this.loopEnd - this.loopStart;
        this._mixRaw(this._xL, this._xR, 0, cnt, p0 - len, false);
        for (var i = 0; i < cnt; i++) {
          var w = ((p0 + i * step) - xs) / XFADE; if (w > 1) w = 1;
          outL[off + done + i0 + i] = outL[off + done + i0 + i] * (1 - w) + this._xL[i] * w;
          outR[off + done + i0 + i] = outR[off + done + i0 + i] * (1 - w) + this._xR[i] * w;
        }
      }
    }
    this.readPos += seg * step;
    this.inTotal += seg;
    done += seg;
    if (this.loopOn && this.readPos >= this.loopEnd) this._wrap();
  }
  this.framesIn += count;
};

Engine.prototype._pump = function () {
  var n = FEED, tl = this._tmpL, tr = this._tmpR, ti = this._tmpI;
  this._produce(tl, tr, 0, n);
  for (var i = 0; i < n; i++) { ti[2 * i] = tl[i]; ti[2 * i + 1] = tr[i]; }
  this.st.inputBuffer.putSamples(ti, 0, n);
  this.st.process();
};

Engine.prototype._metronome = function (outL, outR, n, est) {
  var m = this.met, beats = m.beats, i, k;
  // song seconds per output frame
  var spf = (this.bypass ? 1 : this.tempo) * this.step / this.outRate;
  if (m.enabled && beats.length) {
    var loopLen = this.loopOn ? (this.loopEnd - this.loopStart) / this.srcRate : 0;
    var t0;
    if (!this.metValid) { t0 = est; this.metValid = true; this.metLast = lowerBound(beats, t0) - 1; }
    else if (this.bypass) { t0 = est; }
    else {
      var d = est - this.metAcc;
      if (loopLen > 0) { if (d > loopLen / 2) d -= loopLen; else if (d < -loopLen / 2) d += loopLen; }
      if (Math.abs(d) > 0.03) { t0 = est; this.metLast = lowerBound(beats, t0) - 1; }
      else t0 = this.metAcc + d * 0.08;
    }
    var t1 = t0 + n * spf, segs;
    if (this.loopOn) {
      var le = this.loopEnd / this.srcRate, ls = this.loopStart / this.srcRate;
      if (t0 < le && t1 >= le) { segs = [[t0, le, 0, false], [ls, ls + (t1 - le), (le - t0) / spf, true]]; this.metAcc = ls + (t1 - le); }
      else { segs = [[t0, t1, 0, false]]; this.metAcc = t1; }
    } else { segs = [[t0, t1, 0, false]]; this.metAcc = t1; }
    for (var sg = 0; sg < segs.length; sg++) {
      var ta = segs[sg][0], tb = segs[sg][1], o = segs[sg][2];
      if (segs[sg][3]) this.metLast = lowerBound(beats, ta) - 1;
      var bi = Math.max(lowerBound(beats, ta), this.metLast + 1);
      for (; bi < beats.length && beats[bi] < tb; bi++) {
        var fr = Math.round(o + (beats[bi] - ta) / spf);
        var acc = m.accents.has(bi);
        this.active.push({ start: fr, w: acc ? this.clickA : this.clickN, amp: m.volume * (acc ? 1.0 : 0.7) });
        this.metLast = bi;
      }
    }
  } else { this.metValid = false; }
  // render active clicks (start is relative to this block, may be negative = already running)
  var keep = [];
  for (i = 0; i < this.active.length; i++) {
    var c = this.active[i], w = c.w, wl = w.length, a = c.amp;
    var from = Math.max(0, c.start), to = Math.min(n, c.start + wl);
    for (k = from; k < to; k++) { var v = w[k - c.start] * a; outL[k] += v; outR[k] += v; }
    c.start -= n;
    if (c.start + wl > 0) keep.push(c);
  }
  this.active = keep;
};

/** Render n output frames (ctx rate) into outL/outR. */
Engine.prototype.render = function (outL, outR, n) {
  var i;
  var est;
  if (this.bypass) {
    est = this.readPos / this.srcRate;
    this.blockSong = est; this.blockRate = 1;
    this._produce(outL, outR, 0, n);
  } else {
    var st = this.st;
    while (st.outputBuffer.frameCount < n) this._pump();
    est = this.headFrames() / this.srcRate;
    this.blockSong = est; this.blockRate = this.tempo;
    if (this._outI.length < n * 2) this._outI = new Float32Array(n * 2);
    st.outputBuffer.receiveSamples(this._outI, n);
    var oi = this._outI;
    for (i = 0; i < n; i++) { outL[i] = oi[2 * i]; outR[i] = oi[2 * i + 1]; }
  }
  this.framesOut += n;
  if (this.fadeLeft > 0) {
    var m = Math.min(n, this.fadeLeft);
    for (i = 0; i < m; i++) { var g = (FADE_FRAMES - this.fadeLeft + i) / FADE_FRAMES; outL[i] *= g; outR[i] *= g; }
    this.fadeLeft -= m;
  }
  if (this.met.enabled || this.active.length) this._metronome(outL, outR, n, est);
  // soft safety limiter (only touches |x| > 0.9)
  for (i = 0; i < n; i++) {
    var a = outL[i], b = outR[i];
    if (a > 0.9 || a < -0.9) outL[i] = (a > 0 ? 1 : -1) * (0.9 + 0.1 * Math.tanh((Math.abs(a) - 0.9) / 0.1));
    if (b > 0.9 || b < -0.9) outR[i] = (b > 0 ? 1 : -1) * (0.9 + 0.1 * Math.tanh((Math.abs(b) - 0.9) / 0.1));
  }
  // prune wraps behind the head, detect end
  var headAfter = this.headFrames();
  if (this.wraps.length) {
    var keep = [];
    var headTotal = this.bypass ? this.inTotal : this.inTotal - (this.st._intermediateBuffer.frameCount + this.st.inputBuffer.frameCount + this.st.outputBuffer.frameCount * this.tempo + this.latCorr);
    for (i = 0; i < this.wraps.length; i++) if (this.wraps[i].at > headTotal) keep.push(this.wraps[i]);
    this.wraps = keep;
  }
  if (!this.loopOn && headAfter >= this.len) this.endedFlag = true;
};

/* ------------------------------------------------------------------ */
/* Web Audio wrapper                                                   */
/* ------------------------------------------------------------------ */
function StemPlayer(ctx, stems, sampleRate, opts) {
  opts = opts || {};
  this.ctx = ctx;
  this.sampleRate = sampleRate || 44100;
  this.bufferSize = opts.bufferSize || 4096;
  this.engine = new Engine(stems, this.sampleRate, ctx.sampleRate || this.sampleRate);
  this.isPlaying = false;
  this.onended = null;
  this._pausedPos = 0;
  this._recs = [];
  this._node = null;
  this._gain = null;
  this._destroyed = false;
  this._endTimer = null;
  this._pauseTimer = null;
  this._seekTarget = 0;
}

Object.defineProperty(StemPlayer.prototype, 'duration', { get: function () { return this.engine.duration; } });

StemPlayer.prototype._latency = function () {
  var c = this.ctx;
  var l = (c.outputLatency > 0 ? c.outputLatency : 0);
  if (!(c.outputLatency > 0)) l = c.baseLatency > 0 ? c.baseLatency : 0;
  return l;
};

Object.defineProperty(StemPlayer.prototype, 'position', {
  get: function () {
    var e = this.engine;
    if (!this.isPlaying) return this._pausedPos;
    var recs = this._recs;
    if (!recs.length) return this._seekTarget;
    var ts = this.ctx.currentTime - this._latency();
    var r = recs[0];
    for (var i = recs.length - 1; i >= 0; i--) { if (recs[i].T <= ts) { r = recs[i]; break; } }
    var dt = ts - r.T; if (dt < 0) dt = 0;
    var pos = r.song + dt * r.rate;
    if (r.loop && r.song < r.loop[1] && pos >= r.loop[1]) pos = r.loop[0] + ((pos - r.loop[0]) % (r.loop[1] - r.loop[0]));
    return clamp(pos, 0, e.duration);
  }
});

StemPlayer.prototype._ensureNode = function () {
  if (this._node) return;
  var ctx = this.ctx, self = this, n;
  try { n = ctx.createScriptProcessor(this.bufferSize, 0, 2); }
  catch (err) { n = ctx.createScriptProcessor(this.bufferSize, 1, 2); }
  n.onaudioprocess = function (ev) { self._process(ev); };
  this._node = n;
  this._gain = ctx.createGain();
  n.connect(this._gain);
  this._gain.connect(ctx.destination);
};

StemPlayer.prototype._process = function (ev) {
  var out = ev.outputBuffer, n = out.length;
  var L = out.getChannelData(0), R = out.numberOfChannels > 1 ? out.getChannelData(1) : new Float32Array(n);
  var e = this.engine;
  if (!this.isPlaying) { L.fill(0); R.fill(0); return; }
  e.render(L, R, n);
  var T = ev.playbackTime > 0 ? ev.playbackTime : this.ctx.currentTime + n / this.ctx.sampleRate;
  this._recs.push({ T: T, song: e.blockSong, rate: e.blockRate,
    loop: e.loopOn ? [e.loopStart / e.srcRate, e.loopEnd / e.srcRate] : null });
  if (this._recs.length > 6) this._recs.shift();
  if (e.endedFlag) {
    var self = this;
    this.isPlaying = false; this._pausedPos = e.duration;
    var wait = Math.max(0, (T + n / this.ctx.sampleRate - this.ctx.currentTime)) * 1000 + 30;
    this._endTimer = setTimeout(function () {
      self._endTimer = null;
      self._disconnect();
      if (typeof self.onended === 'function') { try { self.onended(); } catch (x) { } }
    }, wait);
  }
};

StemPlayer.prototype._disconnect = function () {
  if (this._node && !this.isPlaying) { try { this._node.disconnect(); } catch (e) { } this._connected = false; }
};

StemPlayer.prototype.play = function () {
  if (this._destroyed || this.isPlaying) return;
  var e = this.engine;
  if (this._pauseTimer) { clearTimeout(this._pauseTimer); this._pauseTimer = null; }
  if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
  if (this.ctx.state === 'suspended' && this.ctx.resume && typeof this.ctx.startRendering !== 'function') {
    try { var rp = this.ctx.resume(); if (rp && rp.catch) rp.catch(function () { }); } catch (x) { }
  }
  this._ensureNode();
  var start = this._pausedPos;
  if (start >= e.duration - 0.02 && !e.loopOn) start = 0;
  e.seek(start);
  this._seekTarget = start;
  this._recs.length = 0;
  var g = this._gain.gain;
  try { g.cancelScheduledValues(this.ctx.currentTime); } catch (x) { }
  g.value = 1;
  if (!this._connected) { this._node.connect(this._gain); this._connected = true; }
  this.isPlaying = true;
};

StemPlayer.prototype.pause = function () {
  if (!this.isPlaying) return;
  this._pausedPos = this.position;
  this.isPlaying = false;
  var self = this, g = this._gain.gain, t = this.ctx.currentTime;
  try { g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.008); } catch (x) { g.value = 0; }
  this._pauseTimer = setTimeout(function () { self._pauseTimer = null; self._disconnect(); }, 80);
};

StemPlayer.prototype.seek = function (sec) {
  var e = this.engine;
  sec = clamp(+sec || 0, 0, e.duration);
  e.seek(sec);
  this._recs.length = 0;
  this._seekTarget = sec;
  this._pausedPos = sec;
};

StemPlayer.prototype.setTempo = function (r) {
  var e = this.engine;
  var pos = this.position;
  var wasBypass = e.bypass;
  e.setTempo(r);
  if (wasBypass !== e.bypass) { this._recs.length = 0; this._seekTarget = pos; }
};

StemPlayer.prototype.setGain = function (id, g) { this.engine.setGain(id, g); };
StemPlayer.prototype.setLoop = function (a, b) {
  var pos = this.position;
  this.engine.setLoop(a, b);
  if (this.engine.loopOn && pos >= b) { this._recs.length = 0; this._seekTarget = a; this._pausedPos = a; }
};
StemPlayer.prototype.clearLoop = function () { this.engine.clearLoop(); };
StemPlayer.prototype.setMetronome = function (o) { this.engine.setMetronome(o); };

StemPlayer.prototype.destroy = function () {
  this._destroyed = true; this.isPlaying = false;
  if (this._endTimer) clearTimeout(this._endTimer);
  if (this._pauseTimer) clearTimeout(this._pauseTimer);
  if (this._node) { try { this._node.onaudioprocess = null; this._node.disconnect(); } catch (e) { } }
  if (this._gain) { try { this._gain.disconnect(); } catch (e) { } }
  this._node = null; this._gain = null; this.onended = null;
  this.engine = new Engine({}, this.sampleRate, this.sampleRate);
};

StemPlayer.Engine = Engine;
