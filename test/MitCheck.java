import ai.onnxruntime.*;
import com.emanuelec807.bachatalab.*;
import java.io.*; import java.nio.*; import java.nio.file.*; import java.util.*;
public class MitCheck {
  // minimal WAV (float32 or int16, stereo) reader/writer
  static float[][] readWav(String p, double a, double b) throws Exception {
    byte[] d = Files.readAllBytes(Paths.get(p)); ByteBuffer bb = ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN);
    int off = 12, fmt = 1, ch = 2, bits = 16, dataOff = 0, dataLen = 0;
    while (off < d.length - 8) { String id = new String(d, off, 4); int sz = bb.getInt(off + 4);
      if (id.equals("fmt ")) { fmt = bb.getShort(off + 8); ch = bb.getShort(off + 10); bits = bb.getShort(off + 22); if (fmt == -2) fmt = bb.getShort(off + 32); }
      if (id.equals("data")) { dataOff = off + 8; dataLen = sz; break; } off += 8 + sz + (sz & 1); }
    int bps = bits / 8, n = dataLen / (bps * ch), s0 = (int) (a * 44100), s1 = Math.min(n, (int) (b * 44100));
    float[][] x = new float[2][s1 - s0];
    for (int i = s0; i < s1; i++) for (int c = 0; c < 2; c++) { int o = dataOff + (i * ch + Math.min(c, ch - 1)) * bps;
      x[c][i - s0] = bits == 32 ? bb.getFloat(o) : bb.getShort(o) / 32768f; }
    return x;
  }
  static void writeWav(String p, FloatBuffer[] st) throws Exception {
    int n = st[0].capacity(); ByteBuffer b = ByteBuffer.allocate(44 + n * 8).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes()).putInt(36 + n * 8).put("WAVE".getBytes()).put("fmt ".getBytes()).putInt(16).putShort((short) 3).putShort((short) 2)
     .putInt(44100).putInt(44100 * 8).putShort((short) 8).putShort((short) 32).put("data".getBytes()).putInt(n * 8);
    for (int i = 0; i < n; i++) { b.putFloat(st[0].get(i)); b.putFloat(st[1].get(i)); }
    Files.write(Paths.get(p), b.array());
  }
  public static void main(String[] a) throws Exception {
    String song = a[0], wav = a[1], outDir = a[4]; double s0 = Double.parseDouble(a[2]), s1 = Double.parseDouble(a[3]);
    if (a.length > 5) MitSeparator.megaOnOther = a[5].equals("other");
    OrtEnvironment env = OrtEnvironment.getEnvironment();
    OrtSession.SessionOptions o = new OrtSession.SessionOptions(); o.setIntraOpNumThreads(2); o.setCPUArenaAllocator(false); o.setMemoryPatternOptimization(false); o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
    String M = "/home/claude/mit/onnx/";
    int W = Integer.parseInt(System.getProperty("workers", "1")), TH = Integer.parseInt(System.getProperty("threads", "2"));
    String megaPath = System.getProperty("mega", M + "mega.onnx");
    Map<String, String> paths = new HashMap<>(); paths.put("scnet", M + "scnet.onnx"); paths.put("mega", megaPath); paths.put("asep", System.getProperty("asep", "/home/claude/bachatalab/models-mit/asep.onnx"));
    java.util.function.Function<String, float[]> rf = f -> { try { FloatBuffer fb = ByteBuffer.wrap(Files.readAllBytes(Paths.get(f))).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer(); float[] x = new float[fb.remaining()]; fb.get(x); return x; } catch (Exception e) { return null; } };
    MitSeparator.condGuira = rf.apply("/home/claude/bachatalab/models-mit/cond_guira.f32");
    if (!"0".equals(System.getProperty("bongo", "1"))) MitSeparator.condBongo = rf.apply("/home/claude/bachatalab/models-mit/cond_bongo.f32");
    int MW = Integer.parseInt(System.getProperty("megaWorkers", "" + W));
    MitSeparator.Models models = (name, max) -> { int nw = Math.min(max, name.equals("mega") ? MW : W); OrtSession[] ss = new OrtSession[nw];
      for (int w = 0; w < nw; w++) { OrtSession.SessionOptions so = new OrtSession.SessionOptions(); so.setIntraOpNumThreads(Math.max(1, TH / nw + (w < TH % nw ? 1 : 0)));
        so.setCPUArenaAllocator(false); so.setMemoryPatternOptimization(false); so.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        ss[w] = env.createSession(paths.get(name), so); }
      return ss; };
    Separator.javaThreads = TH;
    float[][] in = readWav(wav, s0, s1);
    Separator.tmpDir = new File("/tmp/septmp"); Separator.tmpDir.mkdirs();
    long t = System.currentTimeMillis(); Map<String, Long> st = new LinkedHashMap<>(); String[] last = {""}; long[] lt = {t};
    Map<String, FloatBuffer[]> r = new MitSeparator(env, models).separate(in, true, (s, i, n) -> {
      if (i % 3 == 0 || !s.equals(last[0])) { try { String l = new String(Files.readAllBytes(Paths.get("/proc/self/status"))); for (String x : l.split("\n")) if (x.startsWith("VmRSS")) System.out.println(s + " " + i + "/" + n + " " + x.trim() + " heap MB " + (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / 1048576); } catch (Exception e) {} }
      if (!s.equals(last[0])) { long now = System.currentTimeMillis(); if (!last[0].isEmpty()) st.put(last[0], now - lt[0]); last[0] = s; lt[0] = now; } }, () -> false);
    st.put(last[0], System.currentTimeMillis() - lt[0]);
    System.out.println(song + " java total secs " + (System.currentTimeMillis() - t) / 1000.0 + " stages(ms) " + st);
    new File(outDir).mkdirs();
    for (Map.Entry<String, FloatBuffer[]> e : r.entrySet()) writeWav(outDir + "/" + e.getKey() + ".wav", e.getValue());
  }
}
