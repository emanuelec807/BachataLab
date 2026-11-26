import sys, numpy as np, torch, onnxruntime as ort, time
sys.argv = sys.argv; import export, run_ref, os
kind, path, frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
so = ort.SessionOptions(); so.intra_op_num_threads = 2
s = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
torch.manual_seed(0)
if kind.startswith('scnet'):
    m, *_ = run_ref.get(kind); core = export.SCNetCore(m).eval(); x = torch.randn(1, 4, 2049, frames) * 0.1
    with torch.no_grad(): ref0 = core(x).numpy()
    export.dft_as_matmul()
else:
    run_ref.MEGA_SEL = os.environ.get('MEGA_SEL', 'guitar,piano').split(',')
    m, *_ = run_ref.get('mega'); core = export.MegaCore(m).eval(); x = torch.randn(1, 2050, frames, 2) * 0.5
    with torch.no_grad(): ref0 = core(x).numpy()
    (export.fast_attention if os.environ.get('FAST', '1') == '1' else export.simple_attention)()
with torch.no_grad(): ref = core(x).numpy()
print('matmul vs fft snr', 10*np.log10((ref0**2).sum()/((ref-ref0)**2).sum())); ref = ref0
t = time.time(); out = s.run(None, {'spec': x.numpy()})[0]; dt = time.time() - t
t = time.time(); s.run(None, {'spec': x.numpy()}); dt2 = time.time() - t
err = np.abs(out - ref).max(); snr = 10 * np.log10((ref ** 2).sum() / ((out - ref) ** 2).sum())
print(kind, path, 'max err', err, 'snr dB', round(float(snr), 1), 'ort secs/chunk', round(dt, 2), round(dt2, 2))
