// Compares faster window settings against the reference ones: time and SNR per stem.
const fs = require('fs'), ort = require('onnxruntime-node'), Sep = require('../src/separate.js');
const src = fs.readFileSync(__dirname + '/sep_node.js', 'utf8'); const readWav = eval('(' + src.match(/function readWav[\s\S]*?\n}\n/)[0] + ')');
(async () => {
  const secs = +(process.argv[2] || 30);
  const { sr, chans } = readWav('/home/claude/bachata/in/frio_60s.wav'); const n = secs * sr;
  const L = chans[0].slice(0, n), R = chans[1].slice(0, n);
  const opt = { graphOptimizationLevel: 'all', intraOpNumThreads: 2, enableCpuMemArena: false };
  const s = { demucs: await ort.InferenceSession.create('/home/claude/bachata/onnx/demucs6_h.onnx', opt), guira: await ort.InferenceSession.create('/home/claude/bachata/onnx/guira_h.onnx', opt) };
  const run = async o => { const t = Date.now(); let tg = 0; const r = await Sep.separate(ort, s, L.slice(), R.slice(), p => { if (p.stage === 'resample') tg = Date.now(); }, () => false, o); return { r, dem: (tg - t) / 1000, gu: (Date.now() - tg) / 1000 }; };
  const ref = await run({ overlap: 0.25, guiraCtx: 1 }); console.log('ref', ref.dem, ref.gu);
  for (const o of JSON.parse(process.argv[3])) {
    const x = await run(o), snr = {};
    for (const k in ref.r) { let e = 0, p = 0; for (const c of [0, 1]) { const a = ref.r[k][c], b = x.r[k][c]; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; p += a[i] * a[i]; } } snr[k] = +(10 * Math.log10(p / (e + 1e-12))).toFixed(1); }
    console.log(JSON.stringify(o), 'demucs', x.dem, 'guira', x.gu, JSON.stringify(snr));
  }
})().catch(e => { console.error("ERR", e); process.exit(1); });
