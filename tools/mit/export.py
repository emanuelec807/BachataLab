"""ONNX exports for the phone: the networks only, STFT/ISTFT stay in app code (Java).
  scnet  : spec [1,4,2049,T] (L re, L im, R re, R im; rectangular window, normalized STFT) -> [1,16,2049,T]
           (source s, channel c, re/im: channel index (s*2+c)*2 + {0,1}); sources drums, bass, other, vocals
  mega   : spec [1,2050,T,2] (BS-RoFormer layout: freq-major, stereo interleaved, re/im last; hann, n_fft 2048,
           hop 512, not normalized) -> masked spectra [S,2050,T,2] for the kept heads (guitar, piano)
usage: python3 export.py scnet_large|scnet_small|mega <frames> [heads]"""
import sys, os, json
sys.path.insert(0, '/home/claude/mit'); sys.path.insert(0, '/home/claude/zfturbo/music-source-separation-training')
import torch, torch.nn as nn, torch.nn.functional as F
from collections import deque
import run_ref

class SCNetCore(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x):
        m = self.m; B, C, Fr, T = x.shape
        skips, lens, olens = deque(), deque(), deque()
        for sd in m.encoder:
            x, s, l, o = sd(x); skips.append(s); lens.append(l); olens.append(o)
        x = m.separation_net(x)
        for fusion, su in m.decoder:
            x = fusion(x, skips.pop()); x = su(x, lens.pop(), olens.pop())
        return x.reshape(B, -1, Fr, T)

class MegaCore(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, spec):                      # [1, F*S, T, 2]
        m = self.m
        x = spec.reshape(1, spec.shape[1], spec.shape[2], 2).permute(0, 2, 1, 3).reshape(1, spec.shape[2], -1)  # b t (f c)
        x = m.band_split(x)
        for blk in m.layers:
            tt, ft = blk[-2], blk[-1]
            b, t, f, d = x.shape
            x = x.permute(0, 2, 1, 3).reshape(b * f, t, d); x = tt(x)
            x = x.reshape(b, f, t, d).permute(0, 2, 1, 3).reshape(b * t, f, d); x = ft(x)
            x = x.reshape(b, t, f, d)
        x = m.final_norm(x)
        mask = torch.stack([fn(x) for fn in m.mask_estimators], dim=1)          # b n t (f c)
        n, T = mask.shape[1], mask.shape[2]
        mask = mask.reshape(n, T, -1, 2).permute(0, 2, 1, 3)                   # n (f s) t c
        sr, si = spec[0, :, :, 0], spec[0, :, :, 1]
        mr, mi = mask[..., 0], mask[..., 1]
        return torch.stack([sr * mr - si * mi, sr * mi + si * mr], dim=-1)    # n (f s) t c

def dft_as_matmul():
    """SCNet's rfft/irfft along time become two small matrix products: ORT's DFT op took a third of the time."""
    from models.scnet import separation
    def fwd(self, x):
        x = x.float(); N = x.shape[3] if not self.inverse else 2 * (x.shape[3] - 1); K = N // 2 + 1
        n = torch.arange(N, dtype=torch.float64)[:, None]; k = torch.arange(K, dtype=torch.float64)[None, :]
        ang = 2 * torch.pi * n * k / N; C, S = torch.cos(ang).float(), torch.sin(ang).float()   # [N, K]
        if not self.inverse:
            return torch.cat([x @ C / N ** 0.5, -(x @ S) / N ** 0.5], dim=1)
        xr, xi = x[:, :self.channels // 2], x[:, self.channels // 2:]
        w = torch.full((K,), 2.0); w[0] = 1; w[-1] = 1
        xi = xi * torch.cat([torch.zeros(1), torch.ones(K - 2), torch.zeros(1)])   # DC and Nyquist: imag ignored
        return ((xr * w) @ C.T - (xi * w) @ S.T) / N ** 0.5
    separation.FeatureConversion.forward = fwd

def simple_attention(max_elems=48_000_000):
    """Attention written out (no sdp_kernel context, which the exporter cannot trace), rotary tables as
    constants, and the attention matrix computed a few sequences at a time: on the phone the whole matrix
    of a long chunk would take GBs. Same math as the original."""
    from models.bs_roformer import bs_roformer as B
    def rot_half(t):
        t = t.reshape(*t.shape[:-1], -1, 2); x1, x2 = t[..., 0], t[..., 1]
        return torch.stack((-x2, x1), dim=-1).reshape(*t.shape[:-2], -1)
    def fwd(self, x):
        x = self.norm(x); b, n, _ = x.shape; h = self.heads
        q, k, v = self.to_qkv(x).reshape(b, n, 3, h, -1).permute(2, 0, 3, 1, 4)
        if self.rotary_embed is not None:
            with torch.no_grad():
                pos = torch.arange(n, dtype=torch.float32)
                fr = self.rotary_embed.forward(pos, seq_len=n).float()       # [n, rot_dim]
            cos, sin = fr.cos(), fr.sin(); r = fr.shape[-1]
            def rot(t): return torch.cat([t[..., :r] * cos + rot_half(t[..., :r]) * sin, t[..., r:]], dim=-1)
            q, k = rot(q), rot(k)
        g = max(1, min(b, max_elems // (h * n * n))); outs = []
        for i in range(0, b, g):
            a = torch.softmax((q[i:i + g] @ k[i:i + g].transpose(-1, -2)) * self.scale, dim=-1)
            outs.append(a @ v[i:i + g])
        out = torch.cat(outs, 0) if len(outs) > 1 else outs[0]
        out = out * self.to_gates(x).permute(0, 2, 1).unsqueeze(-1).sigmoid()
        return self.to_out(out.permute(0, 2, 1, 3).reshape(b, n, -1))
    B.Attention.forward = fwd

def split_attention(max_elems=48_000_000):
    """The attention matrix b*h*n*n is computed a few sequences at a time: on the phone the whole
    matrix of a 20 s chunk would take several GB. Same result (each sequence is independent)."""
    from models.bs_roformer import attend
    orig = attend.Attend.forward
    def fwd(self, q, k, v):
        b, h, n, _ = q.shape; g = max(1, min(b, max_elems // (h * n * n)))
        if g >= b: return orig(self, q, k, v)
        return torch.cat([orig(self, q[i:i + g], k[i:i + g], v[i:i + g]) for i in range(0, b, g)], 0)
    attend.Attend.forward = fwd

if __name__ == '__main__':
    kind, frames = sys.argv[1], int(sys.argv[2])
    out = f'/home/claude/mit/onnx'; os.makedirs(out, exist_ok=True)
    if kind.startswith('scnet'):
        dft_as_matmul()
        model, *_ = run_ref.get(kind); core = SCNetCore(model).eval().requires_grad_(False)
        x = torch.randn(1, 4, 2049, frames)
        torch.onnx.export(core, (x,), f'{out}/{kind}.onnx', input_names=['spec'], output_names=['out'], opset_version=18, dynamo=True, external_data=False)
    else:
        os.environ['MEGA_SEL'] = sys.argv[3] if len(sys.argv) > 3 else 'guitar,piano'
        run_ref.MEGA_SEL = os.environ['MEGA_SEL'].split(',')
        simple_attention()
        model, *_ = run_ref.get('mega'); core = MegaCore(model).eval().requires_grad_(False)
        x = torch.randn(1, 2050, frames, 2)
        name = 'mega_' + run_ref.MEGA_SEL[0] if len(run_ref.MEGA_SEL) == 1 else 'mega_' + '_'.join(run_ref.MEGA_SEL)
        torch.onnx.export(core, (x,), f'{out}/{name}_{frames}.onnx', input_names=['spec'], output_names=['out'], opset_version=17, dynamo=False)
        import resource; print('peak RSS MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
    print('exported')
