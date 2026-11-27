"""htdemucs_6s core (no STFT) as LiteRT .tflite for the phone GPU (branch veloce).
Only operators the GPU knows: attention written out plainly (PyTorch's adds SELECT guards), position tables as
constants, GELU from ABS/EXP (erf does not convert; the tanh form costs ~40 dB on the quiet stems).
Outputs kept 4-D/3-D: zout [1,24,2048,T] (= [6 sources x 4 ch]), xt [1,12,L]: same memory layout as demucs6.onnx.
usage: <venv with litert-torch and demucs>/python export_demucs_litert.py out.tflite
then:  python to_fp16.py out.tflite demucs_gpu.tflite  (float16 weights, 62 MB)"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import numpy as np, torch
from demucs.pretrained import get_model
from dsp_ref import demucs_spec, demucs_ispec

dst = sys.argv[1]
def gelu_erf(x):
    # Exact-GELU stand-in: 0.5*(x + |x|*erf(|x|/sqrt2)), erf by Abramowitz-Stegun 7.1.26 (|err| < 1.5e-7).
    # Built from ABS/MUL/ADD/DIV/EXP only: torch's erf lowers to an op the converter cannot serialize,
    # and the tanh form costs ~40 dB of agreement on the quiet stems.
    ax = x.abs(); u = ax * 0.7071067811865476
    t = 1.0 / (1.0 + 0.3275911 * u)
    p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    return 0.5 * (x + ax * (1.0 - p * torch.exp(-u * u)))
torch.nn.GELU.forward = lambda self, x: gelu_erf(x)
torch.nn.functional.gelu = lambda x, approximate='none': gelu_erf(x)
m = get_model('htdemucs_6s').models[0].eval().requires_grad_(False)


class PlainMHA(torch.nn.Module):
    """Same math as nn.MultiheadAttention (batch_first, no mask, no dropout), written with plain
    matmul/softmax: PyTorch's own path adds -inf/NaN guards that become SELECT ops the GPU rejects."""
    def __init__(self, a):
        super().__init__()
        assert a.batch_first and a._qkv_same_embed_dim
        self.h = a.num_heads; E = a.embed_dim; self.d = E // self.h
        w, b = a.in_proj_weight, a.in_proj_bias
        self.q = torch.nn.Linear(E, E); self.k = torch.nn.Linear(E, E); self.v = torch.nn.Linear(E, E)
        for lin, i in ((self.q, 0), (self.k, 1), (self.v, 2)):
            lin.weight.data = w[i * E:(i + 1) * E].clone(); lin.bias.data = b[i * E:(i + 1) * E].clone()
        self.o = a.out_proj
    def forward(self, query, key, value, attn_mask=None, key_padding_mask=None, need_weights=False, **kw):
        assert attn_mask is None and key_padding_mask is None
        B, Tq, E = query.shape; Tk = key.shape[1]
        q = self.q(query).reshape(B, Tq, self.h, self.d).transpose(1, 2) * (self.d ** -0.5)
        k = self.k(key).reshape(B, Tk, self.h, self.d).transpose(1, 2)
        v = self.v(value).reshape(B, Tk, self.h, self.d).transpose(1, 2)
        a = torch.softmax(q @ k.transpose(2, 3), dim=-1)
        y = (a @ v).transpose(1, 2).reshape(B, Tq, E)
        return self.o(y), None


def swap(mod):
    for name, ch in mod.named_children():
        if isinstance(ch, torch.nn.MultiheadAttention): setattr(mod, name, PlainMHA(ch))
        else: swap(ch)
swap(m)

# Position tables depend only on shapes: compute them once and hand the converter plain constants
# (built inside the graph they became BROADCAST_TO / STABLEHLO_PAD / SELECT, which the GPU rejects).
import demucs.transformer as dtr
_c2d = dtr.create_2d_sin_embedding
_cache = {}
def c2d_const(*a, **k):
    key = ('2d',) + tuple(a[:3])
    if key not in _cache: _cache[key] = _c2d(*a, **k).detach().clone()
    return _cache[key]
dtr.create_2d_sin_embedding = c2d_const
_gpe = dtr.CrossTransformerEncoder._get_pos_embedding
def gpe_const(self, T, B, C, device):
    key = ('t', T, B, C)
    if key not in _cache: _cache[key] = _gpe(self, T, B, C, device).detach().clone()
    return _cache[key]
dtr.CrossTransformerEncoder._get_pos_embedding = gpe_const
L = int(m.segment * m.samplerate)

class Core(torch.nn.Module):
    def __init__(self, m):
        super().__init__(); self.m = m
    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        n = C * Fq * T
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = ((x - mean).pow(2).sum(dim=(1, 2, 3), keepdim=True) / (n - 1)).sqrt()
        x = (x - mean) / (1e-5 + std)
        xt = mix
        nt = mix.shape[1] * mix.shape[2]
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = ((xt - meant).pow(2).sum(dim=(1, 2), keepdim=True) / (nt - 1)).sqrt()
        xt = (xt - meant) / (1e-5 + stdt)
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty: saved_t.append(xt)
                else: inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                if not hasattr(self, 'femb'):
                    frs = torch.arange(x.shape[-2], device=x.device)
                    self.femb = (m.freq_emb_scale * m.freq_emb(frs).t()[None, :, :, None]).detach().clone()
                x = x + self.femb   # plain broadcast add
            saved.append(x)
        if m.bottom_channels:
            b, c, f, t = x.shape
            x = m.channel_upsampler(x.reshape(b, c, f * t)).reshape(b, -1, f, t)
            xt = m.channel_upsampler_t(xt)
        x, xt = m.crosstransformer(x, xt)
        if m.bottom_channels:
            b, c, f, t = x.shape
            x = m.channel_downsampler(x.reshape(b, c, f * t)).reshape(b, -1, f, t)
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
        x = x * std + mean          # [1, 24, 2048, T]
        xt = xt * stdt + meant      # [1, 12, L]
        return x, xt

core = Core(m).eval()
rng = np.random.default_rng(0)
mix = torch.from_numpy((rng.standard_normal((1, 2, L)) * 0.1).astype(np.float32))
mag = torch.from_numpy(demucs_spec(mix.numpy()[0]))[None]
print('mix', tuple(mix.shape), 'spec', tuple(mag.shape))
with torch.no_grad():
    ref = m(mix)
    zx, xt = core(mix, mag)   # first call fills the constant tables
    zx, xt = core(mix, mag)
def snr(r, e): return float(10 * np.log10((r ** 2).sum() / ((r - e) ** 2).sum()))
est = demucs_ispec(zx.numpy()[0].reshape(6, 4, 2048, -1), L) + xt.numpy()[0].reshape(6, 2, L)
print('torch core vs official dB', round(snr(ref.numpy()[0], est), 1))
import litert_torch
t = time.time()
em = litert_torch.convert(core, (mix, mag))
print('convert', round(time.time() - t), 's')
y = em(mix, mag)
zy, xy = [np.asarray(v) for v in y]
est2 = demucs_ispec(zy[0].reshape(6, 4, 2048, -1), L) + xy[0].reshape(6, 2, L)
print('tflite vs official dB', round(snr(ref.numpy()[0], est2), 1))
em.export(dst)
print('exported', dst, os.path.getsize(dst) // 1000000, 'MB')
