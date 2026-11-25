/* Separation worker: downloads the models once (cached by the browser), then runs Separator.separate.
   The host serves only text-like types, so each model is split into base64 text files. */
/* global ort, Separator */
importScripts('ort.wasm.min.js', 'separate.js');

const MODEL_VERSION = 'v1';
const part = (name, n) => Array.from({ length: n }, (_, i) => `models/${name}.${i}.b64.txt`);
const MODELS = {
  demucs: { parts: part('demucs6', 5), size: 59965838 },
  guira: { parts: part('guira', 5), size: 59835291 },
};
let sessions = null, cancelled = false;

const post = (m, t) => self.postMessage(m, t || []);

let noCache = false; // inside the Android app the model files are local: no second copy in the cache
async function openCache() {
  if (noCache) return null;
  try { return await caches.open('bachata-models-' + MODEL_VERSION); } catch (e) { return null; }
}

function b64ToBytes(s, out, off) {
  const bin = atob(s);
  for (let i = 0; i < bin.length; i++) out[off + i] = bin.charCodeAt(i);
  return bin.length;
}

async function fetchModel(name, onProgress) {
  const spec = MODELS[name], out = new Uint8Array(spec.size), cache = await openCache();
  let off = 0;
  for (let k = 0; k < spec.parts.length; k++) {
    const url = spec.parts[k];
    let res = null;
    if (cache) { try { res = await cache.match(url); } catch (e) { res = null; } }
    const fromCache = !!res;
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error('download ' + url + ' ' + res.status);
      if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* storage full or blocked: keep going */ } }
    }
    off += b64ToBytes((await res.text()).trim(), out, off);
    onProgress(k + 1, spec.parts.length, fromCache);
  }
  if (off !== spec.size) throw new Error('model ' + name + ' size ' + off);
  return out;
}

async function init(needGuira) {
  if (sessions && (!needGuira || sessions.guira)) return post({ type: 'ready', provider: 'wasm', threads: ort.env.wasm.numThreads });
  ort.env.wasm.wasmPaths = new URL('./', self.location.href).href;
  // Threads need SharedArrayBuffer (a cross-origin isolated page); otherwise one thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  const names = needGuira ? ['demucs', 'guira'] : ['demucs'];
  const totalMB = Math.round(names.reduce((a, n) => a + MODELS[n].size, 0) * 4 / 3 / 1e6);
  const totalParts = names.reduce((a, n) => a + MODELS[n].parts.length, 0);
  let done = 0, anyNetwork = false;
  const bytes = {};
  for (const name of names) {
    if (sessions && sessions[name]) { done += MODELS[name].parts.length; continue; }
    bytes[name] = await fetchModel(name, (k, n, fromCache) => {
      if (!fromCache) anyNetwork = true;
      done++;
      post({ type: 'download', loaded: Math.round(totalMB * done / totalParts), total: totalMB, frac: done / totalParts, network: anyNetwork });
    });
  }
  post({ type: 'loading' });
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'basic', enableCpuMemArena: false };
  sessions = sessions || {};
  for (const name of names) if (!sessions[name]) sessions[name] = await ort.InferenceSession.create(bytes[name], opts);
  post({ type: 'ready', provider: 'wasm', threads: ort.env.wasm.numThreads });
}

self.onmessage = async (ev) => {
  if (ev.data && ev.data.noCache) noCache = true;
  const m = ev.data;
  try {
    if (m.type === 'init') await init(m.guira !== false);
    if (m.type === 'cancel') cancelled = true;
    if (m.type === 'separate') {
      cancelled = false;
      await init(m.guira !== false);
      const stems = await Separator.separate(ort, sessions, m.left, m.right,
        p => post({ type: 'progress', ...p }), () => cancelled, { guira: m.guira !== false });
      const transfer = [];
      for (const v of Object.values(stems)) for (const ch of v) transfer.push(ch.buffer);
      post({ type: 'done', stems, provider: 'wasm' }, transfer);
    }
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e), cancelled: String(e && e.message) === 'cancelled' });
  }
};
