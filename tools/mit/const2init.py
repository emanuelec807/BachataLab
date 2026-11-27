# Moves the 2-D Constant nodes (weights exported as constants) into initializers, so quantization sees them. usage: const2init.py src dst
import sys, onnx
m = onnx.load(sys.argv[1]); g = m.graph; keep = []; k = 0
for n in g.node:
    if n.op_type == 'Constant' and len(n.attribute) == 1 and n.attribute[0].name == 'value' and len(n.attribute[0].t.dims) >= 2:
        t = onnx.TensorProto(); t.CopyFrom(n.attribute[0].t); t.name = n.output[0]; g.initializer.append(t); k += 1
    else: keep.append(n)
del g.node[:]; g.node.extend(keep); onnx.save(m, sys.argv[2]); print('moved', k)
