# Weight-only int8 for the LiteRT model (GPU test). usage: <litert venv>/python litert_quantize.py src.tflite dst.tflite
import sys, warnings; warnings.filterwarnings('ignore')
from ai_edge_quantizer import quantizer, recipe
q = quantizer.Quantizer(sys.argv[1]); q.load_quantization_recipe(recipe.weight_only_wi8_afp32())
r = q.quantize(); r.export_model(sys.argv[2]); print('ok')
