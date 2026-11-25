"""Plain numpy reference for the DSP the app does outside the ONNX models.
Written loop-by-loop on purpose so it maps 1:1 to the JavaScript port."""
import math
import numpy as np


def hann(n):  # periodic Hann, as torch.hann_window
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float64)


def reflect_pad(x, left, right):
    return np.pad(x, [(0, 0)] * (x.ndim - 1) + [(left, right)], mode='reflect')


def stft(x, n_fft, hop, normalized):
    """torch.stft(center=True, pad_mode='reflect', onesided). x: [C, N] -> complex [C, F, T]"""
    w = hann(n_fft)
    x = reflect_pad(x, n_fft // 2, n_fft // 2)
    T = 1 + (x.shape[-1] - n_fft) // hop
    frames = np.stack([x[:, t * hop:t * hop + n_fft] * w for t in range(T)], -1)  # C, n_fft, T
    z = np.fft.rfft(frames, axis=1)
    if normalized:
        z = z / math.sqrt(n_fft)
    return z


def istft(z, n_fft, hop, length, normalized):
    """torch.istft(center=True). z: complex [C, F, T] -> [C, length]"""
    w = hann(n_fft)
    C, F, T = z.shape
    if normalized:
        z = z * math.sqrt(n_fft)
    frames = np.fft.irfft(z, n=n_fft, axis=1)  # C, n_fft, T
    total = n_fft + hop * (T - 1)
    y = np.zeros((C, total)); env = np.zeros(total)
    for t in range(T):
        y[:, t * hop:t * hop + n_fft] += frames[:, :, t] * w
        env[t * hop:t * hop + n_fft] += w * w
    y = y[:, n_fft // 2:]; env = env[n_fft // 2:]
    y = y[:, :length]; env = env[:length]
    out = np.zeros((C, length))
    n = y.shape[-1]
    out[:, :n] = y / np.where(env > 1e-11, env, 1.0)
    return out


# ---- Demucs (nfft 4096, hop 1024) ----
NFFT, HOP = 4096, 1024


def demucs_spec(mix):
    """mix [2, L] -> complex-as-channels [4, 2048, T] float32"""
    L = mix.shape[-1]
    le = int(math.ceil(L / HOP))
    pad = HOP // 2 * 3
    x = reflect_pad(mix.astype(np.float64), pad, pad + le * HOP - L)
    z = stft(x, NFFT, HOP, True)[:, :-1, :]
    z = z[:, :, 2:2 + le]
    C, Fq, T = z.shape
    out = np.empty((C * 2, Fq, T), np.float32)
    out[0::2] = z.real; out[1::2] = z.imag
    return out


def demucs_ispec(zout, L):
    """zout [S, 4, 2048, T] complex-as-channels -> waveforms [S, 2, L]"""
    S, C4, Fq, T = zout.shape
    z = zout[:, 0::2].astype(np.float64) + 1j * zout[:, 1::2]  # S, 2, Fq, T
    z = np.pad(z, ((0, 0), (0, 0), (0, 1), (2, 2)))
    pad = HOP // 2 * 3
    le = HOP * int(math.ceil(L / HOP)) + 2 * pad
    out = np.empty((S, 2, L), np.float32)
    for s in range(S):
        x = istft(z[s], NFFT, HOP, le, True)
        out[s] = x[:, pad:pad + L]
    return out
