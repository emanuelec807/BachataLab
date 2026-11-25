const fs = require('fs'), vm = require('vm'), path = require('path'), readWav = require('./wav');
const sb = { Math, Float32Array, Float64Array, Int32Array, Uint32Array, Array, Object, console }; sb.self = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/beats.js'), 'utf8'), sb);
const BT = sb.BeatTracker;
module.exports = BT;
if (require.main === module) {
  const D = '/home/claude/bachata/final/';
  const ws = ['bongo', 'guira', 'bass'].map(n => readWav(D + n + '.wav'));
  const n = ws[0].channels[0].length, sr = ws[0].sampleRate, mono = new Float32Array(n);
  for (const w of ws) { const c = w.channels; for (let i = 0; i < n; i++) mono[i] += (c.length > 1 ? (c[0][i] + c[1][i]) / 2 : c[0][i]); }
  fs.mkdirSync('/tmp/ref', { recursive: true });
  const t0 = process.hrtime.bigint(); const r = BT.analyze(mono, sr); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('analyze time ms', ms.toFixed(0), '(60 s audio)');
  console.log('bpm', r.bpm.toFixed(3), 'confidence', r.confidence.toFixed(3), 'beats', r.beats.length, 'first', Array.from(r.beats.slice(0, 4)).map(x => x.toFixed(3)), 'last', r.beats[r.beats.length - 1].toFixed(3));
  fs.writeFileSync('/tmp/ref/js.json', JSON.stringify({ bpm: r.bpm, beats: Array.from(r.beats), confidence: r.confidence }));
  const g = BT.grid(120, 0.3, 5); console.log('grid(120,0.3,5):', Array.from(g).map(x => x.toFixed(2)).join(' '));
}

// ---------- extra checks (run with: node test/beats.test.js) ----------
if (require.main === module) {
  const assert = require('assert'); let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  PASS', m); };
  const sr = 44100, D = '/home/claude/bachata/final/';
  if (!fs.existsSync('/tmp/ref/librosa.json')) { console.log('run: python3 test/ref_librosa.py first for the librosa comparison'); process.exit(0); }
  const lib = JSON.parse(fs.readFileSync('/tmp/ref/librosa.json', 'utf8')), js = JSON.parse(fs.readFileSync('/tmp/ref/js.json', 'utf8'));
  // vs librosa (reference produced by test/ref_librosa.py)
  const lb = lib.beats, jb = js.beats, offs = [];
  for (const t of lb) { let best = 1e9; for (const b of jb) if (Math.abs(b - t) < Math.abs(best)) best = b - t; offs.push(best * 1000); }
  offs.sort((a, b) => a - b);
  console.log('vs librosa: bpm', js.bpm.toFixed(2), 'vs', lib.tempo.toFixed(2), '| nearest-beat offset ms median', offs[offs.length >> 1].toFixed(1), 'min', offs[0].toFixed(1), 'max', offs[offs.length - 1].toFixed(1));
  ok(Math.abs(js.bpm - lib.tempo) < 1.0, 'bpm within 1 of librosa');
  ok(Math.abs(offs[offs.length >> 1]) < 25, 'median beat offset vs librosa < 25 ms (librosa itself lags real onsets by ~10 ms)');
  // synthetic click tracks with off-beat 16ths (bachata-ish): tempo + phase
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5;
  for (const bpm of [96, 110, 124, 135, 150, 172]) {
    const dur = 45, x = new Float32Array(sr * dur), P = 60 / bpm, t0 = 0.43;
    for (let k = 0; t0 + k * P / 2 < dur - 0.3; k++) { const amp = k % 2 === 0 ? 1 : 0.45, s = Math.round((t0 + k * P / 2) * sr); for (let i = 0; i < 1500; i++) x[s + i] += rnd() * 2 * amp * Math.exp(-i / 250) + (k % 2 === 0 ? 0.7 * Math.sin(i * 0.02) * Math.exp(-i / 700) : 0); }
    const r = BT.analyze(x, sr); const o = r.beats.map(b => { const k = Math.round((b - t0) / P); return (b - (t0 + k * P)) * 1000; }).sort((a, b) => a - b);
    console.log('  synthetic', bpm, '->', r.bpm.toFixed(2), 'phase err median ms', o[o.length >> 1].toFixed(1), 'conf', r.confidence.toFixed(2));
    ok(Math.abs(r.bpm - bpm) < 0.7 && Math.abs(o[o.length >> 1]) < 12, 'synthetic ' + bpm + ' BPM (no half/double error)');
  }
  // grid()
  const g = BT.grid(120, 0.3, 5); ok(g instanceof Float64Array && Math.abs(g[0] - 0.3) < 1e-9 && g.length === 10 && Math.abs(g[1] - g[0] - 0.5) < 1e-9, 'grid(120,0.3,5) = 0.3,0.8,...,4.8');
  const g2 = BT.grid(90, 7.1, 20); ok(g2[0] >= 0 && g2[0] < 60 / 90 && g2[g2.length - 1] <= 20, 'grid covers [0,duration] through anchor');
  // robustness: the other 4-stem-ish mixes / excerpts
  const rd = n => readWav(D + n + '.wav').channels; const mix = (names, a, b) => { const o = new Float32Array(b - a); for (const n of names) { const c = rd(n); for (let i = a; i < b; i++) o[i - a] += (c[0][i] + c[1][i]) / 2; } return o; };
  for (const [nm, names, a, b] of [['bongo+guira+bass 0-30 s', ['bongo', 'guira', 'bass'], 0, 30 * sr], ['bongo+guira+bass 25-60 s', ['bongo', 'guira', 'bass'], 25 * sr, 60 * sr], ['all stems', ['vocals', 'guitar', 'bass', 'bongo', 'guira', 'altro'], 0, 60 * sr]]) {
    const r = BT.analyze(mix(names, a, b), sr); console.log('  ', nm, '->', r.bpm.toFixed(2), 'BPM, conf', r.confidence.toFixed(2)); ok(Math.abs(r.bpm - 118) < 1.5, nm + ' ~118 BPM');
  }
  console.log('BEATS PASSED (' + pass + ' checks)');
}
