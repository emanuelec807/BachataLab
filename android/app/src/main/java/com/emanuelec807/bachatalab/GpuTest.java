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
 * separation) and through LiteRT on the GPU in several ways; one transformer layer alone at full and small size. Reports the time per piece and how
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

    static String run(android.content.Context ctx, OrtEnvironment env, File onnx, File tflite, File tiny, File[] parts, int threads, Log log) throws Exception {
        StringBuilder sb = new StringBuilder();
        // 0) a tiny model (one 256x256 layer): does the GPU work at all? Default environment and one made with the app context.
        {
            float[] x = new float[64 * 256]; for (int i = 0; i < x.length; i++) x[i] = (float) Math.sin(i * 0.01);
            Result c = lite(tiny, x, Accelerator.CPU, null, null);
            sb.append(c.text("mini · CPU", null)).append('\n');
            sb.append(lite(tiny, x, Accelerator.GPU, null, null).text("mini · GPU", c.y)).append('\n');
            com.google.ai.edge.litert.Environment e = null;
            try { e = com.google.ai.edge.litert.Environment.create(ctx); sb.append(lite(tiny, x, Accelerator.GPU, null, e).text("mini · GPU (ambiente app)", c.y)).append('\n'); }
            catch (Throwable t) { sb.append("mini · ambiente app: ").append(t.getClass().getSimpleName()).append(": ").append(t.getMessage()).append('\n'); }
            finally { if (e != null) try { e.close(); } catch (Exception ignored) {} }
        }
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
        // 2) one transformer layer (float32 weights) at full size and small: does the GPU take it at all, and how?
        for (File part : parts) {
            // the stored file is "<app version>.mega_layer_<frames>.tflite": the frames come after "mega_layer_"
            String fn = part.getName(), fr = fn.substring(fn.indexOf("mega_layer_") + 11, fn.indexOf(".tflite"));
            String nm = "strato " + fr + " frame";
            int T = Integer.parseInt(fr);
            float[] x = new float[T * 62 * 256]; long seed = 7;
            for (int i = 0; i < x.length; i++) { seed = seed * 6364136223846793005L + 1442695040888963407L; x[i] = ((seed >>> 40) / (float) (1 << 24) - 0.5f); }
            float[] cpu = null;
            for (Object[] c : CONFIGS) {
                String name = nm + " · " + c[0]; log.line(name + "…");
                Result r = lite(part, x, (Accelerator) c[1], (CompiledModel.GpuOptions) c[2], null);
                if (c[1] == Accelerator.CPU && r.y != null) cpu = r.y;
                sb.append(r.text(name, cpu)).append('\n');
            }
        }
        // 3) the whole Mega 53 (int8 weights) on the GPU, in the different ways LiteRT can load it
        for (Object[] c : CONFIGS) {
            if (c[1] == Accelerator.CPU) continue;
            String name = "Mega intero · " + c[0]; log.line(name + "…");
            sb.append(lite(tflite, in, Accelerator.GPU, (CompiledModel.GpuOptions) c[2], null).text(name, ref)).append('\n');
        }
        // what LiteRT wrote in the system log (an app can read its own lines): the real reason of a failure
        try {
            Process pr = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-v", "brief", "-t", "3000"});
            java.util.ArrayList<String> keep = new java.util.ArrayList<>();
            try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(pr.getInputStream()))) {
                String l; while ((l = br.readLine()) != null) {
                    String lo = l.toLowerCase(java.util.Locale.ROOT);
                    if (lo.contains("litert") || lo.contains("tflite") || lo.contains("opencl") || lo.contains("gpu") || lo.contains("delegate") || lo.contains("accelerator"))
                        { keep.add(l.length() > 220 ? l.substring(0, 220) : l); if (keep.size() > 40) keep.remove(0); }
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
    static final Object[][] CONFIGS = {
        {"CPU LiteRT", Accelerator.CPU, null},
        {"GPU", Accelerator.GPU, gpu(null, null, null)},
        {"GPU OpenCL buffer", Accelerator.GPU, gpu(null, CompiledModel.GpuOptions.BufferStorageType.BUFFER, CompiledModel.GpuOptions.Backend.OPENCL)},
        {"GPU OpenCL fp32", Accelerator.GPU, gpu(CompiledModel.GpuOptions.Precision.FP32, CompiledModel.GpuOptions.BufferStorageType.BUFFER, CompiledModel.GpuOptions.Backend.OPENCL)},
        {"GPU OpenGL", Accelerator.GPU, gpu(null, null, CompiledModel.GpuOptions.Backend.OPENGL)},
    };

    static final class Result {
        float[] y; double sec, first; String err;
        String text(String name, float[] ref) {
            if (err != null) return name + ": non funziona (" + err + ")";
            return String.format(java.util.Locale.ROOT, "%s: %.2f s (prima volta %.1f s)%s", name, sec, first,
                                 ref != null && ref != y ? String.format(java.util.Locale.ROOT, ", uguale a %.1f dB", snrDb(ref, y)) : "");
        }
    }
    static Result lite(File model, float[] in, Accelerator acc, CompiledModel.GpuOptions go, com.google.ai.edge.litert.Environment env) {
        Result res = new Result(); CompiledModel m = null; List<TensorBuffer> ins = null, outs = null;
        try {
            CompiledModel.Options op = new CompiledModel.Options(acc);
            if (acc == Accelerator.GPU) { op.disableAutoFallbackToCpu(); if (go != null) op.setGpuOptions(go); }
            long t0 = System.nanoTime();
            m = env != null ? CompiledModel.create(model.getAbsolutePath(), op, env) : CompiledModel.create(model.getAbsolutePath(), op);
            ins = m.createInputBuffers(); outs = m.createOutputBuffers();
            ins.get(0).writeFloat(in); m.run(ins, outs); res.y = outs.get(0).readFloat();
            res.first = (System.nanoTime() - t0) / 1e9;
            long t = System.nanoTime();
            for (int r = 0; r < 2; r++) { ins.get(0).writeFloat(in); m.run(ins, outs); res.y = outs.get(0).readFloat(); }
            res.sec = (System.nanoTime() - t) / 2e9;
        } catch (Throwable e) {
            String msg = String.valueOf(e.getMessage()); if (msg.length() > 160) msg = msg.substring(0, 160);
            res.err = e.getClass().getSimpleName() + ": " + msg; res.y = null;
        } finally {
            if (ins != null) for (TensorBuffer b : ins) try { b.close(); } catch (Exception ignored) {}
            if (outs != null) for (TensorBuffer b : outs) try { b.close(); } catch (Exception ignored) {}
            if (m != null) try { m.close(); } catch (Exception ignored) {}
        }
        return res;
    }

    private static float[] ort(OrtEnvironment env, OrtSession s, float[] in, long[] shape) throws Exception {
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(in), shape)) {
            Map<String, OnnxTensor> feeds = new HashMap<>(); feeds.put("spec", t);
            try (OrtSession.Result r = s.run(feeds)) { return Separator.toArray((OnnxTensor) r.get(0)); }
        }
    }
}
