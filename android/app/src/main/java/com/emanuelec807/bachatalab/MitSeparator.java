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

    public static int scOverlap = 2, mgOverlap = 2, mgChunk = 220500;   // 5 s: the Mega model is exported for 431 STFT frames
    // Mega 53 listens to SCNet's "other" (where guitar and piano are) rather than to the whole mix: on the test
    // songs the subtraction other - guitar then leaves no negative copy of the guitar in "altro".
    public static boolean megaOnOther = true;

    private final OrtEnvironment env;
    private final OrtSession scnet, mega, guira;

    public MitSeparator(OrtEnvironment env, OrtSession scnet, OrtSession mega, OrtSession guira) {
        this.env = env; this.scnet = scnet; this.mega = mega; this.guira = guira;
    }

    interface ChunkModel { float[][][] run(float[][] chunk) throws Exception; }   // [stems][2][len]

    /** ZFTurbo's generic demix: chunks every chunk/overlap samples, linear fades of chunk/10 (none at the
     *  song edges), the borders reflect-padded, the last chunk reflect- or zero-padded. */
    static FloatBuffer[][] demix(FloatBuffer[] mix, int n, int chunk, int overlap, int stems, ChunkModel model,
                                 String stage, Separator.Progress pr, Separator.Cancel cc) throws Exception {
        int fade = chunk / 10, step = chunk / overlap, border = chunk - step;
        boolean pad = n > 2 * border && border > 0;
        int off = pad ? border : 0, Lp = n + 2 * off;
        float[] win = new float[chunk]; java.util.Arrays.fill(win, 1f);
        for (int i = 0; i < fade; i++) { win[i] = fade == 1 ? 0 : (float) i / (fade - 1); win[chunk - fade + i] = fade == 1 ? 0 : 1f - (float) i / (fade - 1); }
        FloatBuffer[][] acc = new FloatBuffer[stems][2];
        for (int s = 0; s < stems; s++) for (int c = 0; c < 2; c++) acc[s][c] = Separator.newBuf(n);
        float[] cnt = new float[n];
        int nChunks = 0; for (int i = 0; i < Lp; i += step) nChunks++;
        int k = 0;
        for (int i = 0; i < Lp; i += step) {
            if (cc.cancelled()) throw new InterruptedException("cancelled");
            int ln = Math.min(chunk, Lp - i);
            float[][] part = new float[2][chunk];
            for (int c = 0; c < 2; c++) {
                for (int j = 0; j < ln; j++) part[c][j] = mix[c].get(reflect(i + j - off, n));
                if (ln < chunk && ln > chunk / 2) for (int j = ln; j < chunk; j++) part[c][j] = part[c][reflect(j, ln)];
            }
            float[][][] y = model.run(part);
            boolean first = i == 0, last = i + step >= Lp;
            for (int j = 0; j < ln; j++) {
                int p = i + j - off; if (p < 0 || p >= n) continue;
                float w = win[j];
                if (first && j < fade) w = 1; if (last && j >= chunk - fade) w = 1;
                for (int s = 0; s < stems; s++) for (int c = 0; c < 2; c++) acc[s][c].put(p, acc[s][c].get(p) + y[s][c][j] * w);
                cnt[p] += w;
            }
            pr.on(stage, ++k, nChunks);
        }
        for (FloatBuffer[] st : acc) for (FloatBuffer ch : st) for (int j = 0; j < n; j++) ch.put(j, ch.get(j) / Math.max(cnt[j], 1e-8f));
        return acc;
    }
    /** torch "reflect" index (edge not repeated) */
    static int reflect(int j, int n) { if (n == 1) return 0; while (j < 0 || j >= n) { if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; } return j; }

    // ---------- SCNet ----------
    float[][][] scnetChunk(float[][] ch) throws Exception {
        int L = ch[0].length, padding = SC_HOP - L % SC_HOP;
        if ((L + padding) / SC_HOP % 2 == 0) padding += SC_HOP;
        int Lp = L + padding;
        double[] w = Separator.rect(SC_NFFT);
        Separator.Spec[] z = new Separator.Spec[2];
        for (int c = 0; c < 2; c++) { double[] x = new double[Lp]; for (int i = 0; i < L; i++) x[i] = ch[c][i]; z[c] = Separator.stft(x, SC_NFFT, SC_HOP, true, w); }
        int F = z[0].F, T = z[0].T, FT = F * T;
        float[] in = new float[4 * FT];
        for (int c = 0; c < 2; c++) { System.arraycopy(z[c].re, 0, in, (2 * c) * FT, FT); System.arraycopy(z[c].im, 0, in, (2 * c + 1) * FT, FT); }
        float[] out;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), new long[]{1, 4, F, T})) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = scnet.run(feeds)) { out = Separator.toArray((OnnxTensor) r.get(0)); }
        }
        float[][][] res = new float[4][2][];
        for (int s = 0; s < 4; s++) for (int c = 0; c < 2; c++) {
            int j = s * 2 + c;
            float[] re = java.util.Arrays.copyOfRange(out, (2 * j) * FT, (2 * j + 1) * FT), im = java.util.Arrays.copyOfRange(out, (2 * j + 1) * FT, (2 * j + 2) * FT);
            float[] y = Separator.istft(re, im, F, T, SC_NFFT, SC_HOP, Lp, true, w);
            res[s][c] = java.util.Arrays.copyOf(y, L);
        }
        return res;
    }

    // ---------- Mega 53 (guitar, piano) ----------
    float[][][] megaChunk(float[][] ch) throws Exception {
        int L = ch[0].length;
        Separator.Spec[] z = { Separator.stft(ch[0], MG_NFFT, MG_HOP, false), Separator.stft(ch[1], MG_NFFT, MG_HOP, false) };
        int F = z[0].F, T = z[0].T;
        float[] in = new float[F * 2 * T * 2];   // [1, F*2 (freq-major, stereo interleaved), T, 2 (re, im)]
        for (int f = 0; f < F; f++) for (int s = 0; s < 2; s++) for (int t = 0; t < T; t++) {
            int o = (((f * 2 + s) * T) + t) * 2; in[o] = z[s].re[f * T + t]; in[o + 1] = z[s].im[f * T + t];
        }
        float[] out; long[] shape;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), new long[]{1, F * 2, T, 2})) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = mega.run(feeds)) { OnnxTensor o = (OnnxTensor) r.get(0); shape = o.getInfo().getShape(); out = Separator.toArray(o); }
        }
        int S = (int) shape[0];
        float[][][] res = new float[S][2][];
        for (int n = 0; n < S; n++) for (int s = 0; s < 2; s++) {
            float[] re = new float[F * T], im = new float[F * T];
            for (int f = 1; f < F; f++) for (int t = 0; t < T; t++) {   // f = 0 stays 0: zero_dc
                int o = ((((n * F + f) * 2 + s) * T) + t) * 2; re[f * T + t] = out[o]; im[f * T + t] = out[o + 1];
            }
            res[n][s] = Separator.istft(re, im, F, T, MG_NFFT, MG_HOP, L, false);
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
        FloatBuffer[][] sc = demix(mix, n, SC_CH, scOverlap, 4, ch -> {
            for (float[] x : ch) for (int i = 0; i < x.length; i++) x[i] = (x[i] - mean) / std;
            float[][][] y = scnetChunk(ch);
            for (float[][] s : y) for (float[] x : s) for (int i = 0; i < x.length; i++) x[i] = x[i] * std + mean;
            return y;
        }, "scnet", pr, cc);
        FloatBuffer[] drums = sc[0], bass = sc[1], other = sc[2], vocals = sc[3];
        FloatBuffer[][] mg = demix(megaOnOther ? other : mix, n, mgChunk, mgOverlap, MG_HEADS.length, this::megaChunk, "mega", pr, cc);
        mix = null;
        FloatBuffer[] guitar = mg[0], piano = mg[1];
        for (int c = 0; c < 2; c++) for (int i = 0; i < n; i++) other[c].put(i, other[c].get(i) - guitar[c].get(i));   // altro = other - guitar
        pr.on("resample", 0, 0);
        FloatBuffer[] bongo, guiraSt;
        if (!withGuira || guira == null) { bongo = drums; guiraSt = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)}; }
        else {
            float[] mono = new float[n]; for (int i = 0; i < n; i++) mono[i] = 0.5f * (drums[0].get(i) + drums[1].get(i));
            float[] m32 = Separator.resample(mono, SR, Separator.GSR); mono = null;
            float[] g32 = Separator.guiraAll(env, guira, m32, pr, cc); m32 = null;
            float[] g44 = java.util.Arrays.copyOf(Separator.resample(g32, Separator.GSR, SR), n); g32 = null;
            pr.on("split", 0, 0);
            guiraSt = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)}; bongo = new FloatBuffer[]{Separator.newBuf(n), Separator.newBuf(n)};
            Separator.splitDrums(drums, g44, guiraSt, bongo);
        }
        Map<String, FloatBuffer[]> res = new LinkedHashMap<>();
        res.put("vocals", vocals); res.put("guitar", guitar); res.put("bass", bass);
        res.put("bongo", bongo); res.put("guira", guiraSt); res.put("altro", other); res.put("piano", piano);
        return res;
    }
}
