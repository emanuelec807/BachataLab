# Which part of the network loses the quiet stems in float16? Round to fp16 only the nodes of one part at a time.
import sys, os, numpy as np, soundfile as sf, torch
sys.argv = ['x', '/dev/null']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export_demucs_fp16safe.py')).read().split('import litert_torch')[0])
a, sr = sf.read('/home/claude/app/test/frio30.wav', dtype='float32'); a = a.T[:, 44100*5:44100*5+L].copy()
mixr = torch.from_numpy(a)[None]; magr = torch.from_numpy(demucs_spec(a))[None]
with torch.no_grad(): ref = m(mixr).numpy()[0]
xn, mt, st = normalise(mixr.numpy()); sn, mf, sf_ = normalise(magr.numpy())
args = (torch.from_numpy(xn), torch.from_numpy(sn))
gm = torch.export.export(core, args).run_decompositions().module()
def part(n):
    st_ = n.meta.get('nn_module_stack') or {}
    path = ' '.join(v[0] for v in st_.values())
    for k in ('tencoder', 'tdecoder', 'crosstransformer', 'channel_', 'encoder', 'decoder'):
        if k in path:
            if k in ('encoder', 'decoder', 'tencoder', 'tdecoder'):
                import re; mm = re.search(k + r'\.(\d+)', path); return k + (mm.group(1) if mm else '')
            return k
    return 'top'
parts = sorted({part(n) for n in gm.graph.nodes if n.op == 'call_function'})
print('parts', parts)
def run(sel):
    class I(torch.fx.Interpreter):
        def run_node(self, n):
            v = super().run_node(n)
            if isinstance(v, torch.Tensor) and v.is_floating_point() and n.op == 'call_function' and part(n) in sel:
                v = v.to(torch.float16).to(torch.float32)
            return v
    with torch.no_grad(): o = I(gm).run(*args)
    zx = o[0].numpy().astype(np.float64) * sf_ + mf; xt = o[1].numpy().astype(np.float64) * st + mt
    est = demucs_ispec(zx[0].reshape(6, 4, 2048, -1).astype(np.float32), L) + xt[0].reshape(6, 2, L)
    return {src: round(float(10*np.log10((ref[i]**2).sum()/max(((ref[i]-est[i])**2).sum(), 1e-30))), 1) for i, src in enumerate(m.sources) if src in ('other', 'piano', 'drums')}
for p in parts: print('%-18s' % p, run({p}), flush=True)
