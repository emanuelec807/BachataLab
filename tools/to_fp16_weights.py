"""Store large float32 weights as float16 + a Cast node back to float32.
Halves the download; compute stays float32 (ORT folds the casts at load)."""
import sys
import numpy as np, onnx
from onnx import helper, numpy_helper, TensorProto

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
new_inits, new_nodes = [], []
for init in g.initializer:
    if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 1024:
        arr = numpy_helper.to_array(init).astype(np.float16)
        h = numpy_helper.from_array(arr, init.name + '__fp16')
        new_inits.append(h)
        new_nodes.append(helper.make_node('Cast', [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
    else:
        new_inits.append(init)
del g.initializer[:]
g.initializer.extend(new_inits)
nodes = list(g.node)
del g.node[:]
g.node.extend(new_nodes + nodes)
onnx.save(m, dst)
print('saved', dst)
