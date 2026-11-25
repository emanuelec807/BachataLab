"""Run the exported Demucs core on the Frío minute (numpy DSP around it) and compare with official stems."""
import sys, time, resource
sys.path.insert(0, '/home/claude/bachata')
import numpy as np, soundfile as sf, onnxruntime as ort
from dsp_ref import demucs_spec, demucs_ispec

opt = sys.argv[1] if len(sys.argv) > 1 else 'basic'
model = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/bachata/onnx/demucs6.onnx'
SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
L = 343980
so = ort.SessionOptions()
so.graph_optimization_level = {'none': ort.GraphOptimizationLevel.ORT_DISABLE_ALL,
                               'basic': ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
                               'all': ort.GraphOptimizationLevel.ORT_ENABLE_ALL}[opt]
so.enable_cpu_mem_arena = False
sess = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
print('loaded, peak MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, flush=True)

mix, sr = sf.read('/home/claude/bachata/in/frio_60s.wav', dtype='float32', always_2d=True)
mix = mix.T
total = mix.shape[1]; overlap = L // 4; stride = L - overlap
win = np.ones(L, np.float32); f = np.linspace(0, 1, overlap, dtype=np.float32); win[:overlap] = f; win[-overlap:] = f[::-1]
out = np.zeros((6, 2, total), np.float32); wsum = np.zeros(total, np.float32)
t = time.time(); i = 0
while i * stride < total:
    s = i * stride; e = min(s + L, total); c = mix[:, s:e]
    if c.shape[1] < L: c = np.pad(c, ((0, 0), (0, L - c.shape[1])))
    zo, xt = sess.run(None, {'mix': c[None], 'spec': demucs_spec(c)[None]})
    y = demucs_ispec(zo[0], L) + xt[0]
    out[:, :, s:e] += y[:, :, :e - s] * win[:e - s]; wsum[s:e] += win[:e - s]; i += 1
    if i == 1: print('first segment', round(time.time() - t, 1), 's, peak MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, flush=True)
out /= np.maximum(wsum, 1e-8)
print(f'{i} segments in {time.time()-t:.1f}s; peak MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
for k, name in enumerate(SOURCES):
    ref, _ = sf.read(f'/home/claude/bachata/sep/htdemucs_6s/{name}.wav', dtype='float32', always_2d=True)
    ref = ref.T[:, :total]; est = out[k]
    print(f'{name:7s} agreement with official Demucs: {10*np.log10((ref**2).sum()/(((ref-est)**2).sum()+1e-12)):5.1f} dB')
