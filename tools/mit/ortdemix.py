"""Mega through ONNX Runtime on real audio, like the phone: chunk length, overlap and int8 variants vs the 20 s reference."""
import sys, os, numpy as np, torch, soundfile as sf, onnxruntime as ort, time
sys.path.insert(0, '/home/claude/mit'); import run_ref
def mega_onnx(path):
    so = ort.SessionOptions(); so.intra_op_num_threads = 2; so.enable_cpu_mem_arena = False; so.enable_mem_pattern = False
    s = ort.InferenceSession(path, so); w = torch.hann_window(2048)
    def run(part):  # part [1, 2, L]
        x = part[0]; L = x.shape[-1]
        z = torch.stft(x, 2048, 512, 2048, window=w, center=True, return_complex=True)      # [2, F, T]
        spec = torch.view_as_real(z).permute(1, 0, 2, 3).reshape(1, -1, z.shape[-1], 2)    # [1, F*2, T, 2]
        out = torch.tensor(s.run(None, {'spec': spec.numpy()})[0])                         # [S, F*2, T, 2]
        S = out.shape[0]; c = torch.view_as_complex(out.reshape(S, -1, 2, out.shape[2], 2).permute(0, 2, 1, 3, 4).contiguous())  # [S, 2, F, T]
        c[:, :, 0] = 0
        y = torch.istft(c.reshape(S * 2, c.shape[2], c.shape[3]), 2048, 512, 2048, window=w, center=True, length=L)
        return y.reshape(1, S, 2, L)
    return run
def sdr(r, e): return 10 * np.log10((r ** 2).sum() / ((r - e) ** 2).sum() + 1e-12)
if __name__ == '__main__':
    path, chunk, song, tag = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    step = int(sys.argv[5]) if len(sys.argv) > 5 else None
    mix = run_ref.load_clip(song); t = time.time()
    out = run_ref.demix_generic(mega_onnx(path), mix, chunk, 2, 2, False, step)
    dt = time.time() - t; od = f'/home/claude/mit/out/{song}'
    for n, y in zip(['guitar', 'piano'], out):
        sf.write(f'{od}/{tag}_{n}.wav', y.T, 44100, subtype='FLOAT')
        ref, _ = sf.read(f'{od}/mega_{n}.wav', dtype='float32'); print(tag, song, n, 'SDR vs 20s reference', round(float(sdr(ref.T, y)), 1), 'dB')
    print(tag, song, f'{dt:.0f}s for 60s')
