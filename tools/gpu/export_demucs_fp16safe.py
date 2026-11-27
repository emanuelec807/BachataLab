"""NOT the model the app uses (that is export_demucs_litert.py, run in float32 on the GPU).
Experiment for float16: normalisation done by the app in double precision, GroupNorm/LayerNorm with block means.
Result: fp16 storage alone still costs the quiet stems (other, piano) down to 7-11 dB, almost all in the last
frequency decoder (see fp16_where.py): its outputs are small differences of large values. Kept for later work.
"""
"""htdemucs_6s core (no STFT) as LiteRT .tflite for the phone GPU test.
Outputs are kept 4-D/3-D (GPU limit): zout [1,24,2048,T] (= [6 sources x 4 ch]), xt [1,12,L].
usage: lt/bin/python export_demucs_litert.py out.tflite [gelu_tanh=1]"""
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
    uc = torch.clamp(u, max=10.0)          # erf(10) = 1: keeps u*u inside float16
    return 0.5 * (x + ax * (1.0 - p * torch.exp(-uc * uc)))
torch.nn.GELU.forward = lambda self, x: gelu_erf(x)
torch.nn.functional.gelu = lambda x, approximate='none': gelu_erf(x)
# ---- float16-safe normalisation (the phone GPU computes in float16: max 65504, 11-bit sums) ----
# Means in blocks of 64 (a single MEAN over millions of values loses everything in float16), and the spread is
# measured on values scaled by their mean distance first, so nothing squared can overflow. Same math as torch.
def smean(x):
    """x [B, N] -> mean over N as [B, 1], computed 64 values at a time (zero padding, corrected exactly)."""
    B = x.shape[0]; scale = 1.0
    while x.shape[-1] > 64:
        N = x.shape[-1]; n2 = -(-N // 64); pad = n2 * 64 - N
        if pad: x = torch.nn.functional.pad(x, (0, pad)); scale *= (N + pad) / N
        x = x.reshape(B, n2, 64).mean(-1)
    return x.mean(-1, keepdim=True) * scale
SQ_EPS = None
def safe_norm(flat, eps):
    """(x - mean) / sqrt(var + eps) per row of flat [B, N], float16-safe."""
    d = flat - smean(flat)
    c = 8.0 * smean(d.abs()) + 1e-4           # any c > 0 gives the same result; this one keeps (d/c)^2 small
    z = d / c
    v = smean(z * z)
    e = (eps ** 0.5) / c
    return z * torch.rsqrt(v + e * e)
def gn_forward(self, x):
    assert self.num_groups == 1
    B, C = x.shape[0], x.shape[1]
    y = safe_norm(x.reshape(B, -1), self.eps).reshape(x.shape)
    if self.affine:
        sh = [1, C] + [1] * (x.dim() - 2)
        y = y * self.weight.reshape(sh) + self.bias.reshape(sh)
    return y
torch.nn.GroupNorm.forward = gn_forward
def ln_forward(self, x):
    assert len(self.normalized_shape) == 1
    C = x.shape[-1]
    y = safe_norm(x.reshape(-1, C), self.eps).reshape(x.shape)
    if self.elementwise_affine: y = y * self.weight + self.bias
    return y
torch.nn.LayerNorm.forward = ln_forward

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

# Linear on 3-D token data computed as a 1x1 convolution (same math). As FULLY_CONNECTED the converter emitted some
# going 3-D -> 2-D (keep_num_dims off) and the phone GPU computed those wrong ("Shape mismatch ... convolution1x1",
# result -66 dB); reshapes around the Linear get folded back in, a convolution does not.
_lin = torch.nn.Linear.forward
def lin_conv(self, x):
    if x.dim() != 3: return _lin(self, x)
    B, N, C = x.shape
    y = torch.nn.functional.conv2d(x.transpose(1, 2).reshape(B, C, N, 1), self.weight[:, :, None, None], self.bias)
    return y.reshape(B, self.out_features, N).transpose(1, 2)
torch.nn.Linear.forward = lin_conv

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
    def forward(self, xt, x):
        # inputs already normalised by the app: xt = (mix - mean) / (1e-5 + std), x = (spec - mean) / (1e-5 + std)
        m = self.m
        B, C, Fq, T = x.shape
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
        stages = [x, xt]
        x, xt = m.crosstransformer(x, xt)
        stages += [x, xt]
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
        # [1, 24, 2048, T] and [1, 12, L], still normalised: the app multiplies by std and adds the mean
        if DIAG: return (x, xt) + tuple(stages)
        return x, xt

DIAG = os.environ.get('DIAG') == '1'
core = Core(m).eval()

def normalise(v):
    v = v.astype(np.float64); mu = v.mean(); sd = v.std(ddof=1)
    return ((v - mu) / (1e-5 + sd)).astype(np.float32), mu, sd
rng = np.random.default_rng(0)
mix = torch.from_numpy((rng.standard_normal((1, 2, L)) * 0.1).astype(np.float32))
mag = torch.from_numpy(demucs_spec(mix.numpy()[0]))[None]
print('mix', tuple(mix.shape), 'spec', tuple(mag.shape))
mixn, mu_t, sd_t = normalise(mix.numpy()); magn, mu_f, sd_f = normalise(mag.numpy())
mixn, magn = torch.from_numpy(mixn), torch.from_numpy(magn)
def finish(zx, xt):
    zx = np.asarray(zx, np.float64) * sd_f + mu_f; xt = np.asarray(xt, np.float64) * sd_t + mu_t
    return demucs_ispec(zx[0].reshape(6, 4, 2048, -1).astype(np.float32), L) + xt[0].reshape(6, 2, L)
with torch.no_grad():
    ref = m(mix)
    o = core(mixn, magn)   # first call fills the constant tables
    o = core(mixn, magn)
def snr(r, e): return float(10 * np.log10((r ** 2).sum() / ((r - e) ** 2).sum()))
print('torch core vs official dB', round(snr(ref.numpy()[0], finish(o[0].numpy(), o[1].numpy())), 1))
import litert_torch
t = time.time()
em = litert_torch.convert(core, (mixn, magn))
print('convert', round(time.time() - t), 's')
y = em(mixn, magn)
print('tflite vs official dB', round(snr(ref.numpy()[0], finish(np.asarray(y[0]), np.asarray(y[1]))), 1))
em.export(dst)
print('exported', dst, os.path.getsize(dst) // 1000000, 'MB')
