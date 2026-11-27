package com.emanuelec807.bachatalab;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.nio.FloatBuffer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * GPU test (branch veloce): one 7.8 s piece of Demucs on the processor with ONNX Runtime (what the separation
 * uses today) and with LiteRT on the processor and on the GPU in several ways. Reports the time per piece and how
 * close each result is to today's, per instrument (dB: higher = closer; above ~50 dB the difference cannot be
 * heard). Nothing is kept: it only measures.
 */
final class GpuTest {
    interface Log { void line(String s); }

    /** A test piece that behaves like music: plucked-string notes with harmonics, a pulse, a little noise, stereo. */
    static float[][] testAudio(int n) {
        float[][] x = new float[2][n];
        double[] notes = {196.0, 246.9, 293.7, 392.0, 329.6, 261.6, 220.0, 293.7};
        for (int k = 0; k < 24; k++) {
            int start = k * n / 24; double f = notes[k % notes.length];
            for (int i = start; i < n; i++) {
                double t = (i - start) / 44100.0, e = Math.exp(-t * 3.0), v = 0;
                for (int h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f * h * t) * e / h;
                x[0][i] += (float) (0.08 * v); x[1][i] += (float) (0.06 * v);
            }
        }
        long seed = 12345;
        for (int i = 0; i < n; i++) {
            seed = seed * 6364136223846793005L + 1442695040888963407L;
            float r = ((seed >>> 40) / (float) (1 << 24) - 0.5f);
            int beat = i % 22050; float hit = beat < 2000 ? (float) Math.exp(-beat / 300.0) * r * 0.5f : 0f;
            x[0][i] += r * 0.01f + hit; x[1][i] += -r * 0.01f + hit;
        }
        return x;
    }

    static double snrDb(float[] ref, float[] y) {
        double s = 0, e = 0; int n = Math.min(ref.length, y.length);
        for (int i = 0; i < n; i++) { s += (double) ref[i] * ref[i]; double d = ref[i] - y[i]; e += d * d; }
        return 10 * Math.log10(Math.max(s, 1e-30) / Math.max(e, 1e-30));
    }

    /** Final waveforms of the 6 instruments (as the separation builds them): inverse STFT of zout plus xt. */
    static float[][][] stems(float[] zout, float[] xt, int T) {
        int L = Separator.L, S = Separator.SOURCES.length;
        float[][][] w = Separator.demucsIspec(zout, S, T);
        for (int k = 0; k < S; k++) for (int c = 0; c < 2; c++) { int b = (k * 2 + c) * L; for (int j = 0; j < L; j++) w[k][c][j] += xt[b + j]; }
        return w;
    }

    static final String[] NAMES = {"percussioni", "basso", "altro", "voce", "chitarra", "piano"};

    static String compare(float[][][] ref, float[][][] y) {
        double min = 1e9; int at = 0;
        for (int k = 0; k < ref.length; k++) {
            float[] r = new float[2 * Separator.L], v = new float[2 * Separator.L];
            System.arraycopy(ref[k][0], 0, r, 0, Separator.L); System.arraycopy(ref[k][1], 0, r, Separator.L, Separator.L);
            System.arraycopy(y[k][0], 0, v, 0, Separator.L); System.arraycopy(y[k][1], 0, v, Separator.L, Separator.L);
            double d = snrDb(r, v); if (d < min) { min = d; at = k; }
        }
        return String.format(Locale.ROOT, "uguale ad almeno %.0f dB (il più diverso: %s)", min, NAMES[at]);
    }

    static String run(android.content.Context ctx, OrtEnvironment env, File onnx, File tflite, File tiny, File[] parts, int[][] partSizes, int threads, Log log) throws Exception {
        StringBuilder sb = new StringBuilder();
        // 0) a tiny model (one layer): does the GPU work at all?
        if (tiny != null) {
            float[] x = new float[64 * 256]; for (int i = 0; i < x.length; i++) x[i] = (float) Math.sin(i * 0.01);
            Single c = single(tiny, x, Accelerator.CPU, null, true);
            Single g = single(tiny, x, Accelerator.GPU, null, true);
            sb.append(g.err != null ? "mini · GPU: non funziona (" + g.err + ")"
                                    : String.format(Locale.ROOT, "mini · GPU: funziona, uguale a %.0f dB", c.y != null ? snrDb(c.y, g.y) : 0)).append('\n');
        }
        int L = Separator.L;
        float[][] ch = testAudio(L);
        int[] T = new int[1]; float[] spec = Separator.demucsSpec(ch, T);
        float[] mix = new float[2 * L]; System.arraycopy(ch[0], 0, mix, 0, L); System.arraycopy(ch[1], 0, mix, L, L);

        // 1) today's engine: ONNX Runtime on the processor
        log.line("CPU (ONNX Runtime)…");
        float[][][] ref;
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setIntraOpNumThreads(threads); o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        try (OrtSession s = env.createSession(onnx.getAbsolutePath(), o)) {
            float[][] r = ort(env, s, mix, spec, T[0]);
            long t = System.nanoTime();
            ort(env, s, mix, spec, T[0]); r = ort(env, s, mix, spec, T[0]);
            double sec = (System.nanoTime() - t) / 2e9;
            ref = stems(r[0], r[1], T[0]);
            sb.append(String.format(Locale.ROOT, "Demucs oggi · CPU ONNX Runtime (%d thread): %.2f s per pezzo\n", threads, sec));
        }
        // 2) Demucs through LiteRT: processor, then GPU in the different ways it can load
        for (Object[] c : CONFIGS) {
            String name = "Demucs · " + c[0]; log.line(name + "…");
            Pair p = pair(tflite, mix, spec, (Accelerator) c[1], (CompiledModel.GpuOptions) c[2], (Boolean) c[3]);
            if (p.err != null) sb.append(name).append(": non funziona (").append(p.err).append(")\n");
            else sb.append(String.format(Locale.ROOT, "%s: %.2f s per pezzo (prima volta %.1f s), %s\n",
                                         name, p.sec, p.first, compare(ref, stems(p.zout, p.xt, T[0]))));
        }
        // 3) pieces of the network alone (transformer; everything but the transformer), processor vs GPU on the same
        //    made-up input: if the whole model comes out wrong, this says which piece does it
        for (int k = 0; k < parts.length; k++) {
            String nm = parts[k].getName(); nm = nm.substring(nm.indexOf("part_") + 5, nm.indexOf(".tflite")).replace('_', ' ');
            float[][] in = new float[partSizes[k].length][]; long seed = 99 + k;
            for (int i = 0; i < in.length; i++) {
                in[i] = new float[partSizes[k][i]];
                for (int j = 0; j < in[i].length; j++) { seed = seed * 6364136223846793005L + 1442695040888963407L; in[i][j] = ((seed >>> 40) / (float) (1 << 24) - 0.5f) * 2f; }
            }
            log.line("pezzo " + nm + "…");
            Multi c = multi(parts[k], in, Accelerator.CPU, null, true);
            for (Object[] g : new Object[][]{{"GPU", gpu(null, null, null)}, {"GPU fp32", gpu(CompiledModel.GpuOptions.Precision.FP32, CompiledModel.GpuOptions.BufferStorageType.BUFFER, CompiledModel.GpuOptions.Backend.OPENCL)}}) {
                Multi r = multi(parts[k], in, Accelerator.GPU, (CompiledModel.GpuOptions) g[1], true);
                sb.append("pezzo ").append(nm).append(" · ").append(g[0]).append(": ");
                if (r.err != null || c.err != null) { sb.append("non funziona (").append(r.err != null ? r.err : "CPU " + c.err).append(")\n"); continue; }
                StringBuilder d = new StringBuilder();
                for (int q = 0; q < r.y.length; q++) d.append(q == 0 ? "" : ", ").append(String.format(Locale.ROOT, "%.0f", snrDb(c.y[q], r.y[q])));
                sb.append(String.format(Locale.ROOT, "%.2f s (CPU %.2f s), uguale a %s dB\n", r.sec, c.sec, d));
            }
        }
        // what LiteRT wrote in the system log (an app can read its own lines): the real reason of a failure
        try {
            Process pr = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-v", "brief", "-t", "4000"});
            java.util.ArrayList<String> keep = new java.util.ArrayList<>();
            try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(pr.getInputStream()))) {
                String l; while ((l = br.readLine()) != null) {
                    String lo = l.toLowerCase(Locale.ROOT);
                    if (lo.contains("litert") || lo.contains("tflite") || lo.contains("opencl") || lo.contains("gpu") || lo.contains("delegate")
                        || lo.contains("accelerator") || lo.contains("unsupported") || lo.contains("not supported") || lo.contains("ml_drift") || lo.contains("mismatch"))
                        { keep.add(l.length() > 400 ? l.substring(0, 400) : l); if (keep.size() > 30) keep.remove(0); }
                }
            }
            sb.append("\n— registro di sistema (ultime righe) —\n");
            for (String l : keep) sb.append(l).append('\n');
        } catch (Throwable t) { sb.append("registro non leggibile: ").append(t.getMessage()).append('\n'); }
        return sb.toString();
    }

    static CompiledModel.GpuOptions gpu(CompiledModel.GpuOptions.Precision p, CompiledModel.GpuOptions.BufferStorageType st,
                                        CompiledModel.GpuOptions.Backend be) {
        return new CompiledModel.GpuOptions(null, null, Boolean.TRUE, p, st, null, null, null, null, null, null, null, be, null, null);
    }
    /** name, accelerator, GPU options, GPU only (true) or GPU with the processor taking what the GPU cannot do (false) */
    static final Object[][] CONFIGS = {
        {"CPU LiteRT", Accelerator.CPU, null, true},
        {"GPU", Accelerator.GPU, gpu(null, null, null), true},
        {"GPU OpenCL fp32", Accelerator.GPU, gpu(CompiledModel.GpuOptions.Precision.FP32, CompiledModel.GpuOptions.BufferStorageType.BUFFER, CompiledModel.GpuOptions.Backend.OPENCL), true},
        {"GPU OpenGL", Accelerator.GPU, gpu(null, null, CompiledModel.GpuOptions.Backend.OPENGL), true},
        {"GPU + CPU dove serve", Accelerator.GPU, gpu(null, null, null), false},
    };

    static final class Multi { float[][] y; double sec; String err; }
    /** Any model: inputs in order, all outputs; one warm-up run, then the time of one run. */
    static Multi multi(File model, float[][] in, Accelerator acc, CompiledModel.GpuOptions go, boolean strict) {
        Multi res = new Multi(); CompiledModel m = null; List<TensorBuffer> ins = null, outs = null;
        try {
            m = open(model, acc, go, strict);
            ins = m.createInputBuffers(); outs = m.createOutputBuffers();
            for (int i = 0; i < in.length; i++) ins.get(i).writeFloat(in[i]);
            m.run(ins, outs);
            long t = System.nanoTime();
            for (int i = 0; i < in.length; i++) ins.get(i).writeFloat(in[i]);
            m.run(ins, outs);
            res.y = new float[outs.size()][];
            for (int o = 0; o < outs.size(); o++) res.y[o] = outs.get(o).readFloat();
            res.sec = (System.nanoTime() - t) / 1e9;
        } catch (Throwable e) {
            String msg = String.valueOf(e.getMessage()); if (msg.length() > 200) msg = msg.substring(0, 200);
            res.err = e.getClass().getSimpleName() + ": " + msg; res.y = null;
        } finally {
            if (ins != null) for (TensorBuffer b : ins) try { b.close(); } catch (Exception ignored) {}
            if (outs != null) for (TensorBuffer b : outs) try { b.close(); } catch (Exception ignored) {}
            if (m != null) try { m.close(); } catch (Exception ignored) {}
        }
        return res;
    }

    static final class Pair { float[] zout, xt; double sec, first; String err; }
    static final class Single { float[] y; String err; }

    private static CompiledModel open(File model, Accelerator acc, CompiledModel.GpuOptions go, boolean strict) throws Exception {
        CompiledModel.Options op = new CompiledModel.Options(acc);
        if (acc == Accelerator.GPU) { if (strict) op.disableAutoFallbackToCpu(); if (go != null) op.setGpuOptions(go); }
        return CompiledModel.create(model.getAbsolutePath(), op);
    }

    static Pair pair(File model, float[] mix, float[] spec, Accelerator acc, CompiledModel.GpuOptions go, boolean strict) {
        Pair res = new Pair(); CompiledModel m = null; List<TensorBuffer> ins = null, outs = null;
        try {
            long t0 = System.nanoTime();
            m = open(model, acc, go, strict);
            ins = m.createInputBuffers(); outs = m.createOutputBuffers();
            runOnce(m, ins, outs, mix, spec, res);
            res.first = (System.nanoTime() - t0) / 1e9;
            long t = System.nanoTime();
            for (int r = 0; r < 2; r++) runOnce(m, ins, outs, mix, spec, res);
            res.sec = (System.nanoTime() - t) / 2e9;
        } catch (Throwable e) {
            String msg = String.valueOf(e.getMessage()); if (msg.length() > 200) msg = msg.substring(0, 200);
            res.err = e.getClass().getSimpleName() + ": " + msg; res.zout = res.xt = null;
        } finally {
            if (ins != null) for (TensorBuffer b : ins) try { b.close(); } catch (Exception ignored) {}
            if (outs != null) for (TensorBuffer b : outs) try { b.close(); } catch (Exception ignored) {}
            if (m != null) try { m.close(); } catch (Exception ignored) {}
        }
        return res;
    }

    /** Inputs in the model's order (mix [1,2,L], spec [1,4,2048,T]); the two outputs told apart by size. */
    private static void runOnce(CompiledModel m, List<TensorBuffer> ins, List<TensorBuffer> outs, float[] mix, float[] spec, Pair res) throws Exception {
        ins.get(0).writeFloat(mix); ins.get(1).writeFloat(spec);
        m.run(ins, outs);
        float[] a = outs.get(0).readFloat(), b = outs.get(1).readFloat();
        if (a.length == 2 * 6 * Separator.L) { res.xt = a; res.zout = b; } else { res.zout = a; res.xt = b; }
    }

    static Single single(File model, float[] in, Accelerator acc, CompiledModel.GpuOptions go, boolean strict) {
        Single res = new Single(); CompiledModel m = null; List<TensorBuffer> ins = null, outs = null;
        try {
            m = open(model, acc, go, strict);
            ins = m.createInputBuffers(); outs = m.createOutputBuffers();
            ins.get(0).writeFloat(in); m.run(ins, outs); res.y = outs.get(0).readFloat();
        } catch (Throwable e) {
            String msg = String.valueOf(e.getMessage()); if (msg.length() > 160) msg = msg.substring(0, 160);
            res.err = e.getClass().getSimpleName() + ": " + msg;
        } finally {
            if (ins != null) for (TensorBuffer b : ins) try { b.close(); } catch (Exception ignored) {}
            if (outs != null) for (TensorBuffer b : outs) try { b.close(); } catch (Exception ignored) {}
            if (m != null) try { m.close(); } catch (Exception ignored) {}
        }
        return res;
    }

    private static float[][] ort(OrtEnvironment env, OrtSession s, float[] mix, float[] spec, int T) throws Exception {
        try (OnnxTensor tm = OnnxTensor.createTensor(env, FloatBuffer.wrap(mix), new long[]{1, 2, Separator.L});
             OnnxTensor ts = OnnxTensor.createTensor(env, FloatBuffer.wrap(spec), new long[]{1, 4, Separator.NFFT / 2, T})) {
            Map<String, OnnxTensor> feeds = new LinkedHashMap<>(); feeds.put("mix", tm); feeds.put("spec", ts);
            try (OrtSession.Result r = s.run(feeds)) {
                return new float[][]{Separator.toArray((OnnxTensor) r.get("zout").get()), Separator.toArray((OnnxTensor) r.get("xt").get())};
            }
        }
    }
}
