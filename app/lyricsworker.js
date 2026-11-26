// Lyrics models, run off the main thread: Whisper "base" transcribes the vocal stem,
// Opus-MT translates the lines. Library and models are downloaded the first time and cached.
// In the Android app Whisper, the library and its runtime ship inside the app (folder asr/): nothing to
// download. Elsewhere (a plain browser) they come from the CDN and Hugging Face the first time.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const LOCAL = new URL('asr/', self.location.href).href;
let T = null, asr = null, local = false;
const tr = {};

async function lib() {
  if (!T) {
    try { const r = await fetch(LOCAL + 'whisper-base/config.json'); local = r.ok && (await r.json()).model_type === 'whisper'; } catch (e) { local = false; }
    T = await import(local ? LOCAL + 'transformers.min.js' : LIB);
    if (local) T.env.backends.onnx.wasm.wasmPaths = LOCAL + 'ort/';
    T.env.allowLocalModels = false;
    try { T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1; } catch (e) {}
  }
  return T;
}

// Download progress summed over all the files of one model.
function progress(stage) {
  const files = {};
  return p => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = [p.loaded, p.total];
      let l = 0, t = 0; for (const k in files) { l += files[k][0]; t += files[k][1]; }
      postMessage({ type: 'progress', stage, loaded: l, total: t });
    }
  };
}

function useHub(remote) {
  T.env.remoteHost = remote ? 'https://huggingface.co/' : LOCAL;
  T.env.remotePathTemplate = remote ? '{model}/resolve/{revision}/' : '{model}/';
}

async function translator(key) {
  if (!tr[key]) {
    const t = await lib();
    useHub(true); t.env.useBrowserCache = true;
    tr[key] = t.pipeline('translation', 'Xenova/opus-mt-' + key, { dtype: 'q8', device: 'wasm', progress_callback: progress('tr') });
    tr[key].catch(() => { delete tr[key]; });
  }
  return tr[key];
}

// Opus-MT models that exist on Hugging Face (Xenova, with the quantized ONNX files), checked Nov 2026.
// Portuguese has no pair of its own: ROMANCE-en reads it, en-ROMANCE writes it when the line starts with >>pt<<.
const DIRECT = new Set(['es-en', 'es-it', 'es-fr', 'es-de', 'en-es', 'en-it', 'en-fr', 'en-de', 'it-es', 'it-en', 'it-fr',
  'fr-es', 'fr-en', 'fr-de', 'de-es', 'de-en', 'de-fr']);
// The models to chain for src -> tgt: the direct pair, otherwise through English.
function route(src, tgt) {
  if (DIRECT.has(src + '-' + tgt)) return [{ model: src + '-' + tgt }];
  const legs = [];
  if (src !== 'en') legs.push(src === 'pt' ? { model: 'ROMANCE-en' } : { model: src + '-en' });
  if (tgt !== 'en') legs.push(tgt === 'pt' ? { model: 'en-ROMANCE', prefix: '>>pt<< ' } : { model: 'en-' + tgt });
  for (const l of legs) if (!DIRECT.has(l.model) && !/ROMANCE/.test(l.model)) throw new Error('no model for ' + src + ' -> ' + tgt);
  return legs;
}

// The ROMANCE models repeat themselves ("Não. Não. Não…") when given several lines together: one line at a time.
async function translateAll(fn, lines, base, total, prefix, size = 6) {
  const out = [];
  for (let i = 0; i < lines.length; i += size) {
    const r = await fn(lines.slice(i, i + size).map(x => (prefix || '') + x));
    out.push(...r.map(x => x.translation_text));
    postMessage({ type: 'trstep', done: base + out.length, total });
  }
  return out;
}

// Whisper picks the language from the first token after <|startoftranscript|>: one decoder step
// on the 30 s with the most voice. Without this the library would assume English and translate.
const LANG_CODES = ['es', 'en', 'it', 'pt', 'fr', 'de'];
async function detectLang(t, audio) {
  const sec = 16000, n = Math.floor(audio.length / sec), e = new Float32Array(n);
  for (let k = 0; k < n; k++) { let s = 0; for (let i = k * sec; i < (k + 1) * sec; i++) s += audio[i] * audio[i]; e[k] = s; }
  let best = 0, bs = -1, run = 0; const w = Math.min(30, n);
  for (let k = 0; k < n; k++) { run += e[k]; if (k >= w) run -= e[k - w]; if (k >= w - 1 && run > bs) { bs = run; best = k - w + 1; } }
  const f = await asr.processor(audio.subarray(best * sec, (best + 30) * sec));
  const gc = asr.model.generation_config;
  const out = await asr.model({ input_features: f.input_features, decoder_input_ids: new t.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]) });
  const lg = out.logits.data; let code = 'es', top = -Infinity;
  for (const c of LANG_CODES) { const id = gc.lang_to_id['<|' + c + '|>']; if (id != null && lg[id] > top) { top = lg[id]; code = c; } }
  return code;
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'asr') {
      const t = await lib();
      // device 'wasm' on purpose: on phones with WebGPU the library would pick the GPU, where Whisper failed
      // the bundled model is served as if it were the hub: <app>/asr/whisper-base/<file>
      if (!asr) { useHub(!local); t.env.useBrowserCache = !local; asr = await t.pipeline('automatic-speech-recognition', local ? 'whisper-base' : 'Xenova/whisper-base', { dtype: 'q8', device: 'wasm', progress_callback: progress('asr') }); }
      postMessage({ type: 'stage', stage: 'run' });
      let lang = m.lang; try { lang = lang || await detectLang(t, m.audio); } catch (e) { lang = 'es'; }
      const out = await asr(m.audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', language: lang });
      postMessage({ type: 'asr', id: m.id, chunks: out.chunks || [], text: out.text || '', lang });
    } else if (m.type === 'tr') {
      // direct pair when it exists, otherwise through English (one leg after the other)
      const legs = route(m.src, m.tgt), n = m.lines.length; let res = m.lines;
      for (let k = 0; k < legs.length; k++) res = await translateAll(await translator(legs[k].model), res, k * n, legs.length * n, legs[k].prefix, /ROMANCE/.test(legs[k].model) ? 1 : 6);
      postMessage({ type: 'tr', id: m.id, out: res });
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, msg: String(e && e.message || e) });
  }
};
