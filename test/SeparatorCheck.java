import ai.onnxruntime.*;
import com.emanuelec807.bachatalab.Separator;
import java.nio.*; import java.nio.file.*; import java.util.*;
public class Check {
  static float[] rd(String p) throws Exception { byte[] b = Files.readAllBytes(Paths.get(p)); FloatBuffer f = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer(); float[] a = new float[f.remaining()]; f.get(a); return a; }
  public static void main(String[] a) throws Exception {
    OrtEnvironment env = OrtEnvironment.getEnvironment();
    OrtSession.SessionOptions o = new OrtSession.SessionOptions(); o.setIntraOpNumThreads(2); o.setCPUArenaAllocator(false); o.setMemoryPatternOptimization(false); o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
    OrtSession d = env.createSession(Files.readAllBytes(Paths.get("/home/claude/bachata/onnx/demucs6_h.onnx")), o);
    OrtSession g = env.createSession(Files.readAllBytes(Paths.get("/home/claude/bachata/onnx/guira_h.onnx")), o);
    float[] L = rd("/home/claude/jtest/ref/in_L.f32"), R = rd("/home/claude/jtest/ref/in_R.f32");
    long t = System.currentTimeMillis();
    Map<String, float[][]> r = new Separator(env, d, g).separate(L, R, true, (s, i, n) -> {}, () -> false);
    System.out.println("java secs " + (System.currentTimeMillis() - t) / 1000.0);
    for (String k : r.keySet()) { double e = 0, p = 0; for (int c = 0; c < 2; c++) { float[] ref = rd("/home/claude/jtest/ref/" + k + "_" + c + ".f32"), x = r.get(k)[c]; for (int i = 0; i < ref.length; i++) { double dd = ref[i] - x[i]; e += dd * dd; p += ref[i] * ref[i]; } }
      System.out.printf("%s snr %.1f dB%n", k, 10 * Math.log10(p / (e + 1e-20))); }
  }
}
