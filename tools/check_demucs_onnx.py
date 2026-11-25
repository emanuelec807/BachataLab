"""Run the Demucs 6-stem ONNX on the Frío minute and compare with official Demucs stems."""
import sys, time
sys.path.insert(0, '/home/claude/bachata')
import numpy as np, soundfile as sf, onnxruntime as ort

SOURCES = ("drums", "bass", "other", "vocals", "guitar", "piano")
N = 343980
mix, sr = sf.read('/home/claude/bachata/in/frio_60s.wav', dtype='float32', always_2d=True)
mix = mix.T
so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC; so.enable_mem_pattern = False; so.enable_cpu_mem_arena = False
sess = ort.InferenceSession('/home/claude/dl_ref/htdemucs_6s_fp16weights.onnx', so, providers=['CPUExecutionProvider'])
total = mix.shape[1]; overlap = N // 4; stride = N - overlap
win = np.ones(N, np.float32); f = np.linspace(0, 1, overlap, dtype=np.float32); win[:overlap] = f; win[-overlap:] = f[::-1]
out = np.zeros((6, 2, total), np.float32); wsum = np.zeros(total, np.float32)
t = time.time(); i = 0
while i * stride < total:
    s = i * stride; e = min(s + N, total); c = mix[:, s:e]
    if c.shape[1] < N: c = np.pad(c, ((0, 0), (0, N - c.shape[1])))
    y = sess.run(['stems'], {'mix': c[None]})[0][0]
    out[:, :, s:e] += y[:, :, :e - s] * win[:e - s]; wsum[s:e] += win[:e - s]; i += 1
out /= np.maximum(wsum, 1e-8)
print(f'{i} chunks in {time.time()-t:.1f}s')
for k, name in enumerate(SOURCES):
    ref, _ = sf.read(f'/home/claude/bachata/sep/htdemucs_6s/{name}.wav', dtype='float32', always_2d=True)
    ref = ref.T[:, :total]; est = out[k]
    sdr = 10 * np.log10((ref ** 2).sum() / (((ref - est) ** 2).sum() + 1e-12) + 1e-12)
    print(f'{name:7s} agreement with official Demucs: {sdr:5.1f} dB')
