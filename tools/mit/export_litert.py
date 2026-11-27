"""Mega 53 (heads guitar, piano) as a LiteRT .tflite model, for the GPU test on the phone.
Same graph as export.py's fast_attention version (plain operators: the GPU backends do not know ONNX Runtime's
fused ones). Weights stored as float16 (the GPU computes in float16 anyway).
usage: <venv with litert-torch>/python export_litert.py <frames> <out.tflite>"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get('MSST', '/home/claude/zfturbo/music-source-separation-training'))
import torch
import run_ref, export

if __name__ == '__main__':
    frames, dst = int(sys.argv[1]), sys.argv[2]
    run_ref.MEGA_SEL = ['guitar', 'piano']
    export.fast_attention()
    # GELU: the exact (erf) form lowers through a path the converter cannot serialize; the tanh form is a
    # native LiteRT operator and differs by < 5e-4 (below float16 rounding on the GPU).
    torch.nn.GELU.forward = lambda self, x: 0.5 * x * (1 + torch.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)))
    model, *_ = run_ref.get('mega')
    core = export.MegaCore(model).eval().requires_grad_(False)
    x = torch.randn(1, 2050, frames, 2)
    with torch.no_grad(): ref = core(x)
    import litert_torch
    em = litert_torch.convert(core, (x,))
    y = em(x)
    y = torch.as_tensor(y if not isinstance(y, (list, tuple)) else y[0])
    e = (y - ref).pow(2).sum() / ref.pow(2).sum()
    print('tflite vs torch SNR dB', float(-10 * torch.log10(e)))
    em.export(dst)
    print('exported', dst, os.path.getsize(dst) // 1000000, 'MB')
