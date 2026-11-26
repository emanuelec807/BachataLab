/* Bachata Lab: UI logic. Uses StemPlayer (player.js), BeatTracker (beats.js) and worker.js. */
/* global StemPlayer, BeatTracker, Separator */
{
const $ = id => document.getElementById(id);
// Piano is a track only in the projects where it really plays; otherwise it stays inside "Altro".
const ALL_STEMS = [
  { id: 'vocals', n: 'Voce', d: '' },
  { id: 'guitar', n: 'Chitarra', d: 'requinto + ritmica' },
  { id: 'bass', n: 'Basso', d: '' },
  { id: 'bongo', n: 'Bongo', d: '+ cencerro, altre perc.' },
  { id: 'guira', n: 'Güira', d: '' },
  { id: 'piano', n: 'Piano', d: '' },
  { id: 'altro', n: 'Altro', d: 'synth, archi, fiati' },
];
const STEMS = [];
// "Requinto + altro" (as YAMNet named it, stored in Italian) -> the name in the app language
const altroLabel = nm => { const m = String(nm || ''), mixed = / \+ altro$/.test(m); return T(m.replace(/ \+ altro$/, '')) + (mixed ? ' ' + T('+ altro') : ''); };
// decimal numbers: comma in Italian and Spanish, point in English
const dec = v => I18N.lang === 'en' ? String(v) : String(v).replace('.', ',');
// "l'1", "il 2" in Italian; "the 1" / "el 1" in the other languages
const countName = c => I18N.lang === 'it' ? (c === 1 || c === 8 ? "l'" : 'il ') + c : T('il {n}', { n: c });
// card line for instruments turned off (Italian agrees the adjective with each name)
function offText(names) {
  if (I18N.lang !== 'it') return T(names.length === 1 ? '{x} spento' : '{x} spenti', { x: I18N.lang === 'es' ? names.join(', ').toLowerCase() : names.join(', ') });
  return (names.length === 1 ? names[0] + ' spenta' : names.join(', ') + ' spenti').replace('Basso spenta', 'Basso spento').replace('Bongo spenta', 'Bongo spento');
}
// altroName: the instrument family recognised in Altro (e.g. "Requinto"), shown as the track's name
function useStems(piano, altroName) {
  STEMS.length = 0;
  for (const s of ALL_STEMS) { if (s.id === 'piano' && !piano) continue;
    // "Requinto + altro": the name is the main instrument, "+ altro" says other things play there too
    const mixed = altroName && / \+ altro$/.test(altroName), main = altroName && altroName.replace(/ \+ altro$/, '');
    STEMS.push(s.id === 'altro' && altroName ? Object.assign({}, s, { n: T(main), extra: mixed ? T('+ altro') : '', d: 'riconosciuto in Altro' }) : Object.assign({}, s, { n: T(s.n) })); }
}
useStems(false);
const PRESETS = [
  { n: 'Completo', g: [100, 100, 100, 100, 100, 100] },
  { n: "Trova l'1", g: [0, 0, 100, 0, 150, 0] },
  { n: 'Solo ritmo', g: [0, 0, 100, 100, 100, 0] },
  { n: 'Senza voce', g: [0, 100, 100, 100, 100, 100] },
  { n: 'Solo voce', g: [100, 0, 0, 0, 0, 0] },
  { n: 'Chitarra', g: [0, 150, 60, 40, 60, 0] },
  { n: 'Bongo', g: [0, 0, 50, 160, 80, 0] },
];
// Seconds of work per second of audio, measured in desktop Chromium (WebAssembly, 1 thread).
// Before the first run on this phone the estimate assumes a phone is about twice as slow.
const COST = { demucs: 2.4, guira: 2.4 };
const MARK_NAMES = ['Intro', 'Derecho', 'Majao', 'Mambo', 'Break', T('Finale')];
const PIANO_MIX = 0.03, PIANO_ALTRO = 0.35; // piano share of the whole song and of Altro to show it as a track
const SR = 44100, MAX_FILE = 350e6, TAP_LAG = 0.15;
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const probe = document.createElement('i'); probe.style.display = 'none'; document.body.append(probe);
const colorCache = {};
const cssColor = v => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
const cc = v => colorCache[v] || (colorCache[v] = cssColor(v));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const ico = (id, cls) => `<svg class="i${cls ? ' ' + cls : ''}"><use href="#i-${id}"/></svg>`;
// range inputs paint their filled part through --p
function fillRange(el) { const min = +el.min || 0, max = +el.max || 100; el.style.setProperty('--p', ((el.value - min) / (max - min) * 100) + '%'); }
document.addEventListener('input', e => { if (e.target.type === 'range') fillRange(e.target); });
// ---------- theme and accent colour (Settings) ----------
const ACCENTS = [['Corallo', '#FF6A4D', '#E5482A'], ['Azzurro', '#4DA3FF', '#1F7AE0'], ['Viola', '#A78BFA', '#7C5CE6'], ['Rosa', '#FF5C9A', '#E0336F'], ['Menta', '#3DDCB0', '#119E7A'], ['Lime', '#B8F24A', '#6E9F12']];
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isLight = () => { const t = ls.get('theme', 'dark'); return t === 'light' || (t === 'auto' && !darkMQ.matches); };
function applyTheme() {
  const light = isLight(), a = ACCENTS[ls.get('accent', 0)] || ACCENTS[0], root = document.documentElement;
  root.classList.toggle('light', light);
  root.style.setProperty('--acc', light ? a[2] : a[1]); // the light theme takes a darker shade of the same colour
  document.querySelector('meta[name=theme-color]').content = light ? '#F6F6F3' : '#0B0C10';
  for (const k in colorCache) delete colorCache[k];
  $('themeBtn').innerHTML = ico(light ? 'moon' : 'sun'); $('themeBtn').setAttribute('aria-label', light ? T('Tema scuro') : T('Tema chiaro'));
  if (window.__themeHook) window.__themeHook();
}
darkMQ.addEventListener('change', applyTheme);
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

// ---------- toast, busy overlay, dialog ----------
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
function busy(msg) { $('busyT').textContent = msg || ''; $('busy').classList.toggle('on', !!msg); }
let dlgResolve = null;
function closeDialog(val) { if (!dlgResolve) return; const r = dlgResolve; dlgResolve = null; $('dlg').classList.remove('on'); r(val); }
function dialog(title, bodyNode, actions) {
  closeDialog(undefined);
  return new Promise(res => {
    dlgResolve = res;
    $('dlgT').textContent = title; const b = $('dlgB'); b.innerHTML = ''; if (bodyNode) b.append(bodyNode);
    const a = $('dlgA'); a.innerHTML = '';
    actions.forEach(([label, val, primary]) => {
      const btn = document.createElement('button'); btn.textContent = label; if (primary) btn.className = 'primary';
      btn.onclick = () => closeDialog(val); a.append(btn);
    });
    $('dlg').classList.add('on');
    const inp = b.querySelector('input');
    if (inp) { setTimeout(() => inp.focus(), 50); const prim = actions.find(x => x[2]); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && prim) closeDialog(prim[1]); }); }
  });
}
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) closeDialog(false); });
const textEl = s => { const p = document.createElement('p'); p.textContent = s; return p; };

// ---------- storage (IndexedDB in this browser on this phone) ----------
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bachata-lab', 2);
    r.onupgradeneeded = () => { const d = r.result;
      for (const n of ['projects', 'stems', 'media']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort'));
  });
}
const listProjects = () => tx('projects', 'readonly', s => s.getAll());
const getProject = id => tx('projects', 'readonly', s => s.get(id));
const putProject = p => tx('projects', 'readwrite', s => s.put(p));
const getStems = id => tx('stems', 'readonly', s => s.get(id));
const getMedia = id => tx('media', 'readonly', s => s.get(id));
async function deleteProject(id) { for (const st of ['projects', 'stems', 'media']) { try { await tx(st, 'readwrite', s => s.delete(id)); } catch (e) {} } }
function toInt16(f) { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i]; o[i] = v >= 1 ? 32767 : v <= -1 ? -32767 : v * 32767; } return o; }
// ---------- stem compression: Opus (the phone's own encoder, WebCodecs) in an Ogg file ----------
// A 3-minute project took about 250 MB as 16-bit PCM (7 stereo tracks); as Opus at 128 kb/s per
// track it takes about 22 MB. The player gets the same float tracks back after decoding.
const OPUS_BR = 128000;
let opusState = null; // null = not tested yet; true/false after a round-trip self-test
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
function oggPage(body, granule, seq, flags) {
  const segs = []; let left = body.length; while (left >= 255) { segs.push(255); left -= 255; } segs.push(left);
  const h = new Uint8Array(27 + segs.length), v = new DataView(h.buffer);
  h.set([79, 103, 103, 83]); h[5] = flags; v.setUint32(6, granule % 4294967296, true); v.setUint32(10, Math.floor(granule / 4294967296), true);
  v.setUint32(14, 0x42414348, true); v.setUint32(18, seq, true); h[26] = segs.length; h.set(segs, 27);
  const page = new Uint8Array(h.length + body.length); page.set(h); page.set(body, h.length);
  let c = 0; for (let i = 0; i < page.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ page[i]) & 255]) >>> 0;
  new DataView(page.buffer).setUint32(22, c, true); return page;
}
async function encodeStem(ch, n) {
  const packets = []; let head = null, err = null;
  const enc = new AudioEncoder({ output: (c, meta) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push({ d, dur: c.duration });
      if (!head && meta && meta.decoderConfig && meta.decoderConfig.description) head = new Uint8Array(meta.decoderConfig.description); },
    error: e => { err = e; } });
  enc.configure({ codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: OPUS_BR });
  const B = SR; // one second at a time
  for (let i = 0; i < n; i += B) {
    const m = Math.min(B, n - i), buf = new Float32Array(2 * m); buf.set(ch[0].subarray(i, i + m)); buf.set(ch[1].subarray(i, i + m), m);
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(i / SR * 1e6), data: buf }));
    if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
  }
  await enc.flush(); enc.close(); if (err) throw err;
  if (!head || head.length < 19) { head = new Uint8Array(19); head.set([79, 112, 117, 115, 72, 101, 97, 100, 1, 2]); const v = new DataView(head.buffer); v.setUint16(10, 312, true); v.setUint32(12, SR, true); }
  const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
  const tags = new Uint8Array([79, 112, 117, 115, 84, 97, 103, 115, 11, 0, 0, 0, 66, 97, 99, 104, 97, 116, 97, 76, 97, 98, 0, 0, 0, 0]);
  const pages = [oggPage(head, 0, 0, 2), oggPage(tags, 0, 1, 0)], end = preSkip + Math.round(n * 48000 / SR);
  let gp = 0;
  packets.forEach((p, k) => { gp += Math.round(p.dur * 48 / 1000); const last = k === packets.length - 1; pages.push(oggPage(p.d, last ? end : Math.min(gp, end), k + 2, last ? 4 : 0)); });
  const out = new Uint8Array(pages.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of pages) { out.set(p, o); o += p.length; }
  return out.buffer;
}
// Some decoders (Chrome's decodeAudioData) ignore the Opus pre-skip and return the audio a few ms late:
// the self-test measures that delay once and every decode removes it, so all tracks stay sample-aligned.
let opusLag = 0;
async function decodeStem(buf, n, lag = opusLag) {
  const ac = new OfflineAudioContext(2, Math.max(1, n + Math.max(0, lag)), SR), b = await ac.decodeAudioData(buf.slice(0));
  const L = new Float32Array(n), R = new Float32Array(n), a = Math.max(0, lag), c0 = b.getChannelData(0), c1 = b.getChannelData(b.numberOfChannels > 1 ? 1 : 0);
  L.set(c0.subarray(a, a + n)); R.set(c1.subarray(a, a + n));
  return [L, R];
}
// Encode and decode one second of noise once: compression is used only if the round trip works here.
async function opusOK() {
  if (opusState != null) return opusState;
  try {
    if (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: OPUS_BR })).supported) return opusState = false;
    // a sweep with soft noise: one clear alignment, like music
    const n = SR, a = [new Float32Array(n), new Float32Array(n)]; let z = 1;
    for (let i = 0; i < n; i++) { z = (z * 16807) % 2147483647; const ph = 2 * Math.PI * (100 * i / SR + 1500 * (i / SR) ** 2); a[0][i] = 0.3 * Math.sin(ph) + 0.05 * (z / 2147483647 - 0.5); a[1][i] = a[0][i] * 0.8; }
    const enc = await encodeStem(a, n), raw = await decodeStem(enc, n + 2000, 0);
    let best = 0, be = Infinity;
    for (let lag = 0; lag <= 1500; lag++) { let e = 0; for (let i = 4000; i < n - 4000; i += 5) { const v = raw[0][i + lag] - a[0][i]; e += v * v; } if (e < be) { be = e; best = lag; } }
    opusLag = best;
    const d = await decodeStem(enc, n); let e = 0, s = 0; for (let i = 4000; i < n - 4000; i++) { e += (d[0][i] - a[0][i]) ** 2; s += a[0][i] ** 2; }
    opusState = e / s < 0.01; // > 20 dB once aligned: the round trip works here
  } catch (e) { opusState = false; }
  return opusState;
}
// Stored tracks -> float tracks, whatever the format (old projects: 16-bit PCM)
async function stemsF32(st, ids) {
  // all tracks decoded at the same time: the browser decodes in parallel, opening is several times faster
  const out = {}, list = (ids || Object.keys(st.data)).filter(id => st.data[id]);
  const res = await Promise.all(list.map(id => st.codec === 'opus' ? decodeStem(st.data[id], st.n) : [toF32(st.data[id][0]), toF32(st.data[id][1])]));
  list.forEach((id, k) => { out[id] = res[k]; });
  return out;
}
async function packAllProjects() {
  if (!(await opusOK())) return toast(T('Questo telefono non sa comprimere le tracce'));
  const list = await listProjects(); let done = 0, saved = 0;
  for (const p of list) {
    if (cur && cur.id === p.id) continue;
    busy(T('Comprimo i progetti: {a} di {b}…', { a: ++done, b: list.length }));
    try { const st = await getStems(p.id); if (!st || st.codec === 'opus') continue;
      const r = await compressOld(p.id, await stemsF32(st), st.n); if (r) saved += r.before - r.after; } catch (e) {}
  }
  busy(); toast(saved ? T('Fatto: liberati {n} MB', { n: Math.round(saved / 1e6) }) : T('Tutti i progetti erano già compressi')); renderSettings(); renderHome();
}
async function packStems(stems, ids, n, onStep) {
  const data = {}, opus = await opusOK(); let k = 0;
  for (const id of ids) { data[id] = opus ? await encodeStem(stems[id], n) : [toInt16(stems[id][0]), toInt16(stems[id][1])]; if (onStep) onStep(++k, ids.length); }
  return { data, codec: opus ? 'opus' : undefined };
}
const stemsBytes = st => Object.values(st.data).reduce((a, d) => a + (d.byteLength != null ? d.byteLength : d[0].byteLength + d[1].byteLength), 0);
// Old projects (PCM) are compressed the first time they are opened, after checking the decoded copy.
async function compressOld(id, stems, n) {
  if (!(await opusOK())) return null;
  const ids = Object.keys(stems), old = await getStems(id); if (!old || old.codec === 'opus') return null;
  const before = stemsBytes(old), { data } = await packStems(stems, ids, n);
  const check = await decodeStem(data[ids[0]], n); let e = 0, s = 0; for (let i = 0; i < n; i += 7) { e += (check[0][i] - stems[ids[0]][0][i]) ** 2; s += stems[ids[0]][0][i] ** 2; }
  if (s > 0 && e / s > 0.05) return null; // something is off: keep the original
  await tx('stems', 'readwrite', st => st.put({ id, n, sr: SR, codec: 'opus', data }));
  return { before, after: stemsBytes({ data }) };
}

function toF32(a) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] / 32767; return o; }

// ---------- navigation ----------
// History stays short: home ('') -> one screen (#nuovo, #elabora, #player, #impostazioni) -> overlays (#mappa, #pop, #schermo, #allenamento).
function show(name) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + name)); window.scrollTo(0, 0); }
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { if (location.hash) history.back(); else go('home'); }));
async function go(name) {
  if (name !== 'home') return;
  closeDialog(undefined); stopPreview(); closePlayer(); releaseSource();
  if (location.hash) history.replaceState(null, '', location.pathname);
  await renderHome(); show('home');
}
window.addEventListener('hashchange', async () => {
  const h = location.hash.slice(1);
  if (h !== 'pop' && openPopEl) { closePop(true); return; }
  if (h !== 'schermo' && $('stage').classList.contains('fs')) { exitFs(true); return; }
  if (h !== 'allenamento' && $('train').classList.contains('on')) { closeTraining(true); return; }
  if (h !== 'mappa' && $('map').classList.contains('on')) { closeMap(true); return; }
  if (procRunning && h !== 'elabora') {
    history.pushState(null, '', '#elabora');
    if (await dialog(T('Annullare la separazione?'), textEl(T('Se esci adesso perdi il lavoro fatto finora.')), [[T('Continua'), false, true], [T('Esci'), true]])) cancelProcessing();
    return;
  }
  if (!h && !$('s-home').classList.contains('on')) go('home');
});
window.addEventListener('beforeunload', e => { if (procRunning) { e.preventDefault(); e.returnValue = ''; } });
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
  const n = b.dataset.nav;
  if (n === 'home') { if (location.hash) history.back(); else go('home'); }
  if (n === 'set') openSettings();
  if (n === 'train') trainFromHome();
}));

// ---------- audio context ----------
let actx = null;
function audioCtx() {
  if (!actx) {
    try { actx = new AudioContext({ sampleRate: SR }); } catch (e) { actx = new AudioContext(); }
    actx.onstatechange = () => { if (actx.state !== 'running' && player && player.isPlaying) { pausePlayer(); } };
  }
  return actx;
}

// ---------- HOME ----------
let homeFilter = 'all', homeSort = ls.get('homeSort', 'recent'), homeList = [];
const SICON = { vocals: 'vocals', guitar: 'guitar', bass: 'bass', bongo: 'bongo', guira: 'guira', altro: 'altro', piano: 'altro' };
const sico = (id, cls) => `<svg class="i${cls ? ' ' + cls : ''}"><use href="#s-${SICON[id]}"/></svg>`;
function whenTxt(ts) {
  const d = new Date(ts), now = new Date(), day = 864e5, hm = d.toLocaleTimeString(I18N.locale, { hour: 'numeric', minute: '2-digit' });
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= d0) return T('Oggi, {t}', { t: hm }); if (ts >= d0 - day) return T('Ieri, {t}', { t: hm });
  return d.toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short' });
}
// One line on the card that says how the project was left: who is solo, who is off, which preset.
function mixStatus(p) {
  const name = id => (STEMS.find(s => s.id === id) || {}).n;
  const solo = STEMS.filter(s => p.solo && p.solo[s.id]).map(s => s.n);
  if (solo.length) return [T('Solo {x}', { x: solo.join(' + ') }), 'var(--tap)'];
  const off = STEMS.filter(s => (p.mute && p.mute[s.id]) || (p.gains && p.gains[s.id] === 0)).map(s => s.id);
  if (off.length) return [offText(off.map(name)), 'var(--tap)'];
  return [T('Mix completo'), 'var(--mute)'];
}
async function renderHome() {
  let list = [];
  try { list = await listProjects(); } catch (e) { $('projects').innerHTML = '<p class="warn" style="padding:0 8px">' + T('Questo browser non permette di salvare i progetti (forse è in modalità privata).') + '</p>'; return; }
  homeList = list.slice().sort((a, b) => b.updated - a.updated);
  if (homeSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, I18N.lang)); else list.sort((a, b) => b.updated - a.updated);
  $('sortBtn').textContent = homeSort === 'name' ? 'A–Z' : T('Recenti'); $('sortBtn').hidden = list.length < 2;
  $('searchBox').hidden = list.length < 3;
  const q = ($('q').value || '').trim().toLowerCase();
  const nA = list.filter(p => p.kind !== 'video').length, nV = list.length - nA;
  $('filters').innerHTML = nA && nV ? [['all', T('Tutti')], ['audio', T('Audio')], ['video', T('Video')]]
    .map(([k, l]) => `<button data-f="${k}" class="${homeFilter === k ? 'on' : ''}">${l}</button>`).join('') : '';
  $('guide').hidden = list.length > 2;
  $('projHead').hidden = !list.length;
  // playlists: a song sits in at most one; the chips filter the list
  const pls = getPlaylists(); if (homePl && homePl !== 'none' && !pls.some(x => x.id === homePl)) homePl = '';
  const inPl = p => !homePl || (homePl === 'none' ? !p.playlist || !pls.some(x => x.id === p.playlist) : p.playlist === homePl);
  $('plChips').innerHTML = !list.length ? '' : [`<button data-pl="" class="${!homePl ? 'on' : ''}">${T('Tutti')} <span>${list.length}</span></button>`]
    .concat(pls.map(x => `<button data-pl="${esc(x.id)}" class="${homePl === x.id ? 'on' : ''}">${esc(x.name)} <span>${list.filter(p => p.playlist === x.id).length}</span></button>`))
    .concat([`<button data-pl="+" class="add">${ico('plus')} ${T('Playlist')}</button>`]).join('');
  const plName = homePl && homePl !== 'none' ? (pls.find(x => x.id === homePl) || {}).name : null;
  $('projTitle').textContent = plName || (homePl === 'none' ? T('Senza playlist') : T('Progetti')); $('plMenu').hidden = !plName;
  const shown = list.filter(p => inPl(p) && (homeFilter === 'all' || (homeFilter === 'video') === (p.kind === 'video')) && (!q || p.name.toLowerCase().includes(q)));
  const bars = [12, 24, 16, 28, 10];
  $('projects').innerHTML = !list.length ? '' : shown.map(p => {
    const [st, sc] = mixStatus(p), mk = p.marks && p.marks.length ? ' · ' + esc(p.marks[0].name) : '';
    const th = p.kind === 'video' ? `${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ''}<span class="vt">VIDEO</span>` : bars.map(h => `<i style="height:${h}px"></i>`).join('');
    return `<div class="proj" data-id="${esc(p.id)}" role="button" tabindex="0">
      <div class="th">${th}</div>
      <div class="tx"><b>${esc(p.name)}</b><div class="m1">${fmt(p.dur)} · ${p.bpm ? Math.round(p.bpm) + ' BPM' : T('ritmo ?')} · ${T('{n} tracce', { n: p.withGuira === false ? 5 : p.piano ? 7 : 6 })}</div>
        <div class="m2" style="--sc:${sc}"><i></i>${esc(st)}${mk}</div></div>
      <span class="when">${whenTxt(p.updated)}</span><button class="icon" data-menu="${esc(p.id)}" aria-label="${T('Opzioni')}">${ico('more')}</button></div>`; }).join('');
  if (list.length && !shown.length) $('projects').innerHTML = plName && !q ? '<p class="mute" style="padding:14px 8px">' + T('Playlist vuota: usa ⋯ → «Aggiungi brani», oppure ⋯ su un brano → «Sposta in playlist».') + '</p>' : '<p class="mute" style="padding:14px 8px">' + T('Nessun progetto trovato.') + '</p>';
  try { const e = await navigator.storage.estimate(); $('homeMeta').textContent = T(list.length === 1 ? '{n} progetto' : '{n} progetti', { n: list.length }) + ' · ' + Math.round((e.usage || 0) / 1e6) + ' MB'; }
  catch (e) { $('homeMeta').textContent = T(list.length === 1 ? '{n} progetto' : '{n} progetti', { n: list.length }); }
}
// ---------- playlists (stored on this phone, like the projects) ----------
let homePl = ls.get('homePl', ''); if (homePl === 'none') homePl = '';
const getPlaylists = () => ls.get('playlists', []);
const setPlaylists = v => ls.set('playlists', v);
async function newPlaylist() {
  const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 40; inp.placeholder = T('Es. Sensual, Da studiare, Corso giovedì');
  if (!(await dialog(T('Nuova playlist'), inp, [[T('Annulla'), false], [T('Crea'), true, true]])) || !inp.value.trim()) return null;
  const pl = { id: 'pl' + Date.now().toString(36), name: inp.value.trim() }; setPlaylists(getPlaylists().concat([pl])); return pl.id;
}
// a list of choices inside the dialog (one button per playlist)
function pickList(title, items, extra) {
  const wrap = document.createElement('div'); wrap.className = 'plist';
  for (const [label, val, on] of items) { const b = document.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = () => closeDialog(val); wrap.append(b); }
  return dialog(title, wrap, extra || [[T('Annulla'), null, true]]);
}
async function moveToPlaylist(ids) {
  ids = [].concat(ids); const pls = getPlaylists(), one = ids.length === 1 ? await getProject(ids[0]) : null;
  let v = await pickList(ids.length === 1 ? T('Sposta in playlist') : T('Sposta {n} brani', { n: ids.length }), pls.map(x => [x.name, x.id, one && one.playlist === x.id])
    .concat([[T('Nessuna playlist'), '', one && !one.playlist], ['＋ ' + T('Nuova playlist…'), '+']]));
  if (v == null) return;
  if (v === '+') { v = await newPlaylist(); if (!v) return; }
  for (const id of ids) {
    if (cur && cur.id === id) { cur.playlist = v || null; await putProject(cur); continue; }
    const p = await getProject(id); if (p) { p.playlist = v || null; await putProject(p); }
  }
  const name = (getPlaylists().find(x => x.id === v) || {}).name; toast(v ? T('Spostato in «{x}»', { x: name }) : T('Tolto dalla playlist')); renderHome();
}
async function playlistMenu() {
  const pls = getPlaylists(), pl = pls.find(x => x.id === homePl); if (!pl) return;
  const v = await dialog(pl.name, null, [[T('Aggiungi brani'), 'add'], [T('Rinomina'), 'ren'], [T('Elimina playlist'), 'del'], [T('Chiudi'), null, true]]);
  if (v === 'ren') { const inp = document.createElement('input'); inp.type = 'text'; inp.value = pl.name; inp.maxLength = 40;
    if (await dialog(T('Rinomina playlist'), inp, [[T('Annulla'), false], [T('Salva'), true, true]]) && inp.value.trim()) { pl.name = inp.value.trim(); setPlaylists(pls); renderHome(); } }
  if (v === 'del') { if (await dialog(T('Eliminare «{x}»?', { x: pl.name }), textEl(T('I brani restano: tornano senza playlist.')), [[T('Annulla'), false], [T('Elimina'), true, true]])) {
      setPlaylists(pls.filter(x => x !== pl)); for (const p of await listProjects()) if (p.playlist === pl.id) { p.playlist = null; await putProject(p); } homePl = ''; ls.set('homePl', ''); renderHome(); } }
  if (v === 'add') {
    const all = (await listProjects()).sort((a, b) => a.name.localeCompare(b.name, I18N.lang)), wrap = document.createElement('div'); wrap.className = 'plist checks';
    for (const p of all) { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.value = p.id; c.checked = p.playlist === pl.id;
      const t = document.createElement('span'); t.textContent = p.name; const o = document.createElement('small'); const opl = pls.find(x => x.id === p.playlist);
      o.textContent = opl && opl !== pl ? T('in «{x}»', { x: opl.name }) : ''; l.append(c, t, o); wrap.append(l); }
    if (!all.length) wrap.append(textEl(T('Ancora nessun progetto.')));
    if (!(await dialog(T('Brani in «{x}»', { x: pl.name }), wrap, [[T('Annulla'), false], [T('Salva'), true, true]]))) return;
    for (const c of wrap.querySelectorAll('input')) { const p = all.find(x => x.id === c.value); const want = c.checked ? pl.id : (p.playlist === pl.id ? null : p.playlist);
      if ((p.playlist || null) !== (want || null)) { if (cur && cur.id === p.id) { cur.playlist = want; await putProject(cur); } else { p.playlist = want; await putProject(p); } } }
    renderHome();
  }
}
$('plChips').addEventListener('click', async e => { const b = e.target.closest('[data-pl]'); if (!b) return;
  let v = b.dataset.pl; if (v === '+') { v = await newPlaylist(); if (!v) return; }
  homePl = v; ls.set('homePl', v); renderHome(); });
$('plMenu').addEventListener('click', playlistMenu);
$('sortBtn').addEventListener('click', () => { homeSort = homeSort === 'name' ? 'recent' : 'name'; ls.set('homeSort', homeSort); renderHome(); });
$('q').addEventListener('input', () => renderHome());
$('filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { homeFilter = b.dataset.f; renderHome(); } });
$('projects').addEventListener('click', e => {
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); return projectMenu(m.dataset.menu); }
  const c = e.target.closest('.proj'); if (c) openPlayer(c.dataset.id);
});
$('projects').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('proj')) openPlayer(e.target.dataset.id); });
async function renameProject(id) {
  const p = await getProject(id); if (!p) return;
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = p.name; inp.maxLength = 60;
  if (await dialog(T('Rinomina'), inp, [[T('Annulla'), false], [T('Salva'), true, true]]) && inp.value.trim()) {
    if (cur && cur.id === id) { cur.name = inp.value.trim(); $('pTitle').textContent = cur.name; await putProject(cur); }
    else { p.name = inp.value.trim(); await putProject(p); }
  }
  if ($('s-home').classList.contains('on')) renderHome();
}
async function removeProject(id) {
  const p = await getProject(id); if (!p) return;
  if (!await dialog(T('Eliminare «{x}»?', { x: p.name }), textEl(p.kind === 'video' ? T('Le tracce separate e il video salvato verranno cancellate da questo telefono.') : T('Le tracce separate verranno cancellate da questo telefono.')), [[T('Annulla'), false], [T('Elimina'), true, true]])) return;
  const open = cur && cur.id === id; if (open) closePlayer(true);
  await deleteProject(id); toast(T('Progetto eliminato'));
  if (open) { if (location.hash) history.back(); else go('home'); return; }
  if ($('s-home').classList.contains('on')) renderHome();
}
async function projectMenu(id) {
  const p = await getProject(id); if (!p) return;
  const v = await dialog(p.name, null, [[T('Sposta in playlist'), 'pl'], [T('Rinomina'), 'ren'], [T('Elimina'), 'del'], [T('Chiudi'), null, true]]);
  if (v === 'pl') moveToPlaylist(id);
  if (v === 'ren') renameProject(id);
  if (v === 'del') removeProject(id);
}
$('newBtn').addEventListener('click', () => $('file').click());
// Training from the home bar: the last project, or the one chosen with "Cambia".
async function trainFromHome(id) {
  if (!homeList.length) { try { homeList = (await listProjects()).sort((a, b) => b.updated - a.updated); } catch (e) {} }
  if (!homeList.length) return toast(T('Prima crea un progetto'));
  await openPlayer(id || homeList[0].id); if (cur) openTraining();
}
// ---------- settings ----------
async function openSettings() {
  renderSettings(); show('set'); if (location.hash !== '#impostazioni') location.hash = 'impostazioni';
}
async function renderSettings() {
  const th = ls.get('theme', 'dark'), ai = ls.get('accent', 0);
  document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === th));
  $('accentList').innerHTML = ACCENTS.map((a, i) => `<button data-acc-i="${i}" class="${i === ai ? 'on' : ''}" style="--c:${isLight() ? a[2] : a[1]}" aria-label="${T('Colore {c}', { c: T(a[0]) })}"></button>`).join('');
  $('accentName').textContent = T(ACCENTS[ai][0]) + (ai === 0 ? ' ' + T('(predefinito)') : '');
  $('accentHint').textContent = isLight() ? T('tonalità più scura sul chiaro') : '';
  $('trLang').value = trTarget(); $('uiLang').value = I18N.lang; const o = tapOffset(); $('calTxt2').textContent = o == null ? T('Non calibrato') : T('{n} ms tra suono e tocco', { n: Math.round(o * 1000) });
  const mb = v => v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB' : Math.round(v / 1e6) + ' MB';
  let est = {}, models = [], n = homeList.length;
  try { est = await navigator.storage.estimate(); } catch (e) {}
  try { models = (await caches.keys()).filter(k => k.startsWith('bachata-models')); } catch (e) {}
  const row = (a, b) => `<div class="setrow"><span class="grow">${a}</span><b>${b}</b></div>`;
  $('setInfo').innerHTML = row(T('Progetti'), n + ' · ' + mb(est.usage || 0)) + row(T('Modelli di separazione'), NATIVE ? T("dentro l'app") : models.length ? T('scaricati') : T('non ancora')) +
    row(T('Versione'), 'Bachata Lab 6' + (NATIVE ? ' · Android' : '')) + (!NATIVE && models.length ? '<div class="setrow"><span class="grow">' + T('Libera circa 160 MB (si riscaricano al prossimo progetto)') + '</span><button class="pill" id="delModels">' + T('Elimina modelli') + '</button></div>' : '');
  const ok = await opusOK();
  $('setInfo').insertAdjacentHTML('beforeend', row(T('Compressione delle tracce'), ok ? T('attiva (Opus 128 kb/s)') : T('non disponibile qui')));
  if (ok) $('setInfo').insertAdjacentHTML('beforeend', '<div class="setrow"><span class="grow">' + T('I progetti nuovi sono già compressi (circa 10 volte meno spazio). Quelli fatti prima si comprimono quando li apri, oppure tutti qui.') + '</span><button class="pill" id="packAll">' + T('Comprimi') + '</button></div>');
  if (ok) $('packAll').onclick = packAllProjects;
  const dm = $('delModels'); if (dm) dm.onclick = async () => { for (const k of models) { try { await caches.delete(k); } catch (e) {} } ls.set('modelsCached', false); toast(T('Modelli eliminati')); renderSettings(); };
}
document.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => { ls.set('theme', b.dataset.theme); applyTheme(); renderSettings(); }));
$('accentList').addEventListener('click', e => { const b = e.target.closest('[data-acc-i]'); if (!b) return; ls.set('accent', +b.dataset.accI); applyTheme(); renderSettings(); });
$('calBtn2').addEventListener('click', async () => { await calibrate(); renderSettings(); });
// app language: saved, then the page reloads in the new language and comes back to Settings
$('uiLang').addEventListener('change', e => { if (I18N.setLang(e.target.value)) { try { sessionStorage.setItem('reopen', 'set'); } catch (x) {} location.reload(); } });
$('themeBtn').addEventListener('click', () => { ls.set('theme', isLight() ? 'dark' : 'light'); applyTheme(); });
$('changeFile').addEventListener('click', () => $('file').click());
$('clearName').addEventListener('click', () => { $('pname').value = ''; $('pname').focus(); });


// ---------- NEW PROJECT ----------
let src = null, region = { s: 0, e: 60 }, preview = null, peaks = null, vprevUrl = null;
function releaseSource() {
  src = null; peaks = null; $('vcard').classList.remove('on'); const vp = $('vprev'); vp.pause(); if (vp.getAttribute('src')) { vp.removeAttribute('src'); vp.load(); }
  if (vprevUrl) { URL.revokeObjectURL(vprevUrl); vprevUrl = null; }
}
$('file').addEventListener('change', async () => {
  const f = $('file').files[0]; $('file').value = ''; if (!f) return;
  const video = /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v)$/i.test(f.name);
  if (f.size > MAX_FILE) return dialog(T('File troppo grande'), textEl(T('Questo file supera i {n} MB e il telefono potrebbe non reggere. Prova con un video più corto o compresso.', { n: Math.round(MAX_FILE / 1e6) })), [['OK', 0, true]]);
  releaseSource();
  busy(video ? T('Leggo l\'audio del video…') : T('Leggo il brano…'));
  let buf;
  try { buf = await audioCtx().decodeAudioData(await f.arrayBuffer()); }
  catch (e) { busy(); return dialog(T('File non leggibile'), textEl(video ? T('Non riesco a leggere l\'audio di questo video. Prova con un MP4 registrato dal telefono.') : T('Questo file audio non si apre. Prova con un MP3 o un M4A.')), [['OK', 0, true]]); }
  busy();
  src = { buf, file: f, kind: video ? 'video' : 'audio', name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || T('Nuovo brano') };
  region = { s: 0, e: Math.min(buf.duration, 60) };
  $('pname').value = src.name; $('newTitle').textContent = video ? T('Nuovo progetto video') : T('Nuovo progetto');
  const vp = $('vprev');
  if (video) { vprevUrl = URL.createObjectURL(f); vp.src = vprevUrl; $('vcard').classList.add('on'); }
  $('fileIc').innerHTML = ico(video ? 'video' : 'note'); $('vname').textContent = f.name; $('vdur').textContent = (video ? T('Video') : T('Audio')) + ' · ' + fmt(buf.duration);
  $('audioOnlyRow').hidden = !video; $('audioOnly').checked = false;
  $('createBtn').disabled = false;
  computePeaks(); show('new'); location.hash = 'nuovo'; drawRegion(); seekPreview(0);
});
function computePeaks() {
  const ch = src.buf.getChannelData(0), n = 1000, step = Math.max(1, Math.floor(ch.length / n)); peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step && j < ch.length; j += 16) { const v = Math.abs(ch[j]); if (v > m) m = v; } peaks[i] = m; }
}
let vseekT = 0;
function seekPreview(t) { if (!src || src.kind !== 'video' || preview) return; clearTimeout(vseekT); vseekT = setTimeout(() => { try { $('vprev').currentTime = t; } catch (e) {} }, 60); }
// speedFactor: phone time / desktop WebAssembly time, learned after each project (separately for the Android app).
const SPEED_KEY = () => NATIVE ? 'speedFactorNative' : 'speedFactor';
function estimateMinutes(dur, withG) {
  const speed = ls.get(SPEED_KEY(), NATIVE ? 0.6 : 2);
  return Math.max(1, Math.round(dur * (COST.demucs + (withG ? COST.guira : 0)) * speed / 60));
}
function drawRegion() {
  const cv = $('rwave').querySelector('canvas'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!W || !src) return;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const d = src.buf.duration, xs = region.s / d * W, xe = region.e / d * W;
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, cssColor('--pri')); grad.addColorStop(1, cssColor('--acc'));
  for (let i = 0; i < peaks.length; i++) {
    const x = i / peaks.length * W, h = Math.max(1, peaks[i] * (H - 36)), inside = x >= xs && x <= xe;
    g.fillStyle = inside ? grad : cssColor('--s4'); g.fillRect(x, (H - h) / 2, Math.max(1, W / peaks.length - 0.6), h);
  }
  const acc = cssColor('--acc'), cy = cssColor('--cy');
  g.globalAlpha = 0.16; g.fillStyle = acc; g.fillRect(xs, 0, xe - xs, H); g.globalAlpha = 1;
  g.font = '700 10px "JetBrains Mono",monospace';
  [[xs, acc, T('INIZIO')], [xe, cy, T('FINE')]].forEach(([x, c, t]) => {
    g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 8; g.fillRect(x - 1, 0, 2, H); g.shadowBlur = 0;
    const tw = g.measureText(t).width + 8, lx = Math.min(Math.max(x - tw / 2, 0), W - tw);
    g.fillRect(lx, 2, tw, 15); g.fillStyle = cssColor('--bg'); g.fillText(t, lx + 4, 13);
    g.fillStyle = c; g.beginPath(); g.arc(Math.min(Math.max(x, 9), W - 9), H - 10, 8, 0, 7); g.fill();
    g.fillStyle = cssColor('--bg'); g.beginPath(); g.arc(Math.min(Math.max(x, 9), W - 9), H - 10, 3, 0, 7); g.fill(); });
  const step = [10, 15, 30, 60, 120].find(v => d / v <= 6) || 300;
  let tk = ''; for (let t = 0; t <= d + 0.01; t += step) tk += `<span>${fmt(t)}</span>`; $('ticks').innerHTML = tk;
  const dur = region.e - region.s, withG = true;
  $('rs').textContent = fmt(region.s); $('re').textContent = fmt(region.e); $('rd').textContent = fmt(dur);
  $('rdS').textContent = dur < 30 ? T('Una frase · meglio 30–90 s') : dur <= 90 ? T('Durata ideale per studiare') : T('Parte lunga · meglio 30–90 s');
  const first = !NATIVE && !ls.get('modelsCached', false);
  $('est').textContent = T('Circa {n} min · tutto sul telefono', { n: estimateMinutes(dur, withG) }) + (first ? ' · ' + T('la prima volta scarica anche i modelli (160 MB)') : '');
  $('regionWarn').innerHTML = dur > 180 ? '<div class="alert"><b>' + T('Parte lunga:') + '</b> ' + T('serve molta memoria. Sui telefoni con meno di 8 GB potrebbe non riuscire.') + '</div>'
    : dur > 120 ? '<div class="alert">' + T('Le parti oltre i 2 minuti richiedono più memoria e più tempo sul telefono.') + '</div>' : '';
  $('createBtn').disabled = dur < 8;
}

(function regionDrag() {
  const el = $('rwave'); let which = null;
  const tAt = e => { const b = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * src.buf.duration; };
  el.addEventListener('pointerdown', e => { if (!src) return; const t = tAt(e); which = Math.abs(t - region.s) < Math.abs(t - region.e) ? 's' : 'e'; el.setPointerCapture(e.pointerId); move(e); });
  const move = e => { if (!which) return; const t = Math.round(tAt(e) * 10) / 10;
    if (which === 's') region.s = Math.max(0, Math.min(t, region.e - 8)); else region.e = Math.min(src.buf.duration, Math.max(t, region.s + 8));
    drawRegion(); seekPreview(which === 's' ? region.s : region.e); };
  el.addEventListener('pointermove', move);
  const end = () => { if (which) { seekPreview(region.s); if (preview) startPreview(); } which = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
})();
document.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => {
  const [k, v] = b.dataset.nudge.split(','); const d = src.buf.duration;
  if (k === 's') region.s = Math.min(Math.max(0, region.s + +v), region.e - 8); else region.e = Math.max(Math.min(d, region.e + +v), region.s + 8);
  drawRegion(); seekPreview(k === 's' ? region.s : region.e);
}));
function stopPreview() {
  if (preview) { const p = preview; preview = null; try { p.node.stop(); } catch (e) {} cancelAnimationFrame(p.raf); }
  $('preview').innerHTML = ico('play') + T('Ascolta'); $('rph').style.display = 'none'; $('startHere').disabled = $('endHere').disabled = true;
  try { $('vprev').pause(); } catch (e) {}
}
async function startPreview() {
  stopPreview(); if (!src) return;
  const c = audioCtx(); await c.resume();
  const node = c.createBufferSource(); node.buffer = src.buf; node.connect(c.destination);
  const t0 = c.currentTime, from = region.s; node.start(0, from, region.e - from);
  preview = { node, t0, from, raf: 0 };
  node.onended = () => { if (preview && preview.node === node) stopPreview(); };
  if (src.kind === 'video') { const v = $('vprev'); v.currentTime = from; v.play().catch(() => {}); }
  $('preview').innerHTML = ico('pause') + T('Stop'); $('startHere').disabled = $('endHere').disabled = false;
  const ph = $('rph'); ph.style.display = 'block';
  const loop = () => { if (!preview) return; const t = previewPos(); ph.style.left = (t / src.buf.duration * 100) + '%'; preview.raf = requestAnimationFrame(loop); };
  loop();
}
const previewPos = () => preview ? preview.from + (audioCtx().currentTime - preview.t0) : region.s;
$('preview').addEventListener('click', () => (preview ? stopPreview() : startPreview()));
$('startHere').addEventListener('click', () => { const t = previewPos(); region.s = Math.max(0, Math.min(t, region.e - 8)); drawRegion(); toast(T('Inizio a {t}', { t: fmt(region.s) })); startPreview(); });
$('allSong').addEventListener('click', () => { if (!src) return; stopPreview(); region = { s: 0, e: src.buf.duration }; drawRegion(); });
$('endHere').addEventListener('click', () => { const t = previewPos(); region.e = Math.min(src.buf.duration, Math.max(t, region.s + 8)); drawRegion(); toast(T('Fine a {t}', { t: fmt(region.e) })); stopPreview(); });
window.addEventListener('resize', () => { if ($('s-new').classList.contains('on')) drawRegion(); if (cur) drawTimelineStatic(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { for (const k in colorCache) delete colorCache[k]; drawTimelineStatic(); });

function videoThumb(t) {
  return new Promise(res => {
    const v = $('vprev'); if (!src || src.kind !== 'video') return res(null);
    let done = false; const finish = () => { if (done) return; done = true;
      try { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
        const r = Math.max(480 / v.videoWidth, 270 / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
        g.drawImage(v, (480 - w) / 2, (270 - h) / 2, w, h); res(c.toDataURL('image/jpeg', 0.72)); } catch (e) { res(null); } };
    v.addEventListener('seeked', finish, { once: true }); setTimeout(finish, 1200);
    try { v.currentTime = t + 0.5; } catch (e) { finish(); }
  });
}
// The worker expects 44.1 kHz stereo: resample the chosen part if the phone decoded at another rate.
async function regionAt44k(buf, s, e) {
  const a = Math.floor(s * buf.sampleRate), b = Math.floor(e * buf.sampleRate);
  const ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  if (buf.sampleRate === SR) return [ch0.slice(a, b), ch1.slice(a, b)];
  const n = Math.ceil((e - s) * SR), off = new OfflineAudioContext(2, n, SR);
  const part = off.createBuffer(2, b - a, buf.sampleRate); part.copyToChannel(ch0.slice(a, b), 0); part.copyToChannel(ch1.slice(a, b), 1);
  const node = off.createBufferSource(); node.buffer = part; node.connect(off.destination); node.start();
  const r = await off.startRendering();
  return [r.getChannelData(0).slice(), r.getChannelData(1).slice()];
}

// ---------- PROCESSING ----------
let worker = null, procRunning = false;
// Wake lock: one shared request at a time; held while separating or while a project is open.
let wakeLock = null, wakeReq = null;
// Inside the Android app (Capacitor) the screen stays on through the KeepAwake plugin.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// The page runs without the Capacitor JS bundle, so the plugin is called straight through the native bridge.
const nativeAwake = () => NATIVE && typeof window.Capacitor.nativePromise === 'function' && {
  keepAwake: () => window.Capacitor.nativePromise('KeepAwake', 'keepAwake', {}), allowSleep: () => window.Capacitor.nativePromise('KeepAwake', 'allowSleep', {}) };
async function keepAwake() {
  const ka = nativeAwake(); if (ka) { if (!wakeLock) { try { await ka.keepAwake(); wakeLock = { native: true }; } catch (e) {} } return; }
  if (wakeLock || wakeReq || !('wakeLock' in navigator)) return;
  wakeReq = navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; }); }).catch(() => {}).finally(() => { wakeReq = null; });
  await wakeReq;
}
async function releaseWake() { const ka = nativeAwake(); if (ka) { if (wakeLock) { wakeLock = null; try { await ka.allowSleep(); } catch (e) {} } return; }
  if (wakeReq) await wakeReq; const l = wakeLock; wakeLock = null; try { l && l.release(); } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (procRunning || cur) keepAwake(); }
  else if (player && player.isPlaying) pausePlayer();
});
window.addEventListener('pagehide', () => { if (cur && player) { cur.pos = player.position; putProject(cur).catch(() => {}); } });
function setSteps(list, now) { $('procSteps').innerHTML = list.map((s, i) => { const st = i < now ? 'done' : i === now ? 'now' : 'todo';
  return `<li class="${st}"><span class="st">${st === 'done' ? '✓' : i + 1}</span><span class="t">${s}</span><span class="tag">${st === 'done' ? T('fatto') : ''}</span>${st === 'now' ? '<span class="sbar"><b></b></span>' : ''}</li>`; }).join(''); }
const stepInfo = txt => { const t = document.querySelector('#procSteps li.now .tag'); if (t) t.textContent = txt; };
// frac: share of the whole job; part: share of the current step (for its own bar)
function setProgress(frac, part) {
  frac = Math.max(0, Math.min(1, frac)); $('procRing').style.strokeDashoffset = (603.2 * (1 - frac)).toFixed(1); $('procPct').textContent = Math.round(frac * 100) + '%';
  const sb = document.querySelector('#procSteps li.now .sbar b'); if (sb) sb.style.width = ((part == null ? frac : part) * 100).toFixed(1) + '%';
}
let procClock = 0;
function cancelProcessing() { if (worker) { worker.terminate(); worker = null; } procRunning = false; clearInterval(procClock); releaseWake(); toast(T('Separazione annullata')); go('home'); }
$('createBtn').addEventListener('click', async () => {
  if (procRunning || !src) return;
  $('createBtn').disabled = true; procRunning = true; stopPreview();
  const name = $('pname').value.trim() || src.name, withG = true;
  const audioOnly = src.kind === 'video' && $('audioOnly').checked; // a video kept only for its sound: no video stored
  const dur = region.e - region.s, offset = region.s, kind = audioOnly ? 'audio' : src.kind, file = src.file;
  const steps = [NATIVE ? T('Preparo i modelli') : T('Scarico i modelli'), T('Separo voce, chitarra, basso, percussioni'), ...(withG ? [T('Isolo la güira')] : []), T('Trovo il ritmo e salvo')];
  history.replaceState(null, '', '#elabora'); show('proc'); keepAwake();
  $('procThumb').innerHTML = ico(kind === 'video' ? 'video' : 'note');
  $('procTitle').textContent = name; setProgress(0); setSteps(steps, 0);
  $('procKind').textContent = kind === 'video' ? T('Video') : T('Audio'); $('procSub').textContent = T('{t} selezionato · 6 tracce', { t: fmt(dur) });
  $('procStage').textContent = T('Preparazione…'); $('procWhat').textContent = T('Modelli'); $('procEl').textContent = '0:00'; $('procLeft').textContent = T('preparazione…'); $('procPart').textContent = '–';
  const t0 = Date.now(); clearInterval(procClock); procClock = setInterval(() => { $('procEl').textContent = fmt((Date.now() - t0) / 1000); $('wakeChip').hidden = !wakeLock; }, 1000);
  let left, right, thumb = null;
  try { thumb = audioOnly ? null : await videoThumb(offset); if (thumb) $('procThumb').innerHTML = `<img src="${thumb}" alt="">`; [left, right] = await regionAt44k(src.buf, region.s, region.e); }
  catch (e) { procRunning = false; await dialog(T('File non leggibile'), textEl(T('Non riesco a preparare l\'audio di questa parte.')), [['OK', 0, true]]); return go('home'); }
  const srcDur = src.buf.duration; releaseSource();
  const wD = COST.demucs, wG = withG ? COST.guira : 0; let tWork = Date.now(); const est = estimateMinutes(dur, withG);
  worker = NATIVE ? nativeWorker() : new Worker('worker.js?v=23');
  worker.onmessage = async ev => {
    const m = ev.data;
    if (m.type === 'download') {
      $('procStage').textContent = m.network ? T('Scarico i modelli: {a} di {b} MB (solo la prima volta)', { a: m.loaded, b: m.total }) : T('Carico i modelli');
      setProgress(0, m.frac);
    }
    if (m.type === 'loading') $('procStage').textContent = T('Preparo i modelli…');
    if (m.type === 'ready') { ls.set('modelsCached', true); ls.set('lastThreads', m.threads || 1); setSteps(steps, 1); tWork = Date.now(); setProgress(0); $('procWhat').textContent = T('Separazione'); $('procStage').textContent = T('Separo gli strumenti…'); }
    if (m.type === 'progress') {
      let frac = null, part = null;
      if (m.stage === 'demucs') { frac = wD / (wD + wG) * m.i / m.n; part = m.i / m.n; $('procStage').textContent = T('Separo gli strumenti: parte {i} di {n}', { i: m.i, n: m.n }); $('procPart').textContent = m.i + '/' + m.n; }
      if (m.stage === 'guira') { if (!document.querySelector('#procSteps li.now .sbar') || $('procWhat').textContent !== 'Güira') { setSteps(steps, 2); $('procWhat').textContent = 'Güira'; }
        frac = (wD + wG * m.i / m.n) / (wD + wG); part = m.i / m.n; $('procStage').textContent = T('Isolo la güira: parte {i} di {n}', { i: m.i, n: m.n }); $('procPart').textContent = m.i + '/' + m.n; }
      if (m.stage === 'resample') $('procStage').textContent = T('Preparo la güira');
      if (m.stage === 'split') $('procStage').textContent = T('Divido bongo e güira');
      if (frac != null) {
        setProgress(frac, part);
        const el = (Date.now() - tWork) / 1000;
        const lf = el / frac - el; $('procLeft').textContent = frac > 0.04 ? T('ancora circa {x}', { x: lf < 60 ? Math.max(5, Math.round(lf / 5) * 5) + ' s' : Math.round(lf / 60) + ' min' }) : T('circa {n} min', { n: est });
        if (m.n) stepInfo(T('parte {i} di {n}', { i: m.i, n: m.n }));
      }
    }
    if (m.type === 'error') {
      if (worker) { worker.terminate(); worker = null; } procRunning = false; releaseWake(); clearInterval(procClock);
      const net = /download|fetch|network|Failed/i.test(m.message);
      await dialog(T('Qualcosa è andato storto'), textEl(net ? T('Non riesco a scaricare i modelli: controlla la connessione e riprova.') : T('La separazione si è fermata ({x}). Prova con una parte più corta.', { x: m.message })), [['OK', 0, true]]);
      go('home');
    }
    if (m.type === 'done') try {
      if (worker) { worker.terminate(); worker = null; }
      const workS = (Date.now() - tWork) / 1000; ls.set(SPEED_KEY(), Math.max(0.05, Math.min(10, workS / (dur * (wD + wG)))));
      clearInterval(procClock); setSteps(steps, steps.length - 1); $('procStage').textContent = T('Trovo il ritmo e salvo…'); $('procWhat').textContent = T('Ritmo'); $('procLeft').textContent = T('quasi fatto'); setProgress(1, 0.5);
      const args = { name, stems: m.stems, dur, offset, srcDur, withG, kind, file, thumb };
      for (;;) {
        try { const id = await saveNew(args); procRunning = false; history.replaceState(null, '', '#player'); await openPlayer(id); return; }
        catch (e) {
          const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
          const again = await dialog(quota ? T('Spazio insufficiente') : T('Salvataggio non riuscito'), textEl(quota ? T('Il telefono non ha spazio per salvare questo progetto. Libera spazio (o elimina un progetto) e riprova.') : T('Non riesco a salvare il progetto: {x}', { x: e && e.message || e })), [[T('Rinuncia'), false], [T('Riprova'), true, true]]);
          if (!again) { procRunning = false; releaseWake(); return go('home'); }
        }
      }
    } catch (e) {
      procRunning = false; releaseWake();
      await dialog(T('Salvataggio non riuscito'), textEl(T('Errore alla fine della separazione: {x}', { x: e && e.message || e })), [['OK', 0, true]]); go('home');
    }
  };
  worker.onerror = e => { if (worker) worker.onmessage({ data: { type: 'error', message: e.message || T('errore interno') } }); };
  worker.postMessage({ type: 'separate', left, right, guira: withG, noCache: NATIVE }, [left.buffer, right.buffer]);
});
// In the Android app the separation runs natively (SeparatorPlugin, ONNX Runtime on several cores).
// This object speaks the same messages as worker.js, so the processing screen does not change.
function i16b64(x) { const u8 = new Uint8Array(toInt16(x).buffer); let s = ''; for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000)); return btoa(s); }
function nativeWorker() {
  const call = (m, o) => window.Capacitor.nativePromise('Separator', m, o || {});
  const w = { onmessage: null, onerror: null, stopped: false,
    terminate() { w.stopped = true; call('cancel').catch(() => {}); if (w.real) w.real.terminate(); },
    async postMessage(msg) {
      const emit = d => { if (!w.stopped && w.onmessage) w.onmessage({ data: d }); };
      try {
        const n = msg.left.length, CH = 1 << 19; await call('begin', { frames: n });
        emit({ type: 'loading' });
        for (const [ch, x] of [[0, msg.left], [1, msg.right]]) for (let off = 0; off < n; off += CH) {
          if (w.stopped) return;
          await call('append', { ch, offset: off, data: i16b64(x.subarray(off, off + CH)) });
        }
        await call('run', { guira: msg.guira });
        let ready = false;
        for (;;) {
          await new Promise(r => setTimeout(r, 400)); if (w.stopped) return;
          const s = await call('status');
          if (s.state === 'running' && !ready) { ready = true; emit({ type: 'ready', threads: s.threads }); }
          if (s.state === 'running' && ['demucs', 'guira', 'resample', 'split'].includes(s.stage)) emit({ type: 'progress', stage: s.stage, i: s.i, n: s.n });
          if (s.state === 'error') return fallback(s.error || 'errore');
          if (s.state === 'cancelled') return;
          if (s.state === 'done') {
            if (!ready) emit({ type: 'ready', threads: s.threads });
            const stems = {};
            for (const id in s.files) {
              const a = new Int16Array(await (await fetch(window.Capacitor.convertFileSrc(s.files[id]))).arrayBuffer()), h = a.length / 2;
              stems[id] = [toF32(a.subarray(0, h)), toF32(a.subarray(h))];
            }
            call('cleanup').catch(() => {});
            return emit({ type: 'done', stems });
          }
        }
      } catch (e) { fallback(String(e && e.message || e)); }
      // If the native separator is missing or fails, the slower WebAssembly worker does the job.
      function fallback(why) {
        if (w.stopped) return; console.warn('native separation failed:', why); toast(T('Uso la separazione nel browser (più lenta)'));
        const real = w.real = new Worker('worker.js?v=23');
        real.onmessage = ev => emit(ev.data); real.onerror = e => emit({ type: 'error', message: e.message || T('errore interno') });
        real.postMessage(msg);
      }
    } };
  return w;
}
$('cancelBtn').addEventListener('click', async () => {
  if (!procRunning) return;
  if (await dialog(T('Annullare?'), textEl(T('Perdi il lavoro fatto finora.')), [[T('Continua'), false], [T('Annulla separazione'), true, true]])) cancelProcessing();
});
function envelopes(stems, n) {
  const hop = Math.floor(SR / 20), env = {};
  for (const s of STEMS) {
    const [L, R] = stems[s.id], k = Math.floor(n / hop), e = new Array(k);
    for (let i = 0; i < k; i++) { let a = 0; for (let j = i * hop; j < (i + 1) * hop; j += 4) { const v = (L[j] + R[j]) * 0.5; a += v * v; } const db = 10 * Math.log10(a / (hop / 4) + 1e-12); e[i] = Math.round(Math.min(1, Math.max(0, (db + 55) / 45)) * 100) / 100; }
    env[s.id] = e;
  }
  return env;
}
function rhythmMono(stems, n) {
  const m = new Float32Array(n);
  for (const id of ['bongo', 'guira', 'bass']) { const [L, R] = stems[id]; for (let i = 0; i < n; i++) m[i] += (L[i] + R[i]) * 0.5; }
  return m;
}
// Where is the "1"? In bachata the chords change on the 1 (and on the 5), so the beat phase with the
// strongest harmonic change in guitar + bass + other is the start of the 4-count; between 1 and 5 the
// stronger change plus the bass accent decides. (The bass alone put the 1 one count late on real songs.)
function guessOne(stems, beats, n) {
  if (beats.length < 16) return 0;
  const harm = new Float32Array(n);
  for (const id of ['guitar', 'bass', 'altro']) { const [L, R] = stems[id]; for (let i = 0; i < n; i++) harm[i] += (L[i] + R[i]) * 0.5; }
  const NF = 8192, HOP = 2048, z = Separator.stft(harm, NF, HOP, false);
  const bins = []; // [fft bin, pitch class] for 55–1800 Hz
  for (let f = 1; f < z.F; f++) { const hz = f * SR / NF; if (hz >= 55 && hz <= 1800) bins.push([f, ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12]); }
  const chroma = (t0, t1) => { const c = new Float64Array(12), f0 = Math.max(0, Math.floor(t0 * SR / HOP)), f1 = Math.min(z.T, Math.ceil(t1 * SR / HOP));
    for (const [f, pc] of bins) for (let t = f0; t < f1; t++) c[pc] += Math.hypot(z.re[f * z.T + t], z.im[f * z.T + t]);
    let s = 0; for (const v of c) s += v * v; s = Math.sqrt(s) || 1; return c.map(v => v / s); };
  const nov = new Float64Array(8), cnt = new Float64Array(8);
  for (let i = 2; i < beats.length - 2; i++) {
    const a = chroma(beats[i - 2], beats[i]), b = chroma(beats[i], beats[i + 2]);
    let dot = 0; for (let k = 0; k < 12; k++) dot += a[k] * b[k];
    nov[i % 8] += 1 - dot; cnt[i % 8]++;
  }
  const mean = k => cnt[k] ? nov[k] / cnt[k] : 0;
  const [L] = stems.bass, w = Math.floor(0.06 * SR), bass = new Float64Array(8);
  beats.forEach((t, i) => { const a = Math.floor(t * SR); if (a < 0 || a + w >= n) return; let e = 0; for (let j = a; j < a + w; j++) e += L[j] * L[j]; bass[i % 8] += e; });
  const bmax = Math.max(...bass) || 1;
  let p4 = 0; for (let k = 1; k < 4; k++) if (mean(k) + mean(k + 4) > mean(p4) + mean(p4 + 4)) p4 = k;
  const score = k => mean(k) + 0.1 * bass[k] / bmax;
  return score(p4) >= score(p4 + 4) ? p4 : p4 + 4;
}
// Piano becomes a track only when it really plays: a fair share of the song and of "Altro" (which includes it).
// Otherwise it stays inside Altro, as before. Returns true when kept.
function splitPiano(stems, n) {
  if (!stems.piano) return false;
  const E = x => { let e = 0; for (const c of x) for (let i = 0; i < n; i += 2) e += c[i] * c[i]; return e; };
  let all = 0; for (const id of ['vocals', 'guitar', 'bass', 'bongo', 'guira', 'altro']) all += E(stems[id]);
  const pe = E(stems.piano), ae = E(stems.altro);
  const keep = all > 0 && pe / all > PIANO_MIX && pe / (ae || 1) > PIANO_ALTRO;
  if (keep) for (let c = 0; c < 2; c++) { const a = stems.altro[c], p = stems.piano[c]; for (let i = 0; i < n; i++) a[i] -= p[i]; }
  else delete stems.piano;
  return keep;
}
let lastAltroParts = null; // what nameAltro heard, moment by moment (saved in the project)
// YAMNet (tagworker.js) says which instrument family plays in Altro; null when no family clearly wins.
async function nameAltro(altro, n) {
  try {
    const buf = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: SR }), ch = buf.getChannelData(0), [L, R] = altro;
    for (let i = 0; i < n; i++) ch[i] = (L[i] + R[i]) * 0.5;
    const oc = new OfflineAudioContext(1, Math.ceil(n * 16000 / SR), 16000), bs = oc.createBufferSource();
    bs.buffer = buf; bs.connect(oc.destination); bs.start();
    const x = (await oc.startRendering()).getChannelData(0).slice();
    const r = await new Promise(res => {
      const w = new Worker('tagworker.js?v=2'), done = v => { clearTimeout(to); w.terminate(); res(v || {}); }, to = setTimeout(() => done({}), 90000);
      w.onmessage = e => done(e.data); w.onerror = () => done({}); w.postMessage({ audio: x }, [x.buffer]);
    });
    lastAltroParts = r.parts ? { parts: r.parts, unsure: r.unsure } : null;
    return r.name || null;
  } catch (e) { return null; }
}
async function saveNew({ name, stems, dur, offset, srcDur, withG, kind, file, thumb }) {
  const n = stems.vocals[0].length, id = 'p' + Date.now().toString(36);
  const piano = splitPiano(stems, n), altroName = await nameAltro(stems.altro, n); useStems(piano, altroName);
  let bt = { bpm: 0, beats: new Float64Array(0), confidence: 0 };
  try { bt = BeatTracker.analyze(rhythmMono(stems, n), SR); } catch (e) {}
  const beats = Array.from(bt.beats);
  // where the 1 falls, phrase by phrase (follows breaks that add or skip beats)
  let anchors; try { anchors = Counts.analyze(stems, beats, n, SR, Separator, 6); } catch (e) { const g = guessOne(stems, beats, n); anchors = [{ i: 0, c: (8 - g) % 8 }]; }
  const oneIdx = (((anchors[0].i - anchors[0].c) % 8) + 8) % 8;
  $('procStage').textContent = T('Comprimo le tracce per occupare meno spazio…');
  const { data, codec } = await packStems(stems, STEMS.map(s => s.id), n, (k, m) => { $('procStage').textContent = T('Comprimo le tracce: {a} di {b}', { a: k, b: m }); });
  try {
    await tx('stems', 'readwrite', s => s.put({ id, n, sr: SR, codec, data }));
    if (kind === 'video') await tx('media', 'readwrite', s => s.put({ id, blob: file, type: file.type || 'video/mp4' }));
    const p = normalize({ id, name, kind, thumb, dur, offset, srcDur, piano, altroName, altroParts: lastAltroParts, created: Date.now(), updated: Date.now(), withGuira: withG,
      bpm: bt.bpm, bpmDetected: bt.bpm, beats, beatsDetected: beats.slice(), confidence: bt.confidence, oneIdx, oneDetected: oneIdx, anchors, anchorsDetected: anchors.map(a => ({ ...a })), countAlgo: 1, tempoVaries: !!bt.tempoVaries,
      env: envelopes(stems, n), envRate: 20, mirror: kind === 'video', oneAlgo: 2 });
    try { await navigator.storage.persist(); } catch (e) {}
    await putProject(p);
    return id;
  } catch (e) { await deleteProject(id); throw e; }
}
// Every project goes through here, so projects made by older versions open with sensible defaults.
function normalize(p) {
  const d = { kind: 'audio', thumb: null, offset: 0, withGuira: true, beats: [], bpm: 0, confidence: 0, oneIdx: 0, envRate: 10,
    gains: Object.fromEntries(STEMS.map(s => [s.id, 1])), mute: {}, solo: {}, preset: 0, tempo: 100, step: 8, marks: [], pos: 0,
    ramp: false, countIn: false, mirror: false, env: {}, style: 'bachata', view: 'timeline', notes: [] };
  const q = Object.assign({}, d, p);
  q.met = Object.assign({ on: false, vol: 60, acc: '1' }, p.met || {});
  q.gains = Object.assign({}, d.gains, p.gains || {});
  for (const s of STEMS) if (!q.env[s.id]) q.env[s.id] = [];
  if (!q.beatsDetected) q.beatsDetected = q.beats.slice();
  if (q.bpmDetected == null) q.bpmDetected = q.bpm;
  if (q.oneDetected == null) q.oneDetected = q.oneIdx;
  return q;
}

// ---------- PLAYER ----------
let cur = null, player = null, raf = 0, saveT = 0, loopMode = null, abA = null, staticCv = null, loopRange = null, vidUrl = null, opening = 0;
let liveTempo = 100, padNodes = [], envScale = {}, userSeekAt = 0;
const isVideo = () => !!cur && cur.kind === 'video';
function persist() { clearTimeout(saveT); saveT = setTimeout(() => { if (cur) { cur.updated = Date.now(); putProject(cur).catch(() => {}); } }, 600); }
function closePlayer(skipSave) {
  cancelAnimationFrame(raf); raf = 0;
  if (player) { if (cur && !skipSave) { cur.pos = player.position; putProject(cur).catch(() => {}); } player.destroy(); player = null; }
  const v = $('vid'); try { v.pause(); } catch (e) {} if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
  if (vidUrl) { URL.revokeObjectURL(vidUrl); vidUrl = null; }
  if ($('train').classList.contains('on')) { training = null; $('train').classList.remove('on'); }
  exitFs(true); closePop(true); closeMap(true); $('lyrRes').innerHTML = ''; $('lyrQ').value = ''; cur = null; loopRange = null; loopMode = null; abA = null; waveImgs = {}; releaseWake();
}
async function openPlayer(id) {
  const my = ++opening;
  closePlayer();
  busy(T('Apro il progetto…'));
  let p, st, m;
  try { p = await getProject(id); st = await getStems(id); if (p && p.kind === 'video') m = await getMedia(id); }
  catch (e) { p = null; }
  if (my !== opening) return;
  if (!p || !st) { busy(); toast(T('Progetto non leggibile')); return go('home'); }
  try {
    useStems(!!st.data.piano, p.altroName);
    cur = normalize(p);
    const stems = await stemsF32(st, STEMS.map(s => s.id)), wasPcm = st.codec !== 'opus', nFrames = st.n;
    st = null;
    if (!cur.oneAlgo && cur.beats.length >= 16) {
      try { const g = guessOne(stems, cur.beatsDetected, stems.vocals[0].length);
        if (cur.oneIdx === cur.oneDetected && cur.beats.length === cur.beatsDetected.length) cur.oneIdx = g;
        cur.oneDetected = g; cur.oneAlgo = 2; persist(); } catch (e) {}
    }
    player = new StemPlayer(audioCtx(), stems, SR);
    player.onended = () => { setPlayIcon(); syncVideo(true); };
    // per-instrument scale for the pads: a quiet güira should light up as clearly as a loud voice
    for (const s of STEMS) { const e = cur.env[s.id].slice().sort((a, b) => a - b); envScale[s.id] = Math.max(0.25, e[Math.floor(e.length * 0.95)] || 0.25); }
    $('s-player').classList.toggle('video', isVideo());
    if (isVideo()) {
      if (m && m.blob) { vidUrl = URL.createObjectURL(m.blob); const v = $('vid'); v.src = vidUrl; v.addEventListener('loadedmetadata', () => syncVideo(true), { once: true }); }
      else toast(T('Video non trovato: resta solo l\'audio'));
      setMirror(!!cur.mirror, true);
    }
    $('pTitle').textContent = cur.name; $('tDur').textContent = fmt(player.duration); $('pSub').textContent = fmt(player.duration) + (cur.bpm ? ' · ' + Math.round(cur.bpm) + ' BPM' : '') + (isVideo() ? ' · video' : '');
    liveTempo = cur.tempo; applyTempo(cur.tempo, true); $('countIn').checked = !!cur.countIn;
    applyGains(); renderPads(); renderMarks();
    $('metVol').value = cur.met.vol; fillRange($('metVol')); renderAcc(); applyMet();
    updateLoopBtns();
    player.seek(Math.min(cur.pos || 0, Math.max(0, player.duration - 0.1)));
    show('player'); if (location.hash !== '#player') location.hash = 'player';
    renderDots(); renderStyle(); setView(cur.view, true); updateBeatInfo(); setPlayIcon(); lastCount = -1; busy(); keepAwake();
    if (!ls.get('padTipSeen', false)) { ls.set('padTipSeen', true); setTimeout(() => toast(isVideo() ? T('Tocca uno strumento per spegnerlo, tienilo premuto per sentirlo da solo') : T('M spegne uno strumento, S lo fa sentire da solo, il nome regola il volume')), 600); }
    requestAnimationFrame(() => { drawTimelineStatic(); syncVideo(true); });
    raf = requestAnimationFrame(tick);
    // projects made before the tempo/break tracking: redo beats and counts once, if the rhythm was never touched
    if (cur.countAlgo !== 1 && cur.beatsDetected && cur.beatsDetected.length >= 16) { const proj = cur;
      setTimeout(() => { try {
        if (cur !== proj) return;
        const untouched = proj.oneIdx === proj.oneDetected && proj.beats.length === proj.beatsDetected.length && proj.beats.every((t, k) => Math.abs(t - proj.beatsDetected[k]) < 1e-6);
        if (!untouched) { proj.countAlgo = 1; persist(); return; }
        const n2 = stems.vocals[0].length;
        if (!(proj.notes || []).length) { const bt = BeatTracker.analyze(rhythmMono(stems, n2), SR); if (bt.beats.length >= 16) { proj.beats = Array.from(bt.beats); proj.beatsDetected = proj.beats.slice(); proj.bpm = proj.bpmDetected = bt.bpm; proj.tempoVaries = !!bt.tempoVaries; } }
        const a = Counts.analyze(stems, proj.beats, n2, SR, Separator, 6); setAnchors(a); proj.oneDetected = proj.oneIdx; proj.anchorsDetected = a.map(x => ({ ...x })); proj.countAlgo = 1;
        lastCount = -1; updateBeatInfo(); persist();
        if (a.length > 1) toast(T(a.length === 2 ? 'Ho trovato {n} punto dove il conteggio riparte' : 'Ho trovato {n} punti dove il conteggio riparte', { n: a.length - 1 }));
      } catch (e) { console.warn('counts', e); } }, 800); }
    // projects saved before the compression: compress them now, in the background
    if (wasPcm) { const pid = cur.id; setTimeout(() => compressOld(pid, stems, nFrames).then(r => { if (r) toast(T('Progetto compresso: da {a} a {b} MB', { a: Math.round(r.before / 1e6), b: Math.round(r.after / 1e6) })); }).catch(() => {}), 1500); }
    // projects made before the naming: listen to Altro once, in the background
    if (cur.altroName === undefined || cur.altroParts === undefined) { const proj = cur; nameAltro(stems.altro, stems.altro[0].length).then(nm => {
      proj.altroName = nm || null; proj.altroParts = lastAltroParts; if (cur !== proj) return putProject(proj).catch(() => {});
      persist(); if (nm) { useStems(!!stems.piano, nm); renderPads(); if (mapOpen()) renderMapHeads(true); toast(T('In Altro c\'è soprattutto: {x}', { x: altroLabel(nm) })); } }); }
  } catch (e) {
    busy(); closePlayer(true); await dialog(T('Progetto non leggibile'), textEl(T('Non riesco ad aprire questo progetto ({x}).', { x: e && e.message || e })), [['OK', 0, true]]); go('home');
  }
}

// ---- beat grid helpers ----
const hasBeats = () => !!cur && cur.beats.length >= 8 && cur.bpm > 0;
function beatIdx(t) { const b = cur.beats; let lo = 0, hi = b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m] <= t + 0.03) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function nearestBeat(t) { const b = cur.beats; if (!b.length) return -1; let i = beatIdx(t); if (i < 0) return 0; if (i + 1 < b.length && Math.abs(b[i + 1] - t) < Math.abs(b[i] - t)) i++; return i; }
// The count of beat i. Anchors: beat i has count c (0 = the 1) and the count goes on from there; a song
// with a break that adds or skips beats has more than one. Old projects: one anchor from oneIdx.
const anchorsOf = () => cur.anchors && cur.anchors.length ? cur.anchors : [{ i: 0, c: (((0 - cur.oneIdx) % 8) + 8) % 8 }];
const countOf = i => Counts.countAt(anchorsOf(), i) + 1;
function setAnchors(a) { cur.anchors = a.sort((x, y) => x.i - y.i); cur.oneIdx = (((a[0].i - a[0].c) % 8) + 8) % 8; }
function beatTime(i) { const b = cur.beats; if (i >= 0 && i < b.length) return b[i]; const per = 60 / cur.bpm; return i < 0 ? b[0] + i * per : b[b.length - 1] + (i - b.length + 1) * per; }
function phraseStartIdx(t) { const i = Math.max(0, beatIdx(t)); return i - (countOf(i) - 1); }
function updateBeatInfo() {
  const ok = hasBeats();
  $('bpmVal').innerHTML = (ok ? dec(Math.round(cur.bpm * 10) / 10) : '–') + '<small> BPM</small>';
  $('bpmOrig').textContent = cur.bpmDetected ? T('Trovati dall\'app: {n} BPM', { n: dec(Math.round(cur.bpmDetected * 10) / 10) }) : '';
  if (player) $('pSub').textContent = fmt(player.duration) + (ok ? ' · ' + Math.round(cur.bpm) + ' BPM' : '') + (isVideo() ? ' · video' : '');
  $('beatWarn').textContent = !ok ? T('Ritmo non trovato: i salti vanno a mezzi secondi, usa il Loop A–B.') : cur.confidence < 0.4 ? T('Non sono sicuro del ritmo: controlla l\'1 e i BPM dal menu ⋮.') : '';
  ['loop4', 'loop8'].forEach(id => { $(id).disabled = !ok; });
  applyMet(); drawTimelineStatic(); computePhrases(); renderGrid();
}

// ---- count display ----
let dotNodes = [];
const isOne = c => c === 1 || c === 5, isTap = c => c === 4 || c === 8;
function renderDots() {
  $('dots').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => isTap(n) ? `<div class="dot tap">${n}<small>TAP</small></div>` : `<div class="dot${isOne(n) ? ' one' : ''}">${n}</div>`).join('');
  dotNodes = [...$('dots').children];
}
let lastCount = -1, lastT = 0, wraps = 0, frame = 0, lastSec = -2;
// index of the bookmark whose section contains t (-1 before the first one)
function sectionAt(t) { let k = -1; (cur.marks || []).forEach((m, i) => { if (m.t <= t + 0.05) k = i; }); return k; }
function phraseInfo(t) {
  const first = phraseStartIdx(0), total = Math.floor((phraseStartIdx(player.duration - 0.01) - first) / 8) + 1;
  return { pn: Math.floor((phraseStartIdx(t) - first) / 8) + 1, total };
}
function tick() {
  if (!player) return;
  const t = player.position;
  if (hasBeats()) {
    const i = beatIdx(t), c = i < 0 ? 0 : countOf(i);
    if (c !== lastCount) {
      lastCount = c;
      dotNodes.forEach((d, k) => d.classList.toggle('now', k + 1 === c));
      const cls = isTap(c) ? 'tap' : isOne(c) ? 'one' : '';
      for (const id of ['bigNum', 'mapNum']) { const el = $(id); el.textContent = c || '–'; el.classList.toggle('tap', cls === 'tap'); el.classList.toggle('one', cls === 'one'); }
      $('ovNum').textContent = c || ''; $('ovNum').className = 'ov ov-num ' + cls;
      const { pn, total } = phraseInfo(t), warn = c >= 5 && phraseChangeAhead(pn - 1), sec = sectionAt(t);
      $('phraseLbl').textContent = T('Frase {a} di {b}', { a: pn, b: total });
      $('secLbl').textContent = warn ? T('Cambio tra {n}', { n: 9 - c }) : sec >= 0 ? cur.marks[sec].name : ''; $('secLbl').classList.toggle('warn', warn);
      $('ovPhrase').textContent = warn ? T('Cambio tra {n}', { n: 9 - c }) : (sec >= 0 ? cur.marks[sec].name + ' · ' : '') + T('Frase {a} di {b}', { a: pn, b: total }); $('ovPhrase').classList.toggle('warn', warn);
      $('mapSub').textContent = T('Frase {a} di {b}', { a: pn, b: total }) + ' · ' + fmt(t);
      if (sec !== lastSec) { lastSec = sec; [...$('marks').children].forEach((b, k) => b.classList.toggle('on', k === sec)); }
    }
  } else { $('bigNum').textContent = '–'; $('ovNum').textContent = ''; }
  if (loopRange && player.isPlaying && t < lastT - 0.2 && performance.now() - userSeekAt > 400) wraps++;
  lastT = t;
  if ((frame++ & 1) === 0) { updatePads(t); drawTimeline(t); $('tPos').textContent = fmt(t); if (mapOpen()) drawMap(t); }
  if (training) trainTick(t);
  if (lyricsTick) lyricsTick(t);
  syncVideo(false);
  raf = requestAnimationFrame(tick);
}
let lyricsTick = null;

// ---- video: the stems are the sound, the video follows the player clock ----
let lastHardSeek = 0, lastRate = 0;
function syncVideo(force) {
  if (!isVideo() || !player) return;
  const v = $('vid'); if (!v.getAttribute('src') || v.readyState < 1 || v.seeking) return;
  const target = cur.offset + player.position, now = performance.now(), diff = v.currentTime - target;
  if (player.isPlaying) {
    if (Math.abs(diff) > (force ? 0.06 : 0.3) && now - lastHardSeek > 400) { v.currentTime = target; lastHardSeek = now; }
    const rate = Math.max(0.25, (liveTempo / 100) * (1 - Math.max(-0.06, Math.min(0.06, diff * 0.6))));
    if (Math.abs(rate - lastRate) > 0.005) { v.playbackRate = rate; lastRate = rate; }
    if (v.paused) v.play().catch(() => {});
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(diff) > 0.04 && (force || now - lastHardSeek > 150)) { v.currentTime = target; lastHardSeek = now; }
  }
}
function setMirror(on, quiet) { if (!cur) return; cur.mirror = on; $('stage').classList.toggle('mirror', on); $('mirrorBtn').classList.toggle('on', on); $('mirrorBtn').setAttribute('aria-pressed', String(on)); if (!quiet) { persist(); toast(on ? T('Specchio: il video è ribaltato come in sala') : T('Video normale')); } }
$('mirrorBtn').addEventListener('click', () => setMirror(!cur.mirror));
async function enterFs() {
  const st = $('stage'); st.classList.add('fs'); location.hash = 'schermo';
  try { if (st.requestFullscreen) await st.requestFullscreen(); } catch (e) {}
  try { await screen.orientation.lock('landscape'); } catch (e) {}
}
function exitFs(fromNav) {
  const st = $('stage'); if (!st.classList.contains('fs')) return; st.classList.remove('fs');
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  try { screen.orientation.unlock(); } catch (e) {}
  if (!fromNav && location.hash === '#schermo') history.back();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('stage').classList.contains('fs')) exitFs(); });
$('fsBtn').addEventListener('click', () => ($('stage').classList.contains('fs') ? exitFs() : enterFs()));
$('stage').querySelector('.fsbar').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
  if (a === 'play') togglePlay(); if (a === 'jb') jumpBy(-8); if (a === 'jf') jumpBy(8); if (a === 'exitfs') exitFs();
  if (a === 'slow') { const steps = [100, 85, 70]; const nx = steps[(steps.indexOf(cur.tempo) + 1) % steps.length] || 100; applyTempo(nx); } });

// ---- instruments: one row each (audio) or a compact pad (video); the waveform fills in as the song plays ----
function renderPads() {
  $('stems').innerHTML = STEMS.map(s => `<div class="stem" data-id="${s.id}" style="--c:var(--c-${s.id})"><i class="bar"></i>
    <button class="nm" data-vol aria-label="${T('Volume {x}', { x: s.n })}"><b>${s.n}</b><span></span></button><input type="range" class="vr" min="0" max="200" step="5" style="--tc:var(--c-${s.id})" aria-label="${T('Volume {x}', { x: s.n })}">
    <button class="ms m" aria-label="${T('Spegni {x}', { x: s.n })}">M</button><button class="ms s" aria-label="${T('Solo {x}', { x: s.n })}">S</button></div>`).join('');
  $('minipads').innerHTML = STEMS.map(s => `<button class="mpad" data-id="${s.id}" style="--c:var(--c-${s.id})"><i></i>${s.n}</button>`).join('');
  refreshPadStates(); requestAnimationFrame(drawStemWaves);
}
function refreshPadStates() {
  for (const row of document.querySelectorAll('#stems .stem')) {
    const id = row.dataset.id, off = isOff(id), g = Math.round(cur.gains[id] * 100);
    row.classList.toggle('off', off);
    const vr = row.querySelector('.vr'); if (vr && document.activeElement !== vr) { vr.value = cur.mute[id] ? 0 : g; fillRange(vr); }
    const ex = (STEMS.find(s => s.id === id) || {}).extra;
    row.querySelector('.nm span').textContent = (cur.mute[id] || g === 0 ? T('Spento') : anySolo() && !cur.solo[id] ? T('Escluso') : g + '%') + (ex ? ' · ' + ex : '');
    row.querySelector('.m').classList.toggle('on', !!cur.mute[id]); row.querySelector('.s').classList.toggle('on', !!cur.solo[id]);
    row.querySelector('.m').setAttribute('aria-pressed', String(!!cur.mute[id])); row.querySelector('.s').setAttribute('aria-pressed', String(!!cur.solo[id]));
  }
  for (const p of document.querySelectorAll('#minipads .mpad')) { const id = p.dataset.id; p.classList.toggle('off', isOff(id)); p.classList.toggle('solo', !!cur.solo[id]); p.setAttribute('aria-pressed', String(!isOff(id))); }
  padNodes = [...document.querySelectorAll(isVideo() ? '#minipads .mpad' : '#stems .stem')].map(p => ({ el: p, id: p.dataset.id, v: -1 }));
  if (mapOpen()) renderMapHeads(true);
}
const smooth = {};
function levelAt(id, t) {
  const e = cur.env[id], k = Math.floor(t * (cur.envRate || 10));
  let lv = e ? (e[k] || 0) / envScale[id] : 0;
  return Math.max(0, Math.min(1, (lv - 0.25) / 0.7));
}
function updatePads(t) {
  for (const p of padNodes) {
    let lv = levelAt(p.id, t); if (!player.isPlaying) lv *= 0.6;
    const prev = smooth[p.id] || 0, s = lv > prev ? lv : prev * 0.8 + lv * 0.2; smooth[p.id] = s;
    if (Math.abs(s - p.v) > 0.02) { p.v = s; p.el.style.setProperty('--lv', s.toFixed(2)); }
  }
  drawWaveProgress(t);
}
// Each row's waveform is drawn twice offscreen (bright and dim); every frame shows the bright part up to the playhead.
let waveImgs = {};
function drawStemWaves() { // the player rows now have a volume line instead of a waveform
  waveImgs = {};
  if (!cur || !player || isVideo() || !document.querySelector('#stems canvas')) return;
  const dpr = Math.min(2, devicePixelRatio || 1), dur = player.duration, dim = cc('--s3');
  for (const row of document.querySelectorAll('#stems .stem')) {
    const id = row.dataset.id, cv = row.querySelector('canvas'), W = cv.clientWidth, H = cv.clientHeight; if (!W) continue;
    cv.width = W * dpr; cv.height = H * dpr;
    const e = cur.env[id] || [], rate = cur.envRate || 10, n = Math.floor(W / 4), col = isOff(id) ? dim : cc('--c-' + id);
    const mk = c => { const o = document.createElement('canvas'); o.width = W * dpr; o.height = H * dpr; const g = o.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = c;
      for (let i = 0; i < n; i++) { const a = Math.floor(i / n * dur * rate), b = Math.max(a + 1, Math.floor((i + 1) / n * dur * rate)); let m = 0; for (let k = a; k < b; k++) m = Math.max(m, e[k] || 0);
        const h = Math.max(2, Math.min(1, m / (envScale[id] || 1)) * (H - 2)); g.beginPath(); g.roundRect ? g.roundRect(i * 4, (H - h) / 2, 3, h, 1.5) : g.rect(i * 4, (H - h) / 2, 3, h); g.fill(); }
      return o; };
    waveImgs[id] = { cv, on: mk(col), off: mk(dim) };
  }
  drawWaveProgress(player.position);
}
let lastWaveX = -1;
function drawWaveProgress(t) {
  if (!player) return;
  const f = Math.max(0, Math.min(1, t / player.duration)), xk = Math.round(f * 1000); if (xk === lastWaveX) return; lastWaveX = xk;
  for (const id in waveImgs) {
    const { cv, on, off } = waveImgs[id], g = cv.getContext('2d'), x = Math.round(f * cv.width);
    g.clearRect(0, 0, cv.width, cv.height); g.drawImage(off, 0, 0);
    if (x > 0) g.drawImage(on, 0, 0, x, cv.height, 0, 0, x, cv.height);
  }
}
// Shared by the rows, the pads, the volume popup and the map, so they always agree.
function toggleMute(id) { cur.mute[id] = !cur.mute[id]; if (cur.mute[id]) cur.solo[id] = false; else if (cur.gains[id] === 0) cur.gains[id] = 1; }
function toggleSolo(id) { cur.solo[id] = !cur.solo[id]; if (cur.solo[id]) { cur.mute[id] = false; if (cur.gains[id] === 0) cur.gains[id] = 1; } }
// volume line on each row: 0–200%, sticks to 100% near the middle
$('stems').addEventListener('input', e => { const vr = e.target.closest('.vr'); if (!vr) return; const id = vr.closest('.stem').dataset.id;
  let v = +vr.value; if (Math.abs(v - 100) <= 5) { v = 100; vr.value = 100; fillRange(vr); }
  cur.gains[id] = v / 100; cur.mute[id] = v === 0 ? cur.mute[id] : false; applyGains(); refreshPadStates(); persist(); });
$('stems').addEventListener('change', e => { if (e.target.closest('.vr')) e.target.blur(); });
$('stems').addEventListener('click', e => {
  const row = e.target.closest('.stem'); if (!row) return; const id = row.dataset.id;
  if (e.target.closest('.m')) { toggleMute(id); mixerChanged(); }
  else if (e.target.closest('.s')) { toggleSolo(id); mixerChanged(); }
  else if (e.target.closest('[data-vol]')) openVol(id);
});
function padPress(container) {
  let timer = 0, fired = false;
  container.addEventListener('pointerdown', e => { const target = e.target.closest('.mpad'); if (!target) return; fired = false; clearTimeout(timer);
    timer = setTimeout(() => { fired = true; const id = target.dataset.id; toggleSolo(id); mixerChanged();
      toast(cur.solo[id] ? T('{x} da solo', { x: STEMS.find(s => s.id === id).n }) : T('Solo tolto')); vibrate(20); }, 450); });
  const cancel = () => clearTimeout(timer);
  container.addEventListener('pointerup', cancel); container.addEventListener('pointercancel', cancel); container.addEventListener('pointerleave', cancel);
  container.addEventListener('contextmenu', e => e.preventDefault());
  container.addEventListener('click', e => { const p = e.target.closest('.mpad'); if (!p) return; if (fired) { fired = false; return; } const id = p.dataset.id;
    if (cur.solo[id]) toggleSolo(id);
    else if (isOff(id)) { cur.mute[id] = false; if (cur.gains[id] === 0) cur.gains[id] = 1; if (anySolo()) cur.solo[id] = true; }
    else toggleMute(id);
    mixerChanged(); });
}
padPress($('minipads'));
$('allOn').addEventListener('click', () => { if (!cur) return; cur.mute = {}; cur.solo = {}; STEMS.forEach(s => { if (cur.gains[s.id] === 0) cur.gains[s.id] = 1; }); mixerChanged(); toast(T('Tutti gli strumenti accesi')); });
// volume popup for one instrument
let volId = null;
function openVol(id) {
  volId = id; const s = STEMS.find(x => x.id === id);
  $('volName').textContent = s.n + (s.extra ? ' ' + s.extra : '');
  const ap = id === 'altro' && cur.altroParts; $('volInfo').hidden = !ap;
  if (ap) $('volInfo').textContent = T('Dentro, momento per momento: {x}.', { x: ap.parts.map(([n, v]) => T(n) + ' ' + v + '%').join(', ') + (ap.unsure ? ', ' + T('non riconosciuto {n}%', { n: ap.unsure }) : '') });
  $('popVol').style.setProperty('--c', `var(--c-${id})`); $('volRange').style.setProperty('--tc', `var(--c-${id})`);
  renderVol(); openPop('popVol');
}
function renderVol() { if (!volId) return; const g = Math.round(cur.gains[volId] * 100); $('volRange').value = g; fillRange($('volRange')); $('volVal').textContent = cur.mute[volId] ? T('Spento') : g + '%';
  $('volM').textContent = cur.mute[volId] ? T('Riaccendi') : T('Spegni'); $('volS').textContent = cur.solo[volId] ? T('Togli solo') : T('Solo'); }
$('volRange').addEventListener('input', e => { cur.gains[volId] = e.target.value / 100; if (cur.gains[volId] > 0) cur.mute[volId] = false; applyGains(); refreshPadStates(); renderVol(); persist(); });
$('volRange').addEventListener('change', () => drawStemWaves());
$('volM').addEventListener('click', () => { toggleMute(volId); mixerChanged(); renderVol(); });
$('volS').addEventListener('click', () => { toggleSolo(volId); mixerChanged(); renderVol(); });
$('volReset').addEventListener('click', () => { cur.gains[volId] = 1; cur.mute[volId] = false; mixerChanged(); renderVol(); });

// ---- scrub bar ----
function drawTimelineStatic() {
  if (!cur || !player) return;
  const dur = player.duration;
  $('scMarks').innerHTML = (cur.marks || []).map(m => `<i style="left:${(m.t / dur * 100).toFixed(2)}%"></i>`).join('');
  drawStemWaves();
}
function drawTimeline(t) {
  if (!player) return;
  const dur = player.duration, f = Math.max(0, Math.min(1, t / dur)) * 100;
  $('scFill').style.width = f.toFixed(2) + '%'; $('scHandle').style.left = f.toFixed(2) + '%';
  const L = $('scLoop');
  if (loopRange) { L.style.display = 'block'; L.style.left = (loopRange[0] / dur * 100).toFixed(2) + '%'; L.style.width = ((loopRange[1] - loopRange[0]) / dur * 100).toFixed(2) + '%'; }
  else if (abA != null) { L.style.display = 'block'; L.style.left = (abA / dur * 100).toFixed(2) + '%'; L.style.width = '0'; }
  else L.style.display = 'none';
}
(function timelineInput() {
  const el = $('tl'); let down = false, moved = false, sx = 0;
  const tAt = e => { const b = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * player.duration; };
  el.addEventListener('pointerdown', e => { if (!player) return; down = true; moved = false; sx = e.clientX; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (!player || !down) return; if (Math.abs(e.clientX - sx) > 6) moved = true; if (moved) seekTo(tAt(e), false); });
  el.addEventListener('pointerup', e => { if (!player || !down) return; down = false; seekTo(tAt(e), !moved); });
  el.addEventListener('pointercancel', () => { down = false; });
})();
function seekTo(t, snap) {
  if (!player) return;
  t = Math.max(0, Math.min(player.duration - 0.05, t));
  if (snap && hasBeats()) { const i = nearestBeat(t); if (i >= 0 && Math.abs(beatTime(i) - t) < 0.25) t = Math.max(0, beatTime(i)); }
  if (loopRange && (t < loopRange[0] - 0.01 || t >= loopRange[1])) clearLoop(false);
  userSeekAt = performance.now(); player.seek(t); syncVideo(true); drawTimeline(t);
}

// ---- transport ----
function setPlayIcon() { const p = !!player && player.isPlaying; for (const id of ['playBtn', 'fsPlay', 'mPlay']) { $(id).innerHTML = ico(p ? 'pause' : 'play'); $(id).setAttribute('aria-label', p ? T('Pausa') : T('Play')); } }
function pausePlayer() { if (!player) return; player.pause(); if (cur) { cur.pos = player.position; persist(); } setPlayIcon(); syncVideo(true); }
async function togglePlay() {
  if (!player) return;
  await audioCtx().resume();
  if (player.isPlaying) return pausePlayer();
  if (player.position >= player.duration - 0.1) { userSeekAt = performance.now(); player.seek(loopRange ? loopRange[0] : 0); }
  if (cur.countIn && hasBeats()) { // start four counts before the phrase so the dancer hears 5-6-7-8
    const startIdx = loopRange ? nearestBeat(loopRange[0]) : phraseStartIdx(player.position);
    const pre = beatTime(startIdx - 4);
    if (pre >= 0) { userSeekAt = performance.now(); player.seek(pre); }
  }
  if (liveTempo !== cur.tempo) setLiveTempo(cur.tempo);
  player.play(); keepAwake(); setPlayIcon(); syncVideo(true);
}
$('playBtn').addEventListener('click', togglePlay); $('mPlay').addEventListener('click', togglePlay);
$('stage').addEventListener('click', e => { if (e.target.closest('button') || $('stage').classList.contains('fs') && e.target.closest('.fsbar')) return; if (!swipedRecently) togglePlay(); });
// −8 −4 +4 +8: jump by counts. Inside a loop the loop itself moves by that many counts.
function jumpBy(n) {
  if (!player) return;
  const t = player.position, per = hasBeats() ? 60 / cur.bpm : 0.5;
  if (loopRange) {
    let a, b;
    if (hasBeats()) { const ia = nearestBeat(loopRange[0]), ib = nearestBeat(loopRange[1]); a = beatTime(ia + n); b = beatTime(ib + n); }
    else { a = loopRange[0] + n * per; b = loopRange[1] + n * per; }
    if (a < -0.05 || b > player.duration + 0.05) return toast(n < 0 ? T('Sei all\'inizio') : T('Sei alla fine'));
    setLoop(Math.max(0, a), Math.min(player.duration, b)); userSeekAt = performance.now(); player.seek(Math.max(0, a)); syncVideo(true);
    toast(T('Loop spostato di {n} tempi', { n: (n > 0 ? '+' : '') + n })); return;
  }
  if (!hasBeats()) return seekTo(t + n * per, false);
  const k = nearestBeat(t), target = beatTime(k + n);
  if (target < -0.05) return seekTo(0, false);
  if (target > player.duration - 0.05) return toast(T('Sei alla fine'));
  seekTo(Math.max(0, target), false);
}
document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => jumpBy(+b.dataset.jump)));
document.addEventListener('keydown', e => {
  if (!cur || !$('s-player').classList.contains('on') || e.target.tagName === 'INPUT' || $('dlg').classList.contains('on')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); jumpBy(e.shiftKey ? -4 : -8); }
  if (e.code === 'ArrowRight') { e.preventDefault(); jumpBy(e.shiftKey ? 4 : 8); }
});
let swipedRecently = false;
(function swipeJumps() {
  for (const el of [$('count'), $('stage')]) {
    let x0 = null;
    el.addEventListener('pointerdown', e => { x0 = e.target.closest('button') ? null : e.clientX; });
    el.addEventListener('pointerup', e => { if (x0 == null || !player) return; const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) { swipedRecently = true; setTimeout(() => { swipedRecently = false; }, 300); jumpBy(dx < 0 ? 8 : -8); } });
  }
})();

// ---- loops ----
function setLoop(a, b) { loopRange = [a, b]; player.setLoop(a, b); wraps = 0; drawTimeline(player.position); renderLoopInfo(); }
function renderLoopInfo() {
  let txt = '';
  if (abA != null) txt = T('A a {t} · tocca A–B per la fine', { t: fmt(abA) });
  else if (loopRange && cur) {
    const [a, b] = loopRange;
    if ((loopMode === 4 || loopMode === 8) && hasBeats()) { const c = countOf(nearestBeat(a)); txt = 'Loop ' + loopMode + ' · ' + T(c !== 1 ? 'frase {p} dal {c}' : 'frase {p}', { p: phraseInfo(a + 0.01).pn, c }); }
    else { const sec = cur.marks.findIndex(m => Math.abs(m.t - a) < 0.05); txt = (sec >= 0 ? 'Loop ' + cur.marks[sec].name : 'Loop A–B') + ` · ${fmt(a)}–${fmt(b)}`; }
  }
  $('loopTxt').textContent = txt;
  $('mapLoop').textContent = txt;
}
function clearLoop(silent) {
  const had = !!loopRange || abA != null; loopRange = null; loopMode = null; abA = null; if (player) player.clearLoop(); updateLoopBtns();
  if (player) drawTimeline(player.position);
  if (liveTempo !== cur.tempo) setLiveTempo(cur.tempo);
  if (!silent && had) toast(T('Loop spento'));
}
function updateLoopBtns() {
  $('loop4').classList.toggle('on', loopMode === 4); $('loop8').classList.toggle('on', loopMode === 8);
  $('loopAB').classList.toggle('on', loopMode === 'ab' || abA != null);
  $('loopAB').textContent = abA != null ? T('B: fine') : 'A–B';
  ['loop4', 'loop8'].forEach(id => $(id).setAttribute('aria-pressed', String(loopMode === (id === 'loop4' ? 4 : 8))));
  renderLoopInfo();
}
function beatLoop(n) {
  if (loopMode === n) return clearLoop();
  const t = player.position, i = Math.max(0, beatIdx(t)), c = countOf(i);
  let start = i - (c - 1); if (n === 4 && c > 4) start += 4;
  if (beatTime(start) < -0.05) start += n; // a first phrase cut by the region start: use the next whole one
  const a = beatTime(start), b = beatTime(start + n);
  if (b > player.duration + 0.01) { toast(T('Non c\'è una frase intera qui')); return; }
  abA = null; loopMode = n; setLoop(Math.max(0, a), Math.min(player.duration, b)); updateLoopBtns();
  if (t < a - 0.05 || t > b) { userSeekAt = performance.now(); player.seek(Math.max(0, a)); syncVideo(true); }
}
$('loop4').addEventListener('click', () => beatLoop(4));
$('loop8').addEventListener('click', () => beatLoop(8));
$('loopAB').addEventListener('click', () => {
  if (loopMode === 'ab') return clearLoop();
  let t = player.position; if (hasBeats()) { const i = nearestBeat(t); if (Math.abs(beatTime(i) - t) < 0.2) t = Math.max(0, beatTime(i)); }
  if (abA == null) { if (loopRange) clearLoop(true); abA = t; updateLoopBtns(); drawTimeline(player.position); toast(T('A segnato: tocca di nuovo alla fine (B)')); return; }
  const a = Math.min(abA, t), b = Math.max(abA, t);
  if (b - a < 0.5) { toast(T('Loop troppo corto')); return; }
  abA = null; loopMode = 'ab'; setLoop(a, b); updateLoopBtns(); userSeekAt = performance.now(); player.seek(a); syncVideo(true);
});

// ---- speed (pitch preserved) ----
function setLiveTempo(v) { liveTempo = v; if (player) player.setTempo(v / 100); $('tempoV').textContent = v + '%'; $('spdVal').textContent = v + '%'; $('fsSlow').textContent = v + '%'; $('speedBtn').classList.toggle('on', v !== 100); }
function applyTempo(v, quiet) {
  v = Math.max(50, Math.min(120, Math.round(+v)));
  if (cur) { cur.tempo = v; if (!quiet) persist(); }
  setLiveTempo(v); wraps = 0;
  document.querySelectorAll('[data-tempo]').forEach(b => b.classList.toggle('on', +b.dataset.tempo === v));
}
document.querySelectorAll('[data-tempo]').forEach(b => b.addEventListener('click', () => applyTempo(b.dataset.tempo)));
$('spdDown').addEventListener('click', () => cur && applyTempo(Math.ceil(cur.tempo / 5) * 5 - 5));
$('spdUp').addEventListener('click', () => cur && applyTempo(Math.floor(cur.tempo / 5) * 5 + 5));
$('countIn').addEventListener('change', e => { cur.countIn = e.target.checked; persist(); });

// ---- mixer ----
const anySolo = () => STEMS.some(s => cur.solo[s.id]);
const isOff = id => !!cur.mute[id] || (anySolo() && !cur.solo[id]) || cur.gains[id] === 0;
function applyGains() { if (!player) return; for (const s of STEMS) player.setGain(s.id, mapGain(s.id)); }
function mixerChanged() { applyGains(); refreshPadStates(); drawStemWaves(); persist(); }

// ---- bottom popups (one at a time; the phone's Back closes them) ----
let openPopEl = null;
function openPop(id) {
  if (openPopEl) closePop(true);
  openPopEl = $(id); openPopEl.classList.add('on'); $('scrim').classList.add('on');
  if (location.hash !== '#pop') location.hash = 'pop';
}
function closePop(fromNav) {
  if (!openPopEl) return; openPopEl.classList.remove('on'); $('scrim').classList.remove('on'); openPopEl = null; volId = null;
  if (!fromNav && location.hash === '#pop') history.back();
}
$('scrim').addEventListener('click', () => closePop());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closePop()));
document.querySelectorAll('.pop .grab').forEach(g => { let y0 = null; g.style.touchAction = 'none'; g.style.padding = '10px 0'; g.style.backgroundClip = 'content-box';
  g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 > 40) closePop(); y0 = null; }); });
$('speedBtn').addEventListener('click', () => openPop('popSpeed'));
$('metBtn').addEventListener('click', () => openPop('popMet'));
$('menuBtn').addEventListener('click', () => { if (cur) { updateBeatInfo(); openPop('popRhythm'); } });
$('secBtn').addEventListener('click', () => { if (cur) { renderMarks(); openPop('popSec'); } });
$('renameBtn').addEventListener('click', () => { if (cur) { closePop(); renameProject(cur.id); } });
$('plBtn').addEventListener('click', () => { if (cur) { closePop(); moveToPlaylist(cur.id); } });
$('deleteBtn').addEventListener('click', () => { if (cur) { const id = cur.id; closePop(); setTimeout(() => removeProject(id), 50); } });

// ---- rhythm: metronome, the "1", BPM ----
function renderAcc() {
  document.querySelectorAll('[data-acc]').forEach(b => b.classList.toggle('on', b.dataset.acc === cur.met.acc));
  const want = cur.met.acc === '48' ? [4, 8] : cur.met.acc === '15' ? [1, 5] : [1];
  $('accDots').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<i class="${want.includes(n) ? 'on' : ''}">${n}</i>`).join('');
  $('metState').textContent = cur.met.on ? T('Acceso') : T('Spento'); $('metBtn').classList.toggle('on', !!cur.met.on);
  $('metVolV').textContent = cur.met.vol + '%'; $('metOn').checked = !!cur.met.on;
}
function applyMet() {
  if (!player || !cur) return;
  const want = cur.met.acc === '48' ? [4, 8] : cur.met.acc === '15' ? [1, 5] : [1];
  const acc = []; for (let i = 0; i < cur.beats.length; i++) if (want.includes(countOf(i))) acc.push(i);
  player.setMetronome({ enabled: cur.met.on && hasBeats() && !training, beats: Float64Array.from(cur.beats), accents: acc, volume: cur.met.vol / 100 });
}
function setMet(on) { cur.met.on = on; renderAcc(); applyMet(); persist(); }
$('metOn').addEventListener('change', e => { if (!hasBeats()) { e.target.checked = false; return toast(T('Ritmo non trovato')); } setMet(e.target.checked); });
$('metVol').addEventListener('input', e => { cur.met.vol = +e.target.value; renderAcc(); applyMet(); persist(); });
document.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => { cur.met.acc = b.dataset.acc; renderAcc(); applyMet(); persist(); }));
// Measured delay between a sound and the tap on it (speaker, headphones, reaction), or null if never calibrated.
const tapOffset = () => ls.get('tapOffset', null);
// The tap comes a little after the 1 is heard: take the beat nearest to (tap time − delay).
// (no button any more: the count comes from the analysis) Kept for a possible return of the manual fix:
// "L'1 è qui!": corrects the part of the song the tap is in (the whole song when there are no breaks).
// "Da qui in poi": the count changes only from this beat on (a break the app did not notice).
function setOneHere(fromHere) {
  if (!hasBeats() || !player) return;
  const lag = tapOffset() != null ? tapOffset() : TAP_LAG;
  const i = nearestBeat(player.position - (player.isPlaying ? lag : 0)); if (i < 0) return;
  const anc = anchorsOf().map(a => ({ ...a }));
  if (fromHere) setAnchors(anc.filter(a => a.i !== i).concat([{ i, c: 0 }]));
  else { let k = 0; anc.forEach((a, j) => { if (a.i <= i) k = j; }); const a = anc[k]; a.c = (((a.c - Counts.countAt(anc, i)) % 8) + 8) % 8; setAnchors(anc); }
  lastCount = -1; applyMet(); drawTimelineStatic(); computePhrases(); persist();
  if (loopMode === 4 || loopMode === 8) { const n = loopMode; loopMode = null; beatLoop(n); }
  toast(fromHere ? 'Ok, l\'1 è qui da questo punto in poi' : 'Ok, l\'1 è qui'); vibrate(15);
}
function regrid(bpm) {
  const t = player.position, i = Math.max(0, nearestBeat(t)), anchor = beatTime(i - (countOf(i) - 1));
  const g = Array.from(BeatTracker.grid(bpm, anchor, player.duration));
  let k = 0, best = Infinity; g.forEach((v, j) => { const d = Math.abs(v - anchor); if (d < best) { best = d; k = j; } });
  cur.bpm = bpm; cur.beats = g; setAnchors([{ i: k, c: 0 }]); lastCount = -1; if (loopRange) clearLoop(false); updateBeatInfo(); persist();
  cur.notes = cur.notes || [];
}
document.querySelectorAll('[data-bpm]').forEach(b => b.addEventListener('click', () => {
  if (!cur.bpmDetected) return toast(T('Ritmo non trovato')); const v = b.dataset.bpm;
  if (v === 'reset') { cur.bpm = cur.bpmDetected; cur.beats = cur.beatsDetected.slice(); cur.oneIdx = cur.oneDetected; cur.anchors = cur.anchorsDetected ? cur.anchorsDetected.map(a => ({ ...a })) : null; lastCount = -1; if (loopRange) clearLoop(false); updateBeatInfo(); persist(); toast(T('Ritmo ripristinato')); return; }
  regrid(v === 'half' ? cur.bpm / 2 : v === 'double' ? cur.bpm * 2 : Math.max(40, Math.min(240, Math.round(cur.bpm) + +v)));
}));

// ---- sections (bookmarks: a bookmark starts a section that ends at the next one) ----
function renderMarks() {
  cur.marks.sort((a, b) => a.t - b.t);
  $('marks').innerHTML = cur.marks.map((m, i) => `<button data-mark="${i}"><span>${esc(m.name)}</span><span class="mute small">${fmt(m.t)}</span></button>`).join(''); lastSec = -2;
  drawTimelineStatic();
}
async function addMark(t) {
  if (!cur) return;
  if (cur.marks.length >= 12) return toast(T('Massimo 12 sezioni'));
  if (hasBeats()) t = Math.max(0, beatTime(phraseStartIdx(t)));
  const wrap = document.createElement('div'), inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 24; inp.placeholder = T('Nome');
  const chips = document.createElement('div'); chips.className = 'chips';
  MARK_NAMES.forEach(n => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => { inp.value = n; }; chips.append(b); });
  const p = document.createElement('p'); p.className = 'mute small'; p.textContent = T('All\'inizio della frase, a {t}', { t: fmt(t) });
  wrap.append(p, chips, inp);
  const ok = await dialog(T('Nuova sezione'), wrap, [[T('Annulla'), false], [T('Salva'), true, true]]);
  if (ok && cur) { cur.marks.push({ t, name: inp.value.trim() || T('Sezione {n}', { n: cur.marks.length + 1 }) }); renderMarks(); persist(); }
}
$('markBtn').addEventListener('click', () => player && addMark(player.position));
(function markInput() {
  let lp = 0, fired = false;
  $('marks').addEventListener('pointerdown', e => { const b = e.target.closest('[data-mark]'); if (!b) return; fired = false;
    lp = setTimeout(() => { fired = true; markMenu(+b.dataset.mark); }, 600); });
  const stop = () => clearTimeout(lp);
  $('marks').addEventListener('pointerup', stop); $('marks').addEventListener('pointercancel', stop);
  $('marks').addEventListener('contextmenu', e => e.preventDefault());
  $('marks').addEventListener('click', e => { const b = e.target.closest('[data-mark]'); if (!b) return; if (fired) { fired = false; return; } seekTo(cur.marks[+b.dataset.mark].t, false); closePop(); });
})();
function sectionOf(idx) { const m = cur.marks[idx], next = cur.marks[idx + 1]; return [m.t, next ? next.t : player.duration]; }
async function markMenu(idx) {
  const m = cur.marks[idx]; if (!m) return;
  const v = await dialog(m.name + ' · ' + fmt(m.t), null, [[T('Loop sezione'), 'loop', true], [T('Rinomina'), 'ren'], [T('Elimina'), 'del'], [T('Chiudi'), null]]);
  if (!cur) return;
  if (v === 'loop') { const [a, b] = sectionOf(idx); if (b - a < 0.5) return toast(T('Sezione troppo corta')); abA = null; loopMode = 'ab'; setLoop(a, b); updateLoopBtns(); userSeekAt = performance.now(); player.seek(a); syncVideo(true); toast('Loop: ' + m.name); closePop(); }
  if (v === 'ren') { const inp = document.createElement('input'); inp.type = 'text'; inp.value = m.name; inp.maxLength = 24;
    if (await dialog(T('Rinomina sezione'), inp, [[T('Annulla'), false], [T('Salva'), true, true]]) && cur && inp.value.trim()) { m.name = inp.value.trim(); renderMarks(); persist(); } }
  if (v === 'del' && await dialog(T('Eliminare "{x}"?', { x: m.name }), null, [[T('No'), false], [T('Elimina'), true, true]]) && cur) { cur.marks.splice(idx, 1); renderMarks(); persist(); }
}

// ---- phrases: which instruments play in each 8, so changes can be announced ----
let phrases = [];
function computePhrases() {
  phrases = [];
  if (!cur || !player || !hasBeats()) return;
  const r = cur.envRate || 10, first = phraseStartIdx(0);
  for (let ps = first; beatTime(ps) < player.duration - 0.5; ps += 8) {
    const a = Math.max(0, beatTime(ps)), b = Math.min(player.duration, beatTime(ps + 8));
    const active = STEMS.filter(st => { const e = cur.env[st.id] || [], i0 = Math.floor(a * r), i1 = Math.max(i0 + 1, Math.floor(b * r));
      let sum = 0; for (let k = i0; k < i1; k++) sum += e[k] || 0; return sum / (i1 - i0) / (envScale[st.id] || 1) > 0.45; }).map(st => st.id);
    phrases.push({ ps, active });
  }
}
// true when the next phrase brings in or drops at least two instruments
function phraseChangeAhead(k) {
  const p = phrases[k], q = phrases[k + 1]; if (!p || !q) return false;
  const A = new Set(p.active), B = new Set(q.active); let d = 0;
  for (const x of A) if (!B.has(x)) d++; for (const x of B) if (!A.has(x)) d++;
  return d >= 2;
}
function notesAt(i) { const t = beatTime(i), per = 60 / cur.bpm; return (cur.notes || []).filter(n => Math.abs(n.t - t) < per / 2); }
const renderGrid = () => {}, setView = () => {};
async function editNote(i) {
  const ex = notesAt(i)[0], inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 60; inp.placeholder = T('Es. giro, dip, body roll'); inp.value = ex ? ex.text : '';
  const { pn } = phraseInfo(beatTime(i) + 0.01);
  const wrap = document.createElement('div'); const p = document.createElement('p'); p.className = 'mute small'; p.textContent = T('Frase {p}, tempo {c}', { p: pn, c: countOf(i) }); wrap.append(p, inp);
  const v = await dialog(T('Nota sul tempo'), wrap, ex ? [[T('Elimina'), 'del'], [T('Annulla'), false], [T('Salva'), true, true]] : [[T('Annulla'), false], [T('Salva'), true, true]]);
  if (!cur || !v) return;
  cur.notes = (cur.notes || []).filter(n => n !== ex);
  if (v === true && inp.value.trim()) { cur.notes.push({ t: beatTime(i), text: inp.value.trim() }); toast(T('Nota salvata')); }
  persist(); mapStatic = null;
}
function renderStyle() { if (cur) cur.style = 'bachata'; }

// ---- tap tempo: tap at least 4 times on the beat ----
let taps = [];
$('tapBtn').addEventListener('pointerdown', e => {
  e.preventDefault(); if (!player) return;
  const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now); vibrate(8);
  if (taps.length >= 4) {
    const d = []; for (let k = 1; k < taps.length; k++) d.push(taps[k] - taps[k - 1]); d.sort((a, b) => a - b);
    const bpm = Math.round(60000 / d[Math.floor(d.length / 2)] * 10) / 10;
    $('tapLbl').innerHTML = ico('hand') + 'Tap · ' + dec(bpm) + ' BPM';
    clearTimeout(taps.t); taps.t = setTimeout(() => { if (bpm >= 60 && bpm <= 220) { regrid(bpm); toast(T('Tempo impostato a {n} BPM', { n: Math.round(bpm) })); } taps = []; $('tapLbl').innerHTML = ico('hand') + T('Tap tempo'); }, 1600);
  } else $('tapLbl').innerHTML = ico('hand') + 'Tap ' + taps.length + '/4';
});

// ---- map of the instruments: a view of the player (same loop, speed, metronome) ----
// Turning an instrument off here only lasts while the map is open.
let mapMute = null, mapStatic = null, mapView = 0, mapDrag = null;
const mapOpen = () => $('map').classList.contains('on');
function mapGain(id) {
  if (mapMute) return mapMute[id] ? 0 : (isOff(id) ? 1 : cur.gains[id]);
  return isOff(id) ? 0 : cur.gains[id];
}
function openMap() {
  if (!cur || !player) return;
  mapMute = {}; for (const s of STEMS) mapMute[s.id] = isOff(s.id); // off in the player = off here; tapping brings it in at 100%
  $('mapTitle').textContent = cur.name; $('map').classList.add('on'); location.hash = 'mappa';
  mapStatic = null; mapView = null; renderMapHeads(true); mapTab($('mapTabT').classList.contains('on') ? 'T' : 'S');
  applyGains(); requestAnimationFrame(() => drawMap(player.position));
}
function closeMap(fromNav) {
  if (!mapOpen()) return; $('map').classList.remove('on'); mapMute = null; if (cur) applyGains();
  if (!fromNav && location.hash === '#mappa') history.back();
}
$('mapBtn').addEventListener('click', openMap);
$('mapClose').addEventListener('click', () => closeMap());
function mapTab(w) { $('mapTabS').classList.toggle('on', w === 'S'); $('mapTabT').classList.toggle('on', w === 'T'); $('mapPaneS').hidden = w !== 'S'; $('mapPaneT').hidden = w !== 'T'; if (w === 'T' && window.openLyrics) window.openLyrics(); }
$('mapTabS').addEventListener('click', () => mapTab('S')); $('mapTabT').addEventListener('click', () => mapTab('T'));
function renderMapHeads(full) {
  if (!mapOpen() || !player) return;
  const t = player.position;
  if (full) $('mapHeads').classList.toggle('n7', STEMS.length > 6);
  if (full) $('mapHeads').innerHTML = STEMS.map(s => `<button class="mhd" data-id="${s.id}" style="--c:var(--c-${s.id})"><b>${s.n}${s.extra ? ' +' : ''}</b><span></span></button>`).join('');
  for (const b of $('mapHeads').children) {
    const id = b.dataset.id, off = mapMute[id], lv = levelAt(id, t), lit = !off && lv > 0.15;
    b.classList.toggle('lit', lit); b.classList.toggle('off', off);
    b.querySelector('span').textContent = off ? T('spento · tocca') : lv > 0.7 ? T('forte') : lit ? T('suona') : T('pausa');
  }
}
$('mapHeads').addEventListener('click', e => { const b = e.target.closest('.mhd'); if (!b || !mapMute) return; const id = b.dataset.id;
  mapMute[id] = !mapMute[id]; applyGains(); mapStatic = null; renderMapHeads(); vibrate(10); });
// The map shows some phrases at a time (zoom + / −, down to the whole song); a drag scrolls, a tap goes there.
const ZOOMS = [1, 2, 4, 8, 16, 0]; // phrases per screen, 0 = the whole song
let mapZoom = Math.min(ZOOMS.length - 1, Math.max(0, ls.get('mapZoom', 2)));
function setMapZoom(k) {
  mapZoom = Math.min(ZOOMS.length - 1, Math.max(0, k)); ls.set('mapZoom', mapZoom); mapView = null; mapStatic = null;
  const z = ZOOMS[mapZoom]; $('zLbl').textContent = z ? T(z === 1 ? '{n} frase' : '{n} frasi', { n: z }) : T('tutta');
  $('zIn').disabled = mapZoom === 0; $('zOut').disabled = mapZoom === ZOOMS.length - 1;
  if (player && mapOpen()) drawMap(player.position);
}
function mapWindow(t) {
  if (!ZOOMS[mapZoom] || !hasBeats()) { if (!ZOOMS[mapZoom]) return { a: 0, span: player.duration, per: 60 / cur.bpm }; }
  const per = 60 / cur.bpm, span = (ZOOMS[mapZoom] || 4) * 8 * per, first = hasBeats() ? beatTime(phraseStartIdx(0)) : 0;
  if (mapView == null || t < mapView || t > mapView + span) { const k = Math.floor((t - first) / span); mapView = first + Math.max(0, k) * span; }
  return { a: mapView, span, per };
}
function drawMap(t) {
  renderMapHeads();
  const cv = $('mapCv'), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr)) { cv.width = W * dpr; cv.height = H * dpr; mapStatic = null; }
  const { a, span, per } = mapDrag ? { a: mapDrag.a, span: mapDrag.span, per: 60 / cur.bpm } : mapWindow(t);
  const key = a.toFixed(3) + '|' + W + '|' + H + '|' + JSON.stringify(mapMute);
  if (!mapStatic || mapStatic.key !== key) {
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const g = o.getContext('2d'); g.scale(dpr, dpr);
    const top = 24, laneH = (H - top - 8) / STEMS.length, rate = cur.envRate || 10, n = Math.floor(W / 3);
    // phrase lines and numbers, count ticks
    if (hasBeats()) {
      const i0 = Math.max(0, nearestBeat(a)), nb = Math.ceil(span / per) + 2, phW = 8 * per / span * W;
      const ticks = phW > 60, every = phW >= 26 ? 1 : phW >= 13 ? 2 : phW >= 7 ? 4 : 8; // fewer labels when zoomed out
      g.font = '700 12px Inter,system-ui,sans-serif';
      for (let i = i0 - 1; i <= i0 + nb; i++) { const bt = beatTime(i); if (bt < a - 0.01 || bt > a + span) continue; const x = (bt - a) / span * W, c = countOf(i);
        if (c !== 1 && !ticks) continue;
        g.fillStyle = cc('--ink'); g.globalAlpha = c === 1 ? (ticks ? 0.35 : 0.18) : 0.08; g.fillRect(x, c === 1 ? 0 : top - 6, 1, c === 1 ? H : H - top + 6);
        if (c === 1) { const pn = phraseInfo(bt + 0.01).pn; if ((pn - 1) % every === 0) { g.globalAlpha = 1; g.fillStyle = cc('--ink3'); g.fillText(String(pn), x + 3, 15); } }
        if (notesAt(i).length) { g.globalAlpha = 1; g.fillStyle = cc('--acc'); g.beginPath(); g.arc(x, top - 6, 3.5, 0, 7); g.fill(); } }
      g.globalAlpha = 1;
    }
    STEMS.forEach((s, k) => {
      const e = cur.env[s.id] || [], y = top + k * laneH + laneH / 2, col = mapMute[s.id] ? cc('--s3') : cc('--c-' + s.id);
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const t0 = a + i / n * span, t1 = a + (i + 1) / n * span; let m = 0;
        for (let q = Math.floor(t0 * rate); q < Math.max(Math.floor(t0 * rate) + 1, Math.floor(t1 * rate)); q++) m = Math.max(m, e[q] || 0);
        if (t0 > player.duration) break;
        const h = Math.max(1.5, Math.min(1, m / (envScale[s.id] || 1)) * (laneH - 6)); g.fillRect(i * 3, y - h / 2, 2, h);
      }
    });
    mapStatic = { key, img: o };
  }
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(mapStatic.img, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = (t - a) / span * W;
  g.fillStyle = cc('--bg'); g.globalAlpha = 0.45; g.fillRect(0, 22, Math.max(0, Math.min(W, x)), H); g.globalAlpha = 1;
  if (loopRange) { const lx = (loopRange[0] - a) / span * W, lw = (loopRange[1] - loopRange[0]) / span * W; g.strokeStyle = cc('--acc'); g.lineWidth = 2; g.beginPath(); g.roundRect ? g.roundRect(lx + 1, 22, lw - 2, H - 26, 8) : g.rect(lx + 1, 22, lw - 2, H - 26); g.stroke(); }
  if (x >= 0 && x <= W) { g.fillStyle = cc('--ink'); g.fillRect(x - 1.5, 0, 3, H); }
  const dur = player.duration; $('mapOvWin').style.left = (a / dur * 100) + '%'; $('mapOvWin').style.width = Math.min(100, span / dur * 100) + '%'; $('mapOvPos').style.left = (t / dur * 100) + '%';
  $('mapInfo').textContent = liveTempo + '% · ' + (cur.met.on ? T('metronomo acceso') : T('metronomo spento'));
}
(function mapInput() {
  const el = $('mapBox'); let sx = 0, moved = false, down = false, lp = 0;
  const tAt = e => { const b = el.getBoundingClientRect(), { a, span } = mapDrag || mapWindow(player.position); return a + (e.clientX - b.left) / b.width * span; };
  el.addEventListener('pointerdown', e => { if (!player) return; down = true; moved = false; sx = e.clientX; el.setPointerCapture(e.pointerId);
    const w = mapWindow(player.position); mapDrag = ZOOMS[mapZoom] ? { a: w.a, span: w.span, a0: w.a } : null;
    const t0 = tAt(e); clearTimeout(lp); lp = setTimeout(() => { if (!moved && hasBeats()) { down = false; mapDrag = null; editNote(nearestBeat(t0)); } }, 600); });
  el.addEventListener('pointermove', e => { if (!down || !mapDrag) return; const dx = e.clientX - sx; if (Math.abs(dx) > 8) { moved = true; clearTimeout(lp); }
    if (moved) { const b = el.getBoundingClientRect(); mapDrag.a = Math.max(-mapDrag.span * 0.1, Math.min(player.duration - mapDrag.span * 0.5, mapDrag.a0 - dx / b.width * mapDrag.span)); drawMap(player.position); } });
  el.addEventListener('pointerup', e => { clearTimeout(lp); if (!down) return; down = false;
    if (!moved || !mapDrag) { const t = tAt(e); mapDrag = null; mapView = null; seekTo(hasBeats() ? beatTime(nearestBeat(t)) : t, false); }
    else { mapView = mapDrag.a; mapDrag = null; } });
  el.addEventListener('pointercancel', () => { clearTimeout(lp); down = false; mapDrag = null; });
  $('zIn').addEventListener('click', () => setMapZoom(mapZoom - 1)); $('zOut').addEventListener('click', () => setMapZoom(mapZoom + 1));
  // two fingers: pinch to zoom
  let pd = 0; el.addEventListener('touchstart', e => { if (e.touches.length === 2) pd = Math.abs(e.touches[0].clientX - e.touches[1].clientX); }, { passive: true });
  el.addEventListener('touchmove', e => { if (e.touches.length !== 2 || !pd) return; const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
    if (d > pd * 1.6) { setMapZoom(mapZoom - 1); pd = d; } else if (d < pd / 1.6) { setMapZoom(mapZoom + 1); pd = d; } }, { passive: true });
  el.addEventListener('touchend', () => { pd = 0; }, { passive: true });
  setMapZoom(mapZoom);
})();
if (window.ResizeObserver) new ResizeObserver(() => { if (cur && player) { drawStemWaves(); if (mapOpen()) { mapStatic = null; drawMap(player.position); } } }).observe(document.body);
window.__themeHook = () => { if (cur && player) { drawStemWaves(); mapStatic = null; } };

// ---- MP3 of the current mix (what you hear, at the original speed) ----
function loadScript(src) { return new Promise((res, rej) => { if (window.lamejs) return res(); const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('script')); document.head.append(sc); }); }
async function exportMp3() {
  if (!cur || !player) return;
  closePop(); busy(T('Preparo l\'MP3…'));
  try {
    await loadScript('lame.min.js');
    const st = await getStems(cur.id), n = st.n, L = new Int16Array(n), R = new Int16Array(n);
    const gains = STEMS.map(s => mapGain(s.id)), on = STEMS.filter((s, k) => gains[k]).map(s => s.id), f = await stemsF32(st, on);
    for (let i = 0; i < n; i++) { let l = 0, r = 0; STEMS.forEach((s, k) => { const g = gains[k]; if (g && f[s.id]) { l += f[s.id][0][i] * g; r += f[s.id][1][i] * g; } });
      L[i] = Math.max(-32767, Math.min(32767, l * 32767)); R[i] = Math.max(-32767, Math.min(32767, r * 32767)); }
    const enc = new lamejs.Mp3Encoder(2, SR, 192), parts = [];
    for (let i = 0; i < n; i += 1152) { const b = enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152)); if (b.length) parts.push(new Uint8Array(b)); if ((i & 0xfffff) === 0) await new Promise(r => setTimeout(r)); }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    const blob = new Blob(parts, { type: 'audio/mpeg' }), off = STEMS.filter(s => isOff(s.id)).map(s => s.n.toLowerCase());
    const name = (cur.name + (off.length ? ' - ' + T('senza {x}', { x: off.join(' ') }) : '')).replace(/[^\w\- àèéìòùáíóúñü]+/gi, '').trim() + '.mp3';
    busy();
    if (NATIVE) { // the Android app saves it and opens the share sheet (Drive, Files, WhatsApp…)
      const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      const w = await window.Capacitor.nativePromise('Filesystem', 'writeFile', { path: name, data: b64, directory: 'CACHE' });
      try { await window.Capacitor.nativePromise('Share', 'share', { title: name, files: [w.uri] }); } catch (e) { if (!/cancel/i.test(e && e.message || '')) throw e; }
    } else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    toast(T('MP3 pronto: {x}', { x: name }));
  } catch (e) { busy(); toast(T('MP3 non riuscito: {x}', { x: e && e.message || e })); }
}
$('mp3Btn').addEventListener('click', exportMp3);

// ---- training: the count disappears, the dancer taps ----
let training = null;
const PERFECT = 0.03; // a tap within 30 ms of the beat counts as perfect
const GAMES = {
  one: { n: T("Trova l'1"), target: T('Primo tempo'), desc: T("Ascolta e tocca solo sull'1 di ogni frase (ogni 8 tempi). Allena il riconoscimento del cambio di frase."), want: c => c === 1,
    pad: T("Tap sull'1"), help: T("Tocca esattamente sull'1"), help2: T('Segui il basso e i cambi di accordo'),
    tipT: T('Segui basso e accordi'), tip: T("Il basso e la chitarra cambiano accordo proprio sull'1: aspetta il cambio invece di anticiparlo con il corpo.") },
  beat: { n: T('A tempo'), target: '1-2-3-4-5-6-7-8', desc: T('Tocca su ogni tempo, come un passo. Ideale per sentire la pulsazione continua del brano.'), want: () => true,
    pad: T('Tocca ogni tempo'), help: T('Tocca su ogni tempo'), help2: T('Segui la güira: scandisce ogni tempo'),
    tipT: T('Segui la güira'), tip: T('La güira raspa su ogni tempo in modo regolare: se ti perdi, ascolta lei e lascia stare la voce.') },
  tap: { n: T('Il tap'), target: T('4 e 8'), desc: T("La firma della bachata: tocca solo sul 4 e sull'8, il momento del tap. Allena a non anticipare il piede."), want: c => c === 4 || c === 8,
    pad: T('Tap sul 4 e sull\'8'), help: T("Tocca sul 4 e sull'8"), help2: T('Senti il bongo che chiude la mezza frase'),
    tipT: T('Ascolta il bongo'), tip: T("Il tap cade sul 4 e sull'8: il bongo chiude ogni mezza frase con un colpo più marcato. Aspettalo, non anticiparlo.") } };
function trainStats() { const st = ls.get('trainStats', { best: {}, days: [] }); st.bestMs = st.bestMs || {}; return st; }
function trainOpts() { return Object.assign({ guide: 'bg', len: 4 }, ls.get('trainOpts', {})); }
function streakDays(st) { let n = 0; const d = new Date(); for (;;) { const k = d.toISOString().slice(0, 10); if (!st.days.includes(k)) break; n++; d.setDate(d.getDate() - 1); } return n; }
function showTrain(which) { ['trainMenu', 'trainPlay', 'trainDone'].forEach(id => { $(id).hidden = id !== which; }); $('train').scrollTop = 0; }
function renderTrainMenu() {
  const st = trainStats(), sd = streakDays(st), o = trainOpts();
  $('trainTitle').textContent = T('Allenati');
  $('trainTrack').textContent = cur.name; $('trainBpm').textContent = Math.round(cur.bpm) + ' BPM';
  $('streakBox').hidden = !sd; $('trainStreak').textContent = sd === 1 ? T('Ti sei allenato oggi') : T('{n} giorni di fila', { n: sd });
  $('games').innerHTML = Object.entries(GAMES).map(([k, g]) => `<button class="game" data-game="${k}">
    <span class="gh"><b>${g.n}</b><span class="rec">${T('Record')} ${st.best[k] != null ? st.best[k] + '%' : '–'}</span></span>
    <p>${g.desc}</p>
    <span class="c8">${[1, 2, 3, 4, 5, 6, 7, 8].map(c => `<i class="${g.want(c) ? 'on' : ''}">${c}</i>`).join('')}</span></button>`).join('');
  document.querySelectorAll('[data-guide]').forEach(b => b.classList.toggle('on', b.dataset.guide === o.guide));
  document.querySelectorAll('[data-len]').forEach(b => b.classList.toggle('on', +b.dataset.len === o.len));
}
function renderCal() { const o = tapOffset();
  $('calTxt').textContent = o == null ? T('Non calibrato: fallo anche con l\'altoparlante del telefono') : T('{n} ms · rifallo se cambi cuffie o casse', { n: Math.round(o * 1000) }); }
// Plays 16 clicks and measures how late the dancer's taps land on them: that delay is then
// taken off every tap in the exercises and in "L'1 è qui!".
async function calibrate() {
  const c = audioCtx(); await c.resume(); if (player && player.isPlaying) pausePlayer();
  const per = 0.6, N = 16, t0 = c.currentTime + 1, clicks = [], taps = [];
  for (let k = 0; k < N; k++) {
    const t = t0 + k * per, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = k % 4 === 0 ? 1600 : 1100; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.08); clicks.push(t);
  }
  const wrap = document.createElement('div'), p = textEl(T('Tocca il riquadro esattamente su ogni click, come se fosse il tempo. I primi 4 servono per prendere il ritmo.')); p.className = 'mute small';
  const pad = document.createElement('div'); pad.className = 'calpad'; pad.textContent = T('Tocca sul click');
  pad.addEventListener('pointerdown', e => { e.preventDefault(); taps.push(c.currentTime); pad.classList.add('flash'); setTimeout(() => pad.classList.remove('flash'), 90); vibrate(8); });
  wrap.append(p, pad);
  const timer = setTimeout(() => closeDialog('done'), (t0 - c.currentTime + N * per + 0.6) * 1000);
  const v = await dialog(T('Calibra il ritardo'), wrap, [[T('Annulla'), false]]); clearTimeout(timer);
  if (v !== 'done') return;
  const d = []; for (const t of taps) { let best = null; for (let k = 4; k < N; k++) { const x = t - clicks[k]; if (best == null || Math.abs(x) < Math.abs(best)) best = x; } if (best != null && Math.abs(best) < 0.35) d.push(best); }
  if (d.length < 6) return dialog(T('Calibrazione non riuscita'), textEl(T('Servono almeno 6 tocchi vicini ai click. Riprova con calma.')), [['OK', 0, true]]);
  d.sort((x, y) => x - y); const lat = c.outputLatency > 0 ? c.outputLatency : (c.baseLatency || 0);
  const off = Math.max(-0.1, Math.min(0.5, d[Math.floor(d.length / 2)] - lat));
  ls.set('tapOffset', off); renderCal(); toast(T('Ritardo misurato: {n} ms', { n: Math.round(off * 1000) }));
}
function openTraining() {
  if (!hasBeats()) return toast(T('Serve il ritmo: questo brano non ce l\'ha'));
  renderTrainMenu(); renderCal(); showTrain('trainMenu'); $('train').classList.add('on'); if (location.hash !== '#allenamento') location.hash = 'allenamento';
}
function closeTraining(fromNav) { stopTraining(); $('train').classList.remove('on'); if (!fromNav && location.hash === '#allenamento') history.back(); }
$('trainChange').addEventListener('click', async () => {
  const list = (await listProjects()).sort((a, b) => b.updated - a.updated); if (list.length < 2) return toast(T('Hai un solo progetto'));
  const box = document.createElement('div'); box.className = 'marklist';
  const v = await new Promise(res => { list.forEach(p => { const b = document.createElement('button'); b.innerHTML = `<span>${esc(p.name)}</span><span class="mute small">${fmt(p.dur)}</span>`; b.onclick = () => { closeDialog(p.id); }; box.append(b); });
    dialog(T('Scegli il brano'), box, [[T('Annulla'), null]]).then(res); });
  if (v && (!cur || v !== cur.id)) { closeTraining(); setTimeout(() => trainFromHome(v), 50); }
});
$('trainClose').addEventListener('click', () => (training || !$('trainMenu').hidden ? closeTraining() : (stopTraining(), renderTrainMenu(), showTrain('trainMenu'))));
$('trainBack').addEventListener('click', () => closeTraining());
$('calBtn').addEventListener('click', calibrate);
$('games').addEventListener('click', e => { const b = e.target.closest('[data-game]'); if (b) startTraining(b.dataset.game); });
document.querySelectorAll('[data-guide]').forEach(b => b.addEventListener('click', () => { ls.set('trainOpts', Object.assign(trainOpts(), { guide: b.dataset.guide })); renderTrainMenu(); }));
document.querySelectorAll('[data-len]').forEach(b => b.addEventListener('click', () => { ls.set('trainOpts', Object.assign(trainOpts(), { len: +b.dataset.len })); renderTrainMenu(); }));
$('tAgain').addEventListener('click', () => training && startTraining(training.game));
$('tBack').addEventListener('click', () => { stopTraining(); renderTrainMenu(); showTrain('trainMenu'); });
$('tToPlayer').addEventListener('click', () => closeTraining());
$('tRestart').addEventListener('click', () => training && startTraining(training.game));
$('tExit').addEventListener('click', () => { stopTraining(); renderTrainMenu(); showTrain('trainMenu'); });
$('tPause').addEventListener('click', async () => { const tr = training; if (!tr || tr.done) return;
  if (player.isPlaying) { player.pause(); tr.paused = true; } else { await audioCtx().resume(); player.play(); tr.paused = false; }
  $('tPause').textContent = tr.paused ? T('Riprendi') : T('Pausa'); setPlayIcon(); });
// During an exercise the guide mix goes straight to the player (the project keeps its own mix) and the click is off.
function trainingSound(on) {
  if (!player) return;
  if (!on) { applyGains(); applyMet(); return; }
  const o = trainOpts();
  if (o.guide !== 'mix') for (const s of STEMS) {
    const keep = o.guide === 'all' || s.id === 'bass' || s.id === 'guira' || (s.id === 'bongo' && cur.withGuira === false);
    player.setGain(s.id, keep ? 1 : 0);
  }
  player.setMetronome({ enabled: false, beats: Float64Array.from(cur.beats), accents: [], volume: 0 });
}
async function startTraining(game) {
  stopTraining(true);
  const g = GAMES[game], first = phraseStartIdx(0), all = Math.floor((phraseStartIdx(player.duration - 0.01) - first) / 8);
  const nPh = Math.max(1, Math.min(trainOpts().len, all)), lastStart = phraseStartIdx(player.duration - 0.01) - 8 * nPh;
  let ps = phraseStartIdx(player.position); if (ps > lastStart) ps = Math.max(first, lastStart); if (beatTime(ps) < 0) ps += 8;
  const startIdx = ps, endIdx = ps + 8 * nPh, pre = Math.max(0, beatTime(startIdx - 4));
  const targets = []; for (let i = startIdx; i < endIdx; i++) if (beatTime(i) <= player.duration && g.want(countOf(i))) targets.push({ i, t: beatTime(i), hit: null });
  training = { game, targets, nPh, startT: beatTime(startIdx), endT: Math.min(player.duration, beatTime(endIdx)), taps: 0, wrong: 0, errs: [], wasLoop: loopRange ? loopRange.slice() : null, ph: -1 };
  if (loopRange) { player.clearLoop(); loopRange = null; loopMode = null; updateLoopBtns(); }
  $('trainTitle').textContent = g.n;
  $('tGame').textContent = T('Gioco: {x}', { x: g.n }); $('tLeft').textContent = T('Preparati'); $('tHits').textContent = '0/' + targets.length; $('tErr').textContent = '–';
  $('tSegs').className = 'tsegs' + (nPh > 4 ? ' n8' : ''); $('tSegs').innerHTML = '<i></i>'.repeat(nPh);
  $('tPrep').textContent = T('4 tempi di preparazione: 5, 6, 7, 8…'); $('tWhat').textContent = g.pad; $('tMsg').textContent = T('Ascolta…');
  $('tHelp').textContent = g.help; $('tHelp2').textContent = T('Nessun numero sullo schermo') + ' · ' + g.help2;
  $('tLateTxt').textContent = T('Aspetta il primo tocco'); $('tLast').textContent = ''; $('tMark').style.display = 'none';
  $('tPause').textContent = T('Pausa');
  showTrain('trainPlay');
  await audioCtx().resume(); trainingSound(true); userSeekAt = performance.now(); player.seek(pre); if (!player.isPlaying) player.play(); setPlayIcon(); keepAwake();
}
function trainTick(t) {
  const tr = training; if (!tr || tr.done) return;
  if (t >= tr.startT - 0.05) {
    const k = Math.min(tr.nPh - 1, Math.floor((t - tr.startT) / ((tr.endT - tr.startT) / tr.nPh)));
    if (k !== tr.ph) { tr.ph = k; $('tLeft').textContent = T('Frase {a} di {b}', { a: k + 1, b: tr.nPh }); [...$('tSegs').children].forEach((x, j) => { x.className = j < k ? 'done' : j === k ? 'now' : ''; });
      if (k === 0) $('tPrep').textContent = T('Preparazione finita · registrazione dei tocchi attiva'); }
  }
  if (t >= tr.endT + 0.3 || !player.isPlaying && !tr.paused && t >= tr.endT - 0.1) finishTraining();
}
$('tpad').addEventListener('pointerdown', e => {
  e.preventDefault(); const tr = training; if (!tr || tr.done || !player.isPlaying) return;
  const t = player.position - (tapOffset() || 0); if (t < tr.startT - 0.3) return;
  tr.taps++;
  const per = 60 / cur.bpm, i = nearestBeat(t), dt = t - beatTime(i), target = tr.targets.find(x => x.i === i);
  const pad = $('tpad'); pad.classList.remove('hit', 'miss'); void pad.offsetWidth;
  if (target && !target.hit && Math.abs(dt) < per * 0.3) {
    target.hit = dt; tr.errs.push(dt * 1000); pad.classList.add('hit');
    const ms = Math.round(dt * 1000), ok = Math.abs(dt) <= PERFECT;
    $('tMsg').textContent = ok ? T('Perfetto!') : dt < 0 ? T('In anticipo') : T('In ritardo');
    $('tLateTxt').textContent = ok ? T('A tempo') : dt < 0 ? T('In anticipo di {n} ms', { n: -ms }) : T('In ritardo di {n} ms', { n: ms });
    $('tMark').style.display = 'block'; $('tMark').style.left = (50 + Math.max(-150, Math.min(150, ms)) / 3) + '%';
    $('tLast').textContent = T('Ultimo tocco sul {c}', { c: countOf(i) });
  } else {
    tr.wrong++; pad.classList.add('miss'); const ms = Math.round(dt * 1000);
    if (target && target.hit) $('tMsg').textContent = T('Già preso');
    else if (target) { // right count, too far from it: say how far, so a late tap on the 1 is not reported as "not the 1"
      const ci = countOf(i); $('tMsg').textContent = T(dt < 0 ? 'Era {n}, ma troppo presto' : 'Era {n}, ma troppo tardi', { n: countName(ci) });
      $('tLateTxt').textContent = dt < 0 ? T('In anticipo di {n} ms', { n: -ms }) : T('In ritardo di {n} ms', { n: ms });
      $('tMark').style.display = 'block'; $('tMark').style.left = (50 + Math.max(-150, Math.min(150, ms)) / 3) + '%';
    } else { const ci = countOf(i); $('tMsg').textContent = T('Quello era {n}', { n: countName(ci) }); }
  }
  const h = tr.targets.filter(x => x.hit != null).length; $('tHits').textContent = h + '/' + tr.targets.length;
  if (tr.errs.length) $('tErr').textContent = Math.round(tr.errs.reduce((a, b) => a + Math.abs(b), 0) / tr.errs.length);
  vibrate(10);
});
function finishTraining() {
  const tr = training; if (!tr || tr.done) return; tr.done = true;
  player.pause(); setPlayIcon(); trainingSound(false);
  const n = tr.targets.length, h = tr.targets.filter(x => x.hit != null).length, E = tr.errs;
  const meanAbs = E.length ? E.reduce((a, b) => a + Math.abs(b), 0) / E.length : 0, bias = E.length ? E.reduce((a, b) => a + b, 0) / E.length : 0;
  const score = Math.max(0, Math.round(100 * (h - tr.wrong * 0.5) / Math.max(1, n)));
  const st = trainStats(); const today = new Date().toISOString().slice(0, 10);
  if (!st.days.includes(today)) st.days.push(today); st.days = st.days.slice(-60);
  const best = st.best[tr.game] == null || score > st.best[tr.game]; if (best) st.best[tr.game] = score;
  if (E.length && (st.bestMs[tr.game] == null || Math.round(meanAbs) < st.bestMs[tr.game])) st.bestMs[tr.game] = Math.round(meanAbs);
  ls.set('trainStats', st);
  $('trainTitle').textContent = T('Risultato');
  $('tRecord').hidden = !(best && score > 0);
  $('tRing').style.strokeDashoffset = (452.4 * (1 - score / 100)).toFixed(1); $('tScore').textContent = score + '%';
  $('tResTitle').textContent = score >= 85 ? T('Ritmo eccellente') : score >= 60 ? T('Bene, ci sei quasi') : T('Riproviamo, ascolta ancora');
  $('tHitsR').innerHTML = `${h}/${n} <small>(${Math.round(100 * h / Math.max(1, n))}%)</small>`; $('tHitsBar').style.width = (100 * h / Math.max(1, n)) + '%';
  $('tPrec').innerHTML = E.length ? `±${Math.round(meanAbs)} <small>ms</small>` : '–'; $('tPrecBar').style.width = (E.length ? Math.max(4, 100 - meanAbs / 1.5) : 0) + '%';
  const early = E.filter(x => x < -PERFECT * 1000).length, late = E.filter(x => x > PERFECT * 1000).length, ok = E.length - early - late;
  const pc = v => E.length ? Math.round(100 * v / E.length) : 0;
  $('tDist').innerHTML = `<span class="small mute">${T('Distribuzione dei tocchi · {n} a segno', { n: E.length })}</span>` + [[T('Anticipo'), early, 'var(--tap)'], [T('Perfetto (±30 ms)'), ok, 'var(--acc)'], [T('Ritardo'), late, 'var(--c-vocals)']]
    .map(([l, v, c]) => `<div class="row"><span>${l}</span><span>${pc(v)}% (${v})</span></div><div class="db" style="--dc:${c}"><i style="width:${pc(v)}%"></i></div>`).join('');
  $('tTrend').innerHTML = E.length >= 3 && Math.abs(bias) > 25 ? `<b>${bias < 0 ? T('Tendi ad arrivare in anticipo') : T('Tendi ad arrivare in ritardo')}</b><p class="small" style="margin-top:4px">${T('Nel {p}% dei tocchi, in media di {n} ms.', { p: pc(bias < 0 ? early : late), n: Math.round(Math.abs(bias)) })} ${bias < 0 ? T('Aspetta un attimo di più.') : T('Anticipa leggermente.')}${bias > 60 && tapOffset() == null ? ' ' + T('Prova "Calibra": parte del ritardo può essere dell\'audio del telefono.') : ''}</p>`
    : E.length >= 3 ? `<b>${T('Sei centrato')}</b><p class="small" style="margin-top:4px">${T('Né in anticipo né in ritardo.')}${tr.wrong ? ' ' + T('Tocchi fuori bersaglio: {n}.', { n: tr.wrong }) : ''}</p>` : '';
  $('tTipT').textContent = GAMES[tr.game].tipT; $('tResTip').textContent = GAMES[tr.game].tip + (tr.wrong && !(E.length >= 3 && Math.abs(bias) <= 25) ? ' ' + T('Tocchi fuori bersaglio: {n}.', { n: tr.wrong }) : '');
  showTrain('trainDone');
}
function stopTraining(keepOpen) {
  const tr = training; if (!tr) return; training = null;
  if (player && player.isPlaying) { player.pause(); setPlayIcon(); }
  trainingSound(false);
  if (tr.wasLoop && !keepOpen && player) { setLoop(tr.wasLoop[0], tr.wasLoop[1]); loopMode = 'ab'; updateLoopBtns(); }
}


// ---------- lyrics: LRCLIB first, Whisper on the vocal stem as a fallback, Opus-MT for the translation ----------
const LANGS = { it: T('italiano'), en: T('inglese'), es: T('spagnolo'), fr: T('francese'), de: T('tedesco'), pt: T('portoghese') };
// target language of the lyrics translation: the user's choice if saved, otherwise the app language
const trTarget = () => ls.get('trLang', I18N.lang);
const STOP = {
  es: 'de la que el en y los se del las un por con no una su para es al lo como más pero sus le ya me mi tu te yo amor quiero corazón eres estoy sin cuando porque todo',
  en: 'the and to of in is you that it i me my your love be on with for don\'t can just baby what know when all',
  pt: 'de que não o e é um uma do da em você eu meu minha com para ao seu sua amor coração tá não sem quando',
  it: 'di che non il la e è un una per con mi ti io sei amore cuore ma come anche tutto quando perché',
  fr: 'de la le et les des que je tu pas un une est il elle mon ma ton toi moi pour avec amour coeur'
};
const STOPSET = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
function detectLang(text) {
  const words = text.toLowerCase().match(/[a-zà-öø-ÿñ']+/g) || [], score = {};
  for (const k in STOPSET) score[k] = 0;
  for (const w of words) for (const k in STOPSET) if (STOPSET[k].has(w)) score[k]++;
  // a few letters that only one language uses
  if (/ñ|¿|¡/.test(text)) score.es += 3; if (/ã|õ|ç/.test(text)) score.pt += 3; if (/\bthe\b/i.test(text)) score.en += 2;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}
let lyrW = null, lyrJob = 0, lyrCb = {}, lyrIdx = -2, lyrEls = [], lyrUser = 0, lyrBusy = false;
const mbs = v => Math.round(v / 1e6) + ' MB';
// The status line belongs to the project the running job works on (a transcription keeps going
// when you open another project), so it shows only there.
let lyrFor = null, lyrSt = null;
function lyrStatus(text, frac) { lyrSt = text ? { text, frac } : null; paintLyrStatus(); }
function paintLyrStatus() {
  const show = !!lyrSt && !!cur && (!lyrFor || cur.id === lyrFor);
  $('lyrStat').hidden = !show; $('lyrAsr').disabled = lyrBusy;
  if (!show) return;
  $('lyrStatT').textContent = lyrSt.text; const b = $('lyrBar'), frac = lyrSt.frac;
  b.style.width = frac == null ? '100%' : Math.round(Math.max(0.03, frac) * 100) + '%'; b.style.opacity = frac == null ? 0.35 : 1;
}
// Applies a change to a project whether it is open or not (the job may end after you left it).
async function updateProject(pid, fn) {
  if (cur && cur.id === pid) { fn(cur); persist(); renderLyrics(); return; }
  try { const p = await getProject(pid); if (p) { fn(p); await putProject(p); } } catch (e) {}
}
// Whisper ships inside the Android app: then every new project is transcribed right after the separation.
let asrLocal = null;
async function hasLocalAsr() {
  if (asrLocal == null) { try { asrLocal = (await fetch('asr/whisper-base/config.json')).ok; } catch (e) { asrLocal = false; } }
  return asrLocal;
}
function lyrWorker() {
  if (lyrW) return lyrW;
  lyrW = new Worker('lyricsworker.js?v=5', { type: 'module' });
  lyrW.onmessage = e => { const m = e.data;
    if (m.type === 'progress') lyrStatus((m.stage === 'asr' ? (asrLocal ? T('Carico Whisper') : T('Scarico Whisper')) : T('Scarico il traduttore')) + ' · ' + T('{a} di {b}', { a: mbs(m.loaded), b: mbs(m.total) }), m.loaded / m.total);
    else if (m.type === 'stage') lyrStatus(T('Riconosco la lingua e trascrivo la voce…'), null);
    else if (m.type === 'trstep') lyrStatus(T('Traduco… {a} di {b} righe', { a: m.done, b: m.total }), m.done / m.total);
    else { const cb = lyrCb[m.id]; delete lyrCb[m.id]; if (cb) m.type === 'error' ? cb.rej(new Error(m.msg)) : cb.res(m); } };
  lyrW.onerror = e => { for (const k in lyrCb) lyrCb[k].rej(new Error(e.message || T('errore del modello'))); lyrCb = {}; lyrW = null; };
  return lyrW;
}
function lyrCall(msg, transfer) { const id = ++lyrJob; return new Promise((res, rej) => { lyrCb[id] = { res, rej }; lyrWorker().postMessage(Object.assign({ id }, msg), transfer || []); }); }
const netMsg = e => /fetch|network|load|import|Failed/i.test(e && e.message || '') ? T('serve Internet la prima volta') + (NATIVE ? '' : ' ' + T('(nella versione web dentro Claude è bloccato: usa l\'app Android)')) : (e && e.message || String(e));

// "JENSEN FRIO (Official Video)" -> "JENSEN FRIO": video and file names carry words that spoil the search
function cleanTitle(n) {
  return String(n || '').replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(official|oficial|video|v[ií]deo|lyrics?|letra|audio|hd|4k|remaster(ed)?|en vivo|live)\b/gi, ' ')
    .replace(/[_|]+/g, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
}
function parseLrc(s) {
  const out = [];
  for (const line of String(s || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]; if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const t of tags) out.push({ t: +t[1] * 60 + parseFloat(t[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
let lyrResults = [];
async function lyrSearch() {
  const q = $('lyrQ').value.trim(); if (!q || !cur) return;
  $('lyrRes').innerHTML = '<p class="small mute">' + T('Cerco…') + '</p>';
  let list;
  try { const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q)); if (!r.ok) throw new Error('HTTP ' + r.status); list = await r.json(); }
  catch (e) { $('lyrRes').innerHTML = `<p class="small mute">${esc(T('Ricerca non riuscita: {x}.', { x: netMsg(e) }))}</p>`; return; }
  const sd = cur.srcDur || 0;
  lyrResults = list.filter(x => !x.instrumental && (x.syncedLyrics || x.plainLyrics))
    .sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || (sd ? Math.abs(a.duration - sd) - Math.abs(b.duration - sd) : 0)).slice(0, 6);
  if (!lyrResults.length) { $('lyrRes').innerHTML = '<p class="small mute">' + T('Nessun testo trovato. Prova con titolo e artista, oppure trascrivi la voce.') + '</p>'; return; }
  $('lyrRes').innerHTML = lyrResults.map((x, i) => `<button data-li="${i}"${x.syncedLyrics ? '' : ' disabled'}><span class="rn"><b>${esc(x.trackName)}</b><span class="small mute">${esc(x.artistName)} · ${fmt(x.duration)}</span></span><span class="small ${x.syncedLyrics ? '' : 'mute'}">${x.syncedLyrics ? T('con i tempi') : T('senza tempi')}</span></button>`).join('');
}
// Stops a running Whisper or translation job: its result would overwrite the text just chosen.
let lyrCancelled = false;
function lyrCancel() {
  if (!lyrBusy) return;
  lyrCancelled = true;
  if (lyrW) { lyrW.terminate(); lyrW = null; }
  for (const k in lyrCb) lyrCb[k].rej(new Error('annullato')); lyrCb = {};
  lyrBusy = false; lyrFor = null; lyrStatus();
}
// LRCLIB times belong to the published recording: a video with an intro or another edit starts them in
// the wrong place. This finds the shift that puts the line starts on the voice onsets of the separated
// vocals (it slides the lyrics up to ±40 s and keeps the shift that matches clearly better than any other).
function alignShift(env, rate, times, dur, range = 40) {
  const n = env.length, E = new Float64Array(n + 1); for (let i = 0; i < n; i++) E[i + 1] = E[i] + env[i];
  const avg = (a, b) => { a = Math.max(0, Math.round(a * rate)); b = Math.min(n, Math.round(b * rate)); return b > a ? (E[b] - E[a]) / (b - a) : 0; };
  const res = [];
  for (let s = -range; s <= range + 1e-9; s += 0.05) {
    let sc = 0, k = 0;
    for (let i = 0; i < times.length; i++) { const u = times[i] + s; if (u < 0.5 || u > dur - 1) continue;
      const nx = i + 1 < times.length ? Math.min(times[i + 1] + s, u + 4) : u + 3;
      sc += (avg(u, u + 0.8) - avg(u - 0.7, u - 0.05)) + 0.5 * avg(u, nx); k++; }
    res.push([s, k >= 4 ? sc / k : -1, k]);
  }
  const best = res.reduce((a, b) => b[1] > a[1] ? b : a);
  // confidence: how much the best beats the best rival at least 1.5 s away
  const rival = res.filter(r => Math.abs(r[0] - best[0]) >= 1.5).reduce((a, b) => b[1] > a[1] ? b : a, [0, -1]);
  return { shift: +best[0].toFixed(2), margin: best[1] - rival[1], rival: +rival[0].toFixed(2), lines: best[2] };
}
function autoAlign(L, quiet) {
  const env = cur.env && cur.env.vocals; if (!env || !env.length) return false;
  const times = L.lines.filter(l => l.text).map(l => l.t), r = alignShift(env, cur.envRate || 10, times, cur.dur);
  if (r.lines < 4 || r.margin < 0.04) { if (!quiet) toast(T('Non riesco ad allinearlo da solo: usa «{x}»', { x: T('Questa riga inizia adesso') })); return false; }
  const sh = Math.abs(r.shift) > 0.5 ? r.shift : 0;
  if (sh !== (L.shift || 0)) { L.shift = sh; toast(sh ? T('Testo allineato alla voce ({n} s)', { n: (sh > 0 ? '+' : '') + dec(sh.toFixed(1)) }) : T('Testo allineato alla voce')); }
  else if (!quiet) toast(T('Il testo era già allineato'));
  return true;
}
function pickLyrics(x) {
  lyrCancel();
  const off = cur.offset || 0, dur = cur.dur;
  const lines = parseLrc(x.syncedLyrics).map(l => ({ t: +(l.t - off).toFixed(2), text: l.text })).filter(l => l.t > -1.5 && l.t < dur + 0.5);
  if (!lines.some(l => l.text)) { toast(T('Nella parte che hai ritagliato questo testo non ha righe cantate')); return; }
  setLyrics({ src: 'LRCLIB', title: x.trackName + ' · ' + x.artistName, lines, lang: detectLang(lines.map(l => l.text).join(' ')) });
  if (autoAlign(cur.lyrics, true)) { persist(); renderLyrics(); }
}
async function lyrTranscribe(pid, auto) {
  pid = pid || (cur && cur.id); if (!pid || lyrBusy) return; lyrBusy = true; lyrFor = pid; lyrCancelled = false;
  try {
    lyrStatus(T('Preparo la voce…'), null);
    const st = await getStems(pid), [L, R] = (await stemsF32(st, ['vocals'])).vocals, n = L.length;
    const buf = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: SR }), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (L[i] + R[i]) * 0.5;
    const oc = new OfflineAudioContext(1, Math.ceil(n * 16000 / SR), 16000), bs = oc.createBufferSource();
    bs.buffer = buf; bs.connect(oc.destination); bs.start();
    const audio = (await oc.startRendering()).getChannelData(0).slice();
    lyrStatus(asrLocal ? T('Carico Whisper…') : T('Preparo Whisper…'), null);
    const r = await lyrCall({ type: 'asr', audio }, [audio.buffer]);
    const bad = /subt[ií]tul|amara\.org|gracias por ver|suscr[ií]b|thanks for watching|^[\s♪.…-]*$/i;
    let lines = [];
    for (const c of r.chunks) {
      const text = String(c.text || '').trim(), t = c.timestamp && c.timestamp[0], e = c.timestamp && c.timestamp[1];
      if (t == null || text.length < 2 || bad.test(text)) continue;
      const k = lines.length; if (k >= 2 && lines[k - 1].text === text && lines[k - 2].text === text) continue; // stuck on a loop
      lines.push({ t: +t.toFixed(2), e, text });
    }
    // Whisper often returns several sung lines in one piece: split at the punctuation and share the
    // time by the length of each part, so the lit line follows the singer
    lines = lines.flatMap((l, i) => {
      if (l.text.length <= 55) return [l];
      let parts = l.text.split(/(?<=[,.;:!?¡¿])\s+/).map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) { // no punctuation: cut at the spaces into pieces of about 40 characters
        const w = l.text.split(/\s+/), k = Math.ceil(l.text.length / 40), per = Math.ceil(w.length / k); parts = [];
        for (let i = 0; i < w.length; i += per) parts.push(w.slice(i, i + per).join(' '));
      }
      if (parts.length < 2) return [l];
      const end = l.e != null ? l.e : (lines[i + 1] ? lines[i + 1].t : l.t + parts.length * 2.5), total = parts.reduce((a, x) => a + x.length, 0);
      let acc = 0;
      return parts.map((x, k) => { const t0 = l.t + (end - l.t) * acc / total; acc += x.length; return { t: +t0.toFixed(2), e: k === parts.length - 1 ? l.e : null, text: x }; });
    });
    if (!lines.length) throw new Error(T('nella voce separata non ho sentito parole'));
    const withGaps = []; // an empty line ends a sung line when a long pause follows
    lines.forEach((l, i) => { withGaps.push({ t: l.t, text: l.text }); const nx = lines[i + 1]; if (l.e != null && (!nx || nx.t - l.e > 2)) withGaps.push({ t: +l.e.toFixed(2), text: '' }); });
    lyrBusy = false; lyrStatus();
    const lang = r.lang || detectLang(r.text || lines.map(l => l.text).join(' '));
    if (lyrCancelled) return;
    await updateProject(pid, p => { p.lyrics = { src: 'Whisper', title: 'Trascrizione della voce', lang, shift: 0, trLang: null, lines: withGaps }; });
  } catch (e) { if (lyrCancelled) return; lyrStatus(); toast(T('Trascrizione non riuscita: {x}', { x: netMsg(e) })); console.warn('asr', e); }
  finally { if (!lyrCancelled) { lyrBusy = false; lyrFor = null; } paintLyrStatus(); }
}
// The translation is never automatic: the "Traduci" button starts it.
function setLyrics(L) {
  cur.lyrics = { src: L.src, title: L.title, lang: L.lang, shift: 0, trLang: null, lines: L.lines };
  persist(); renderLyrics();
}
async function lyrTranslate() {
  const L = cur && cur.lyrics, tgt = trTarget(); if (!L || lyrBusy) return;
  if (!tgt) return toast(T('Traduzione spenta nelle Impostazioni'));
  if (!L.lang) return toast(T('Non riesco a capire la lingua del testo'));
  if (L.lang === tgt) return toast(T('Il testo è già in {x}', { x: LANGS[tgt] }));
  lyrBusy = true; const pid = cur.id; lyrFor = pid; lyrCancelled = false;
  try {
    lyrStatus(T('Preparo il traduttore…'), null);
    const idx = L.lines.map((l, i) => l.text ? i : -1).filter(i => i >= 0);
    const r = await lyrCall({ type: 'tr', src: L.lang, tgt, lines: idx.map(i => L.lines[i].text) });
    ls.set('lyrShowTr', true); lyrBusy = false; lyrStatus();
    await updateProject(pid, p => { const P = p.lyrics; if (!P || P.lines.length !== L.lines.length) return; idx.forEach((i, k) => { P.lines[i].tr = r.out[k]; }); P.trLang = tgt; });
  } catch (e) { if (lyrCancelled) return; lyrStatus(); toast(T('Traduzione non riuscita: {x}', { x: netMsg(e) })); }
  finally { lyrBusy = false; lyrFor = null; paintLyrStatus(); }
}
function renderLyrics() {
  if (!cur) return;
  const L = cur.lyrics, has = !!(L && L.lines && L.lines.length);
  $('lyrFind').hidden = has; $('lyrTools').hidden = !has; $('lyrHint').hidden = !has;
  lyrIdx = -2; lyrEls = []; paintLyrStatus();
  if (!has) { $('lyr').innerHTML = ''; if (!$('lyrQ').value) $('lyrQ').value = cleanTitle(cur.name); return; }
  const tgt = trTarget(), showTr = ls.get('lyrShowTr', true) && L.trLang === tgt;
  $('lyrSrc').textContent = L.src + (L.lang ? ' · ' + LANGS[L.lang] : '') + (L.shift ? ' · ' + T('spostato {n} s', { n: (L.shift > 0 ? '+' : '') + dec(L.shift.toFixed(1)) }) : '');
  const can = tgt && L.lang && L.lang !== tgt;
  $('lyrTr').hidden = !can; $('lyrTr').classList.toggle('on', showTr);
  $('lyrTr').textContent = L.trLang === tgt ? T('Traduzione') : T('Traduci in {x}', { x: LANGS[tgt] });
  $('lyr').innerHTML = L.lines.map((l, i) => l.text ? `<p data-i="${i}">${esc(l.text)}${showTr && l.tr ? `<span class="tr">${esc(l.tr)}</span>` : ''}</p>` : '').join('');
  for (const p of $('lyr').children) lyrEls[+p.dataset.i] = p;
  if (player) lyricsTick(player.position, true);
}
lyricsTick = (t, force) => {
  const L = cur && cur.lyrics; if (!L || !L.lines || $('mapPaneT').hidden || !mapOpen()) return;
  const s = L.shift || 0; let i = -1;
  for (let k = 0; k < L.lines.length; k++) { if (L.lines[k].t + s <= t + 0.05) i = k; else break; }
  if (i >= 0 && !L.lines[i].text) i = -1;
  if (i === lyrIdx && !force) return; lyrIdx = i;
  lyrEls.forEach((p, k) => { if (!p) return; p.classList.toggle('now', k === i); p.classList.toggle('past', i >= 0 ? k < i : (L.lines[k].t + s < t)); });
  const el = lyrEls[i] || lyrEls.find((p, k) => p && L.lines[k].t + s > t);
  if (el && performance.now() - lyrUser > 2500) { const pane = $('mapPaneT'), top = el.offsetTop - pane.clientHeight * 0.32; pane.scrollTo({ top, behavior: force ? 'auto' : 'smooth' }); }
};
window.openLyrics = renderLyrics;
async function lyrLineMenu(i) {
  const L = cur.lyrics, l = L.lines[i]; if (!l || !player) return;
  const v = await dialog(l.text, null, [[T('Questa riga inizia adesso'), 'all'], [T('Sposta solo questa riga qui'), 'one'], [T('Correggi il testo'), 'edit'], [T('Elimina la riga'), 'del'], [T('Chiudi'), null, true]]);
  const now = player.position;
  if (v === 'all') { L.shift = +(now - l.t).toFixed(2); toast(T('Testo allineato')); }
  else if (v === 'one') { l.t = +(now - (L.shift || 0)).toFixed(2); L.lines.sort((a, b) => a.t - b.t); }
  else if (v === 'edit') {
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = l.text; inp.maxLength = 160;
    const ok = await dialog(T('Correggi la riga'), inp, [[T('Annulla'), false], [T('Salva'), true, true]]);
    if (!ok || !inp.value.trim()) return; if (inp.value.trim() !== l.text) { l.text = inp.value.trim(); delete l.tr; }
  } else if (v === 'del') L.lines.splice(i, 1);
  else return;
  persist(); renderLyrics();
}
async function lyrMoreMenu() {
  const L = cur && cur.lyrics; if (!L) return;
  const v = await dialog(T(L.title || 'Testo'), null, [[T('Allinea alla voce'), 'align'], [T('Anticipa il testo di 0,5 s'), -0.5], [T('Ritarda il testo di 0,5 s'), 0.5], [T('Traduci di nuovo'), 'tr'], [T('Cerca un altro testo'), 'new'], [T('Genera con Whisper'), 'asr'], [T('Chiudi'), null, true]]);
  if (typeof v === 'number') { L.shift = +((L.shift || 0) + v).toFixed(2); persist(); renderLyrics(); }
  else if (v === 'tr') { L.trLang = null; lyrTranslate(); }
  else if (v === 'align') { if (autoAlign(L, false)) { persist(); renderLyrics(); } }
  else if (v === 'asr') { if (await dialog(T('Generare il testo con Whisper?'), textEl(T('Whisper ascolta la voce separata e scrive il testo con i tempi. Sostituisce il testo attuale.')), [[T('Annulla'), false], [T('Genera'), true, true]])) lyrTranscribe(); }
  else if (v === 'new') { if (await dialog(T('Cercare un altro testo?'), textEl(T('Il testo attuale e le tue correzioni vengono tolti.')), [[T('Annulla'), false], [T('Cerca'), true, true]])) { cur.lyrics = null; persist(); $('lyrRes').innerHTML = ''; renderLyrics(); } }
}
(function lyricsInput() {
  $('lyrSearch').addEventListener('click', lyrSearch);
  $('lyrQ').addEventListener('keydown', e => { if (e.key === 'Enter') lyrSearch(); });
  $('lyrRes').addEventListener('click', e => { const b = e.target.closest('[data-li]'); if (b && !b.disabled) pickLyrics(lyrResults[+b.dataset.li]); });
  $('lyrAsr').addEventListener('click', () => lyrTranscribe());
  $('lyrTr').addEventListener('click', () => { const L = cur && cur.lyrics; if (!L) return;
    if (L.trLang !== trTarget()) return lyrTranslate();
    ls.set('lyrShowTr', !ls.get('lyrShowTr', true)); renderLyrics(); });
  $('lyrMore').addEventListener('click', lyrMoreMenu);
  const pane = $('mapPaneT'), mark = () => { lyrUser = performance.now(); };
  pane.addEventListener('touchmove', mark, { passive: true }); pane.addEventListener('wheel', mark, { passive: true });
  let lp = 0, fired = false;
  $('lyr').addEventListener('pointerdown', e => { const p = e.target.closest('[data-i]'); if (!p) return; fired = false; clearTimeout(lp);
    lp = setTimeout(() => { fired = true; vibrate(15); lyrLineMenu(+p.dataset.i); }, 500); });
  const stop = () => clearTimeout(lp);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => $('lyr').addEventListener(k, stop));
  $('lyr').addEventListener('pointermove', e => { if (Math.abs(e.movementY) > 2) stop(); });
  $('lyr').addEventListener('contextmenu', e => e.preventDefault());
  $('lyr').addEventListener('click', e => { const p = e.target.closest('[data-i]'); if (!p || fired) { fired = false; return; }
    const L = cur.lyrics, l = L.lines[+p.dataset.i]; lyrUser = 0; seekTo(Math.max(0, l.t + (L.shift || 0)), false); });
  $('trLang').addEventListener('change', e => { ls.set('trLang', e.target.value); toast(e.target.value ? T('Traduzione in {x}', { x: LANGS[e.target.value] }) : T('Traduzione spenta')); });
})();

// ---------- Android back (button and edge swipe) ----------
// Without a listener Android closes the app at once. Here back walks the app like the browser does:
// dialog, popup, full screen, training, map, then the screen before; on the home it puts the app
// in the background instead of closing it.
if (NATIVE && window.Capacitor.addListener) {
  try {
    window.Capacitor.addListener('App', 'backButton', () => {
      if (dlgResolve) return closeDialog(false);
      if (location.hash) return history.back();
      if (!$('s-home').classList.contains('on')) return go('home');
      window.Capacitor.nativePromise('App', 'minimizeApp').catch(() => window.Capacitor.nativePromise('App', 'exitApp').catch(() => {}));
    });
  } catch (e) {}
}

// ---------- start ----------
if (location.hash) history.replaceState(null, '', location.pathname);
applyTheme();
let reopen = null; try { reopen = sessionStorage.getItem('reopen'); sessionStorage.removeItem('reopen'); } catch (e) {}
renderHome().then(() => { show('home'); if (reopen === 'set') openSettings(); });
}
