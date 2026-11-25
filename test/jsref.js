// Writes the JS separation of the first N seconds of Frío as raw float32 files for the Java check.
const fs = require('fs'), ort = require('onnxruntime-node'), Sep = require('../src/separate.js');
const src = fs.readFileSync(__dirname + '/sep_node.js', 'utf8'); const readWav = eval('(' + src.match(/function readWav[\s\S]*?\n}\n/)[0] + ')');
(async () => {
  const secs = +process.argv[2], { sr, chans } = readWav('/home/claude/bachata/in/frio_60s.wav'), n = secs * sr;
  const L = chans[0].slice(0, n), R = chans[1].slice(0, n);
  fs.mkdirSync('/home/claude/jtest/ref', { recursive: true });
  fs.writeFileSync('/home/claude/jtest/ref/in_L.f32', Buffer.from(L.buffer)); fs.writeFileSync('/home/claude/jtest/ref/in_R.f32', Buffer.from(R.buffer));
  const opt = { graphOptimizationLevel: 'all', intraOpNumThreads: 2, enableCpuMemArena: false };
  const s = { demucs: await ort.InferenceSession.create('/home/claude/bachata/onnx/demucs6_h.onnx', opt), guira: await ort.InferenceSession.create('/home/claude/bachata/onnx/guira_h.onnx', opt) };
  const t = Date.now(); const r = await Sep.separate(ort, s, L, R, () => {}, () => false, {}); console.log('js secs', (Date.now() - t) / 1000);
  for (const k in r) for (const c of [0, 1]) fs.writeFileSync(`/home/claude/jtest/ref/${k}_${c}.f32`, Buffer.from(r[k][c].buffer));
})().catch(e => { console.error(e); process.exit(1); });
