# Dynamic int8 quantization of the MatMul/Gemm weights. usage: quantize.py src.onnx dst.onnx pc|pt  (pc = one scale per output channel, symmetric)
import sys
from onnxruntime.quantization import quantize_dynamic, QuantType
src, dst, pc = sys.argv[1], sys.argv[2], sys.argv[3] == 'pc'
quantize_dynamic(src, dst, weight_type=QuantType.QInt8, per_channel=pc, op_types_to_quantize=['MatMul', 'Gemm'], extra_options={'DefaultTensorType': 1})
print('ok', dst)
