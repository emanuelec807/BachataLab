"""Mega 53 (guitar, piano) for the phone with two fused ONNX Runtime operators, same math as export.py's
fast_attention graph:
  - attention: com.microsoft MultiHeadAttention on q, k, v in [batch, seq, heads*dim] layout (no transposes,
    and ORT computes it in tiles instead of materialising the whole attention matrix: ~0.4 GB per layer);
  - RMSNorm (F.normalize * sqrt(d) * gamma) as SimplifiedLayerNormalization: x / sqrt(mean(x^2) + eps) * w,
    identical except for inputs with norm below 1e-10.
usage: python3 export_fused.py <frames> <out.onnx>"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.environ.get('MSST', '/home/claude/zfturbo/music-source-separation-training'))
import torch, torch.nn.functional as F
import run_ref, export

class MHA(torch.autograd.Function):
    @staticmethod
    def forward(ctx, q, k, v, heads):
        b, n, D = q.shape; d = D // heads
        sp = lambda t: t.reshape(b, n, heads, d).transpose(1, 2)
        a = torch.softmax(sp(q) @ sp(k).transpose(-1, -2), dim=-1) @ sp(v)
        return a.transpose(1, 2).reshape(b, n, D)
    @staticmethod
    def symbolic(g, q, k, v, heads):
        o = g.op('com.microsoft::MultiHeadAttention', q, k, v, num_heads_i=heads, scale_f=1.0)
        o.setType(q.type()); return o

class RMS(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x, w):
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-20) * w
    @staticmethod
    def symbolic(g, x, w):
        o = g.op('SimplifiedLayerNormalization', x, w, axis_i=-1, epsilon_f=1e-20, stash_type_i=1)
        o.setType(x.type()); return o

def patch():
    from models.bs_roformer import bs_roformer as B
    def norm_fwd(self, x):
        return RMS.apply(x, self.gamma.detach())   # normalize(x) * sqrt(d) = x / rms
    B.RMSNorm.forward = norm_fwd
    def att_fwd(self, x):
        x = self.norm(x); b, n, _ = x.shape; h = self.heads
        if not hasattr(self, '_wq'):
            W = self.to_qkv.weight.detach(); inner = W.shape[0] // 3; d = inner // h
            Pm = torch.zeros(d, d)
            for i in range(d // 2): Pm[2 * i + 1, 2 * i] = -1.0; Pm[2 * i, 2 * i + 1] = 1.0   # rotate_half (interleaved)
            rot = lambda Wx: torch.einsum('ij,hid->hjd', Pm, Wx.reshape(h, d, -1)).reshape(inner, -1)
            for nm, w in (('_wq', W[:inner]), ('_wk', W[inner:2 * inner]), ('_wv', W[2 * inner:]), ('_wqp', rot(W[:inner])), ('_wkp', rot(W[inner:2 * inner]))):
                self.register_buffer(nm, w.T.contiguous(), persistent=False)
        q, k, v = x @ self._wq, x @ self._wk, x @ self._wv
        if self.rotary_embed is not None:
            qp, kp = x @ self._wqp, x @ self._wkp
            with torch.no_grad():
                fr = self.rotary_embed.forward(torch.arange(n, dtype=torch.float32), seq_len=n).float()   # [n, d]
            cos, sin = fr.cos().repeat(1, h), fr.sin().repeat(1, h)                                       # [n, h*d]
            q = q * (cos * self.scale) + qp * (sin * self.scale); k = k * cos + kp * sin
        else:
            q = q * self.scale
        out = MHA.apply(q, k, v, h)                                                    # [b, n, h*d]
        gates = self.to_gates(x).sigmoid()                                             # [b, n, h]
        out = (out.reshape(b, n, h, -1) * gates.unsqueeze(-1)).reshape(b, n, -1)
        return self.to_out(out)
    B.Attention.forward = att_fwd

if __name__ == '__main__':
    frames, dst = int(sys.argv[1]), sys.argv[2]
    run_ref.MEGA_SEL = ['guitar', 'piano']
    patch()
    model, *_ = run_ref.get('mega'); core = export.MegaCore(model).eval().requires_grad_(False)
    x = torch.randn(1, 2050, frames, 2)
    if os.environ.get('CHECK'):
        with torch.no_grad(): y = core(x)
        torch.save((x, y), '/tmp/fused_check.pt')
    torch.onnx.export(core, (x,), dst, input_names=['spec'], output_names=['out'], opset_version=17, dynamo=False,
                      custom_opsets={'com.microsoft': 1})
    import resource; print('peak RSS MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
    print('exported', dst)
