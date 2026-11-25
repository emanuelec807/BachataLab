/* BeatTracker - tempo + beat tracking for bachata (classic script; also works inside a Worker).
 *   BeatTracker.analyze(mono, sampleRate) -> { bpm, beats: Float64Array (s), confidence 0..1 }
 *   BeatTracker.grid(bpm, anchorTime, duration) -> Float64Array
 * Pipeline: log-mel spectral flux (n_fft 2048, hop 512 @44.1k ~ 11.6 ms) -> autocorrelation comb with
 * log-normal prior (~128 BPM) -> Ellis-2007 dynamic-programming beat tracker -> robust linear refinement of the
 * period, second DP pass -> regular extension of the beat series to cover the entire signal.
 */
(function (root) {
  'use strict';

  var CFG = { minBpm: 90, maxBpm: 190, priorBpm: 128, priorSigmaOct: 0.8, tightness: 120, hopSec: 512 / 44100, nMels: 48, fMin: 40, fMax: 11000 };

  /* ---------- FFT (in-place radix-2, complex) ---------- */
  function makeFFT(n) {
    var levels = Math.round(Math.log(n) / Math.LN2), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n), i;
    for (i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    for (i = 0; i < n; i++) { var r = 0, x = i; for (var b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    return function (re, im) {
      var i, j, k, size, half, step, a, b, tr, ti;
      for (i = 0; i < n; i++) { j = rev[i]; if (j > i) { tr = re[i]; re[i] = re[j]; re[j] = tr; ti = im[i]; im[i] = im[j]; im[j] = ti; } }
      for (size = 2; size <= n; size <<= 1) {
        half = size >> 1; step = n / size;
        for (i = 0; i < n; i += size) {
          for (j = i, k = 0; j < i + half; j++, k += step) {
            a = j + half;
            tr = re[a] * cos[k] + im[a] * sin[k];
            ti = -re[a] * sin[k] + im[a] * cos[k];
            re[a] = re[j] - tr; im[a] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  function hz2mel(f) { return 2595 * Math.log(1 + f / 700) / Math.LN10; }
  function mel2hz(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

  function melBank(nFft, sr, nMels, fMin, fMax) {
    var nb = nFft / 2 + 1, pts = new Float64Array(nMels + 2), m0 = hz2mel(fMin), m1 = hz2mel(Math.min(fMax, sr / 2 - 1));
    for (var i = 0; i < nMels + 2; i++) pts[i] = mel2hz(m0 + (m1 - m0) * i / (nMels + 1));
    var fb = [];
    for (var m = 0; m < nMels; m++) {
      var lo = pts[m], c = pts[m + 1], hi = pts[m + 2], k0 = Math.max(0, Math.floor(lo * nFft / sr)), k1 = Math.min(nb - 1, Math.ceil(hi * nFft / sr)), idx = [], w = [];
      for (var k = k0; k <= k1; k++) {
        var f = k * sr / nFft, v = f < c ? (f - lo) / (c - lo) : (hi - f) / (hi - c);
        if (v > 0) { idx.push(k); w.push(v); }
      }
      var s = 0; for (var q = 0; q < w.length; q++) s += w[q];
      if (s > 0) for (q = 0; q < w.length; q++) w[q] /= s;   // area-normalised: flat spectrum -> flat bands
      fb.push({ idx: Int32Array.from(idx), w: Float64Array.from(w) });
    }
    return fb;
  }

  /* ---------- onset strength ---------- */
  function onsetStrength(x, sr) {
    var nFft = CFG.nFft || (sr > 32000 ? 1024 : 512);
    var hop = Math.round(CFG.hopSec * sr);            // 512 @ 44.1k
    var hopSec = hop / sr;
    var nFrames = Math.max(1, 1 + Math.floor(x.length / hop));
    var H = nFft >> 1, fft = makeFFT(H), re = new Float64Array(H), im = new Float64Array(H), mag = new Float64Array(H + 1), win = new Float64Array(nFft), wr = new Float64Array(H), wi = new Float64Array(H), i, t;
    for (i = 0; i < H; i++) { wr[i] = Math.cos(2 * Math.PI * i / nFft); wi[i] = -Math.sin(2 * Math.PI * i / nFft); }
    for (i = 0; i < nFft; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nFft);
    var fb = melBank(nFft, sr, CFG.nMels, CFG.fMin, CFG.fMax), nM = fb.length;
    var prev = new Float64Array(nM), cur = new Float64Array(nM), env = new Float64Array(nFrames), half = nFft >> 1, len = x.length;
    // reference level for log compression: global rms-ish scale so quiet/loud inputs behave alike
    var e = 0, cnt = 0; for (i = 0; i < len; i += 7) { e += x[i] * x[i]; cnt++; }
    var rms = Math.sqrt(e / Math.max(1, cnt)) + 1e-9, gamma = 1000 / (rms * nFft * 0.25);
    for (t = 0; t < nFrames; t++) {
      var start = t * hop - half, anyNonZero = false;
      for (i = 0; i < H; i++) {                       // real FFT of size nFft through one complex FFT of size nFft/2
        var p0 = start + 2 * i, p1 = p0 + 1;
        if (p0 < 0) p0 = -p0; else if (p0 >= len) p0 = 2 * len - 2 - p0;   // reflect padding (centred frames like librosa)
        if (p1 < 0) p1 = -p1; else if (p1 >= len) p1 = 2 * len - 2 - p1;
        re[i] = (p0 >= 0 && p0 < len ? x[p0] : 0) * win[2 * i];
        im[i] = (p1 >= 0 && p1 < len ? x[p1] : 0) * win[2 * i + 1];
      }
      fft(re, im);
      for (var k = 0; k <= H; k++) {
        var k1 = k === H ? 0 : k, k2 = k === 0 ? 0 : H - k;
        var ar = re[k1], ai = im[k1], br = re[k2], bi = -im[k2];     // Z[k], conj(Z[H-k])
        var er = 0.5 * (ar + br), ei = 0.5 * (ai + bi);             // even part
        var dr = 0.5 * (ar - br), di = 0.5 * (ai - bi);             // (Z - conj)/2
        var orr = di, oi = -dr;                                     // odd part = (Z-conj)/(2i)
        var c = k === H ? -1 : wr[k], sn = k === H ? 0 : wi[k];
        var xr = er + orr * c - oi * sn, xi = ei + orr * sn + oi * c;
        mag[k] = Math.sqrt(xr * xr + xi * xi);
      }
      for (var m = 0; m < nM; m++) {
        var idx = fb[m].idx, w = fb[m].w, s = 0;
        for (var q = 0; q < idx.length; q++) s += w[q] * mag[idx[q]];
        cur[m] = Math.log(1 + gamma * s);
      }
      if (t > 0) {
        var f = 0; for (m = 0; m < nM; m++) { var d = cur[m] - prev[m]; if (d > 0) f += d; }
        env[t] = f / nM;
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return { env: env, hopSec: hopSec, nFft: nFft };
  }

  /* remove slow trend and normalise to unit std; keep positive part for DP */
  function normaliseEnv(env, hopSec) {
    var n = env.length, out = new Float64Array(n), w = Math.max(3, Math.round(0.75 / hopSec)) | 1, hw = w >> 1, i;
    var cs = new Float64Array(n + 1); for (i = 0; i < n; i++) cs[i + 1] = cs[i] + env[i];
    for (i = 0; i < n; i++) { var a = Math.max(0, i - hw), b = Math.min(n, i + hw + 1); out[i] = env[i] - (cs[b] - cs[a]) / (b - a); }
    var s = 0; for (i = 0; i < n; i++) s += out[i] * out[i];
    s = Math.sqrt(s / n) || 1;
    for (i = 0; i < n; i++) out[i] /= s;
    return out;
  }

  /* ---------- tempo ---------- */
  function estimateTempo(oenv, hopSec) {
    var n = oenv.length, i, lag;
    var maxLag = Math.min(n - 1, Math.ceil(60 / (CFG.minBpm * 0.45) / hopSec) + 2);
    // autocorrelation of positive-part envelope (zero-mean already)
    var ac = new Float64Array(maxLag + 2);
    var x = new Float64Array(n); for (i = 0; i < n; i++) x[i] = oenv[i] > 0 ? oenv[i] : oenv[i] * 0.3;
    for (lag = 0; lag <= maxLag; lag++) { var s = 0; for (i = lag; i < n; i++) s += x[i] * x[i - lag]; ac[lag] = s / (n - lag); }
    var ac0 = ac[0] || 1;
    function acAt(l) { if (l < 1) return 0; var i0 = Math.floor(l), f = l - i0; if (i0 + 1 > maxLag) return i0 <= maxLag ? ac[i0] : 0; return ac[i0] * (1 - f) + ac[i0 + 1] * f; }
    var best = -1e9, bestBpm = CFG.priorBpm, scores = [], bpms = [];
    for (var bpm = CFG.minBpm; bpm <= CFG.maxBpm + 1e-6; bpm += 0.25) {
      var L = 60 / bpm / hopSec;
      // comb: fundamental + 2x + 3x + 4x periods (harmonics support), plus half period (off-beats) with small weight
      var sc = acAt(L) + 0.5 * acAt(2 * L) + 0.33 * acAt(3 * L) + 0.25 * acAt(4 * L) + 0.35 * acAt(L / 2);
      var oct = Math.log(bpm / CFG.priorBpm) / Math.LN2;
      var prior = Math.exp(-0.5 * oct * oct / (CFG.priorSigmaOct * CFG.priorSigmaOct));
      var v = sc * prior;
      scores.push(v); bpms.push(bpm);
      if (v > best) { best = v; bestBpm = bpm; }
    }
    // salience: peak vs mean of the weighted curve
    var mean = 0; for (i = 0; i < scores.length; i++) mean += Math.max(0, scores[i]); mean /= scores.length;
    var salience = best > 0 ? 1 - mean / best : 0;
    return { bpm: bestBpm, salience: salience, acRel: acAt(60 / bestBpm / hopSec) / ac0 };
  }

  /* ---------- DP beat tracking (Ellis 2007) ---------- */
  function dpBeats(oenv, periodFrames, tightness) {
    var n = oenv.length, i, j;
    // smooth the envelope with a gaussian (~ 1/32 period sigma... use fixed 3-frame) so the DP sees peaks
    var local = new Float64Array(n), kw = [0.06, 0.24, 0.4, 0.24, 0.06];
    for (i = 0; i < n; i++) { var s = 0; for (j = -2; j <= 2; j++) { var k = i + j; if (k >= 0 && k < n) s += kw[j + 2] * oenv[k]; } local[i] = s; }
    var score = new Float64Array(n), back = new Int32Array(n).fill(-1);
    var lo = Math.round(periodFrames / 2), hi = Math.round(periodFrames * 2);
    var penalty = new Float64Array(hi + 2);
    for (var d = lo; d <= hi; d++) { var lg = Math.log(d / periodFrames); penalty[d] = -tightness * lg * lg; }
    var firstPeak = true;
    for (i = 0; i < n; i++) {
      var bestV = 0, bestJ = -1;                      // start fresh allowed (value 0)
      for (d = lo; d <= hi; d++) { j = i - d; if (j < 0) break; var v = score[j] + penalty[d]; if (v > bestV || bestJ < 0 && v > bestV - 1e9 && false) { bestV = v; bestJ = j; } }
      score[i] = local[i] + bestV; back[i] = bestJ;
    }
    // choose end: best score among last ~1.5 periods (so the chain covers the whole signal)
    var endStart = Math.max(0, n - Math.round(periodFrames * 1.5)), end = endStart;
    for (i = endStart; i < n; i++) if (score[i] > score[end]) end = i;
    var seq = []; for (i = end; i >= 0; i = back[i]) { seq.push(i); if (back[i] < 0) break; }
    seq.reverse();
    return seq;
  }

  function median(a) { var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); return b.length ? b[b.length >> 1] : 0; }

  /* robust line fit t = t0 + k*P over beats index->time, returns {t0, P} */
  function fitLine(times) {
    var n = times.length, w = new Float64Array(n).fill(1), t0 = times[0], P = 0, it, i;
    if (n < 2) return { t0: times[0] || 0, P: 0 };
    var d = []; for (i = 1; i < n; i++) d.push(times[i] - times[i - 1]);
    P = median(d);
    for (it = 0; it < 4; it++) {
      var sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (i = 0; i < n; i++) { sw += w[i]; sx += w[i] * i; sy += w[i] * times[i]; sxx += w[i] * i * i; sxy += w[i] * i * times[i]; }
      var den = sw * sxx - sx * sx; if (Math.abs(den) < 1e-12) break;
      P = (sw * sxy - sx * sy) / den; t0 = (sy - P * sx) / sw;
      for (i = 0; i < n; i++) { var r = Math.abs(times[i] - (t0 + P * i)); w[i] = r < 0.03 ? 1 : 0.05 / (r + 0.02) * 0.4; }
    }
    return { t0: t0, P: P };
  }

  /* ---------- public ---------- */
  var BeatTracker = {};
  BeatTracker.config = CFG;

  BeatTracker.grid = function (bpm, anchorTime, duration) {
    var P = 60 / bpm, k0 = Math.ceil(-anchorTime / P - 1e-9), k1 = Math.floor((duration - anchorTime) / P + 1e-9), n = Math.max(0, k1 - k0 + 1), out = new Float64Array(n);
    for (var i = 0; i < n; i++) out[i] = anchorTime + (k0 + i) * P;
    return out;
  };

  BeatTracker.analyze = function (mono, sampleRate) {
    var sr = sampleRate || 44100, duration = mono.length / sr;
    if (mono.length < sr * 2) return { bpm: CFG.priorBpm, beats: BeatTracker.grid(CFG.priorBpm, 0, duration), confidence: 0 };
    var os = onsetStrength(mono, sr), hopSec = os.hopSec, oenv = normaliseEnv(os.env, hopSec);
    var tempo = estimateTempo(oenv, hopSec);
    var seq = dpBeats(oenv, 60 / tempo.bpm / hopSec, CFG.tightness);
    // frame -> time. Flux of centred frames peaks ~ nFft/4 before the true onset (calibrated on synthetic bursts), compensate.
    var shift = CFG.shiftSec != null ? CFG.shiftSec : 0.0035;
    var times = seq.map(function (f) { return f * hopSec + shift; });
    var fit = fitLine(times), P = fit.P;
    if (!(P > 0) || 60 / P < CFG.minBpm - 5 || 60 / P > CFG.maxBpm + 5) { P = 60 / tempo.bpm; fit.t0 = times[0] || 0; }
    else if (Math.abs(60 / P - tempo.bpm) > 0.01) {
      // second pass with refined period
      seq = dpBeats(oenv, P / hopSec, CFG.tightness);
      times = seq.map(function (f) { return f * hopSec + shift; });
      var f2 = fitLine(times); if (f2.P > 0 && Math.abs(f2.P - P) / P < 0.03) { P = f2.P; fit = f2; } else fit.t0 = f2.t0 || fit.t0;
    }
    var bpm = 60 / P;
    // Output: DP beats (follow slight drift) extended with the regular grid before the first and after the last beat.
    var beats = [], i;
    var first = times[0], last = times[times.length - 1];
    var kBack = Math.floor(first / P + 1e-9); for (i = kBack; i >= 1; i--) beats.push(first - i * P);
    for (i = 0; i < times.length; i++) beats.push(times[i]);
    var kFwd = Math.floor((duration - last) / P + 1e-9); for (i = 1; i <= kFwd; i++) beats.push(last + i * P);
    // confidence 0..1: normalised autocorrelation at the beat lag + comb-peak salience (noise ~0.0, clear groove ~1.0)
    var c01 = function (v) { return Math.max(0, Math.min(1, v)); };
    var confidence = 0.5 * c01((tempo.acRel - 0.15) / 0.4) + 0.5 * c01((tempo.salience - 0.2) / 0.6);
    return { bpm: bpm, beats: Float64Array.from(beats), confidence: confidence };
  };

  root.BeatTracker = BeatTracker;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
