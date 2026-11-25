// Compare downbeat heuristics on separated stems: bass-energy (current) vs harmonic change (chord changes land on 1 and 5).
const fs = require('fs');
global.self = global; require('../src/beats.js'); const Sep = require('../src/separate.js');
function readWav(p) { const b = fs.readFileSync(p); let off = 12, fmt, data;
  while (off < b.length) { const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), bits: b.readUInt16LE(off + 22), f: b.readUInt16LE(off + 8) };
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size); off += 8 + size + (size & 1); }
  const n = data.length / (fmt.bits / 8) / fmt.ch, out = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const k = (i * fmt.ch + Math.min(c, fmt.ch - 1)) * (fmt.bits / 8); out[c][i] = fmt.f === 3 ? data.readFloatLE(k) : data.readInt16LE(k) / 32768; }
  return out; }
const dir = process.argv[2] || '/home/claude/app/test/out/';
const st = {}; for (const id of ['vocals', 'guitar', 'bass', 'bongo', 'guira', 'altro']) st[id] = readWav(dir + id + '.wav');
const SR = 44100, n = st.bass[0].length, mono = new Float32Array(n);
for (const id of ['bongo', 'guira', 'bass']) for (let i = 0; i < n; i++) mono[i] += (st[id][0][i] + st[id][1][i]) / 2;
const bt = self.BeatTracker.analyze(mono, SR), beats = Array.from(bt.beats);
console.log('bpm', bt.bpm.toFixed(1), 'beats', beats.length, 'first beat', beats[0].toFixed(2));
// current heuristic
const w = Math.floor(0.06 * SR), bassScore = new Float64Array(8);
beats.forEach((t, i) => { const a = Math.floor(t * SR); if (a + w >= n) return; let e = 0; for (let j = a; j < a + w; j++) e += st.bass[0][j] ** 2; bassScore[i % 8] += e; });
// harmonic: chroma of guitar+bass (+altro) per beat
const harm = new Float32Array(n); for (const id of ['guitar', 'bass', 'altro']) for (let i = 0; i < n; i++) harm[i] += (st[id][0][i] + st[id][1][i]) / 2;
const NF = 8192, HOP = 2048, z = Sep.stft(harm, NF, HOP, false);
const chromaAt = (t0, t1) => { const c = new Float64Array(12); const f0 = Math.max(0, Math.floor(t0 * SR / HOP)), f1 = Math.min(z.T, Math.ceil(t1 * SR / HOP));
  for (let f = 1; f < z.F; f++) { const hz = f * SR / NF; if (hz < 55 || hz > 1800) continue; const pc = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    for (let t = f0; t < f1; t++) { const m = Math.hypot(z.re[f * z.T + t], z.im[f * z.T + t]); c[pc] += m; } }
  const s = Math.hypot(...c) || 1; return c.map(v => v / s); };
const nov = new Float64Array(8), cnt = new Float64Array(8);
for (let i = 2; i < beats.length - 2; i++) {
  const before = chromaAt(beats[i - 2], beats[i]), after = chromaAt(beats[i], beats[i + 2]);
  let dot = 0; for (let k = 0; k < 12; k++) dot += before[k] * after[k];
  nov[i % 8] += 1 - dot; cnt[i % 8]++;
}
const fmtA = a => Array.from(a).map(v => v.toFixed(3)).join(' ');
console.log('bass score  by beat%8:', fmtA(bassScore.map(v => v / Math.max(...bassScore))));
console.log('chord change by beat%8:', fmtA(nov.map((v, k) => v / cnt[k])));
const argmax = a => a.indexOf(Math.max(...a));
console.log('current guess (bass) oneIdx =', argmax(Array.from(bassScore)));
const n4 = [0, 1, 2, 3].map(k => nov[k] / cnt[k] + nov[k + 4] / cnt[k + 4]);
console.log('chord change by beat%4:', fmtA(n4), '-> phase', argmax(n4));
