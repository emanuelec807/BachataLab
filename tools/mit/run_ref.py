"""Reference separations on PC (PyTorch, ZFTurbo's code) for the listening test and as ground truth for the ONNX exports.
usage: python3 run_ref.py scnet_large|scnet_small|mega song..."""
import sys, os, time, json
sys.path.insert(0, '/home/claude/zfturbo/music-source-separation-training')
os.chdir('/home/claude/zfturbo/music-source-separation-training')
import numpy as np, soundfile as sf, torch, yaml
from ml_collections import ConfigDict
torch.set_num_threads(2)
M = '/home/claude/mit'
SONGS = {'frio': ('/home/claude/bachata/in/frio_60s.wav', 0, 60), 'pdm': ('/tmp/pdm/full.wav', 20, 80)}
MEGA_ALL = ['accordion', 'acoustic-guitar', 'back-vocal', 'banjo', 'bass', 'bassoon', 'bells', 'bowed_strings', 'brass', 'cello', 'clarinet', 'congas',
            'digital-piano', 'dobro', 'double-bass', 'drums', 'electric-guitar', 'flute', 'french-horn', 'glockenspiel', 'guitar', 'harmonica', 'harp',
            'harpsichord', 'hh', 'keys', 'kick', 'lead-vocal', 'mandolin', 'marimba', 'oboe', 'organ', 'percussion', 'piano', 'saxophone', 'sitar', 'snare',
            'strings', 'synth', 'tambourine', 'timpani', 'toms', 'triangle', 'trombone', 'trumpet', 'tuba', 'ukulele', 'viola', 'violin', 'vocal', 'wind',
            'wind-chimes', 'woodwind']
assert len(MEGA_ALL) == 53 and MEGA_ALL[20] == 'guitar'
MEGA_SEL = os.environ.get('MEGA_SEL', 'guitar,piano,mandolin,acoustic-guitar,electric-guitar,bass,drums,vocal,congas,percussion,hh,tambourine').split(',')

def load_clip(name):
    p, a, b = SONGS[name]; x, sr = sf.read(p, dtype='float32', always_2d=True); assert sr == 44100
    return x[int(a * sr):int(b * sr)].T.copy()

def demix_generic(model, mix, chunk, overlap, n_out, normalize=False, step=None):
    """ZFTurbo's generic demix (fade window, reflect pad of the borders), batch 1, float32."""
    from utils.model_utils import _getWindowingArray
    if normalize:
        mono = mix.mean(0); mean, std = mono.mean(), mono.std(); mix = (mix - mean) / std
    mix = torch.tensor(mix)
    fade = chunk // 10; step = step or chunk // overlap; border = chunk - step; L0 = mix.shape[-1]
    win = _getWindowingArray(chunk, fade)
    if L0 > 2 * border and border > 0: mix = torch.nn.functional.pad(mix, (border, border), mode='reflect')
    res = torch.zeros((n_out,) + mix.shape); cnt = torch.zeros(mix.shape[-1]); i = 0
    with torch.no_grad():
        while i < mix.shape[1]:
            part = mix[:, i:i + chunk]; ln = part.shape[-1]
            part = torch.nn.functional.pad(part, (0, chunk - ln), mode='reflect' if ln > chunk // 2 else 'constant')
            x = model(part[None])[0]
            if x.ndim == 2: x = x[None]
            w = win.clone(); first = i == 0; last = i + step >= mix.shape[1]
            if first: w[:fade] = 1
            if last: w[-fade:] = 1
            res[..., i:i + ln] += x[..., :ln] * w[:ln]; cnt[i:i + ln] += w[:ln]; i += step
    out = (res / cnt).numpy()
    if L0 > 2 * border and border > 0: out = out[..., border:-border]
    if normalize: out = out * std + mean
    return out

def get(kind):
    if kind.startswith('scnet'):
        from models.scnet.scnet import SCNet
        cfgp = f'{M}/config_musdb18_scnet_large_starrytong.yaml' if kind == 'scnet_large' else f'{M}/config_musdb18_scnet.yaml'
        cfg = ConfigDict(yaml.load(open(cfgp), Loader=yaml.FullLoader))
        m = SCNet(**cfg.model); ck = f'{M}/SCNet-large_starrytong_fixed.ckpt' if kind == 'scnet_large' else f'{M}/scnet_checkpoint_musdb18.ckpt'
        sd = torch.load(ck, map_location='cpu', weights_only=False); sd = sd.get('state_dict', sd) if isinstance(sd, dict) else sd
        print(m.load_state_dict(sd, strict=True)); m.eval()
        return m, list(cfg.model.sources), cfg.audio.chunk_size, cfg.inference.num_overlap, bool(cfg.inference.get('normalize', False))
    from models.bs_roformer.bs_roformer import BSRoformer
    c = json.load(open(f'{M}/luma_config.json'))
    keep = [k for k in ('dim', 'depth', 'dim_head', 'heads', 'freqs_per_bands', 'time_transformer_depth', 'freq_transformer_depth', 'linear_transformer_depth',
                        'mask_estimator_depth', 'mlp_expansion_factor', 'stereo', 'stft_n_fft', 'stft_hop_length', 'stft_win_length', 'stft_normalized', 'zero_dc')]
    m = BSRoformer(**{k: (tuple(c[k]) if isinstance(c[k], list) else c[k]) for k in keep}, num_stems=len(MEGA_SEL), flash_attn=True)
    sd = torch.load(f'{M}/mega53.ckpt', map_location='cpu', weights_only=True, mmap=True)
    new = {}
    for k, v in sd.items():
        if k.startswith('mask_estimators.'):
            h = int(k.split('.')[1]); name = MEGA_ALL[h]
            if name in MEGA_SEL: new['mask_estimators.%d.%s' % (MEGA_SEL.index(name), k.split('.', 2)[2])] = v.float()
        else: new[k] = v.float()
    print(m.load_state_dict(new, strict=False)); m.eval()
    return m, MEGA_SEL, c['chunk_size'], c['num_overlap'], False

if __name__ == '__main__':
    kind = sys.argv[1]; model, names, chunk, ov, norm = get(kind)
    chunk = int(os.environ.get('CHUNK', chunk)); ov = int(os.environ.get('OV', ov))
    for song in sys.argv[2:]:
        mix = load_clip(song); t = time.time()
        out = demix_generic(model, mix, chunk, ov, len(names), norm)
        dt = time.time() - t; od = f'{M}/out/{song}'; os.makedirs(od, exist_ok=True)
        tag = os.environ.get('TAG', kind)
        for n, y in zip(names, out): sf.write(f'{od}/{tag}_{n}.wav', y.T, 44100, subtype='FLOAT')
        print(kind, song, f'{dt:.1f}s for {mix.shape[1]/44100:.0f}s audio  chunk={chunk} overlap={ov}', flush=True)
