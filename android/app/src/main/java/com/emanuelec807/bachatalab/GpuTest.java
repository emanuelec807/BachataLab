package com.emanuelec807.bachatalab;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * GPU test (branch modelli-mit): the same 5 s piece of Mega 53 on the processor (ONNX Runtime, as in the
 * separation) and through LiteRT on the GPU, and on LiteRT's own CPU path. Reports the time per piece and how
 * far each result is from the processor one (dB: higher = closer). Nothing is kept: it only measures.
 */
final class GpuTest {
    interface Log { void line(String s); }

    /** A test piece that behaves like music: plucked-string notes with harmonics, a little noise, stereo. */
    static float[][] testAudio() {
        int n = MitSeparator.mgChunk; float[][] x = new float[2][n];
        double[] notes = {196.0, 246.9, 293.7, 392.0, 329.6, 261.6, 220.0, 293.7};
        long seed = 12345;
        for (int k = 0; k < 20; k++) {
            int start = k * n / 20; double f = notes[k % notes.length];
            for (int i = start; i < n; i++) {
                double t = (i - start) / 44100.0, e = Math.exp(-t * 3.0), v = 0;
                for (int h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f * h * t) * e / h;
                x[0][i] += (float) (0.08 * v); x[1][i] += (float) (0.06 * v);
            }
        }
        for (int i = 0; i < n; i++) { seed = seed * 6364136223846793005L + 1442695040888963407L; float r = ((seed >>> 40) / (float) (1 << 24) - 0.5f) * 0.01f; x[0][i] += r; x[1][i] -= r; }
        return x;
    }

    static double snrDb(float[] ref, float[] y) {
        double s = 0, e = 0; int n = Math.min(ref.length, y.length);
        for (int i = 0; i < n; i++) { s += (double) ref[i] * ref[i]; double d = ref[i] - y[i]; e += d * d; }
        return 10 * Math.log10(s / Math.max(e, 1e-30));
    }

    static String run(OrtEnvironment env, File onnx, File tflite, int threads, Log log) throws Exception {
        StringBuilder sb = new StringBuilder();
        int[] ft = new int[2]; float[] in = MitSeparator.megaSpec(testAudio(), ft);
        long[] shape = {1, ft[0] * 2, ft[1], 2};
        // 1) processor, ONNX Runtime (what the separation uses today)
        float[] ref;
        log.line("CPU (ONNX Runtime)…");
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setIntraOpNumThreads(threads); o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        try (OrtSession s = env.createSession(onnx.getAbsolutePath(), o)) {
            ref = ort(env, s, in, shape); long t = System.nanoTime();
            ort(env, s, in, shape); ort(env, s, in, shape);
            double sec = (System.nanoTime() - t) / 2e9;
            sb.append(String.format(java.util.Locale.ROOT, "CPU ONNX Runtime (%d thread): %.2f s per pezzo\n", threads, sec));
        }
        // 2) LiteRT: GPU (float16 and float32) and its CPU path
        Object[][] cfgs = {
            {"GPU", Accelerator.GPU, CompiledModel.GpuOptions.Precision.FP16},
            {"GPU fp32", Accelerator.GPU, CompiledModel.GpuOptions.Precision.FP32},
            {"CPU LiteRT", Accelerator.CPU, null}};
        for (Object[] c : cfgs) {
            String name = (String) c[0]; log.line(name + "…");
            CompiledModel m = null; List<TensorBuffer> ins = null, outs = null;
            try {
                CompiledModel.Options op = new CompiledModel.Options((Accelerator) c[1]);
                if (c[1] == Accelerator.GPU) {
                    op.disableAutoFallbackToCpu();   // a GPU that cannot run the model must say so, not hide behind the CPU
                    op.setGpuOptions(new CompiledModel.GpuOptions(null, null, null, (CompiledModel.GpuOptions.Precision) c[2], null, null,
                                                                  null, null, null, null, null, null, null, null, null));
                }
                long t0 = System.nanoTime();
                m = CompiledModel.create(tflite.getAbsolutePath(), op);
                ins = m.createInputBuffers(); outs = m.createOutputBuffers();
                ins.get(0).writeFloat(in); m.run(ins, outs); float[] y = outs.get(0).readFloat();
                double first = (System.nanoTime() - t0) / 1e9;
                long t = System.nanoTime();
                for (int r = 0; r < 2; r++) { ins.get(0).writeFloat(in); m.run(ins, outs); y = outs.get(0).readFloat(); }
                double sec = (System.nanoTime() - t) / 2e9;
                sb.append(String.format(java.util.Locale.ROOT, "%s: %.2f s per pezzo (preparazione %.1f s), uguale alla CPU a %.1f dB\n", name, sec, first, snrDb(ref, y)));
            } catch (Throwable e) {
                sb.append(name).append(": non funziona (").append(e.getClass().getSimpleName()).append(": ").append(String.valueOf(e.getMessage())).append(")\n");
            } finally {
                if (ins != null) for (TensorBuffer b : ins) try { b.close(); } catch (Exception ignored) {}
                if (outs != null) for (TensorBuffer b : outs) try { b.close(); } catch (Exception ignored) {}
                if (m != null) try { m.close(); } catch (Exception ignored) {}
            }
        }
        return sb.toString();
    }

    private static float[] ort(OrtEnvironment env, OrtSession s, float[] in, long[] shape) throws Exception {
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), shape)) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = s.run(feeds)) { return Separator.toArray((OnnxTensor) r.get(0)); }
        }
    }
}
