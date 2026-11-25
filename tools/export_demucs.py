"""Export the official htdemucs_6s network to ONNX without its STFT/ISTFT.

The app computes the spectrogram before the model and the inverse STFT after it
(both in JavaScript), so the graph holds only convolutions and the transformer.
Inputs : mix [1,2,L] waveform, spec [1,4,2048,T] complex-as-channels spectrogram
Outputs: zout [1,6,4,2048,T] separated spectrograms, xt [1,6,2,L] time-branch waveforms
Final stem = istft(zout) + xt.
"""
import math, os, sys, time
sys.path.insert(0, '/home/claude/bachata')
import numpy as np, torch, onnxruntime as ort
from demucs.pretrained import get_model
from dsp_ref import demucs_spec, demucs_ispec

OUT = '/home/claude/bachata/onnx'
os.makedirs(OUT, exist_ok=True)
m = get_model('htdemucs_6s').models[0].eval()
L = int(m.segment * m.samplerate)
print('sources', m.sources, 'L', L, 'nfft', m.nfft, 'hop', m.hop_length)


class Core(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_upsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_downsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)
        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, mix.shape[-1]) * stdt[:, None] + meant[:, None]
        return x, xt


core = Core(m).eval()
rng = np.random.default_rng(0)
mix = torch.from_numpy((rng.standard_normal((1, 2, L)) * 0.1).astype(np.float32))
mag = torch.from_numpy(demucs_spec(mix.numpy()[0]))[None]  # numpy reference of the JS STFT
with torch.no_grad():
    ref = m(mix)
    zx, xt = core(mix, mag)
path = f'{OUT}/demucs6.onnx'
t = time.time()
torch.onnx.export(core, (mix, mag), path, input_names=['mix', 'spec'], output_names=['zout', 'xt'],
                  opset_version=17, dynamo=False)
print('export', round(time.time() - t), 's; MB', round(os.path.getsize(path) / 1e6, 1))

so = ort.SessionOptions()
sess = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
t = time.time()
zo, xto = sess.run(None, {'mix': mix.numpy(), 'spec': mag.numpy()})
print('ort one segment', round(time.time() - t, 2), 's')
est = demucs_ispec(zo[0], L) + xto[0]  # numpy reference of the JS ISTFT
r = ref.numpy()[0]
print('agreement with official Demucs (dB):', round(float(10 * np.log10((r ** 2).sum() / ((r - est) ** 2).sum())), 1))
