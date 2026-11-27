# float16 weights for the LiteRT Demucs (the GPU computes in fp16 anyway). usage: python to_fp16.py src dst
import sys, warnings; warnings.filterwarnings('ignore')
from ai_edge_quantizer import quantizer, qtyping
q = quantizer.Quantizer(sys.argv[1])
q.update_quantization_recipe(
    regex='.*', operation_name='*', algorithm_key='float_casting',
    op_config=qtyping.OpQuantizationConfig(
        weight_tensor_config=qtyping.TensorQuantizationConfig(num_bits=16, dtype=qtyping.TensorDataType.FLOAT),
        compute_precision=qtyping.ComputePrecision.FLOAT, explicit_dequantize=True))
r = q.quantize(); r.export_model(sys.argv[2], overwrite=True); print('ok')
