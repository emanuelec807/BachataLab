import sys, collections
from ai_edge_litert.interpreter import Interpreter
it = Interpreter(model_path=sys.argv[1])
ops = it._get_ops_details()
td = {t['index']: t for t in it.get_tensor_details()}
cnt = collections.Counter(o['op_name'] for o in ops)
print(len(ops), 'ops'); print(dict(cnt))
big = collections.Counter()
for o in ops:
    for i in list(o['inputs']) + list(o['outputs']):
        if i >= 0 and len(td[i]['shape']) > 4: big[o['op_name']] += 1
print('ops touching >4D tensors:', dict(big))
mx = max(len(t['shape']) for t in td.values()); print('max rank', mx)
