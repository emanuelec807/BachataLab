"""Python reference of the browser pipeline on the first N seconds, compared with the JS output in /home/claude/app/test/out."""
import sys
sys.path.insert(0, '/home/claude/bachata')
import numpy as np, soundfile as sf, onnxruntime as ort, librosa
from dsp_ref import demucs_spec, demucs_ispec

secs = int(sys.argv[1]); sr = 44100; L = 343980
mix, _ = sf.read('/home/claude/bachata/in/frio_60s.wav', dtype='float32', always_2d=True)
mix = mix.T[:, :secs * sr]; total = mix.shape[1]
so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC; so.enable_cpu_mem_arena = False
sess = ort.InferenceSession('/home/claude/bachata/onnx/demucs6_h.onnx', so, providers=['CPUExecutionProvider'])
overlap = L // 4; stride = L - overlap
win = np.ones(L, np.float32); f = np.arange(overlap) / (overlap - 1); win[:overlap] = f; win[L - overlap:] = f[::-1]
out = np.zeros((6, 2, total), np.float32); ws = np.zeros(total, np.float32); i = 0
while i * stride < total:
    s = i * stride; e = min(s + L, total); c = np.zeros((2, L), np.float32); c[:, :e - s] = mix[:, s:e]
    zo, xt = sess.run(None, {'mix': c[None], 'spec': demucs_spec(c)[None]})
    y = demucs_ispec(zo[0], L) + xt[0]
    out[:, :, s:e] += y[:, :, :e - s] * win[:e - s]; ws[s:e] += win[:e - s]; i += 1
out /= np.maximum(ws, 1e-8)
names = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
ref = dict(zip(names, out))
def agree(a, b): return 10 * np.log10((a ** 2).sum() / (((a - b) ** 2).sum() + 1e-20))
for js, py in [('vocals', 'vocals'), ('guitar', 'guitar'), ('bass', 'bass')]:
    j, _ = sf.read(f'/home/claude/app/test/out/{js}.wav', dtype='float32', always_2d=True)
    print(f'{js:7s} JS vs Python {agree(ref[py], j.T[:, :total]):6.1f} dB')
d = ref['drums']; jb, _ = sf.read('/home/claude/app/test/out/bongo.wav', dtype='float32', always_2d=True); jg, _ = sf.read('/home/claude/app/test/out/guira.wav', dtype='float32', always_2d=True)
print(f'drums   JS (bongo+guira) vs Python {agree(d, (jb + jg).T[:, :total]):6.1f} dB')
ms = sum(ref.values()); print('python sum-of-stems vs mix SNR', round(float(agree(mix, ms)), 1))
x = jg.T.mean(0); S = np.abs(librosa.stft(x)); fr = librosa.fft_frequencies(sr=sr)
print('JS güira share >4 kHz', round(float(S[fr > 4000].sum() / S.sum() * 100)), '%  rms dB', round(float(20 * np.log10(np.sqrt((x ** 2).mean()))), 1))
