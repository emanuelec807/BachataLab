// Minimal WAV reader (PCM 8/16/24/32-bit and float32). Returns {sampleRate, channels:[Float32Array...]}.
const fs = require('fs');
module.exports = function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV: ' + file);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4); let size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(body), ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === 'data') { if (body + size > b.length) size = b.length - body; data = b.subarray(body, body + size); break; }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad WAV');
  const bps = fmt.bits / 8, n = Math.floor(data.length / (bps * fmt.ch));
  const chans = []; for (let c = 0; c < fmt.ch; c++) chans.push(new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const o = (i * fmt.ch + c) * bps; let v;
    if (fmt.tag === 3) v = fmt.bits === 32 ? data.readFloatLE(o) : data.readDoubleLE(o);
    else if (fmt.bits === 16) v = data.readInt16LE(o) / 32768;
    else if (fmt.bits === 24) v = data.readIntLE(o, 3) / 8388608;
    else if (fmt.bits === 32) v = data.readInt32LE(o) / 2147483648;
    else v = (data[o] - 128) / 128;
    chans[c][i] = v;
  }
  return { sampleRate: fmt.sr, channels: chans };
};
