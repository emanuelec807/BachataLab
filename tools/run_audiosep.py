import sys, os, time
sys.path.insert(0, '/home/claude/AudioSep')
os.chdir('/home/claude/AudioSep')
import torch, numpy as np
# allowlist the only extra types the HF pickle scan reports for these checkpoints (keeps weights_only=True)
from numpy.core.multiarray import scalar as _np_scalar
torch.serialization.add_safe_globals([(_np_scalar, 'numpy.core.multiarray.scalar'), _np_scalar, np.dtype, type(np.dtype('float64'))])
from pipeline import build_audiosep, separate_audio

torch.set_num_threads(2)
dev = torch.device('cpu')
t = time.time()
model = build_audiosep('config/audiosep_base.yaml', 'checkpoint/audiosep_base_4M_steps.ckpt', dev)
print('load', round(time.time() - t, 1), 's', flush=True)

drums = '/home/claude/bachata/sep/htdemucs_6s/drums.wav'
out = '/home/claude/bachata/audiosep'
os.makedirs(out, exist_ok=True)
jobs = [
    ('bongo', 'bongo drums'),
    ('guira', 'guiro scraping metal scraper'),
]
for name, q in jobs:
    t = time.time()
    separate_audio(model, drums, q, f'{out}/{name}.wav', dev, use_chunk=True)
    print(name, round(time.time() - t, 1), 's', flush=True)
