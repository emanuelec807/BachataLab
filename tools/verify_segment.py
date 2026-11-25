"""One 7.8 s segment of Frío: official Demucs forward vs exported core + numpy DSP. Runs the two in sequence to fit in RAM."""
import sys, gc
sys.path.insert(0, '/home/claude/bachata')
import numpy as np, soundfile as sf, torch
from dsp_ref import demucs_spec, demucs_ispec

L = 343980
mix, _ = sf.read('/home/claude/bachata/in/frio_60s.wav', dtype='float32', always_2d=True)
seg = mix.T[:, 20 * 44100:20 * 44100 + L].copy()
from demucs.pretrained import get_model
m = get_model('htdemucs_6s').models[0].eval()
with torch.no_grad():
    ref = m(torch.from_numpy(seg)[None]).numpy()[0]
del m; gc.collect()
import onnxruntime as ort
so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC; so.enable_cpu_mem_arena = False
sess = ort.InferenceSession(sys.argv[1], so, providers=['CPUExecutionProvider'])
zo, xt = sess.run(None, {'mix': seg[None], 'spec': demucs_spec(seg)[None]})
est = demucs_ispec(zo[0], L) + xt[0]
for k, n in enumerate(['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']):
    r, e = ref[k], est[k]
    print(f'{n:7s} {10*np.log10((r**2).sum()/(((r-e)**2).sum()+1e-20)):6.1f} dB')
