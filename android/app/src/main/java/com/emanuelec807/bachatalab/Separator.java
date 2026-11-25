package com.emanuelec807.bachatalab;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Native port of app/separate.js: Demucs htdemucs_6s + AudioSep "güira" extractor on ONNX Runtime,
 * with the same STFT/ISTFT, windows and cross-fades. Plain Java (no Android classes) so it can be
 * checked on a desktop JVM against the JavaScript version.
 */
public final class Separator {
    public interface Progress { void on(String stage, int i, int n); }
    public interface Cancel { boolean cancelled(); }

    // Demucs
    static final int L = 343980, NFFT = 4096, HOP = 1024, SR = 44100;
    static final double OVERLAP = 0.25;
    static final String[] SOURCES = {"drums", "bass", "other", "vocals", "guitar", "piano"};
    // Güira: 32 kHz mono, 5 s windows with 0.5 s of context on each side
    static final int GSR = 32000, GWIN = 160000, GNFFT = 2048, GHOP = 320;
    static final double GCTX = 0.5;

    private final OrtEnvironment env;
    private final OrtSession demucs, guira;

    public Separator(OrtEnvironment env, OrtSession demucs, OrtSession guira) {
        this.env = env; this.demucs = demucs; this.guira = guira;
    }

    // The whole-song tracks live in memory-mapped temporary files, outside the Java heap. Android caps the
    // heap of an app (often 512 MB even with largeHeap, and there allocateDirect counts against it too):
    // six stereo tracks of a 3-4 minute song did not fit, so the separation fell back to the slow browser
    // version. A mapping uses free RAM like any memory, and the system can page it to storage if needed.
    public static File tmpDir = new File(System.getProperty("java.io.tmpdir"));
    static FloatBuffer newBuf(int n) throws java.io.IOException {
        File f = File.createTempFile("sep", ".f32", tmpDir);
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "rw")) {
            raf.setLength(n * 4L);
            ByteBuffer m = raf.getChannel().map(java.nio.channels.FileChannel.MapMode.READ_WRITE, 0, n * 4L);
            return m.order(ByteOrder.nativeOrder()).asFloatBuffer();
        } finally { f.delete(); } // the mapping stays valid; the space is freed when the buffer is collected
    }
    public static float[] range(FloatBuffer b, int a, int e) { float[] x = new float[e - a]; FloatBuffer d = b.duplicate(); d.position(a); d.get(x); return x; }

    // ---------- FFT ----------
    private static final Map<Integer, Object[]> plans = new HashMap<>();
    private static synchronized Object[] plan(int n) {
        Object[] p = plans.get(n);
        if (p != null) return p;
        int bits = Integer.numberOfTrailingZeros(n);
        int[] rev = new int[n];
        for (int i = 0; i < n; i++) { int r = 0, x = i; for (int b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
        double[] cos = new double[n / 2], sin = new double[n / 2];
        for (int i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
        p = new Object[]{rev, cos, sin};
        plans.put(n, p);
        return p;
    }
    private static void fft(double[] re, double[] im, int sign) {
        int n = re.length; Object[] p = plan(n);
        int[] rev = (int[]) p[0]; double[] cos = (double[]) p[1], sin = (double[]) p[2];
        for (int i = 0; i < n; i++) { int j = rev[i]; if (j > i) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
        for (int size = 2; size <= n; size <<= 1) {
            int half = size >> 1, step = n / size;
            for (int start = 0; start < n; start += size) {
                for (int k = 0, w = 0; k < half; k++, w += step) {
                    double wr = cos[w], wi = sign * sin[w];
                    int a = start + k, b = a + half;
                    double xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                }
            }
        }
    }
    private static final Map<Integer, double[]> hanns = new HashMap<>();
    private static synchronized double[] hann(int n) {
        double[] w = hanns.get(n);
        if (w == null) { w = new double[n]; for (int i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); hanns.put(n, w); }
        return w;
    }
    private static double[] reflectPad(float[] x, int left, int right) {
        int n = x.length; double[] out = new double[n + left + right];
        for (int i = 0; i < out.length; i++) { int j = i - left; while (j < 0 || j >= n) { if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; } out[i] = x[j]; }
        return out;
    }
    private static double[] reflectPad(double[] x, int left, int right) {
        int n = x.length; double[] out = new double[n + left + right];
        for (int i = 0; i < out.length; i++) { int j = i - left; while (j < 0 || j >= n) { if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; } out[i] = x[j]; }
        return out;
    }

    /** torch.stft(center=True, reflect, onesided); result index [f * T + t]. */
    static final class Spec { float[] re, im; int F, T; }
    static Spec stft(double[] x, int nfft, int hop, boolean normalized) {
        double[] w = hann(nfft), xp = reflectPad(x, nfft / 2, nfft / 2);
        Spec s = new Spec(); s.T = 1 + (xp.length - nfft) / hop; s.F = nfft / 2 + 1;
        s.re = new float[s.F * s.T]; s.im = new float[s.F * s.T];
        double[] br = new double[nfft], bi = new double[nfft];
        double scale = normalized ? 1 / Math.sqrt(nfft) : 1;
        for (int t = 0; t < s.T; t++) {
            int off = t * hop;
            for (int i = 0; i < nfft; i++) { br[i] = xp[off + i] * w[i]; bi[i] = 0; }
            fft(br, bi, -1);
            for (int f = 0; f < s.F; f++) { s.re[f * s.T + t] = (float) (br[f] * scale); s.im[f * s.T + t] = (float) (bi[f] * scale); }
        }
        return s;
    }
    static Spec stft(float[] x, int nfft, int hop, boolean normalized) {
        double[] d = new double[x.length]; for (int i = 0; i < x.length; i++) d[i] = x[i];
        return stft(d, nfft, hop, normalized);
    }
    /** torch.istft(center=True). */
    static float[] istft(float[] re, float[] im, int F, int T, int nfft, int hop, int length, boolean normalized) {
        double[] w = hann(nfft);
        int total = nfft + hop * (T - 1);
        double[] y = new double[total], env = new double[total], br = new double[nfft], bi = new double[nfft];
        double scale = (normalized ? Math.sqrt(nfft) : 1) / nfft;
        for (int t = 0; t < T; t++) {
            for (int f = 0; f < F; f++) { br[f] = re[f * T + t]; bi[f] = im[f * T + t]; }
            bi[0] = 0; bi[F - 1] = 0;
            for (int f = F; f < nfft; f++) { br[f] = br[nfft - f]; bi[f] = -bi[nfft - f]; }
            fft(br, bi, 1);
            int off = t * hop;
            for (int i = 0; i < nfft; i++) { y[off + i] += br[i] * scale * w[i]; env[off + i] += w[i] * w[i]; }
        }
        float[] out = new float[length]; int start = nfft / 2;
        for (int i = 0; i < length; i++) { int j = start + i; if (j >= total) break; double e = env[j]; out[i] = (float) (e > 1e-11 ? y[j] / e : y[j]); }
        return out;
    }
    /** Windowed-sinc resampler (same as separate.js). */
    static float[] resample(float[] x, int from, int to) {
        if (from == to) return x.clone();
        double ratio = (double) from / to; int n = (int) Math.floor(x.length / ratio);
        double cutoff = Math.min(1, (double) to / from); int W = 24;
        float[] out = new float[n];
        for (int i = 0; i < n; i++) {
            double t = i * ratio; int c = (int) Math.floor(t); double s = 0, norm = 0;
            for (int k = c - W + 1; k <= c + W; k++) {
                double d = t - k, win = 0.5 + 0.5 * Math.cos(Math.PI * d / W), a = Math.PI * cutoff * d;
                double h = (d == 0 ? 1 : Math.sin(a) / a) * win;
                norm += h; if (k >= 0 && k < x.length) s += x[k] * h;
            }
            out[i] = (float) (s / norm);
        }
        return out;
    }

    // ---------- Demucs ----------
    static float[] demucsSpec(float[][] ch, int[] tOut) {
        int le = (int) Math.ceil((double) L / HOP), pad = (HOP / 2) * 3, Fq = NFFT / 2;
        float[] out = new float[4 * Fq * le];
        for (int c = 0; c < 2; c++) {
            double[] xp = reflectPad(ch[c], pad, pad + le * HOP - L);
            Spec z = stft(xp, NFFT, HOP, true);
            for (int f = 0; f < Fq; f++) for (int t = 0; t < le; t++) {
                int src = f * z.T + t + 2;
                out[((c * 2) * Fq + f) * le + t] = z.re[src];
                out[((c * 2 + 1) * Fq + f) * le + t] = z.im[src];
            }
        }
        tOut[0] = le;
        return out;
    }
    static float[][][] demucsIspec(float[] zout, int S, int T) {
        int Fq = NFFT / 2, F = Fq + 1, T2 = T + 4, pad = (HOP / 2) * 3;
        int le = HOP * (int) Math.ceil((double) L / HOP) + 2 * pad;
        float[][][] res = new float[S][2][];
        for (int s = 0; s < S; s++) for (int c = 0; c < 2; c++) {
            float[] re = new float[F * T2], im = new float[F * T2];
            int bR = ((s * 4 + c * 2) * Fq) * T, bI = ((s * 4 + c * 2 + 1) * Fq) * T;
            for (int f = 0; f < Fq; f++) for (int t = 0; t < T; t++) { re[f * T2 + t + 2] = zout[bR + f * T + t]; im[f * T2 + t + 2] = zout[bI + f * T + t]; }
            float[] x = istft(re, im, F, T2, NFFT, HOP, le, true);
            float[] o = new float[L]; System.arraycopy(x, pad, o, 0, L);
            res[s][c] = o;
        }
        return res;
    }
    private static float[] toArray(OnnxTensor t) {
        FloatBuffer b = t.getFloatBuffer(); float[] a = new float[b.remaining()]; b.get(a); return a;
    }

    Map<String, FloatBuffer[]> demucsAll(float[] left, float[] right, Progress pr, Cancel cc) throws Exception {
        int total = left.length, overlap = (int) Math.floor(L * OVERLAP), stride = L - overlap;
        int n = Math.max(1, (int) Math.ceil((double) total / stride));
        float[] win = new float[L]; java.util.Arrays.fill(win, 1f);
        for (int i = 0; i < overlap; i++) { float v = (float) i / (overlap - 1); win[i] = v; win[L - 1 - i] = v; }
        FloatBuffer[][] out = new FloatBuffer[SOURCES.length][2];
        for (int k = 0; k < SOURCES.length; k++) for (int c = 0; c < 2; c++) out[k][c] = newBuf(total);
        float[] wsum = new float[total];
        for (int i = 0; i < n; i++) {
            if (cc.cancelled()) throw new InterruptedException("cancelled");
            int s = i * stride, e = Math.min(s + L, total), len = e - s;
            float[] cl = new float[L], cr = new float[L];
            System.arraycopy(left, s, cl, 0, len); System.arraycopy(right, s, cr, 0, len);
            float[] mix = new float[2 * L]; System.arraycopy(cl, 0, mix, 0, L); System.arraycopy(cr, 0, mix, L, L);
            int[] T = new int[1]; float[] spec = demucsSpec(new float[][]{cl, cr}, T);
            Map<String, OnnxTensor> feeds = new LinkedHashMap<>();
            float[] zout, xt;
            try (OnnxTensor tm = OnnxTensor.createTensor(env, FloatBuffer.wrap(mix), new long[]{1, 2, L});
                 OnnxTensor ts = OnnxTensor.createTensor(env, FloatBuffer.wrap(spec), new long[]{1, 4, NFFT / 2, T[0]})) {
                feeds.put("mix", tm); feeds.put("spec", ts);
                try (OrtSession.Result r = demucs.run(feeds)) {
                    zout = toArray((OnnxTensor) r.get("zout").get()); xt = toArray((OnnxTensor) r.get("xt").get());
                }
            }
            float[][][] wav = demucsIspec(zout, SOURCES.length, T[0]);
            for (int k = 0; k < SOURCES.length; k++) for (int c = 0; c < 2; c++) {
                FloatBuffer o = out[k][c]; float[] w = wav[k][c]; int tb = (k * 2 + c) * L;
                for (int j = 0; j < len; j++) o.put(s + j, o.get(s + j) + (w[j] + xt[tb + j]) * win[j]);
            }
            for (int j = 0; j < len; j++) wsum[s + j] += win[j];
            pr.on("demucs", i + 1, n);
        }
        for (FloatBuffer[] st : out) for (FloatBuffer ch : st) for (int j = 0; j < total; j++) ch.put(j, ch.get(j) / Math.max(wsum[j], 1e-8f));
        Map<String, FloatBuffer[]> stems = new HashMap<>();
        for (int k = 0; k < SOURCES.length; k++) stems.put(SOURCES[k], out[k]);
        return stems;
    }

    float[] guiraAll(float[] mono32, Progress pr, Cancel cc) throws Exception {
        int total = mono32.length, NL = (int) Math.round(GCTX * GSR), NR = NL, NC = GWIN - NL - NR;
        float[] out = new float[total];
        java.util.List<Integer> all = new java.util.ArrayList<>();
        int cur = 0; while (cur + GWIN < total) { all.add(cur); cur += NC; }
        int tail = cur < total ? cur : -1; if (tail >= 0) all.add(tail);
        for (int i = 0; i < all.size(); i++) {
            if (cc.cancelled()) throw new InterruptedException("cancelled");
            int s = all.get(i); float[] chunk = new float[GWIN];
            System.arraycopy(mono32, s, chunk, 0, Math.min(GWIN, total - s));
            float[] d; long[] dims;
            try (OnnxTensor tc = OnnxTensor.createTensor(env, FloatBuffer.wrap(chunk), new long[]{1, 1, GWIN})) {
                Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("chunk", tc);
                try (OrtSession.Result r = guira.run(feeds)) {
                    OnnxTensor g = (OnnxTensor) r.get("guira").get(); dims = g.getInfo().getShape(); d = toArray(g);
                }
            }
            int T = (int) dims[2], F = (int) dims[3];
            float[] re = new float[F * T], im = new float[F * T];
            for (int t = 0; t < T; t++) for (int f = 0; f < F; f++) { re[f * T + t] = d[t * F + f]; im[f * T + t] = d[T * F + t * F + f]; }
            float[] y = istft(re, im, F, T, GNFFT, GHOP, GWIN, false);
            if (i == all.size() - 1 && s == tail) { int segLen = Math.min(GWIN, total - s); for (int j = NL; j < segLen; j++) out[s + j] = y[j]; }
            else if (s == 0) { for (int j = 0; j < GWIN - NR; j++) out[j] = y[j]; }
            else { for (int j = NL; j < GWIN - NR; j++) out[s + j] = y[j]; }
            pr.on("guira", i + 1, all.size());
        }
        return out;
    }

    // The güira mask is computed on blocks of ~30 s (plus 8 hops of context on each side, more than a
    // window): the STFT frames line up with the whole-song ones, so the result is the same, but the
    // memory no longer grows with the length of the song (a full STFT of 4 minutes took about 1 GB).
    static final int SPLIT_SEG = 512 * 2560, SPLIT_PAD = 512 * 8;
    static void splitDrums(FloatBuffer[] drums, float[] guira44, FloatBuffer[] gu, FloatBuffer[] bo) {
        int n = drums[0].capacity();
        for (int s = 0; s < n; s += SPLIT_SEG) {
            int a = Math.max(0, s - SPLIT_PAD), b = Math.min(n, s + SPLIT_SEG + SPLIT_PAD), cnt = Math.min(SPLIT_SEG, n - s);
            float[][][] r = splitBlock(new float[][]{range(drums[0], a, b), range(drums[1], a, b)}, java.util.Arrays.copyOfRange(guira44, a, b));
            for (int c = 0; c < 2; c++) {
                FloatBuffer g = gu[c].duplicate(); g.position(s); g.put(r[0][c], s - a, cnt);
                FloatBuffer o = bo[c].duplicate(); o.position(s); o.put(r[1][c], s - a, cnt);
            }
        }
    }

    static float[][][] splitBlock(float[][] drums, float[] guira44) {
        int nfft = 2048, hop = 512, n = drums[0].length;
        Spec g = stft(guira44, nfft, hop, false);
        float[] gm = new float[g.re.length];
        for (int i = 0; i < gm.length; i++) gm[i] = (float) Math.hypot(g.re[i], g.im[i]);
        float[][] gu = new float[2][], bo = new float[2][];
        for (int c = 0; c < 2; c++) {
            Spec z = stft(drums[c], nfft, hop, false); int m = z.re.length;
            float[] ar = new float[m], ai = new float[m], br = new float[m], bi = new float[m];
            for (int i = 0; i < m; i++) {
                float k = (float) Math.min(1, gm[i] / (Math.hypot(z.re[i], z.im[i]) + 1e-8));
                ar[i] = z.re[i] * k; ai[i] = z.im[i] * k; br[i] = z.re[i] * (1 - k); bi[i] = z.im[i] * (1 - k);
            }
            gu[c] = istft(ar, ai, z.F, z.T, nfft, hop, n, false);
            bo[c] = istft(br, bi, z.F, z.T, nfft, hop, n, false);
        }
        return new float[][][]{gu, bo};
    }

    /** Full pipeline; keys: vocals, guitar, bass, bongo, guira, altro (= other + piano), piano (stereo each).
     *  The input channels in[0], in[1] are released after the first step to free memory. */
    public Map<String, FloatBuffer[]> separate(float[][] in, boolean withGuira, Progress pr, Cancel cc) throws Exception {
        Map<String, FloatBuffer[]> dem = demucsAll(in[0], in[1], pr, cc);
        in[0] = null; in[1] = null;
        pr.on("resample", 0, 0);
        FloatBuffer[] d = dem.remove("drums"); int n = d[0].capacity();
        FloatBuffer[] bongo, guiraSt;
        if (!withGuira || guira == null) { bongo = d; guiraSt = new FloatBuffer[]{newBuf(n), newBuf(n)}; }
        else {
            float[] mono = new float[n]; for (int i = 0; i < n; i++) mono[i] = 0.5f * (d[0].get(i) + d[1].get(i));
            float[] m32 = resample(mono, SR, GSR); mono = null;
            float[] g32 = guiraAll(m32, pr, cc); m32 = null;
            float[] g44 = java.util.Arrays.copyOf(resample(g32, GSR, SR), n); g32 = null;
            pr.on("split", 0, 0);
            guiraSt = new FloatBuffer[]{newBuf(n), newBuf(n)}; bongo = new FloatBuffer[]{newBuf(n), newBuf(n)};
            splitDrums(d, g44, guiraSt, bongo);
        }
        FloatBuffer[] altro = dem.get("other"), p = dem.get("piano"); // altro = other + piano, summed in place
        for (int c = 0; c < 2; c++) for (int i = 0; i < n; i++) altro[c].put(i, altro[c].get(i) + p[c].get(i));
        Map<String, FloatBuffer[]> res = new LinkedHashMap<>();
        res.put("vocals", dem.get("vocals")); res.put("guitar", dem.get("guitar")); res.put("bass", dem.get("bass"));
        res.put("bongo", bongo); res.put("guira", guiraSt); res.put("altro", altro); res.put("piano", p); // kept as a track by the app only if it really plays
        return res;
    }
}
