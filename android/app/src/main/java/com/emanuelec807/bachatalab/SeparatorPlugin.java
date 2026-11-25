package com.emanuelec807.bachatalab;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.content.Context;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.Map;

/**
 * Runs the stem separation natively (ONNX Runtime for Android, several threads), much faster than
 * the WebAssembly version in the page. The page sends the audio in base64 chunks, starts the job,
 * polls status() and reads the stems back from files with Capacitor.convertFileSrc.
 */
@CapacitorPlugin(name = "Separator")
public class SeparatorPlugin extends Plugin {
    private static final String[] MODEL_NAMES = {"demucs6", "guira"};
    private float[][] input;
    private volatile Thread job;
    private volatile boolean cancel;
    private volatile String state = "idle", stage = "", error = null;
    private volatile int pi = 0, pn = 0, threads = 1;
    private volatile JSObject files = null;
    private volatile int frames = 0;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("cores", Runtime.getRuntime().availableProcessors());
        call.resolve(r);
    }

    @PluginMethod
    public void begin(PluginCall call) {
        if (job != null) { call.reject("busy"); return; }
        int n = call.getInt("frames", 0);
        input = new float[][]{new float[n], new float[n]};
        frames = n; state = "idle"; error = null; files = null; stage = ""; pi = pn = 0;
        call.resolve();
    }

    /** data: base64 of little-endian int16 samples, written at offset of channel ch. */
    @PluginMethod
    public void append(PluginCall call) {
        int ch = call.getInt("ch", 0), off = call.getInt("offset", 0);
        byte[] b = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        ShortBuffer s = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
        float[] dst = input[ch];
        for (int i = 0; s.hasRemaining() && off + i < dst.length; i++) dst[off + i] = s.get() / 32768f;
        call.resolve();
    }

    @PluginMethod
    public void run(PluginCall call) {
        if (job != null || input == null) { call.reject("busy or no input"); return; }
        final boolean withGuira = call.getBoolean("guira", true);
        cancel = false; state = "loading"; error = null; files = null;
        job = new Thread(() -> work(withGuira), "separator");
        job.setPriority(Thread.MAX_PRIORITY);
        job.start();
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", state); r.put("stage", stage); r.put("i", pi); r.put("n", pn);
        r.put("threads", threads); r.put("frames", frames);
        if (error != null) r.put("error", error);
        if (files != null) r.put("files", files);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) { cancel = true; call.resolve(); }

    /** Deletes the stem files once the page has stored them. */
    @PluginMethod
    public void cleanup(PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "sep");
        File[] fs = dir.listFiles(); if (fs != null) for (File f : fs) f.delete();
        if (job == null) { state = "idle"; files = null; input = null; }
        call.resolve();
    }

    private void work(boolean withGuira) {
        OrtSession demucs = null, guira = null;
        try {
            Context ctx = getContext();
            stage = "models"; pi = 0; pn = withGuira ? 2 : 1;
            File dm = modelFile(ctx, "demucs6"); pi = 1;
            File gm = withGuira ? modelFile(ctx, "guira") : null; pi = pn;
            OrtEnvironment env = OrtEnvironment.getEnvironment();
            OrtSession.SessionOptions o = new OrtSession.SessionOptions();
            threads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
            o.setIntraOpNumThreads(threads);
            o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            o.setCPUArenaAllocator(false);
            o.setMemoryPatternOptimization(false);
            demucs = env.createSession(dm.getAbsolutePath(), o);
            if (gm != null) guira = env.createSession(gm.getAbsolutePath(), o);
            File tmp = new File(ctx.getCacheDir(), "septmp"); tmp.mkdirs();
            File[] old = tmp.listFiles(); if (old != null) for (File f : old) f.delete();
            Separator.tmpDir = tmp;
            state = "running";
            float[][] in = input; input = null; // the separator frees the channels after the first step
            Map<String, FloatBuffer[]> stems = new Separator(env, demucs, guira).separate(in, withGuira,
                (s, i, n) -> { stage = s; pi = i; pn = n; }, () -> cancel);
            stage = "write"; pi = 0; pn = stems.size();
            File dir = new File(ctx.getFilesDir(), "sep"); dir.mkdirs();
            JSObject fl = new JSObject();
            for (Map.Entry<String, FloatBuffer[]> e : stems.entrySet()) {
                File f = new File(dir, e.getKey() + ".pcm");
                writePcm(f, e.getValue());
                fl.put(e.getKey(), f.getAbsolutePath());
                pi++;
            }
            files = fl; state = "done";
        } catch (InterruptedException e) {
            state = "cancelled";
        } catch (Throwable t) {
            error = t.getClass().getSimpleName() + ": " + t.getMessage(); state = "error";
        } finally {
            try { if (demucs != null) demucs.close(); } catch (Exception ignored) {}
            try { if (guira != null) guira.close(); } catch (Exception ignored) {}
            job = null;
        }
    }

    /** Planar int16 little-endian: all of the left channel, then all of the right. */
    private static void writePcm(File f, FloatBuffer[] st) throws Exception {
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(f), 1 << 16)) {
            byte[] buf = new byte[8192]; int k = 0;
            for (FloatBuffer ch : st) for (int i = 0, n = ch.capacity(); i < n; i++) { float v = ch.get(i);
                int s = Math.round(Math.max(-1f, Math.min(1f, v)) * 32767f);
                buf[k++] = (byte) s; buf[k++] = (byte) (s >> 8);
                if (k == buf.length) { os.write(buf); k = 0; }
            }
            os.write(buf, 0, k);
        }
    }

    /** The models ship in the web assets as base64 parts; decode them once into app storage. */
    private File modelFile(Context ctx, String name) throws Exception {
        File dir = new File(ctx.getFilesDir(), "models"); dir.mkdirs();
        File out = new File(dir, name + ".onnx");
        if (out.exists() && out.length() > 1_000_000) return out;
        File tmp = new File(dir, name + ".tmp");
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(tmp), 1 << 20)) {
            for (int k = 0; ; k++) {
                String path = "public/models/" + name + "." + k + ".b64.txt";
                InputStream is;
                try { is = ctx.getAssets().open(path); } catch (Exception e) { if (k == 0) throw e; break; }
                ByteArrayOutputStream bo = new ByteArrayOutputStream(20 << 20);
                byte[] buf = new byte[1 << 20]; int r;
                while ((r = is.read(buf)) > 0) bo.write(buf, 0, r);
                is.close();
                os.write(Base64.decode(bo.toByteArray(), Base64.DEFAULT));
            }
        }
        if (!tmp.renameTo(out)) throw new Exception("model " + name);
        return out;
    }
}
