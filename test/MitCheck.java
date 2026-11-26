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
    OrtSession sc = env.createSession(M + "scnet.onnx", o), mg = env.createSession(M + "mega.onnx", o), g = env.createSession("/home/claude/bachata/onnx/guira_h.onnx", o);
    float[][] in = readWav(wav, s0, s1);
    Separator.tmpDir = new File("/tmp/septmp"); Separator.tmpDir.mkdirs();
    long t = System.currentTimeMillis(); Map<String, Long> st = new LinkedHashMap<>(); String[] last = {""}; long[] lt = {t};
    Map<String, FloatBuffer[]> r = new MitSeparator(env, sc, mg, g).separate(in, true, (s, i, n) -> {
      if (!s.equals(last[0])) { long now = System.currentTimeMillis(); if (!last[0].isEmpty()) st.put(last[0], now - lt[0]); last[0] = s; lt[0] = now; } }, () -> false);
    st.put(last[0], System.currentTimeMillis() - lt[0]);
    System.out.println(song + " java total secs " + (System.currentTimeMillis() - t) / 1000.0 + " stages(ms) " + st);
    new File(outDir).mkdirs();
    for (Map.Entry<String, FloatBuffer[]> e : r.entrySet()) writeWav(outDir + "/" + e.getKey() + ".wav", e.getValue());
  }
}
