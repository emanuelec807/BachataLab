"""Pieces of the GPU Demucs for locating a wrong result on the phone: the transformer alone (first 2 layers: one
self-attention, one cross-attention) and the network without the transformer. usage: python export_parts.py outdir"""
import sys, os, copy
out = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'export_demucs_litert.py')).read().split('import litert_torch')[0]
sys.argv = ['x', '/dev/null']
exec(src)
import litert_torch
caught = {}
def hook(mod, args, outp): caught['in'] = [a.detach().clone() for a in args]
h = m.crosstransformer.register_forward_hook(hook)
with torch.no_grad(): core(mix, mag)
h.remove()

class Tr2(torch.nn.Module):
    def __init__(self, ct):
        super().__init__(); self.ct = copy.deepcopy(ct); self.ct.num_layers = 2
    def forward(self, x, xt): return self.ct(x, xt)
tr = Tr2(m.crosstransformer).eval()
x, xt = caught['in']
print('transformer inputs', tuple(x.shape), tuple(xt.shape))
em = litert_torch.convert(tr, (x, xt)); em.export(f'{out}/part_trasformatore.tflite')

class Ident(torch.nn.Module):
    def forward(self, x, xt): return x, xt
noT = copy.deepcopy(core); noT.m.crosstransformer = Ident()
em = litert_torch.convert(noT.eval(), (mix, mag)); em.export(f'{out}/part_senza_trasformatore.tflite')
with open(f'{out}/parts.txt', 'w') as f:
    f.write('part_trasformatore.tflite|%d,%d\n' % (x.numel(), xt.numel()))
    f.write('part_senza_trasformatore.tflite|%d,%d\n' % (mix.numel(), mag.numel()))
print(open(f'{out}/parts.txt').read())
