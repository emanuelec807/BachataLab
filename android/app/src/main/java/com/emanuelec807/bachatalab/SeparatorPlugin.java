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
    private volatile int pi = 0, pn = 0, threads = 1, workers = 1;
    private volatile String times = "";   // seconds per step of the last separation, for the final message
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
        r.put("threads", threads); r.put("workers", workers); r.put("frames", frames); r.put("times", times);
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

    /** Threads for the models: the cores that are not "little" ones. Phones report 7 or 8 cores (sometimes fewer
     *  when the system has switched some off); the little cores (Cortex-A5xx) would slow every step down to their
     *  pace, so they are left out by their capacity (or, if the system does not say it, their top frequency).
     *  When every core is a big one, one stays free for the screen and the system. */
    static int[] cpuPlan() {
        int avail = Runtime.getRuntime().availableProcessors();
        java.util.List<Long> cap = new java.util.ArrayList<>(), frq = new java.util.ArrayList<>();
        for (int i = 0; i < 64; i++) {
            String d = "/sys/devices/system/cpu/cpu" + i;
            if (!new File(d).exists()) break;
            cap.add(readLong(d + "/cpu_capacity")); frq.add(readLong(d + "/cpufreq/cpuinfo_max_freq"));
        }
        int total = Math.max(avail, cap.size()), perf = -1;
        perf = countAbove(cap, 0.35); if (perf < 0) perf = countAbove(frq, 0.7);
        int t = perf < 0 ? Math.max(1, total - 2) : (perf >= total ? total - 1 : perf);
        t = Math.max(1, Math.min(8, Math.min(t, avail)));
        return new int[]{t, total, perf};
    }
    private static int countAbove(java.util.List<Long> v, double frac) {
        if (v.isEmpty()) return -1; long max = 0;
        for (long x : v) { if (x <= 0) return -1; max = Math.max(max, x); }
        int c = 0; for (long x : v) if (x >= frac * max) c++;
        return c;
    }
    private static long readLong(String path) {
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(path))) { return Long.parseLong(r.readLine().trim()); }
        catch (Exception e) { return -1; }
    }
    /** Two chunks at a time (each with half the threads) keep the cores busier than one chunk with all of them,
     *  but each running chunk takes memory (measured: Demucs ~1.9 GB, güira ~0.2 GB): two at a time
     *  only when the phone has that twice over plus a margin free right now. */
    private int workersFor(Context ctx, String name) {
        if (threads < 4) return 1;
        long need = (name.equals("demucs") ? 6144L : 3072L) * 1024 * 1024;   // Demucs ~1.9 GB per piece, AudioSep ~0.2 GB
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo(); am.getMemoryInfo(mi);
            return mi.availMem >= need && !mi.lowMemory ? 2 : 1;
        } catch (Exception e) { return 1; }
    }

    private void work(boolean withGuira) {
        try {
            Context ctx = getContext();
            stage = "models"; pi = 0; pn = withGuira ? 2 : 1;
            File dm = modelFile(ctx, "demucs6"); pi = 1;
            File gm = withGuira ? modelFile(ctx, "guira") : null; pi = pn;
            OrtEnvironment env = OrtEnvironment.getEnvironment();
            threads = cpuPlan()[0];
            Separator.javaThreads = Math.min(4, threads);
            java.util.Map<String, File> modelFiles = new java.util.HashMap<>();
            modelFiles.put("demucs", dm); if (gm != null) modelFiles.put("guira", gm);
            // each model is opened just before its step (one session per worker) and closed after it
            Separator.Models models = (name, max) -> {
                File f = modelFiles.get(name); if (f == null) return null;
                int w = Math.min(max, workersFor(ctx, name)); if (name.equals("demucs")) workers = w;
                OrtSession[] ss = new OrtSession[w];
                try {
                    for (int k = 0; k < w; k++) {
                        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
                        o.setIntraOpNumThreads(Math.max(1, threads / w + (k < threads % w ? 1 : 0)));
                        o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                        o.setCPUArenaAllocator(false);
                        o.setMemoryPatternOptimization(false);
                        ss[k] = env.createSession(f.getAbsolutePath(), o);
                    }
                } catch (Exception e) {
                    for (OrtSession x : ss) try { if (x != null) x.close(); } catch (Exception ignored) {}
                    throw e;
                }
                return ss;
            };
            File tmp = new File(ctx.getCacheDir(), "septmp"); tmp.mkdirs();
            File[] old = tmp.listFiles(); if (old != null) for (File f : old) f.delete();
            Separator.tmpDir = tmp;
            state = "running";
            float[][] in = input; input = null; // the separator frees the channels after the first step
            final java.util.LinkedHashMap<String, Long> ms = new java.util.LinkedHashMap<>();
            final long[] last = {System.currentTimeMillis()}; final String[] cur = {"demucs"}; times = "";
            Map<String, FloatBuffer[]> stems = new Separator(env, models).separate(in, withGuira,
                (s, i, n) -> {
                    if (!s.equals(cur[0])) { long now = System.currentTimeMillis(); ms.merge(cur[0], now - last[0], Long::sum); last[0] = now; cur[0] = s; }
                    stage = s; pi = i; pn = n;
                }, () -> cancel);
            ms.merge(cur[0], System.currentTimeMillis() - last[0], Long::sum);
            StringBuilder tb = new StringBuilder(); long other = 0;
            for (Map.Entry<String, Long> e : ms.entrySet()) {
                String k = e.getKey();
                if (k.equals("demucs") || k.equals("guira")) tb.append(tb.length() > 0 ? " · " : "").append(k.equals("guira") ? "AudioSep" : "Demucs").append(' ').append(Math.round(e.getValue() / 1000.0)).append(" s");
                else other += e.getValue();
            }
            times = tb.append(" · resto ").append(Math.round(other / 1000.0)).append(" s").toString();
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
        // one copy per app version: an update that ships a new model must not reuse the old one
        long ver = 0;
        try { android.content.pm.PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
              ver = android.os.Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode; } catch (Exception ignored) {}
        File out = new File(dir, name + "." + ver + ".onnx");
        if (out.exists() && out.length() > 1_000_000) return out;
        File[] olds = dir.listFiles((d, f) -> f.startsWith(name + ".") && f.endsWith(".onnx"));
        if (olds != null) for (File f : olds) f.delete();
        File tmp = new File(dir, name + ".tmp");
        // the APK build stores the model as one raw file (smaller download); base64 parts are the fallback
        try (InputStream is = ctx.getAssets().open("public/models/" + name + ".onnx");
             OutputStream os = new BufferedOutputStream(new FileOutputStream(tmp), 1 << 20)) {
            byte[] buf = new byte[1 << 20]; int r;
            while ((r = is.read(buf)) > 0) os.write(buf, 0, r);
        } catch (java.io.FileNotFoundException e) { tmp.delete(); }
        if (tmp.exists() && tmp.length() > 1_000_000) { if (!tmp.renameTo(out)) throw new Exception("model " + name); return out; }
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
