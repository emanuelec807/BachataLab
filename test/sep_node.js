// Node check of separate.js against the Python pipeline, using onnxruntime-node.
// usage: node test/sep_node.js <seconds>
const fs = require('fs');
const ort = require('onnxruntime-node');
const Sep = require('../src/separate.js');

function readWav(p) {
  const b = fs.readFileSync(p);
  let off = 12, fmt, data;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22), fmt: b.readUInt16LE(off + 8) };
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch, chans = [];
  for (let c = 0; c < fmt.ch; c++) chans.push(new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const k = (i * fmt.ch + c) * (fmt.bits / 8);
    chans[c][i] = fmt.fmt === 3 ? data.readFloatLE(k) : data.readInt16LE(k) / 32768;
  }
  return { sr: fmt.sr, chans };
}
function writeWav(p, chans, sr) {
  const n = chans[0].length, C = chans.length, b = Buffer.alloc(44 + n * C * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * C * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); b.writeUInt16LE(C, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * C * 4, 28); b.writeUInt16LE(C * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36); b.writeUInt32LE(n * C * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) b.writeFloatLE(chans[c][i], 44 + (i * C + c) * 4);
  fs.writeFileSync(p, b);
}

(async () => {
  const secs = +(process.argv[2] || 20);
  const { sr, chans } = readWav('/home/claude/bachata/in/frio_60s.wav');
  const n = secs * sr;
  const L = chans[0].slice(0, n), R = chans[1].slice(0, n);
  const opt = { graphOptimizationLevel: 'basic', enableCpuMemArena: false };
  const sessions = {
    demucs: await ort.InferenceSession.create('/home/claude/bachata/onnx/demucs6_h.onnx', opt),
    guira: await ort.InferenceSession.create('/home/claude/bachata/onnx/guira_h.onnx', opt),
  };
  const t = Date.now();
  const stems = await Sep.separate(ort, sessions, L, R, p => { if (p.i === p.n || !p.i) console.log(p.stage, p.i || '', p.n || '', (p.elapsed / 1000).toFixed(1) + 's'); });
  console.log('total', ((Date.now() - t) / 1000).toFixed(1), 's for', secs, 's of audio');
  fs.mkdirSync('/home/claude/app/test/out', { recursive: true });
  for (const [k, v] of Object.entries(stems)) writeWav(`/home/claude/app/test/out/${k}.wav`, v, sr);
  // sanity: stems should sum back to the mix
  let e = 0, s = 0;
  for (let i = 0; i < n; i++) { let sum = 0; for (const v of Object.values(stems)) sum += v[0][i]; e += (sum - L[i]) ** 2; s += L[i] ** 2; }
  console.log('sum-of-stems vs mix SNR dB', (10 * Math.log10(s / e)).toFixed(1));
})().catch(e => { console.error(e); process.exit(1); });
