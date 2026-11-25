"""Export AudioSep's separator as a fixed "güira extractor" ONNX model.

The text query is encoded once here and baked in, so the phone never needs
the 2.35 GB CLAP text/audio encoder: only the separator network ships.
Input: 5 s mono chunk at 32 kHz [1,1,160000]. Output: same shape, the güira.
"""
import sys, os, time
sys.path.insert(0, '/home/claude/AudioSep')
os.chdir('/home/claude/AudioSep')
import numpy as np, torch
import torch.nn.functional as F
from torchlibrosa.stft import magphase
from numpy.core.multiarray import scalar as _np_scalar
torch.serialization.add_safe_globals([(_np_scalar, 'numpy.core.multiarray.scalar'), _np_scalar, np.dtype, type(np.dtype('float64'))])
from pipeline import build_audiosep

QUERY = 'guiro scraping metal scraper'
WIN = 160000  # NL+NC+NR = 1+3+1 s at 32 kHz, same window as chunk_inference
OUT = '/home/claude/bachata/onnx'
os.makedirs(OUT, exist_ok=True)

model = build_audiosep('config/audiosep_base.yaml', 'checkpoint/audiosep_base_4M_steps.ckpt', torch.device('cpu'))
with torch.no_grad():
    cond = model.query_encoder.get_query_embed(modality='text', text=[QUERY], device='cpu')
np.save(f'{OUT}/guira_condition.npy', cond.numpy())


class GuiraExtractor(torch.nn.Module):
    """Waveform chunk -> separated complex spectrogram [1,2,T,F] (real, imag).
    The inverse STFT is left out (its col2im op does not export) and runs in app code."""
    def __init__(self, ss, cond):
        super().__init__()
        self.ss = ss
        self.register_buffer('cond', cond)

    def forward(self, chunk):
        b = self.ss.base
        fd = self.ss.film(conditions=self.cond)
        mag, cos_in, sin_in = b.wav_to_spectrogram_phase(chunk)
        x = b.bn0(mag.transpose(1, 3)).transpose(1, 3)
        origin_len = x.shape[2]
        pad_len = int(np.ceil(origin_len / b.time_downsample_ratio)) * b.time_downsample_ratio - origin_len
        x = F.pad(x, pad=(0, 0, 0, pad_len))[..., 0:x.shape[-1] - 1]
        x = b.pre_conv(x)
        x1p, x1 = b.encoder_block1(x, fd['encoder_block1'])
        x2p, x2 = b.encoder_block2(x1p, fd['encoder_block2'])
        x3p, x3 = b.encoder_block3(x2p, fd['encoder_block3'])
        x4p, x4 = b.encoder_block4(x3p, fd['encoder_block4'])
        x5p, x5 = b.encoder_block5(x4p, fd['encoder_block5'])
        x6p, x6 = b.encoder_block6(x5p, fd['encoder_block6'])
        xc, _ = b.conv_block7a(x6p, fd['conv_block7a'])
        x = b.decoder_block1(xc, x6, fd['decoder_block1'])
        x = b.decoder_block2(x, x5, fd['decoder_block2'])
        x = b.decoder_block3(x, x4, fd['decoder_block3'])
        x = b.decoder_block4(x, x3, fd['decoder_block4'])
        x = b.decoder_block5(x, x2, fd['decoder_block5'])
        x = b.decoder_block6(x, x1, fd['decoder_block6'])
        x = F.pad(b.after_conv(x), pad=(0, 1))[:, :, 0:origin_len, :]
        T, Fq = x.shape[2], x.shape[3]
        x = x.reshape(1, 1, 1, b.K, T, Fq)
        mask_mag = torch.sigmoid(x[:, :, :, 0])
        _, mc, ms = magphase(torch.tanh(x[:, :, :, 1]), torch.tanh(x[:, :, :, 2]))
        oc = cos_in[:, None] * mc - sin_in[:, None] * ms
        os_ = sin_in[:, None] * mc + cos_in[:, None] * ms
        om = F.relu(mag[:, None] * mask_mag)
        return torch.cat([(om * oc).reshape(1, 1, T, Fq), (om * os_).reshape(1, 1, T, Fq)], 1)


ext = GuiraExtractor(model.ss_model, cond).eval()
n_par = sum(p.numel() for p in ext.parameters())
print(f'separatore: {n_par/1e6:.1f} M parametri ({n_par*4/1e6:.0f} MB fp32)', flush=True)

x = torch.randn(1, 1, WIN) * 0.1
with torch.no_grad():
    ref = model.ss_model.base(mixtures=x, film_dict=model.ss_model.film(conditions=cond))['waveform']
    mine = ext(x)
path = f'{OUT}/guira_extractor.onnx'
torch.onnx.export(ext, (x,), path, input_names=['chunk'], output_names=['guira'],
                  opset_version=18, dynamo=False)
print('onnx MB', round(os.path.getsize(path) / 1e6, 1), flush=True)

import onnxruntime as ort
sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
t = time.time()
out = sess.run(None, {'chunk': x.numpy()})[0]
spec = torch.from_numpy(out)
with torch.no_grad():
    out = model.ss_model.base.istft(spec[:, :1], spec[:, 1:], WIN).reshape(1, 1, WIN).numpy()
print('onnxruntime 5 s chunk:', round(time.time() - t, 2), 's')
print('max diff vs PyTorch:', float(np.abs(out - ref.numpy()).max()), ' ref max', float(np.abs(ref.numpy()).max()))
