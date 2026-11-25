/* Stem separation that runs in a Web Worker (or in node for tests).
   Demucs htdemucs_6s and the AudioSep "güira" extractor run in ONNX Runtime;
   the STFT/ISTFT they need around them is done here, mirroring dsp_ref.py,
   which is checked against the original PyTorch models. */
(function (root) {
  'use strict';

  // ---------- FFT (radix-2, complex, in place) ----------
  const fftCache = new Map();
  function fftPlan(n) {
    let p = fftCache.get(n);
    if (p) return p;
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    p = { n, rev, cos, sin };
    fftCache.set(n, p);
    return p;
  }
  // sign -1: forward e^{-i}, +1: inverse (unscaled)
  function fft(re, im, plan, sign) {
    const { n, rev, cos, sin } = plan;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const wr = cos[w], wi = sign * sin[w];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
  }
  const hannCache = new Map();
  const getHann = n => hannCache.get(n) || (hannCache.set(n, hann(n)), hannCache.get(n));

  // numpy-style 'reflect' padding (edge sample not repeated)
  function reflectPad(x, left, right) {
    const n = x.length, out = new Float64Array(n + left + right);
    for (let i = 0; i < out.length; i++) {
      let j = i - left;
      while (j < 0 || j >= n) { if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; }
      out[i] = x[j];
    }
    return out;
  }

  /* torch.stft(center=True, reflect, onesided). Returns {re, im, F, T} with
     index [f * T + t]. */
  function stft(x, nfft, hop, normalized) {
    const w = getHann(nfft), plan = fftPlan(nfft);
    const xp = reflectPad(x, nfft / 2, nfft / 2);
    const T = 1 + Math.floor((xp.length - nfft) / hop), F = nfft / 2 + 1;
    const re = new Float32Array(F * T), im = new Float32Array(F * T);
    const br = new Float64Array(nfft), bi = new Float64Array(nfft);
    const scale = normalized ? 1 / Math.sqrt(nfft) : 1;
    for (let t = 0; t < T; t++) {
      const off = t * hop;
      for (let i = 0; i < nfft; i++) { br[i] = xp[off + i] * w[i]; bi[i] = 0; }
      fft(br, bi, plan, -1);
      for (let f = 0; f < F; f++) { re[f * T + t] = br[f] * scale; im[f * T + t] = bi[f] * scale; }
    }
    return { re, im, F, T };
  }

  /* torch.istft(center=True). re/im index [f * T + t], F = nfft/2+1. */
  function istft(re, im, F, T, nfft, hop, length, normalized) {
    const w = getHann(nfft), plan = fftPlan(nfft);
    const total = nfft + hop * (T - 1);
    const y = new Float64Array(total), env = new Float64Array(total);
    const br = new Float64Array(nfft), bi = new Float64Array(nfft);
    const scale = (normalized ? Math.sqrt(nfft) : 1) / nfft;
    for (let t = 0; t < T; t++) {
      for (let f = 0; f < F; f++) { br[f] = re[f * T + t]; bi[f] = im[f * T + t]; }
      bi[0] = 0; bi[F - 1] = 0; // irfft ignores imag of DC and Nyquist
      for (let f = F; f < nfft; f++) { br[f] = br[nfft - f]; bi[f] = -bi[nfft - f]; }
      fft(br, bi, plan, 1);
      const off = t * hop;
      for (let i = 0; i < nfft; i++) { y[off + i] += br[i] * scale * w[i]; env[off + i] += w[i] * w[i]; }
    }
    const out = new Float32Array(length), start = nfft / 2;
    for (let i = 0; i < length; i++) {
      const j = start + i;
      if (j >= total) break;
      const e = env[j];
      out[i] = e > 1e-11 ? y[j] / e : y[j];
    }
    return out;
  }

  // ---------- windowed-sinc resampler ----------
  function resample(x, from, to) {
    if (from === to) return Float32Array.from(x);
    const ratio = from / to, n = Math.floor(x.length / ratio);
    const cutoff = Math.min(1, to / from), W = 24;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * ratio, c = Math.floor(t);
      let s = 0, norm = 0;
      for (let k = c - W + 1; k <= c + W; k++) {
        const d = t - k;
        const win = 0.5 + 0.5 * Math.cos(Math.PI * d / W);
        const a = Math.PI * cutoff * d;
        const h = (d === 0 ? 1 : Math.sin(a) / a) * win;
        norm += h;
        if (k >= 0 && k < x.length) s += x[k] * h;
      }
      out[i] = s / norm;
    }
    return out;
  }

  // ---------- Demucs ----------
  const D = { L: 343980, OVERLAP: 0.25, NFFT: 4096, HOP: 1024, SR: 44100, SOURCES: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] };

  function demucsSpec(ch) { // ch: [Float32Array L, Float32Array R], each D.L long -> Float32Array [4,2048,T]
    const { L, HOP, NFFT } = D;
    const le = Math.ceil(L / HOP), pad = (HOP / 2) * 3;
    const Fq = NFFT / 2, out = new Float32Array(4 * Fq * le);
    ch.forEach((x, c) => {
      const xp = reflectPad(x, pad, pad + le * HOP - L);
      const z = stft(xp, NFFT, HOP, true); // F = 2049, T = le + 4
      for (let f = 0; f < Fq; f++) {
        for (let t = 0; t < le; t++) {
          const src = f * z.T + t + 2;
          out[((c * 2) * Fq + f) * le + t] = z.re[src];
          out[((c * 2 + 1) * Fq + f) * le + t] = z.im[src];
        }
      }
    });
    return { data: out, T: le };
  }

  function demucsIspec(zout, S, T) { // zout [S,4,2048,T] -> [S][2] Float32Array(L)
    const { L, HOP, NFFT } = D;
    const Fq = NFFT / 2, F = Fq + 1, T2 = T + 4, pad = (HOP / 2) * 3;
    const le = HOP * Math.ceil(L / HOP) + 2 * pad;
    const res = [];
    for (let s = 0; s < S; s++) {
      const chans = [];
      for (let c = 0; c < 2; c++) {
        const re = new Float32Array(F * T2), im = new Float32Array(F * T2);
        const bR = ((s * 4 + c * 2) * Fq) * T, bI = ((s * 4 + c * 2 + 1) * Fq) * T;
        for (let f = 0; f < Fq; f++) for (let t = 0; t < T; t++) {
          re[f * T2 + t + 2] = zout[bR + f * T + t];
          im[f * T2 + t + 2] = zout[bI + f * T + t];
        }
        const x = istft(re, im, F, T2, NFFT, HOP, le, true);
        chans.push(x.slice(pad, pad + L));
      }
      res.push(chans);
    }
    return res;
  }

  /* Runs Demucs over the whole region with 25% overlap and linear cross-fades.
     run(feeds) -> {zout, xt} (Float32Array data). */
  async function demucsAll(ort, session, left, right, progress, isCancelled, ovFrac = D.OVERLAP) {
    const { L } = D, total = left.length;
    const overlap = Math.floor(L * ovFrac), stride = L - overlap;
    const n = Math.max(1, Math.ceil(total / stride));
    const win = new Float32Array(L).fill(1);
    for (let i = 0; i < overlap; i++) { const v = i / (overlap - 1); win[i] = v; win[L - 1 - i] = v; }
    const out = D.SOURCES.map(() => [new Float32Array(total), new Float32Array(total)]);
    const wsum = new Float32Array(total);
    for (let i = 0; i < n; i++) {
      if (isCancelled()) throw new Error('cancelled');
      const s = i * stride, e = Math.min(s + L, total), len = e - s;
      const cl = new Float32Array(L), cr = new Float32Array(L);
      cl.set(left.subarray(s, e)); cr.set(right.subarray(s, e));
      const mix = new Float32Array(2 * L); mix.set(cl, 0); mix.set(cr, L);
      const spec = demucsSpec([cl, cr]);
      const r = await session.run({
        mix: new ort.Tensor('float32', mix, [1, 2, L]),
        spec: new ort.Tensor('float32', spec.data, [1, 4, D.NFFT / 2, spec.T]),
      });
      const zout = r.zout.data, xt = r.xt.data;
      const wav = demucsIspec(zout, D.SOURCES.length, spec.T);
      for (let k = 0; k < D.SOURCES.length; k++) for (let c = 0; c < 2; c++) {
        const o = out[k][c], w = wav[k][c], tb = (k * 2 + c) * L;
        for (let j = 0; j < len; j++) o[s + j] += (w[j] + xt[tb + j]) * win[j];
      }
      for (let j = 0; j < len; j++) wsum[s + j] += win[j];
      progress(i + 1, n);
    }
    for (const st of out) for (const ch of st) for (let j = 0; j < total; j++) ch[j] /= Math.max(wsum[j], 1e-8);
    const stems = {};
    D.SOURCES.forEach((id, k) => { stems[id] = out[k]; });
    return stems;
  }

  // ---------- Güira (AudioSep separator, 32 kHz mono, 5 s windows: 1 s | 3 s | 1 s) ----------
  // 0.5 s context on each side and 4 s kept per 5 s window: 25% less work than AudioSep's 1|3|1 s,
  // the güira differs from it by about 28 dB SNR on Frío (inaudible).
  const G = { SR: 32000, CTX: 0.5, WIN: 160000, NFFT: 2048, HOP: 320 };

  async function guiraAll(ort, session, mono32, progress, isCancelled, ctx = G.CTX) {
    const { WIN, NFFT, HOP } = G, total = mono32.length;
    const NL = Math.round(ctx * G.SR), NR = NL, NC = WIN - NL - NR;
    const out = new Float32Array(total);
    const starts = [];
    let cur = 0;
    while (cur + WIN < total) { starts.push(cur); cur += NC; }
    const tail = cur < total ? cur : -1;
    const all = tail >= 0 ? starts.concat([tail]) : starts;
    for (let i = 0; i < all.length; i++) {
      if (isCancelled()) throw new Error('cancelled');
      const s = all[i], chunk = new Float32Array(WIN);
      chunk.set(mono32.subarray(s, Math.min(s + WIN, total)));
      const r = await session.run({ chunk: new ort.Tensor('float32', chunk, [1, 1, WIN]) });
      const d = r.guira.data, dims = r.guira.dims; // [1,2,T,F]
      const T = dims[2], F = dims[3];
      const re = new Float32Array(F * T), im = new Float32Array(F * T);
      for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) {
        re[f * T + t] = d[t * F + f]; im[f * T + t] = d[T * F + t * F + f];
      }
      const y = istft(re, im, F, T, NFFT, HOP, WIN, false);
      if (i === all.length - 1 && s === tail) {
        const segLen = Math.min(WIN, total - s);
        for (let j = NL; j < segLen; j++) out[s + j] = y[j];
      } else if (s === 0) {
        for (let j = 0; j < WIN - NR; j++) out[j] = y[j];
      } else {
        for (let j = NL; j < WIN - NR; j++) out[s + j] = y[j];
      }
      progress(i + 1, all.length);
    }
    return out;
  }

  /* Splits the stereo drum stem into güira and the rest ("bongo") with a soft
     spectral mask from the güira estimate. */
  function splitDrums(drums, guira44) {
    const NFFT = 2048, HOP = 512, n = drums[0].length;
    const g = stft(guira44, NFFT, HOP, false);
    const gm = new Float32Array(g.re.length);
    for (let i = 0; i < gm.length; i++) gm[i] = Math.hypot(g.re[i], g.im[i]);
    const gu = [], bo = [];
    for (const ch of drums) {
      const z = stft(ch, NFFT, HOP, false);
      const ar = new Float32Array(z.re.length), ai = new Float32Array(z.re.length);
      const br = new Float32Array(z.re.length), bi = new Float32Array(z.re.length);
      for (let i = 0; i < z.re.length; i++) {
        const m = Math.min(1, gm[i] / (Math.hypot(z.re[i], z.im[i]) + 1e-8));
        ar[i] = z.re[i] * m; ai[i] = z.im[i] * m;
        br[i] = z.re[i] * (1 - m); bi[i] = z.im[i] * (1 - m);
      }
      gu.push(istft(ar, ai, z.F, z.T, NFFT, HOP, n, false));
      bo.push(istft(br, bi, z.F, z.T, NFFT, HOP, n, false));
    }
    return { guira: gu, bongo: bo };
  }

  /* Full pipeline. sessions: {demucs, guira}. Returns stems keyed by app ids. */
  async function separate(ort, sessions, left, right, onProgress, isCancelled = () => false, opts = {}) {
    const t0 = Date.now();
    const dem = await demucsAll(ort, sessions.demucs, left, right,
      (i, n) => onProgress({ stage: 'demucs', i, n, elapsed: Date.now() - t0 }), isCancelled, opts.overlap);
    onProgress({ stage: 'resample', elapsed: Date.now() - t0 });
    const d = dem.drums, n = d[0].length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = 0.5 * (d[0][i] + d[1][i]);
    let sp;
    if (opts.guira === false) {
      sp = { bongo: d, guira: [new Float32Array(n), new Float32Array(n)] };
    } else {
      const m32 = resample(mono, D.SR, G.SR);
      const g32 = await guiraAll(ort, sessions.guira, m32,
        (i, k) => onProgress({ stage: 'guira', i, n: k, elapsed: Date.now() - t0 }), isCancelled, opts.guiraCtx);
      const g44full = resample(g32, G.SR, D.SR);
      const g44 = new Float32Array(n); g44.set(g44full.subarray(0, n));
      onProgress({ stage: 'split', elapsed: Date.now() - t0 });
      sp = splitDrums(d, g44);
    }
    const altro = [0, 1].map(c => { const a = new Float32Array(n), o = dem.other[c], p = dem.piano[c]; for (let i = 0; i < n; i++) a[i] = o[i] + p[i]; return a; });
    // piano also comes back on its own: the app keeps it as a track only if it really plays (otherwise it stays in altro)
    return { vocals: dem.vocals, guitar: dem.guitar, bass: dem.bass, bongo: sp.bongo, guira: sp.guira, altro, piano: dem.piano };
  }

  // Rough seconds of work per second of audio, used for the estimate shown before starting.
  // Measured in desktop Chromium, WebAssembly, 1 thread: seconds of work per second of audio.
  const COST = { demucs: 2.4, guira: 2.4 };

  const api = { separate, stft, istft, resample, demucsSpec, demucsIspec, splitDrums, D, G, COST };
  root.Separator = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof self !== 'undefined' ? self : this);
