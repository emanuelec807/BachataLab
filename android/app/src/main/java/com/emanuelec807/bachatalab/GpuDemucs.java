package com.emanuelec807.bachatalab;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.util.List;

/**
 * Demucs on the phone GPU through LiteRT (branch veloce). The model (tools/gpu) has the same inputs and outputs as
 * demucs6.onnx; it runs in float32 on OpenCL: in float16 the quiet instruments (other, piano) lose too much.
 * Measured on the Vivo X300 (Dimensity 9500): 1.67 s per piece instead of 2.49 s on 7 processor cores.
 * The first separation compares one piece with the processor's; the verdict is kept per app version.
 */
final class GpuDemucs implements Separator.Gpu {
    private final Context ctx;
    private final File model;
    private final String key;
    volatile String note = "";

    GpuDemucs(Context ctx, File model, long appVersion) {
        this.ctx = ctx; this.model = model; this.key = "demucs_gpu_" + appVersion;
    }
    private SharedPreferences prefs() { return ctx.getSharedPreferences("gpu", Context.MODE_PRIVATE); }

    @Override public Boolean verified() {
        SharedPreferences p = prefs();
        return p.contains(key) ? p.getBoolean(key, false) : null;
    }
    @Override public void verdict(boolean ok, String why) {
        prefs().edit().putBoolean(key, ok).putString(key + "_why", why).apply();
        note = (ok ? "GPU verificata (" : "GPU esclusa (") + why + ")";
    }
    String lastWhy() { return prefs().getString(key + "_why", ""); }

    /** Processor sessions alongside the GPU: each running Demucs piece takes ~1.9 GB, the GPU about as much again. */
    @Override public int cpuWorkers(int open) {
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo(); am.getMemoryInfo(mi);
            if (mi.lowMemory) return 0;
            long gb = 1024L * 1024 * 1024, gpuNeed = 2 * gb, margin = gb, piece = 2 * gb;
            int w = (int) ((mi.availMem - gpuNeed - margin) / piece);
            return Math.max(0, Math.min(open, w));
        } catch (Exception e) { return 0; }
    }

    /** Compiled GPU programs are kept on storage (key: app version), so only the first separation pays the
     *  few seconds of compiling; if opening with the saved programs fails they are dropped and it compiles again. */
    @Override public Separator.Engine open() throws Exception {
        File cache = new File(ctx.getCacheDir(), "gpucache");
        CompiledModel m;
        try { m = create(cache); }
        catch (Exception e) {
            File[] fs = cache.listFiles(); if (fs != null) for (File f : fs) f.delete();
            m = create(null);
        }
        return engine(m);
    }
    private CompiledModel create(File cache) throws Exception {
        if (cache != null) cache.mkdirs();
        CompiledModel.Options op = new CompiledModel.Options(Accelerator.GPU);
        op.disableAutoFallbackToCpu();
        op.setGpuOptions(new CompiledModel.GpuOptions(null, null, Boolean.TRUE, CompiledModel.GpuOptions.Precision.FP32,
            CompiledModel.GpuOptions.BufferStorageType.BUFFER, null,
            cache != null ? cache.getAbsolutePath() : null, cache != null ? key : null, cache != null ? Boolean.TRUE : null,
            null, null, null, CompiledModel.GpuOptions.Backend.OPENCL, null, null));
        return CompiledModel.create(model.getAbsolutePath(), op);
    }
    private Separator.Engine engine(final CompiledModel m) throws Exception {
        final List<TensorBuffer> ins, outs;
        try { ins = m.createInputBuffers(); outs = m.createOutputBuffers(); }
        catch (Exception e) { m.close(); throw e; }
        return new Separator.Engine() {
            @Override public float[][] run(float[] mix, float[] spec, int T) throws Exception {
                ins.get(0).writeFloat(mix); ins.get(1).writeFloat(spec);
                m.run(ins, outs);
                float[] a = outs.get(0).readFloat(), b = outs.get(1).readFloat();
                return a.length == 2 * Separator.SOURCES.length * Separator.L ? new float[][]{b, a} : new float[][]{a, b};
            }
            @Override public void close() {
                for (TensorBuffer t : ins) try { t.close(); } catch (Exception ignored) {}
                for (TensorBuffer t : outs) try { t.close(); } catch (Exception ignored) {}
                try { m.close(); } catch (Exception ignored) {}
            }
        };
    }
}
