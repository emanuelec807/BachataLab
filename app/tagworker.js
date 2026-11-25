/* Names the "Altro" track: YAMNet (Google, AudioSet, 521 classes, Apache-2.0, 7.5 MB) listens to the parts
   where Altro plays and says which instrument family it is (requinto, accordion, keys, strings, horns).
   Input: mono Float32 at 16 kHz. Output: { name or null, scores }. */
/* global ort */
importScripts('ort.wasm.min.js');

// Instrument families, by AudioSet class index (yamnet_class_map.csv)
const GROUPS = {
  Requinto: [134, 135, 136, 138, 139, 140, 141, 142, 143, 144, 145, 146, 194], // plucked strings, guitars, mandolin, zither, ukulele, banjo, sitar, harp
  Fisarmonica: [203, 204, 205], // harmonica, accordion, bagpipes
  Tastiere: [147, 148, 149, 150, 151, 152, 153, 154, 155], // keyboard, piano, electric piano, organs, synthesizer, sampler, harpsichord
  Archi: [184, 185, 186, 187, 188], // bowed strings, string section, violin, pizzicato, cello
  Fiati: [180, 181, 182, 183, 190, 191, 192, 193], // brass, horn, trumpet, trombone, woodwinds, flute, sax, clarinet
};

// log-mel patches as YAMNet's features.py: 25 ms Hann frames every 10 ms, |FFT 512|, 64 mel 125–7500 Hz, ln(x + 0.001), 96 frames every 48
function melMatrix() {
  const nb = 257, mel = f => 1127 * Math.log(1 + f / 700), lo = mel(125), hi = mel(7500), W = new Float32Array(nb * 64);
  const pts = Array.from({ length: 66 }, (_, i) => lo + (hi - lo) * i / 65);
  for (let b = 1; b < nb; b++) { const m = mel(b * 8000 / 256);
    for (let i = 0; i < 64; i++) { const l = pts[i], c = pts[i + 1], r = pts[i + 2]; W[b * 64 + i] = Math.max(0, Math.min((m - l) / (c - l), (r - m) / (r - c))); } }
  return W;
}
function fft(re, im) { const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
function logMel(x) {
  const W = melMatrix(), win = Float32Array.from({ length: 400 }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 400));
  const nf = 1 + Math.floor((x.length - 400) / 160), out = new Float32Array(nf * 64), re = new Float64Array(512), im = new Float64Array(512);
  for (let f = 0; f < nf; f++) {
    re.fill(0); im.fill(0); for (let i = 0; i < 400; i++) re[i] = x[f * 160 + i] * win[i];
    fft(re, im);
    for (let k = 0; k < 64; k++) { let s = 0; for (let b = 1; b < 257; b++) { const w = W[b * 64 + k]; if (w) s += w * Math.hypot(re[b], im[b]); } out[f * 64 + k] = Math.log(s + 0.001); }
  }
  return { lm: out, nf };
}

async function model() {
  const txt = await (await fetch('models/yamnet.b64.txt')).text(), bin = atob(txt), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(u, { executionProviders: ['wasm'] });
}

self.onmessage = async ({ data: m }) => {
  try {
    let x = m.audio; if (x.length < 15600) { const y = new Float32Array(15600); y.set(x); x = y; }
    // only the patches where the track really plays, brought to a common level
    const np = Math.floor((Math.floor((x.length - 400) / 160) + 1 - 96) / 48) + 1, rms = new Float32Array(Math.max(0, np));
    for (let p = 0; p < np; p++) { let e = 0; const a = p * 48 * 160, b = a + 96 * 160; for (let i = a; i < b; i++) e += x[i] * x[i]; rms[p] = Math.sqrt(e / (b - a)); }
    const peak = Math.max(...rms, 0), act = []; for (let p = 0; p < np; p++) if (rms[p] > peak * 0.25 && rms[p] > 1e-4) act.push(p);
    if (act.length < 4) return postMessage({ name: null, scores: {}, active: act.length });
    const lvl = act.map(p => rms[p]).sort((a, b) => a - b)[act.length >> 1], g = 0.1 / lvl;
    const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
    const { lm } = logMel(y), P = new Float32Array(act.length * 96 * 64);
    act.forEach((p, k) => P.set(lm.subarray(p * 48 * 64, (p * 48 + 96) * 64), k * 96 * 64));
    const s = await model(), out = await s.run({ patches: new ort.Tensor('float32', P, [act.length, 96, 64]) });
    const sc = out.scores.data, mean = new Float32Array(521);
    for (let k = 0; k < act.length; k++) for (let c = 0; c < 521; c++) mean[c] += sc[k * 521 + c] / act.length;
    const scores = {}; for (const g2 in GROUPS) scores[g2] = Math.max(...GROUPS[g2].map(i => mean[i]));
    const rank = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    // a name only when one family clearly wins; otherwise the track stays "Altro"
    const name = rank[0][1] >= 0.06 && rank[0][1] >= 2 * rank[1][1] ? rank[0][0] : null;
    postMessage({ name, scores, active: act.length / np });
  } catch (e) { postMessage({ name: null, error: String(e && e.message || e) }); }
};
