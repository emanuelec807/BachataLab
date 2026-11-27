"""GPU diagnosis: one BS-RoFormer layer of Mega 53 (time transformer + frequency transformer) as its own
LiteRT model, at full size (431 frames) and small (64 frames). usage: <venv>/python export_litert_parts.py <out dir>"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get('MSST', '/home/claude/zfturbo/music-source-separation-training'))
import torch
import run_ref, export

class LayerCore(torch.nn.Module):
    def __init__(self, blk): super().__init__(); self.tt, self.ft = blk[-2], blk[-1]
    def forward(self, x):                       # [1, t, f, d]
        b, t, f, d = x.shape
        x = x.permute(0, 2, 1, 3).reshape(b * f, t, d); x = self.tt(x)
        x = x.reshape(b, f, t, d).permute(0, 2, 1, 3).reshape(b * t, f, d); x = self.ft(x)
        return x.reshape(b, t, f, d)

if __name__ == '__main__':
    out = sys.argv[1]
    run_ref.MEGA_SEL = ['guitar', 'piano']
    export.fast_attention()
    torch.nn.GELU.forward = lambda self, x: 0.5 * x * (1 + torch.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)))
    model, *_ = run_ref.get('mega')
    layer = LayerCore(model.layers[0]).eval().requires_grad_(False)
    print('params M', sum(p.numel() for p in layer.parameters()) / 1e6)
    import litert_torch
    for T in [int(a) for a in sys.argv[2:]] or (431,):
        x = torch.randn(1, T, 62, 256)
        em = litert_torch.convert(layer, (x,))
        p = f'{out}/mega_layer_{T}.tflite'; em.export(p); print('exported', p, os.path.getsize(p) // 1000000, 'MB')
