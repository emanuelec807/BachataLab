package com.emanuelec807.bachatalab;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Separation with MIT-licensed models only (branch "modelli-mit"):
 *  - SCNet (starrytong, MIT): drums, bass, other, vocals;
 *  - MVSep Mega 53 BS-RoFormer (ZFTurbo, MIT), reduced to the guitar and piano heads: guitar, piano;
 *  - AudioSep (MIT) on the drums: güira, and bongo = drums without the güira (as before).
 * The networks run on ONNX Runtime; STFT/ISTFT, chunking and cross-fades are here, ported from
 * ZFTurbo's demix() (fade window, reflect padding of the borders) so the result matches the reference.
 * With two sessions per model the chunks run two at a time (each with half the threads), and the STFT/ISTFT
 * of one chunk overlaps the network of the other; chunks are still added up in order, so the result does not
 * depend on how many run at once.
 * Plain Java (no Android classes): it is checked on a desktop JVM against the PyTorch reference.
 */
public final class MitSeparator {
    static final int SR = 44100;
    // SCNet: 11 s chunks, rectangular-window STFT n_fft 4096 hop 1024 normalized, input normalized by mean/std
    static final int SC_CH = 485100, SC_NFFT = 4096, SC_HOP = 1024;
    static final String[] SC_SOURCES = {"drums", "bass", "other", "vocals"};
    // Mega 53: hann STFT n_fft 2048 hop 512, chunk length fixed by the exported model
    static final int MG_NFFT = 2048, MG_HOP = 512;
    static final String[] MG_HEADS = {"guitar", "piano"};

    // Mega's chunks follow each other with only the fade (a tenth of a chunk) in common instead of half a chunk:
    // about 1.8 times less work. SCNet keeps half a chunk: its drums feed the güira, which changed audibly otherwise.
    public static int mgChunk = 220500;   // 5 s: the Mega model is exported for 431 STFT frames
    public static int scStep = SC_CH / 2, mgStep = mgChunk - mgChunk / 10;
    // Mega 53 listens to SCNet's "other" (where guitar and piano are) rather than to the whole mix: on the test
    // songs the subtraction other - guitar then leaves no negative copy of the guitar in "altro".
    public static boolean megaOnOther = true;
    /** AudioSep text conditions (512 values each, from tools/mit/export_audiosep.py); the bongo one may be null. */
    public static float[] condGuira, condBongo, condVoce;
    public static double GLO = 1000, GHI = 2000;

    /** Opens the sessions of one model, one per worker (null: model not available). Each model is opened just
     *  before its step and closed right after, so only one model at a time takes memory. */
    public interface Models { OrtSession[] open(String name, int maxWorkers) throws Exception; }

    private final OrtEnvironment env;
    private final Models models;

    public MitSeparator(OrtEnvironment env, Models models) { this.env = env; this.models = models; }
    /** single sessions, kept open (desktop checks) */
    public MitSeparator(OrtEnvironment env, OrtSession scnet, OrtSession mega, OrtSession guira) {
        this(env, (name, max) -> { OrtSession s = name.equals("scnet") ? scnet : name.equals("mega") ? mega : guira;
                            return s == null ? null : new OrtSession[]{s}; });
        keepOpen = true;
    }
    private boolean keepOpen = false;
    private void close(OrtSession[] ss) {
        if (keepOpen || ss == null) return;
        for (OrtSession x : ss) try { if (x != null) x.close(); } catch (Exception ignored) {}
    }

    interface Stage<R> { R run(OrtSession[] ss) throws Exception; }
    /** Opens a model, runs its step and closes it. If the step fails with two sessions at a time (memory can
     *  run short on the phone), it is redone from the start with one session. */
    private <R> R withModel(String name, Stage<R> st) throws Exception {
        OrtSession[] ss = models.open(name, 2);
        if (ss == null) return null;
        try { return st.run(ss); }
        catch (InterruptedException e) { throw e; }
        catch (Exception | OutOfMemoryError e) {
            if (ss.length < 2) throw e;
            close(ss); ss = null; System.gc();
            OrtSession[] one = models.open(name, 1);
            try { return st.run(one); } finally { close(one); }
        } finally { close(ss); }
    }

    interface ChunkModel { float[][][] run(int worker, float[][] chunk) throws Exception; }   // [stems][2][len]

    /** ZFTurbo's generic demix: chunks every chunk/overlap samples, linear fades of chunk/10 (none at the
     *  song edges), the borders reflect-padded, the last chunk reflect- or zero-padded. */
    static FloatBuffer[][] demix(FloatBuffer[] mix, int n, int chunk, int step, int stems, int workers, ChunkModel model,
                                 String stage, Separator.Progress pr, Separator.Cancel cc) throws Exception {
        int fade = chunk / 10, border = chunk - step;
        boolean pad = n > 2 * border && border > 0;
        int off = pad ? border : 0, Lp = n + 2 * off;
        float[] win = new float[chunk]; java.util.Arrays.fill(win, 1f);
        for (int i = 0; i < fade; i++) { win[i] = fade == 1 ? 0 : (float) i / (fade - 1); win[chunk - fade + i] = fade == 1 ? 0 : 1f - (float) i / (fade - 1); }
        FloatBuffer[][] acc = new FloatBuffer[stems][2];
        for (int s = 0; s < stems; s++) for (int c = 0; c < 2; c++) acc[s][c] = Separator.newBuf(n);
        float[] cnt = new float[n];
        int nChunks = 0; for (int i = 0; i < Lp; i += step) nChunks++;
        final int total = nChunks;
        // the chunks run on the workers (model + STFT/ISTFT); they are added up here in order, as in a plain loop
        Par.ordered(total, workers, (w, k) -> {
            int i = k * step, ln = Math.min(chunk, Lp - i);
            float[][] part = new float[2][chunk];
            for (int c = 0; c < 2; c++) {
                for (int j = 0; j < ln; j++) part[c][j] = mix[c].get(reflect(i + j - off, n));
                if (ln < chunk && ln > chunk / 2) for (int j = ln; j < chunk; j++) part[c][j] = part[c][reflect(j, ln)];
            }
            return model.run(w, part);
        }, (k, y) -> {
            int i = k * step, ln = Math.min(chunk, Lp - i);
            boolean first = i == 0, last = i + step >= Lp;
            for (int j = 0; j < ln; j++) {
                int p = i + j - off; if (p < 0 || p >= n) continue;
                float w = win[j];
                if (first && j < fade) w = 1; if (last && j >= chunk - fade) w = 1;
                for (int s = 0; s < stems; s++) for (int c = 0; c < 2; c++) acc[s][c].put(p, acc[s][c].get(p) + y[s][c][j] * w);
                cnt[p] += w;
            }
            pr.on(stage, k + 1, total);
        }, cc);
        for (FloatBuffer[] st : acc) for (FloatBuffer ch : st) for (int j = 0; j < n; j++) ch.put(j, ch.get(j) / Math.max(cnt[j], 1e-8f));
        return acc;
    }
    /** torch "reflect" index (edge not repeated) */
    static int reflect(int j, int n) { if (n == 1) return 0; while (j < 0 || j >= n) { if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; } return j; }

    // ---------- SCNet ----------
    float[][][] scnetChunk(OrtSession scnet, float[][] ch) throws Exception {
        int L = ch[0].length, padding = SC_HOP - L % SC_HOP;
        if ((L + padding) / SC_HOP % 2 == 0) padding += SC_HOP;
        int Lp = L + padding;
        double[] w = Separator.rect(SC_NFFT);
        double[] x0 = new double[Lp], x1 = new double[Lp];
        for (int i = 0; i < L; i++) { x0[i] = ch[0][i]; x1[i] = ch[1][i]; }
        Separator.Spec[] z = Separator.stft2(x0, x1, SC_NFFT, SC_HOP, true, w);
        int F = z[0].F, T = z[0].T, FT = F * T;
        float[] in = new float[4 * FT];
        for (int c = 0; c < 2; c++) { System.arraycopy(z[c].re, 0, in, (2 * c) * FT, FT); System.arraycopy(z[c].im, 0, in, (2 * c + 1) * FT, FT); }
        float[] out;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), new long[]{1, 4, F, T})) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = scnet.run(feeds)) { out = Separator.toArray((OnnxTensor) r.get(0)); }
        }
        float[][][] res = new float[4][2][];
        for (int s = 0; s < 4; s++) {   // both channels of a source in one inverse FFT
            int j0 = s * 2, j1 = s * 2 + 1;
            float[][] y = Separator.istft2(java.util.Arrays.copyOfRange(out, (2 * j0) * FT, (2 * j0 + 1) * FT), java.util.Arrays.copyOfRange(out, (2 * j0 + 1) * FT, (2 * j0 + 2) * FT),
                                           java.util.Arrays.copyOfRange(out, (2 * j1) * FT, (2 * j1 + 1) * FT), java.util.Arrays.copyOfRange(out, (2 * j1 + 1) * FT, (2 * j1 + 2) * FT),
                                           F, T, SC_NFFT, SC_HOP, Lp, true, w);
            for (int c = 0; c < 2; c++) res[s][c] = java.util.Arrays.copyOf(y[c], L);
        }
        return res;
    }

    // ---------- Mega 53 (guitar, piano) ----------
    // Mega works only where there is something to separate: a chunk of "altro" much quieter than the song
    // (intro without guitar, breaks with only percussion) gives silent guitar and piano without running the model.
    /** Mega's input: [1, F*2 (freq-major, stereo interleaved), T, 2 (re, im)]; ft receives F and T. */
    static float[] megaSpec(float[][] ch, int[] ft) {
        Separator.Spec[] z = Separator.stft2(ch[0], ch[1], MG_NFFT, MG_HOP, false);
        int F = z[0].F, T = z[0].T; ft[0] = F; ft[1] = T;
        float[] in = new float[F * 2 * T * 2];
        for (int f = 0; f < F; f++) for (int s = 0; s < 2; s++) for (int t = 0; t < T; t++) {
            int o = (((f * 2 + s) * T) + t) * 2; in[o] = z[s].re[f * T + t]; in[o + 1] = z[s].im[f * T + t];
        }
        return in;
    }
    double megaGate = 0;
    final java.util.concurrent.atomic.AtomicInteger megaSkipped = new java.util.concurrent.atomic.AtomicInteger();
    float[][][] megaChunk(OrtSession mega, float[][] ch) throws Exception {
        int L = ch[0].length;
        double e = 0; for (float[] c : ch) for (float v : c) e += v * v;
        if (Math.sqrt(e / (2.0 * L)) < megaGate) { megaSkipped.incrementAndGet(); return new float[MG_HEADS.length][2][L]; }
        int[] ft = new int[2]; float[] in = megaSpec(ch, ft);
        int F = ft[0], T = ft[1];
        float[] out; long[] shape;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), new long[]{1, F * 2, T, 2})) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = mega.run(feeds)) { OnnxTensor o = (OnnxTensor) r.get(0); shape = o.getInfo().getShape(); out = Separator.toArray(o); }
        }
        int S = (int) shape[0];
        float[][][] res = new float[S][2][];
        for (int n = 0; n < S; n++) {
            float[][] re = new float[2][F * T], im = new float[2][F * T];
            for (int s = 0; s < 2; s++) for (int f = 1; f < F; f++) for (int t = 0; t < T; t++) {   // f = 0 stays 0: zero_dc
                int o = ((((n * F + f) * 2 + s) * T) + t) * 2; re[s][f * T + t] = out[o]; im[s][f * T + t] = out[o + 1];
            }
            res[n] = Separator.istft2(re[0], im[0], re[1], im[1], F, T, MG_NFFT, MG_HOP, L, false);   // both channels at once
        }
        return res;
    }

    /** Same keys as the Demucs pipeline: vocals, guitar, bass, bongo, guira, altro (= other without the guitar,
     *  piano still inside: the app takes it out when piano really plays), piano. */
    public Map<String, FloatBuffer[]> separate(float[][] in, boolean withGuira, Separator.Progress pr, Separator.Cancel cc) throws Exception {
        int n = in[0].length;
        FloatBuffer[] mix = { Separator.newBuf(n), Separator.newBuf(n) };
        double sum = 0, sq = 0;
        for (int i = 0; i < n; i++) { float a = in[0][i], b = in[1][i]; mix[0].put(i, a); mix[1].put(i, b); double m = 0.5 * (a + b); sum += m; sq += m * m; }
        in[0] = null; in[1] = null;
        final float mean = (float) (sum / n), std = (float) Math.max(1e-8, Math.sqrt(Math.max(0, sq / n - (sum / n) * (sum / n))));
        // SCNet: input normalized (inference.normalize in its config), output brought back to the original scale
        pr.on("scnet", 0, 1);
        final FloatBuffer[] mixF = mix;
        FloatBuffer[][] sc = withModel("scnet", scs -> demix(mixF, n, SC_CH, scStep, 4, scs.length, (w, ch) -> {
                for (float[] x : ch) for (int i = 0; i < x.length; i++) x[i] = (x[i] - mean) / std;
                float[][][] y = scnetChunk(scs[w], ch);
                for (float[][] s : y) for (float[] x : s) for (int i = 0; i < x.length; i++) x[i] = x[i] * std + mean;
                return y;
            }, "scnet", pr, cc));
        FloatBuffer[] drums = sc[0], bass = sc[1], other = sc[2], vocals = sc[3];
        { FloatBuffer[] src = megaOnOther ? other : mix; double e = 0; for (FloatBuffer c : src) for (int i = 0; i < n; i++) { float v = c.get(i); e += v * v; }
          megaGate = 0.03 * Math.sqrt(e / (2.0 * n)); }   // -30 dB under the song's level
        pr.on("mega", 0, 1);
        final FloatBuffer[] mgIn = megaOnOther ? other : mix;
        FloatBuffer[][] mg = withModel("mega", mgs -> demix(mgIn, n, mgChunk, mgStep, MG_HEADS.length, mgs.length, (w, ch) -> megaChunk(mgs[w], ch), "mega", pr, cc));
        mix = null;
        FloatBuffer[] guitar = mg[0], piano = mg[1];
        for (int c = 0; c < 2; c++) for (int i = 0; i < n; i++) other[c].put(i, other[c].get(i) - guitar[c].get(i));   // altro = other - guitar
        pr.on("resample", 0, 0);
        FloatBuffer[] bongo, guiraSt;
        float[][] est = null; final float[] m32;
        if (withGuira && condGuira != null) {
            // SCNet does not know the güira: part of its scraping lands in "other". AudioSep listens to drums and
            // "altro" together, once asked for the güira and once for the bongo; the güira is taken out of both tracks
            // with one mask, shared with the bongo where both claim the same frequencies (the bongo keeps its slaps).
            // the voice too: SCNet leaves part of the güira in its vocals (heard as güira that drops when the voice is muted)
            final boolean voice = condBongo != null && condVoce != null;
            float[] mono = new float[n];
            for (int i = 0; i < n; i++) mono[i] = 0.5f * (drums[0].get(i) + drums[1].get(i) + other[0].get(i) + other[1].get(i) + (voice ? vocals[0].get(i) + vocals[1].get(i) : 0));
            m32 = Separator.resample(mono, SR, Separator.GSR); mono = null;
            final float[][] conds = voice ? new float[][]{condGuira, condBongo, condVoce} : condBongo != null ? new float[][]{condGuira, condBongo} : new float[][]{condGuira};
            est = withModel("asep", ss -> Separator.asepAll(env, ss, m32, conds, pr, cc));
        }
        if (est == null) { bongo = drums; guiraSt = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)}; }
        else {
            float[] g44 = java.util.Arrays.copyOf(Separator.resample(est[0], Separator.GSR, SR), n);
            float[] b44 = est.length > 1 ? java.util.Arrays.copyOf(Separator.resample(est[1], Separator.GSR, SR), n) : null;
            float[] v44 = est.length > 2 ? java.util.Arrays.copyOf(Separator.resample(est[2], Separator.GSR, SR), n) : null;
            est = null;
            pr.on("split", 0, 0);
            guiraSt = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)}; bongo = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)};
            FloatBuffer[] altroClean = {Separator.newBuf(n), Separator.newBuf(n)};
            // below ~1-2 kHz nothing moves (otherwise guitar and bongo slipped into the güira)
            FloatBuffer[] voClean = v44 != null ? new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)} : null;
            Separator.splitJoint(drums, other, v44 != null ? vocals : null, g44, b44, v44, guiraSt, bongo, altroClean, voClean, GLO, GHI, cc);
            other = altroClean;
            if (voClean != null) vocals = voClean;
        }
        Map<String, FloatBuffer[]> res = new LinkedHashMap<>();
        res.put("vocals", vocals); res.put("guitar", guitar); res.put("bass", bass);
        res.put("bongo", bongo); res.put("guira", guiraSt); res.put("altro", other); res.put("piano", piano);
        return res;
    }
}
