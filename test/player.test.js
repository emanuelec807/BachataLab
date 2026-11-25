const path = require('path'), assert = require('assert');
const readWav = require('./wav'), loadPlayer = require('./load-player');
const SP = loadPlayer(), Engine = SP.Engine;
const DIR = '/home/claude/bachata/final/';
const IDS = ['vocals', 'guitar', 'bass', 'bongo', 'guira', 'altro'];
const stems = {}; for (const id of IDS) { const w = readWav(DIR + id + '.wav'); stems[id] = [w.channels[0], w.channels[1] || w.channels[0]]; }
const sr = 44100, N = stems.vocals[0].length;
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  PASS', m); };
const BS = 4096;
function renderAll(e, nBlocks, bs = BS) {
  const L = new Float32Array(nBlocks * bs), R = new Float32Array(nBlocks * bs);
  const bl = new Float32Array(bs), br = new Float32Array(bs);
  for (let b = 0; b < nBlocks; b++) { e.render(bl, br, bs); L.set(bl, b * bs); R.set(br, b * bs); }
  return [L, R];
}
const sumRef = (i, ch, skip) => { let s = 0; for (const id of IDS) if (id !== skip) s += stems[id][ch][i]; return s; };

console.log('1. tempo 1, all gains 1 => sum of stems');
{
  const e = new Engine(stems, sr, sr);
  const nb = 200; const [L, R] = renderAll(e, nb);
  let maxErr = 0, peak = 0;
  for (let i = 512; i < nb * BS; i++) {
    const a = sumRef(i, 0), b = sumRef(i, 1); peak = Math.max(peak, Math.abs(a), Math.abs(b));
    if (Math.abs(a) < 0.9) maxErr = Math.max(maxErr, Math.abs(L[i] - a));
    if (Math.abs(b) < 0.9) maxErr = Math.max(maxErr, Math.abs(R[i] - b));
  }
  console.log('  max abs error (|x|<0.9):', maxErr.toExponential(2), ' peak of sum:', peak.toFixed(3));
  ok(maxErr < 1e-5, 'bypass output == sum of stems');
}

console.log('2. gain smoothing');
{
  const e = new Engine(stems, sr, sr);
  renderAll(e, 20); e.setGain('vocals', 0);
  const [L] = renderAll(e, 1, 64); // first 64 frames after change: must be gradual
  let maxStep = 0; for (let i = 1; i < 64; i++) maxStep = Math.max(maxStep, Math.abs(L[i] - L[i - 1]));
  renderAll(e, 20);
  const pos = e.readPos; const [L2] = renderAll(e, 1);
  let err = 0; for (let i = 0; i < BS; i++) err = Math.max(err, Math.abs(L2[i] - sumRef(pos + i, 0, 'vocals')));
  console.log('  max sample step during ramp', maxStep.toFixed(4), ' settled error', err.toExponential(2));
  ok(err < 1e-5, 'vocals gain 0 => sum without vocals after ~0.5 s');
  ok(maxStep < 0.2, 'no step discontinuity when gain changes');
}

console.log('3. loop (tempo 1): seamless wrap');
{
  const a = 10.0, b = 12.0, e = new Engine(stems, sr, sr);
  e.seek(9); e.setLoop(a, b);
  const nb = Math.ceil(7 * sr / BS); const [L] = renderAll(e, nb);
  // original-signal diff statistics (what "normal signal" looks like)
  const sig = new Float32Array(2 * sr); for (let i = 0; i < sig.length; i++) sig[i] = sumRef(10 * sr + i, 0);
  const diffs = []; for (let i = 1; i < sig.length; i++) diffs.push(Math.abs(sig[i] - sig[i - 1]));
  diffs.sort((x, y) => x - y); const p999 = diffs[Math.floor(diffs.length * 0.999)], dmax = diffs[diffs.length - 1];
  // wraps happen at output frame (b-9)*sr + k*(b-a)*sr
  let worst = 0;
  for (let k = 0; k < 3; k++) {
    const w = Math.round((3 + 2 * k) * sr);
    for (let i = w - 400; i < w + 400; i++) worst = Math.max(worst, Math.abs(L[i] - L[i - 1]));
  }
  console.log('  max |diff| within +-400 frames of wraps', worst.toFixed(4), ' signal max |diff|', dmax.toFixed(4), ' 99.9% ', p999.toFixed(4));
  ok(worst <= dmax * 1.5 + 1e-3, 'no discontinuity at loop wrap beyond normal signal');
  // after wrap, exact repetition of loop content (outside crossfade)
  let rep = 0; for (let i = 3 * sr + 600; i < 3 * sr + 20000; i++) rep = Math.max(rep, Math.abs(L[i] - L[i + 2 * sr]));
  ok(rep < 1e-5, 'loop repeats sample-exact (err ' + rep.toExponential(1) + ')');
  ok(Math.abs(e.getPosition() - ((9 + 7 - 10) % 2 + 10)) < 0.3, 'position wraps inside loop: ' + e.getPosition().toFixed(3));
}

console.log('4. tempo 0.75: output/input ratio, pitch preservation, loop');
{
  const e = new Engine(stems, sr, sr); e.setTempo(0.75);
  const nb = 400; renderAll(e, nb);
  const consumed = e.readPos - e.st.inputBuffer.frameCount - e.st._intermediateBuffer.frameCount;
  const ratio = (nb * BS) / consumed;
  console.log('  out frames', nb * BS, 'in frames (net of pending)', consumed.toFixed(0), 'ratio', ratio.toFixed(4));
  ok(Math.abs(ratio - 1 / 0.75) < 0.01, 'output frames ~ 1.333x input');
  // pitch: 440 Hz sine
  const n = sr * 20, s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
  const e2 = new Engine({ a: [s, s] }, sr, sr); e2.setTempo(0.75);
  const [L] = renderAll(e2, 100);
  let zc = 0, first = -1, last = -1; for (let i = 20000; i < 100 * BS - 1; i++) if (L[i] <= 0 && L[i + 1] > 0) { const t = i + (-L[i]) / (L[i + 1] - L[i]); if (first < 0) first = t; last = t; zc++; }
  const f = (zc - 1) * sr / (last - first);
  console.log('  measured pitch of 440 Hz sine at tempo 0.75:', f.toFixed(2), 'Hz');
  ok(Math.abs(f - 440) < 2, 'pitch preserved');
  // loop through stretcher: check for clicks
  const e3 = new Engine(stems, sr, sr); e3.setTempo(0.75); e3.seek(9); e3.setLoop(10, 12);
  const [L3] = renderAll(e3, Math.ceil(12 * sr / BS));
  let mx = 0; for (let i = 1; i < L3.length; i++) mx = Math.max(mx, Math.abs(L3[i] - L3[i - 1]));
  console.log('  loop @0.75: max |diff| in output', mx.toFixed(4), '(signal max', 'see above)');
  ok(mx < 0.8, 'looped stretched output has no large spikes');
  const p = e3.getPosition(); ok(p >= 10 && p <= 12.05, 'position stays inside loop at tempo 0.75: ' + p.toFixed(3));
}

console.log('5. position accuracy with ramp stem (head estimate vs actual)');
{
  const len = sr * 60, ramp = new Float32Array(len); for (let i = 0; i < len; i++) ramp[i] = 0.8 * i / len;
  for (const t of [0.5, 0.75, 1, 1.2]) {
    const e = new Engine({ a: [ramp, ramp] }, sr, sr); e.setTempo(t); e.seek(10);
    const L = new Float32Array(BS), R = new Float32Array(BS); const errs = [];
    for (let b = 0; b < 40; b++) { e.render(L, R, BS); if (b < 3) continue; const act = L[2000] / 0.8 * len; errs.push(Math.abs(e.blockSong * sr + 2000 * e.blockRate - act) / sr * 1000); }
    errs.sort((x, y) => x - y);
    console.log('  tempo', t, 'abs pos error ms: median', errs[errs.length >> 1].toFixed(2), 'max', errs[errs.length - 1].toFixed(2));
    ok(errs[errs.length >> 1] < 15, 'position estimate tempo ' + t);
  }
}

console.log('6. seek resets');
{
  for (const t of [1, 0.8]) {
    const e = new Engine(stems, sr, sr); e.setTempo(t); renderAll(e, 50);
    e.seek(30); const p0 = e.getPosition();
    const [L] = renderAll(e, 6); const pos = e.getPosition();
    ok(Math.abs(p0 - 30) < 0.02, 'tempo ' + t + ': position right after seek = 30 s (' + p0.toFixed(3) + ')');
    const expected = 30 + (6 * BS / sr) * t;
    ok(Math.abs(pos - expected) < 0.06, 'tempo ' + t + ': position after 6 blocks ' + pos.toFixed(3) + ' vs ' + expected.toFixed(3));
    // content jumped immediately: first frames after fade are from 30 s
    if (t === 1) { let err = 0; for (let i = 300; i < 2000; i++) err = Math.max(err, Math.abs(L[i] - sumRef(30 * sr + i, 0))); ok(err < 1e-5, 'bypass seek: content from 30 s immediately'); }
    let m0 = 0; for (let i = 0; i < 100; i++) m0 = Math.max(m0, Math.abs(L[i])); // fade-in from silence
    ok(Math.abs(L[0]) < 0.01, 'fade-in after seek (L[0]=' + L[0].toExponential(1) + ')');
  }
}

console.log('7. metronome timing');
{
  const z = new Float32Array(sr * 60), zs = { a: [z, z] };
  const beats = Float64Array.from({ length: 100 }, (_, i) => 1.0 + i * 0.5123);
  // Alignment is measured against the audio actually heard: a ramp stem encodes song time, so the
  // (no-metronome) output tells us which song time each output frame really carries.
  const rl = sr * 60, ramp = new Float32Array(rl); for (let i = 0; i < rl; i++) ramp[i] = 0.5 * i / rl;
  for (const t of [1, 0.75, 0.6, 1.2]) {
    const mk = (met) => { const e = new Engine({ a: [ramp, ramp] }, sr, sr); e.setTempo(t); if (met) e.setMetronome({ enabled: true, beats, accents: [0, 4, 8], volume: 0.3 }); e.seek(0.2); return e; };
    const nb = Math.ceil(30 * sr / BS);
    const [A] = renderAll(mk(false), nb), [B] = renderAll(mk(true), nb);
    const on = []; let quiet = 1e9;
    for (let i = 0; i < A.length; i++) { const d = B[i] - A[i]; if (Math.abs(d) > 0.03) { if (quiet > 0.02 * sr) on.push(i); quiet = 0; } else quiet++; }
    const errs = []; const seen = new Set();
    for (const o of on) { const song = A[o + 1] / 0.5 * rl / sr; const bi = Math.round((song - 1.0) / 0.5123); if (bi < 0) continue; seen.add(bi); errs.push(Math.abs(song - beats[bi]) * 1000); }
    errs.sort((x, y) => x - y);
    const lastSong = A[A.length - 1] / 0.5 * rl / sr;
    const expectedCount = beats.filter(b => b < lastSong - 0.1).length;
    console.log('  tempo', t, 'clicks', on.length, 'expected', expectedCount, 'distinct', seen.size, 'error vs heard audio ms: median', errs[errs.length >> 1].toFixed(2), 'max', errs[errs.length - 1].toFixed(2));
    ok(Math.abs(on.length - expectedCount) <= 1 && seen.size === on.length - (on.length - seen.size) && errs[errs.length >> 1] < 12 && errs[errs.length - 1] < (t === 1 ? 0.1 : 30), 'tempo ' + t + ': each beat exactly one click, aligned with audio');
  }
  // accent louder / different
  const e = new Engine(zs, sr, sr); e.setMetronome({ enabled: true, beats: Float64Array.from([0.1, 0.3]), accents: new Set([0]), volume: 1 });
  const [L] = renderAll(e, 4); let m1 = 0, m2 = 0; for (let i = 0; i < L.length; i++) { const t = i / sr; if (t > 0.09 && t < 0.2) m1 = Math.max(m1, Math.abs(L[i])); if (t > 0.29 && t < 0.4) m2 = Math.max(m2, Math.abs(L[i])); }
  ok(m1 > m2 && m2 > 0.3, 'accent click louder (' + m1.toFixed(2) + ' vs ' + m2.toFixed(2) + ')');
  // metronome across loop wrap
  const e2 = new Engine(zs, sr, sr); e2.setMetronome({ enabled: true, beats: Float64Array.from({ length: 40 }, (_, i) => i * 0.5), volume: 1 });
  e2.seek(0.1); e2.setLoop(2, 4);
  const [L2] = renderAll(e2, Math.ceil(10 * sr / BS)); let c = 0, q = 1e9;
  for (let i = 0; i < L2.length; i++) { if (Math.abs(L2[i]) > 0.05) { if (q > 0.02 * sr) c++; q = 0; } else q++; }
  // 0.1->2: beats .5,1,1.5 =3 ; then loop [2,4): beats 2,2.5,3,3.5 per pass (4/pass). total time ~10 s
  const exp = 3 + Math.floor((10 - 1.9) / 2) * 4; console.log('  loop+metronome clicks', c, 'expected ~', exp);
  ok(Math.abs(c - exp) <= 4, 'metronome follows loop wrap');
}

console.log('8. non-44100 context (48000) resampling path');
{
  const n = sr * 10, s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
  for (const t of [1, 0.8]) {
    const e = new Engine({ a: [s, s] }, sr, 48000); e.setTempo(t);
    const nb = 60, [L] = renderAll(e, nb);
    let zc = 0, first = -1, last = -1; for (let i = 20000; i < nb * BS - 1; i++) if (L[i] <= 0 && L[i + 1] > 0) { const x = i + (-L[i]) / (L[i + 1] - L[i]); if (first < 0) first = x; last = x; zc++; }
    const f = (zc - 1) * 48000 / (last - first);
    console.log('  ctx 48000, tempo', t, 'pitch', f.toFixed(2), 'Hz, position', e.getPosition().toFixed(3), 's (expected', (nb * BS / 48000 * t).toFixed(3), ')');
    ok(Math.abs(f - 440) < 2 && Math.abs(e.getPosition() - nb * BS / 48000 * t) < 0.08, 'rate conversion correct @ tempo ' + t);
  }
}

console.log('9. StemPlayer with mocked AudioContext');
{
  const ctx = { sampleRate: 44100, currentTime: 0, state: 'running', destination: {}, outputLatency: 0.05,
    createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; },
    createScriptProcessor(bs) { this.node = { bufferSize: bs, connect() {}, disconnect() {}, onaudioprocess: null }; return this.node; } };
  const small = {}; for (const id of IDS) small[id] = [stems[id][0].subarray(0, sr * 3), stems[id][1].subarray(0, sr * 3)];
  const p = new SP(ctx, small, sr); let ended = 0; p.onended = () => ended++;
  const drive = (blocks) => { for (let i = 0; i < blocks; i++) { const L = new Float32Array(4096), R = new Float32Array(4096);
    ctx.node.onaudioprocess({ outputBuffer: { length: 4096, numberOfChannels: 2, getChannelData: c => c ? R : L }, playbackTime: ctx.currentTime + 4096 / sr }); ctx.currentTime += 4096 / sr; } };
  ok(Math.abs(p.duration - 3) < 1e-6 && !p.isPlaying && p.position === 0, 'initial state');
  p.seek(1); p.play(); ok(p.isPlaying && Math.abs(p.position - 1) < 1e-6, 'play after seek: position = 1 before first block');
  drive(10); const pos = p.position;
  console.log('  after 10 blocks position', pos.toFixed(3), '(latency compensated, expected ~', (1 + 9 * 4096 / sr - 0.05).toFixed(3), ')');
  ok(Math.abs(pos - (1 + 9 * 4096 / sr - 0.05)) < 0.02, 'position tracks audible time');
  p.pause(); const pp = p.position; drive(2); ok(!p.isPlaying && p.position === pp, 'pause freezes position');
  p.seek(0.5); ok(p.position === 0.5, 'seek while paused');
  p.setTempo(0.75); p.play(); p.setLoop(0.5, 1.0); drive(30);
  ok(p.position >= 0.5 && p.position <= 1.05, 'looping at 0.75: position ' + p.position.toFixed(3));
  p.clearLoop(); p.seek(2.5); drive(20);
  // let timers fire
  setTimeout(() => { ok(ended === 1 && !p.isPlaying, 'onended fired once at the end (' + ended + ')'); p.destroy(); console.log('\nALL PASSED (' + pass + ' checks)'); }, 400);
}
