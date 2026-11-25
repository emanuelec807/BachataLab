/* Bachata Lab: UI logic. Uses StemPlayer (player.js), BeatTracker (beats.js) and worker.js. */
/* global StemPlayer, BeatTracker, Separator */
{
const $ = id => document.getElementById(id);
const STEMS = [
  { id: 'vocals', n: 'Voce', d: '' },
  { id: 'guitar', n: 'Chitarra', d: 'requinto + ritmica' },
  { id: 'bass', n: 'Basso', d: '' },
  { id: 'bongo', n: 'Bongo', d: '+ cencerro, altre perc.' },
  { id: 'guira', n: 'Güira', d: '' },
  { id: 'altro', n: 'Altro', d: 'synth, archi, piano' },
];
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
const MARK_NAMES = ['Intro', 'Derecho', 'Majao', 'Mambo', 'Break', 'Finale'];
const SR = 44100, MAX_REGION = 180, MAX_FILE = 350e6, TAP_LAG = 0.15;
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
function toF32(a) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] / 32767; return o; }

// ---------- navigation ----------
// History stays short: home ('') -> one screen (#nuovo, #elabora or #player) -> overlays (#mixer, #schermo).
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
  if (h !== 'mixer' && $('sheet').classList.contains('on')) { closeSheet(true); return; }
  if (h !== 'schermo' && $('stage').classList.contains('fs')) { exitFs(true); return; }
  if (h !== 'allenamento' && $('train').classList.contains('on')) { closeTraining(true); return; }
  if (procRunning && h !== 'elabora') {
    history.pushState(null, '', '#elabora');
    if (await dialog('Annullare la separazione?', textEl('Se esci adesso perdi il lavoro fatto finora.'), [['Continua', false, true], ['Esci', true]])) cancelProcessing();
    return;
  }
  if (!h && !$('s-home').classList.contains('on')) go('home');
});
window.addEventListener('beforeunload', e => { if (procRunning) { e.preventDefault(); e.returnValue = ''; } });

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
const SICON = { vocals: 'vocals', guitar: 'guitar', bass: 'bass', bongo: 'bongo', guira: 'guira', altro: 'altro' };
const sico = (id, cls) => `<svg class="i${cls ? ' ' + cls : ''}"><use href="#s-${SICON[id]}"/></svg>`;
function whenTxt(ts) {
  const d = new Date(ts), now = new Date(), day = 864e5, hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= d0) return 'Oggi, ' + hm; if (ts >= d0 - day) return 'Ieri, ' + hm;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
// One line on the card that says how the project was left: who is solo, who is off, which preset.
function mixStatus(p) {
  const name = id => (STEMS.find(s => s.id === id) || {}).n;
  const solo = STEMS.filter(s => p.solo && p.solo[s.id]).map(s => s.n);
  if (solo.length) return ['Solo ' + solo.join(' + '), 'var(--am)'];
  const off = STEMS.filter(s => (p.mute && p.mute[s.id]) || (p.gains && p.gains[s.id] === 0)).map(s => s.id);
  if (off.length) return [(off.length === 1 ? name(off[0]) + ' spenta' : off.map(name).join(', ') + ' spenti').replace('Basso spenta', 'Basso spento').replace('Bongo spenta', 'Bongo spento'), 'var(--bad)'];
  if (p.preset > 0 && PRESETS[p.preset]) return ['Preset ' + PRESETS[p.preset].n, 'var(--cy)'];
  return [(p.withGuira === false ? '5' : '6') + ' strumenti · mix completo', 'var(--cy)'];
}
async function renderHome() {
  let list = [];
  try { list = await listProjects(); } catch (e) { $('projects').innerHTML = '<p class="warn">Questo browser non permette di salvare i progetti (forse è in modalità privata).</p>'; return; }
  homeList = list.slice().sort((a, b) => b.updated - a.updated);
  if (homeSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'it')); else list.sort((a, b) => b.updated - a.updated);
  $('sortBtn').textContent = homeSort === 'name' ? 'A–Z' : 'RECENTI'; $('sortBtn').hidden = list.length < 2;
  $('searchBox').hidden = list.length < 3;
  const q = ($('q').value || '').trim().toLowerCase();
  const nA = list.filter(p => p.kind !== 'video').length, nV = list.length - nA;
  $('filters').innerHTML = nA && nV ? [['all', 'Tutti', list.length], ['video', 'Video', nV], ['audio', 'Audio', nA]]
    .map(([k, l, n]) => `<button data-f="${k}" class="${homeFilter === k ? 'on' : ''}">${l} (${n})</button>`).join('') : '';
  $('guide').hidden = list.length > 2;
  $('projHead').hidden = !list.length; $('projCount').textContent = list.length + (list.length === 1 ? ' brano' : ' brani');
  $('navLast').disabled = $('navTrain').disabled = !list.length;
  const shown = list.filter(p => (homeFilter === 'all' || (homeFilter === 'video') === (p.kind === 'video')) && (!q || p.name.toLowerCase().includes(q)));
  $('projects').innerHTML = !list.length ? '' : shown.map(p => {
    const [st, sc] = mixStatus(p), n = p.withGuira === false ? 5 : 6, mk = p.marks && p.marks.length ? p.marks[0] : null;
    return `<article class="proj" data-id="${esc(p.id)}" role="button" tabindex="0">
      <div class="top"><div class="thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ico(p.kind === 'video' ? 'video' : 'target')}<span class="tag badge">${p.kind === 'video' ? 'Video' : 'Audio'}</span><span class="dur">${fmt(p.dur)}</span></div>
        <div class="pi"><div class="pt"><b>${esc(p.name)}</b><button class="icon" data-menu="${esc(p.id)}" aria-label="Opzioni">${ico('more')}</button></div>
          <div class="meta">${p.bpm ? `<span class="b">${Math.round(p.bpm)} BPM</span>` : '<span class="b">ritmo ?</span>'}<span>${n} tracce</span><span class="d">${whenTxt(p.updated)}</span></div>
          ${mk ? `<span class="chip mk">${ico('bookmark')}${esc(mk.name)} · ${fmt(mk.t)}${p.marks.length > 1 ? ' +' + (p.marks.length - 1) : ''}</span>` : ''}</div></div>
      <div class="foot"><span class="status" style="--sc:${sc}"><i></i>${esc(st)}</span><button class="open">${ico('play')}APRI LAB</button></div></article>`; }).join('');
  if (list.length && !shown.length) $('projects').innerHTML = '<p class="mute" style="padding:14px 4px">Nessun progetto trovato.</p>';
  try {
    const e = await navigator.storage.estimate(), mb = v => v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB' : Math.round(v / 1e6) + ' MB';
    $('storageUse').textContent = mb(e.usage || 0) + ' usati';
  } catch (e) {}
}
$('sortBtn').addEventListener('click', () => { homeSort = homeSort === 'name' ? 'recent' : 'name'; ls.set('homeSort', homeSort); renderHome(); });
$('q').addEventListener('input', () => renderHome());
$('filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { homeFilter = b.dataset.f; renderHome(); } });
$('projects').addEventListener('click', e => {
  const m = e.target.closest('[data-menu]');
  if (m) { e.stopPropagation(); return projectMenu(m.dataset.menu); }
  const c = e.target.closest('.proj'); if (c) openPlayer(c.dataset.id);
});
$('projects').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('proj')) openPlayer(e.target.dataset.id); });
async function projectMenu(id) {
  const p = await getProject(id); if (!p) return;
  const v = await dialog(p.name, null, [['Rinomina', 'ren'], ['Elimina', 'del'], ['Chiudi', null, true]]);
  if (v === 'ren') {
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = p.name; inp.maxLength = 60;
    if (await dialog('Rinomina', inp, [['Annulla', false], ['Salva', true, true]]) && inp.value.trim()) {
      if (cur && cur.id === id) { cur.name = inp.value.trim(); $('pTitle').textContent = cur.name; await putProject(cur); }
      else { const q = await getProject(id); if (q) { q.name = inp.value.trim(); await putProject(q); } }
    }
  }
  if (v === 'del') {
    const mb = p.kind === 'video' ? ' e il video salvato' : '';
    if (await dialog('Eliminare il progetto?', textEl(`Le tracce separate${mb} verranno cancellate da questo telefono.`), [['Annulla', false], ['Elimina', true, true]])) {
      const open = cur && cur.id === id; if (open) { closePlayer(true); }
      await deleteProject(id); toast('Progetto eliminato'); if (open) { if (location.hash) history.back(); else go('home'); return; }
    }
  }
  if ($('s-home').classList.contains('on')) renderHome();
}
$('newBtn').addEventListener('click', () => $('file').click());
$('navLast').addEventListener('click', () => homeList.length && openPlayer(homeList[0].id));
$('navTrain').addEventListener('click', async () => { if (!homeList.length) return; await openPlayer(homeList[0].id); if (cur) openTraining(); });
// Settings: storage, downloaded models, tips. Everything stays on this phone.
async function openSettings() {
  const wrap = document.createElement('div'), mb = v => v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB' : Math.round(v / 1e6) + ' MB';
  let est = {}, models = [];
  try { est = await navigator.storage.estimate(); } catch (e) {}
  try { models = (await caches.keys()).filter(k => k.startsWith('bachata-models')); } catch (e) {}
  const row = (a, b) => `<div class="setrow"><span>${a}</span><b>${b}</b></div>`;
  wrap.innerHTML = row('Progetti salvati', homeList.length) + row('Spazio usato', mb(est.usage || 0)) + row('Core usati per separare', ls.get('lastThreads', null) == null ? '–' : ls.get('lastThreads')) +
    row('Modelli di separazione', NATIVE ? "dentro l'app" : models.length ? 'scaricati' : 'non ancora') + row('Versione', 'Bachata Lab 5' + (NATIVE ? ' · app Android' : ''));
  const b1 = document.createElement('button'); b1.className = 'setbtn'; b1.innerHTML = ico('close') + 'Elimina i modelli scaricati (circa 160 MB)'; b1.disabled = !models.length; b1.hidden = NATIVE;
  b1.onclick = async () => { for (const k of models) { try { await caches.delete(k); } catch (e) {} } ls.set('modelsCached', false); b1.disabled = true; toast('Modelli eliminati: si riscaricano al prossimo progetto'); };
  const b2 = document.createElement('button'); b2.className = 'setbtn'; b2.innerHTML = ico('bulb') + 'Mostra di nuovo i suggerimenti';
  b2.onclick = () => { ls.set('padTipSeen', false); toast('Suggerimenti riattivati'); };
  const p = textEl('I brani, le tracce separate e i modelli restano in questo browser del telefono: niente viene caricato online.'); p.className = 'mute small';
  wrap.append(b1, b2, p);
  await dialog('Impostazioni', wrap, [['Chiudi', null, true]]);
  renderHome();
}
$('navSet').addEventListener('click', openSettings); $('manageBtn').addEventListener('click', openSettings);
$('changeFile').addEventListener('click', () => $('file').click());
$('clearName').addEventListener('click', () => { $('pname').value = ''; $('pname').focus(); });
function renderStemTags() { $('stemtags').innerHTML = STEMS.filter(s => s.id !== 'guira' || $('optGuira').checked).map(s => `<span style="--c:var(--c-${s.id})">${sico(s.id)}${s.id === 'bongo' && !$('optGuira').checked ? 'Bongo + güira' : s.n}</span>`).join(''); }

// ---------- NEW PROJECT ----------
let src = null, region = { s: 0, e: 60 }, preview = null, peaks = null, vprevUrl = null;
function releaseSource() {
  src = null; peaks = null; $('vcard').classList.remove('on'); const vp = $('vprev'); vp.pause(); if (vp.getAttribute('src')) { vp.removeAttribute('src'); vp.load(); }
  if (vprevUrl) { URL.revokeObjectURL(vprevUrl); vprevUrl = null; }
}
$('file').addEventListener('change', async () => {
  const f = $('file').files[0]; $('file').value = ''; if (!f) return;
  const video = /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v)$/i.test(f.name);
  if (f.size > MAX_FILE) return dialog('File troppo grande', textEl(`Questo file supera i ${Math.round(MAX_FILE / 1e6)} MB e il telefono potrebbe non reggere. Prova con un video più corto o compresso.`), [['OK', 0, true]]);
  releaseSource();
  busy(video ? 'Leggo l\'audio del video…' : 'Leggo il brano…');
  let buf;
  try { buf = await audioCtx().decodeAudioData(await f.arrayBuffer()); }
  catch (e) { busy(); return dialog('File non leggibile', textEl(video ? 'Non riesco a leggere l\'audio di questo video. Prova con un MP4 registrato dal telefono.' : 'Questo file audio non si apre. Prova con un MP3 o un M4A.'), [['OK', 0, true]]); }
  busy();
  src = { buf, file: f, kind: video ? 'video' : 'audio', name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Nuovo brano' };
  region = { s: 0, e: Math.min(buf.duration, 60) };
  $('pname').value = src.name; $('newTitle').textContent = video ? 'Nuovo progetto video' : 'Nuovo progetto';
  const vp = $('vprev');
  if (video) { vprevUrl = URL.createObjectURL(f); vp.src = vprevUrl; $('vcard').classList.add('on'); $('vname').textContent = f.name; $('vdur').textContent = 'Video · ' + fmt(buf.duration); }
  renderStemTags();
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
  [[xs, acc, 'INIZIO'], [xe, cy, 'FINE']].forEach(([x, c, t]) => {
    g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 8; g.fillRect(x - 1, 0, 2, H); g.shadowBlur = 0;
    const tw = g.measureText(t).width + 8, lx = Math.min(Math.max(x - tw / 2, 0), W - tw);
    g.fillRect(lx, 2, tw, 15); g.fillStyle = '#0f131c'; g.fillText(t, lx + 4, 13);
    g.fillStyle = c; g.beginPath(); g.arc(Math.min(Math.max(x, 9), W - 9), H - 10, 8, 0, 7); g.fill();
    g.fillStyle = '#0f131c'; g.beginPath(); g.arc(Math.min(Math.max(x, 9), W - 9), H - 10, 3, 0, 7); g.fill(); });
  const step = [10, 15, 30, 60, 120].find(v => d / v <= 6) || 300;
  let tk = ''; for (let t = 0; t <= d + 0.01; t += step) tk += `<span>${fmt(t)}</span>`; $('ticks').innerHTML = tk;
  const dur = region.e - region.s, withG = $('optGuira').checked;
  $('rs').textContent = fmt(region.s); $('re').textContent = fmt(region.e); $('rd').textContent = fmt(dur);
  $('rdS').innerHTML = `${Math.round(dur)} secondi<br>${dur < 30 ? 'una frase' : dur <= 90 ? 'ideale per studiare' : 'sezione lunga'}`;
  const first = !NATIVE && !ls.get('modelsCached', false);
  $('estMin').textContent = '~' + estimateMinutes(dur, withG) + ' min';
  $('est').innerHTML = `<div class="nt">${ico(first ? 'dl' : 'shield')}<span>${first ? '<b style="color:var(--ink)">Primo utilizzo:</b> scarico anche i modelli di separazione (circa 160 MB, una volta sola, meglio con il Wi‑Fi). Poi tutto funziona senza Internet.' : 'Tutto avviene su questo telefono, senza Internet e senza caricare il brano da nessuna parte.'}${ls.get(SPEED_KEY(), null) == null ? ' La stima si corregge dopo il primo progetto.' : ''}</span></div>`;
  $('regionWarn').innerHTML = dur > MAX_REGION ? `<div class="alert">${ico('warn')}<span><b>Massimo 3 minuti:</b> accorcia la parte.</span></div>`
    : dur > 120 ? `<div class="alert">${ico('warn')}<span><b>Attenzione:</b> le parti oltre i 2 minuti richiedono più memoria e più tempo di calcolo sul telefono.</span></div>` : '';
  $('createBtn').disabled = dur < 8 || dur > MAX_REGION;
}
$('optGuira').addEventListener('change', () => { drawRegion(); renderStemTags(); });
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
  $('preview').innerHTML = ico('play') + 'Ascolta'; $('rph').style.display = 'none'; $('startHere').disabled = $('endHere').disabled = true;
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
  $('preview').innerHTML = ico('pause') + 'Stop'; $('startHere').disabled = $('endHere').disabled = false;
  const ph = $('rph'); ph.style.display = 'block';
  const loop = () => { if (!preview) return; const t = previewPos(); ph.style.left = (t / src.buf.duration * 100) + '%'; preview.raf = requestAnimationFrame(loop); };
  loop();
}
const previewPos = () => preview ? preview.from + (audioCtx().currentTime - preview.t0) : region.s;
$('preview').addEventListener('click', () => (preview ? stopPreview() : startPreview()));
$('startHere').addEventListener('click', () => { const t = previewPos(); region.s = Math.max(0, Math.min(t, region.e - 8)); drawRegion(); toast('Inizio a ' + fmt(region.s)); startPreview(); });
$('endHere').addEventListener('click', () => { const t = previewPos(); region.e = Math.min(src.buf.duration, Math.max(t, region.s + 8)); drawRegion(); toast('Fine a ' + fmt(region.e)); stopPreview(); });
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
  return `<li class="${st}"><span class="st">${ico(st === 'done' ? 'check' : st === 'now' ? 'restart' : 'clock')}</span><span class="t">${s}</span><span class="tag">${st === 'done' ? 'FATTO' : st === 'now' ? 'ATTIVO' : 'ATTESA'}</span>${st === 'now' ? '<span class="sbar"><b></b></span>' : ''}</li>`; }).join(''); }
// frac: share of the whole job; part: share of the current step (for its own bar)
function setProgress(frac, part) {
  frac = Math.max(0, Math.min(1, frac)); $('procRing').style.strokeDashoffset = (414.7 * (1 - frac)).toFixed(1); $('procPct').innerHTML = Math.round(frac * 100) + '<small>%</small>';
  const sb = document.querySelector('#procSteps li.now .sbar b'); if (sb) sb.style.width = ((part == null ? frac : part) * 100).toFixed(1) + '%';
}
let procClock = 0;
function cancelProcessing() { if (worker) { worker.terminate(); worker = null; } procRunning = false; clearInterval(procClock); releaseWake(); toast('Separazione annullata'); go('home'); }
$('createBtn').addEventListener('click', async () => {
  if (procRunning || !src) return;
  $('createBtn').disabled = true; procRunning = true; stopPreview();
  const name = $('pname').value.trim() || src.name, withG = $('optGuira').checked;
  const dur = region.e - region.s, offset = region.s, kind = src.kind, file = src.file;
  const steps = [NATIVE ? 'Preparo i modelli' : 'Scarico i modelli', 'Separo voce, chitarra, basso, percussioni', ...(withG ? ['Isolo la güira'] : []), 'Trovo il ritmo e salvo'];
  history.replaceState(null, '', '#elabora'); show('proc'); keepAwake();
  $('procThumb').innerHTML = ico(kind === 'video' ? 'video' : 'note');
  $('procTitle').textContent = name; setProgress(0); setSteps(steps, 0);
  $('procKind').textContent = kind === 'video' ? 'Video' : 'Audio'; $('procSub').textContent = fmt(dur) + ' selezionati · ' + (withG ? 6 : 5) + ' tracce';
  $('procStage').textContent = 'Preparazione…'; $('procWhat').textContent = 'Modelli'; $('procEl').textContent = '0:00'; $('procLeft').textContent = '–'; $('procPart').textContent = '–';
  const t0 = Date.now(); clearInterval(procClock); procClock = setInterval(() => { $('procEl').textContent = fmt((Date.now() - t0) / 1000); $('wakeChip').hidden = !wakeLock; }, 1000);
  let left, right, thumb = null;
  try { thumb = await videoThumb(offset); if (thumb) $('procThumb').innerHTML = `<img src="${thumb}" alt="">`; [left, right] = await regionAt44k(src.buf, region.s, region.e); }
  catch (e) { procRunning = false; await dialog('File non leggibile', textEl('Non riesco a preparare l\'audio di questa parte.'), [['OK', 0, true]]); return go('home'); }
  releaseSource();
  const wD = COST.demucs, wG = withG ? COST.guira : 0; let tWork = Date.now(); const est = estimateMinutes(dur, withG);
  worker = NATIVE ? nativeWorker() : new Worker('worker.js?v=22');
  worker.onmessage = async ev => {
    const m = ev.data;
    if (m.type === 'download') {
      $('procStage').textContent = m.network ? `Scarico i modelli: ${m.loaded} di ${m.total} MB (solo la prima volta)` : 'Carico i modelli';
      setProgress(0, m.frac);
    }
    if (m.type === 'loading') $('procStage').textContent = 'Preparo i modelli…';
    if (m.type === 'ready') { ls.set('modelsCached', true); ls.set('lastThreads', m.threads || 1); setSteps(steps, 1); tWork = Date.now(); setProgress(0); $('procWhat').textContent = 'Separazione'; $('procStage').textContent = 'Separo gli strumenti…'; }
    if (m.type === 'progress') {
      let frac = null, part = null;
      if (m.stage === 'demucs') { frac = wD / (wD + wG) * m.i / m.n; part = m.i / m.n; $('procStage').textContent = `Separo gli strumenti: parte ${m.i} di ${m.n}`; $('procPart').textContent = m.i + '/' + m.n; }
      if (m.stage === 'guira') { if (!document.querySelector('#procSteps li.now .sbar') || $('procWhat').textContent !== 'Güira') { setSteps(steps, 2); $('procWhat').textContent = 'Güira'; }
        frac = (wD + wG * m.i / m.n) / (wD + wG); part = m.i / m.n; $('procStage').textContent = `Isolo la güira: parte ${m.i} di ${m.n}`; $('procPart').textContent = m.i + '/' + m.n; }
      if (m.stage === 'resample') $('procStage').textContent = 'Preparo la güira';
      if (m.stage === 'split') $('procStage').textContent = 'Divido bongo e güira';
      if (frac != null) {
        setProgress(frac, part);
        const el = (Date.now() - tWork) / 1000;
        $('procLeft').textContent = frac > 0.04 ? '~' + fmt(Math.max(1, el / frac - el)) : '~' + est + ' min';
      }
    }
    if (m.type === 'error') {
      if (worker) { worker.terminate(); worker = null; } procRunning = false; releaseWake(); clearInterval(procClock);
      const net = /download|fetch|network|Failed/i.test(m.message);
      await dialog('Qualcosa è andato storto', textEl(net ? 'Non riesco a scaricare i modelli: controlla la connessione e riprova.' : 'La separazione si è fermata (' + m.message + '). Prova con una parte più corta.'), [['OK', 0, true]]);
      go('home');
    }
    if (m.type === 'done') {
      if (worker) { worker.terminate(); worker = null; }
      const workS = (Date.now() - tWork) / 1000; ls.set(SPEED_KEY(), Math.max(0.05, Math.min(10, workS / (dur * (wD + wG)))));
      clearInterval(procClock); setSteps(steps, steps.length - 1); $('procStage').textContent = 'Trovo il ritmo e salvo…'; $('procWhat').textContent = 'Ritmo'; $('procLeft').textContent = '0:00'; setProgress(1, 0.5);
      const args = { name, stems: m.stems, dur, offset, withG, kind, file, thumb };
      for (;;) {
        try { const id = await saveNew(args); procRunning = false; history.replaceState(null, '', '#player'); openPlayer(id); return; }
        catch (e) {
          const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
          const again = await dialog(quota ? 'Spazio insufficiente' : 'Salvataggio non riuscito', textEl(quota ? 'Il telefono non ha spazio per salvare questo progetto. Libera spazio (o elimina un progetto) e riprova.' : 'Non riesco a salvare il progetto: ' + (e && e.message || e)), [['Rinuncia', false], ['Riprova', true, true]]);
          if (!again) { procRunning = false; releaseWake(); return go('home'); }
        }
      }
    }
  };
  worker.onerror = e => { if (worker) worker.onmessage({ data: { type: 'error', message: e.message || 'errore interno' } }); };
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
        if (w.stopped) return; console.warn('native separation failed:', why); toast('Uso la separazione nel browser (più lenta)');
        const real = w.real = new Worker('worker.js?v=22');
        real.onmessage = ev => emit(ev.data); real.onerror = e => emit({ type: 'error', message: e.message || 'errore interno' });
        real.postMessage(msg);
      }
    } };
  return w;
}
$('cancelBtn').addEventListener('click', async () => {
  if (!procRunning) return;
  if (await dialog('Annullare?', textEl('Perdi il lavoro fatto finora.'), [['Continua', false], ['Annulla separazione', true, true]])) cancelProcessing();
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
async function saveNew({ name, stems, dur, offset, withG, kind, file, thumb }) {
  const n = stems.vocals[0].length, id = 'p' + Date.now().toString(36);
  let bt = { bpm: 0, beats: new Float64Array(0), confidence: 0 };
  try { bt = BeatTracker.analyze(rhythmMono(stems, n), SR); } catch (e) {}
  const beats = Array.from(bt.beats), oneIdx = guessOne(stems, beats, n);
  const data = {}; for (const s of STEMS) data[s.id] = [toInt16(stems[s.id][0]), toInt16(stems[s.id][1])];
  try {
    await tx('stems', 'readwrite', s => s.put({ id, n, sr: SR, data }));
    if (kind === 'video') await tx('media', 'readwrite', s => s.put({ id, blob: file, type: file.type || 'video/mp4' }));
    const p = normalize({ id, name, kind, thumb, dur, offset, created: Date.now(), updated: Date.now(), withGuira: withG,
      bpm: bt.bpm, bpmDetected: bt.bpm, beats, beatsDetected: beats.slice(), confidence: bt.confidence, oneIdx, oneDetected: oneIdx,
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
  exitFs(true); cur = null; loopRange = null; loopMode = null; abA = null; closeSheet(true); releaseWake();
}
async function openPlayer(id) {
  const my = ++opening;
  closePlayer();
  busy('Apro il progetto…');
  let p, st, m;
  try { p = await getProject(id); st = await getStems(id); if (p && p.kind === 'video') m = await getMedia(id); }
  catch (e) { p = null; }
  if (my !== opening) return;
  if (!p || !st) { busy(); toast('Progetto non leggibile'); return go('home'); }
  try {
    cur = normalize(p);
    const stems = {}; for (const s of STEMS) stems[s.id] = [toF32(st.data[s.id][0]), toF32(st.data[s.id][1])];
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
      else toast('Video non trovato: resta solo l\'audio');
      setMirror(!!cur.mirror, true);
    }
    $('pTitle').textContent = cur.name; $('tDur').textContent = fmt(player.duration); $('pSub').textContent = (isVideo() ? 'VIDEO' : 'AUDIO') + ' · ' + fmt(player.duration) + (cur.withGuira === false ? ' · 5 TRACCE' : '');
    $('sheetSub').textContent = cur.name;
    liveTempo = cur.tempo; applyTempo(cur.tempo, true); setStep(cur.step, true);
    $('rampOn').checked = !!cur.ramp; $('countIn').checked = !!cur.countIn;
    applyGains(); renderPresets(); renderPads(); renderMixer(); renderMarks();
    $('metOn').checked = cur.met.on; $('metVol').value = cur.met.vol; fillRange($('metVol')); renderAcc(); applyMet();
    updateLoopBtns();
    player.seek(Math.min(cur.pos || 0, Math.max(0, player.duration - 0.1)));
    show('player'); if (location.hash !== '#player') location.hash = 'player';
    renderDots(); renderStyle(); setView(cur.view, true); updateBeatInfo(); setPlayIcon(); lastCount = -1; busy(); keepAwake();
    if (!ls.get('padTipSeen', false)) { ls.set('padTipSeen', true); setTimeout(() => toast('Tocca uno strumento per spegnerlo, tienilo premuto per sentirlo da solo'), 600); }
    requestAnimationFrame(() => { drawTimelineStatic(); syncVideo(true); });
    raf = requestAnimationFrame(tick);
  } catch (e) {
    busy(); closePlayer(true); await dialog('Progetto non leggibile', textEl('Non riesco ad aprire questo progetto (' + (e && e.message || e) + ').'), [['OK', 0, true]]); go('home');
  }
}

// ---- beat grid helpers ----
const hasBeats = () => !!cur && cur.beats.length >= 8 && cur.bpm > 0;
function beatIdx(t) { const b = cur.beats; let lo = 0, hi = b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m] <= t + 0.03) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function nearestBeat(t) { const b = cur.beats; if (!b.length) return -1; let i = beatIdx(t); if (i < 0) return 0; if (i + 1 < b.length && Math.abs(b[i + 1] - t) < Math.abs(b[i] - t)) i++; return i; }
const countOf = i => ((i - cur.oneIdx) % 8 + 8) % 8 + 1;
function beatTime(i) { const b = cur.beats; if (i >= 0 && i < b.length) return b[i]; const per = 60 / cur.bpm; return i < 0 ? b[0] + i * per : b[b.length - 1] + (i - b.length + 1) * per; }
function phraseStartIdx(t) { const i = Math.max(0, beatIdx(t)); return i - (countOf(i) - 1); }
function updateBeatInfo() {
  const ok = hasBeats();
  $('bpmVal').innerHTML = (ok ? String(Math.round(cur.bpm * 10) / 10).replace('.', ',') : '–') + '<small> BPM</small>';
  $('bpmLbl').textContent = ok ? Math.round(cur.bpm) : '–';
  $('bpmOrig').textContent = cur.bpmDetected ? 'Rilevato: ' + String(Math.round(cur.bpmDetected * 10) / 10).replace('.', ',') : '';
  $('beatWarn').textContent = !ok ? 'Ritmo non trovato: i salti vanno a mezzi secondi, usa il Loop A–B.' : cur.confidence < 0.4 ? 'Non sono sicuro del ritmo: controlla l\'1 e i BPM in Mixer › Ritmo.' : '';
  ['loop4', 'loop8', 'oneBtn'].forEach(id => { $(id).disabled = !ok; });
  applyMet(); drawTimelineStatic(); computePhrases(); renderGrid();
}

// ---- count display ----
let dotNodes = [], ovDotNodes = [];
// What each count means: bachata taps on 4 and 8.
const STYLES = { bachata: { n: 'Bachata', tag: { 4: 'TAP', 8: 'TAP' }, cap: { 4: 'tap', 8: 'tap' } },
};
const styleOf = () => STYLES.bachata; // the app counts bachata only
function renderDots() {
  const st = styleOf();
  $('dots').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => st.tag[n] ? `<div class="dot tap">${n}<small>${st.tag[n]}</small></div>` : `<div class="dot${n === 1 || n === 5 ? ' one' : ''}">${n}</div>`).join('');
  $('ovDots').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<i class="${n === 4 || n === 8 ? 'tap' : ''}"></i>`).join('');
  dotNodes = [...$('dots').children]; ovDotNodes = [...$('ovDots').children];
}
let lastCount = -1, lastT = 0, wraps = 0, frame = 0, lastSec = -2;
// index of the bookmark whose section contains t (-1 before the first one)
function sectionAt(t) { let k = -1; (cur.marks || []).forEach((m, i) => { if (m.t <= t + 0.05) k = i; }); return k; }
function tick() {
  if (!player) return;
  const t = player.position;
  if (hasBeats()) {
    const i = beatIdx(t), c = i < 0 ? 0 : countOf(i);
    if (c !== lastCount) {
      lastCount = c;
      dotNodes.forEach((d, k) => d.classList.toggle('now', k + 1 === c)); ovDotNodes.forEach((d, k) => { d.classList.toggle('now', k + 1 === c); d.classList.toggle('past', k + 1 < c); });
      const tap = c === 4 || c === 8, one = c === 1 || c === 5;
      $('bigNum').textContent = c || '–'; $('bigNum').classList.toggle('tap', tap); $('bigNum').classList.toggle('one', one);
      $('count').classList.toggle('c1', one); $('count').classList.toggle('c4', tap);
      const first = phraseStartIdx(0), total = Math.floor((phraseStartIdx(player.duration - 0.01) - first) / 8) + 1;
      const pn = Math.floor((phraseStartIdx(t) - first) / 8) + 1;
      $('countCap').innerHTML = c ? (tap ? 'Tap' : 'Tempo') + `<small>${c <= 4 ? 'prima metà' : 'seconda metà'}</small>` : ''; $('countCap').classList.toggle('tap', tap);
      $('ovNum').textContent = c || ''; $('ovNum').classList.toggle('tap', tap); $('ovNum').classList.toggle('one', one);
      const warn = c >= 5 && phraseChangeAhead(pn - 1), sec = sectionAt(t);
      $('phraseLbl').textContent = `Frase ${pn}/${total}`;
      $('secLbl').textContent = warn ? 'Cambio tra ' + (9 - c) : sec >= 0 ? cur.marks[sec].name : ''; $('secLbl').classList.toggle('warn', warn);
      $('ovPhrase').textContent = warn ? 'Cambio tra ' + (9 - c) : (sec >= 0 ? cur.marks[sec].name + ' · ' : '') + `Frase ${pn}/${total}`; $('ovPhrase').classList.toggle('warn', warn);
      if (sec !== lastSec) { lastSec = sec; [...$('marks').children].forEach((b, k) => b.classList.toggle('on', k === sec)); }
      updateGrid(i, pn - 1, warn);
    }
  } else { $('bigNum').textContent = fmt(t); $('ovNum').textContent = ''; }
  // speed ramp: count only real loop wraps, not the user's own seeks
  if (loopRange && player.isPlaying && t < lastT - 0.2 && performance.now() - userSeekAt > 400) {
    wraps++;
    if (cur.ramp && wraps % 2 === 0 && liveTempo < 100) { liveTempo = Math.min(100, liveTempo + 5); setLiveTempo(liveTempo); toast('Velocità ' + liveTempo + '%'); }
  }
  lastT = t;
  if ((frame++ & 1) === 0) { updatePads(t); if (cur.view !== 'grid') drawTimeline(t); $('tPos').textContent = fmt(t); }
  if (training) trainTick(t);
  syncVideo(false);
  raf = requestAnimationFrame(tick);
}

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
function setMirror(on, quiet) { if (!cur) return; cur.mirror = on; $('stage').classList.toggle('mirror', on); $('mirrorBtn').classList.toggle('on', on); $('mirrorBtn').setAttribute('aria-pressed', String(on)); if (!quiet) { persist(); toast(on ? 'Specchio: il video è ribaltato come in sala' : 'Video normale'); } }
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
  if (a === 'play') togglePlay(); if (a === 'jb') jumpBeats(-1); if (a === 'jf') jumpBeats(1); if (a === 'exitfs') exitFs();
  if (a === 'slow') { const steps = [100, 85, 70]; const nx = steps[(steps.indexOf(cur.tempo) + 1) % steps.length] || 100; applyTempo(nx); } });

// ---- instrument pads: they glow with the live level of each instrument ----
function renderPads() {
  const meter = '<span class="meter"><i></i><i></i><i></i><i></i><i></i></span>';
  const html = mini => STEMS.map(s => `<button class="pad" data-id="${s.id}" style="--c:var(--c-${s.id})"><span class="hd">${sico(s.id, 'ic')}<span class="pn">${s.n}</span><span class="sb">S</span><svg class="i mt"><use href="#i-mute"/></svg></span>${mini ? '' : meter}${mini ? meter : ''}</button>`).join('');
  $('pads').innerHTML = html(false); $('minipads').innerHTML = html(true);
  refreshPadStates();
}
function refreshPadStates() {
  document.querySelectorAll('.pad').forEach(p => { const id = p.dataset.id, off = isOff(id);
    p.classList.toggle('off', off); p.classList.toggle('solo', !!cur.solo[id]); p.setAttribute('aria-pressed', String(!off));
    p.setAttribute('aria-label', STEMS.find(s => s.id === id).n + (off ? ', spento' : ', acceso') + (cur.solo[id] ? ', solo' : '')); });
  padNodes = [...document.querySelectorAll(isVideo() ? '#minipads .pad' : '#pads .pad')].map(p => ({ el: p, id: p.dataset.id, v: -1 }));
}
const smooth = {};
function updatePads(t) {
  const k = Math.floor(t * (cur.envRate || 10));
  for (const p of padNodes) {
    const e = cur.env[p.id]; let lv = e ? (e[k] || 0) / envScale[p.id] : 0;
    lv = Math.max(0, Math.min(1, (lv - 0.25) / 0.7));
    if (!player.isPlaying) lv *= 0.6;
    const prev = smooth[p.id] || 0, s = lv > prev ? lv : prev * 0.8 + lv * 0.2; smooth[p.id] = s;
    if (Math.abs(s - p.v) > 0.02) { p.v = s; p.el.style.setProperty('--lv', s.toFixed(2)); }
  }
}
// Shared by the pads and the mixer sheet, so both always agree.
function toggleMute(id) { cur.mute[id] = !cur.mute[id]; if (cur.mute[id]) cur.solo[id] = false; }
function toggleSolo(id) { cur.solo[id] = !cur.solo[id]; if (cur.solo[id]) { cur.mute[id] = false; if (cur.gains[id] === 0) cur.gains[id] = 1; } }
function padPress(container) {
  let timer = 0, fired = false;
  container.addEventListener('pointerdown', e => { const target = e.target.closest('.pad'); if (!target) return; fired = false; clearTimeout(timer);
    timer = setTimeout(() => { fired = true; const id = target.dataset.id; toggleSolo(id); mixerChanged();
      toast(cur.solo[id] ? STEMS.find(s => s.id === id).n + ' da solo' : 'Solo tolto'); vibrate(20); }, 450); });
  const cancel = () => clearTimeout(timer);
  container.addEventListener('pointerup', cancel); container.addEventListener('pointercancel', cancel); container.addEventListener('pointerleave', cancel);
  container.addEventListener('contextmenu', e => e.preventDefault());
  container.addEventListener('click', e => { const p = e.target.closest('.pad'); if (!p) return; if (fired) { fired = false; return; } const id = p.dataset.id;
    if (cur.solo[id]) toggleSolo(id);                                   // tap on a solo pad: drop its solo
    else if (isOff(id)) { cur.mute[id] = false; if (cur.gains[id] === 0) cur.gains[id] = 1; if (anySolo()) cur.solo[id] = true; } // bring it back
    else toggleMute(id);                                                // switch it off
    mixerChanged(); });
}
padPress($('pads')); padPress($('minipads'));

// ---- timeline ----
function drawTimelineStatic() {
  if (!cur || !player) return;
  const cv = $('tl').querySelector('canvas'), W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  staticCv = document.createElement('canvas'); staticCv.width = W * dpr; staticCv.height = H * dpr;
  const g = staticCv.getContext('2d'); g.scale(dpr, dpr);
  const top = 16, laneH = (H - top - 3) / STEMS.length, dur = player.duration, small = laneH < 11;
  STEMS.forEach((s, k) => {
    const e = cur.env[s.id], y = top + k * laneH, c = cc('--c-' + s.id), off = isOff(s.id);
    g.fillStyle = c; g.globalAlpha = off ? 0.16 : 0.9;
    const bw = W / Math.max(1, e.length);
    for (let i = 0; i < e.length; i++) { const h = Math.max(0.5, e[i] * (laneH - 2)); g.fillRect(i * bw, y + (laneH - h) / 2, Math.max(1, bw - 0.1), h); }
    if (!small) { g.globalAlpha = off ? 0.45 : 1; g.font = '600 10px Geist,system-ui,sans-serif'; const tw = g.measureText(s.n).width;
      g.fillStyle = 'rgba(14,13,24,.8)'; g.fillRect(2, y + laneH / 2 - 7, tw + 6, 13); g.fillStyle = c; g.fillText(s.n, 5, y + laneH / 2 + 3.5); }
  });
  g.globalAlpha = 1;
  const ink = cc('--ink');
  if (hasBeats()) {
    const first = phraseStartIdx(0), phrasePx = 8 * (60 / cur.bpm) / dur * W;
    for (let i = first; ; i++) {
      const t = beatTime(i); if (t > dur) break; if (t < 0) continue;
      const x = t / dur * W, c = countOf(i);
      g.fillStyle = ink; g.globalAlpha = c === 1 ? 0.5 : 0.14;
      g.fillRect(x, c === 1 ? 0 : top - 4, 1, c === 1 ? H : 4);
      if (c === 1 && phrasePx > 16) { g.globalAlpha = 0.75; g.font = '600 10px Geist,system-ui,sans-serif'; g.fillText(String(Math.floor((i - first) / 8) + 1), x + 3, 10); }
    }
    g.globalAlpha = 1;
  }
  const warn = cc('--warn');
  for (const m of cur.marks) { const x = m.t / dur * W; g.fillStyle = warn; g.fillRect(x - 1, 0, 3, H); g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 11, 4); g.lineTo(x + 2, 9); g.fill(); }
}
function drawTimeline(t) {
  const cv = $('tl').querySelector('canvas'); if (!staticCv || !cv.width) return;
  const g = cv.getContext('2d'), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight, dur = player.duration, acc = cc('--acc');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(staticCv, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (loopRange) { g.fillStyle = acc; g.globalAlpha = 0.22; g.fillRect(loopRange[0] / dur * W, 0, (loopRange[1] - loopRange[0]) / dur * W, H); g.globalAlpha = 1;
    g.fillRect(loopRange[0] / dur * W - 1, 0, 2, H); g.fillRect(loopRange[1] / dur * W - 1, 0, 2, H); }
  if (abA != null) { g.fillStyle = acc; g.fillRect(abA / dur * W - 1, 0, 3, H); }
  g.fillStyle = cc('--ink'); g.fillRect(t / dur * W - 1.25, 0, 2.5, H);
}
(function timelineInput() {
  const el = $('tl'); let lp = 0, sx = 0, dragging = false, down = false;
  const tAt = e => { const b = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * player.duration; };
  el.addEventListener('pointerdown', e => { if (!player) return; down = true; sx = e.clientX; dragging = false; el.setPointerCapture(e.pointerId);
    const t0 = tAt(e); lp = setTimeout(() => { lp = 0; if (!dragging) { down = false; addMark(t0); } }, 600); });
  el.addEventListener('pointermove', e => { if (!player || !down) return;
    if (Math.abs(e.clientX - sx) > 8) { if (!dragging) { dragging = true; clearTimeout(lp); lp = 0; } seekTo(tAt(e), false); } });
  el.addEventListener('pointerup', e => { if (!player) return; if (lp) { clearTimeout(lp); lp = 0; if (!dragging) seekTo(tAt(e), true); } down = false; dragging = false; });
  el.addEventListener('pointercancel', () => { clearTimeout(lp); lp = 0; down = false; dragging = false; });
})();
function seekTo(t, snap) {
  if (!player) return;
  t = Math.max(0, Math.min(player.duration - 0.05, t));
  if (snap && hasBeats()) { const i = nearestBeat(t); if (i >= 0 && Math.abs(beatTime(i) - t) < 0.25) t = Math.max(0, beatTime(i)); }
  if (loopRange && (t < loopRange[0] - 0.01 || t >= loopRange[1])) clearLoop(false);
  userSeekAt = performance.now(); player.seek(t); syncVideo(true);
}

// ---- transport ----
function setPlayIcon() { const p = !!player && player.isPlaying; $('playBtn').innerHTML = ico(p ? 'pause' : 'play'); $('fsPlay').innerHTML = ico(p ? 'pause' : 'play'); $('playBtn').setAttribute('aria-label', p ? 'Pausa' : 'Play'); }
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
$('playBtn').addEventListener('click', togglePlay);
$('stage').addEventListener('click', e => { if (e.target.closest('button') || $('stage').classList.contains('fs') && e.target.closest('.fsbar')) return; if (!swipedRecently) togglePlay(); });
function nudgeSeconds(d) {
  if (!player) return;
  if (loopRange) { // inside a loop, ±5 s stays inside it
    const [a, b] = loopRange, len = b - a; let t = player.position + d; t = a + ((((t - a) % len) + len) % len);
    userSeekAt = performance.now(); player.seek(t); syncVideo(true); return;
  }
  seekTo(player.position + d, false);
}
$('back5').addEventListener('click', () => nudgeSeconds(-5));
$('fwd5').addEventListener('click', () => nudgeSeconds(5));
function setStep(n, quiet) {
  n = +n === 4 ? 4 : 8; // jumps of 4 or 8 counts only
  if (cur) { cur.step = n; if (!quiet) persist(); }
  document.querySelectorAll('[data-step]').forEach(b => b.classList.toggle('on', +b.dataset.step === n));
  $('jb').innerHTML = `<b>${ico('prev')}${n}</b><span>TEMPI</span>`; $('jf').innerHTML = `<b>${n}${ico('next')}</b><span>TEMPI</span>`;
  $('jb').setAttribute('aria-label', `Indietro di ${n} tempi`); $('jf').setAttribute('aria-label', `Avanti di ${n} tempi`);
}
document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => setStep(b.dataset.step)));
function jumpBeats(dir) {
  if (!player) return;
  const n = cur.step, t = player.position, per = hasBeats() ? 60 / cur.bpm : 0.5;
  if (loopRange) {
    let a, b, msg;
    if (loopMode === 4 || loopMode === 8) { // phrase loops move to the next/previous loop of the same size
      const ia = nearestBeat(loopRange[0]) + dir * loopMode; a = beatTime(ia); b = beatTime(ia + loopMode); msg = dir < 0 ? 'Loop precedente' : 'Loop successivo';
    } else { a = loopRange[0] + dir * n * per; b = loopRange[1] + dir * n * per; msg = `Loop spostato di ${n} tempi`; }
    if (a < -0.05 || b > player.duration + 0.05) return toast(dir < 0 ? 'Sei all\'inizio' : 'Sei alla fine');
    setLoop(Math.max(0, a), Math.min(player.duration, b)); userSeekAt = performance.now(); player.seek(Math.max(0, a)); syncVideo(true); toast(msg); return;
  }
  if (!hasBeats()) return seekTo(t + dir * n * per, false);
  const k = nearestBeat(t), target = beatTime(k + dir * n);
  if (target < -0.05) return seekTo(0, false);
  if (target > player.duration - 0.05) return toast('Sei alla fine');
  seekTo(Math.max(0, target), false);
}
$('jb').addEventListener('click', () => jumpBeats(-1));
$('jf').addEventListener('click', () => jumpBeats(1));
document.addEventListener('keydown', e => {
  if (!cur || !$('s-player').classList.contains('on') || e.target.tagName === 'INPUT' || $('dlg').classList.contains('on')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); jumpBeats(-1); }
  if (e.code === 'ArrowRight') { e.preventDefault(); jumpBeats(1); }
});
let swipedRecently = false;
(function swipeJumps() {
  for (const el of [$('count'), $('stage')]) {
    let x0 = null;
    el.addEventListener('pointerdown', e => { x0 = e.target.closest('button') ? null : e.clientX; });
    el.addEventListener('pointerup', e => { if (x0 == null || !player) return; const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) { swipedRecently = true; setTimeout(() => { swipedRecently = false; }, 300); jumpBeats(dx < 0 ? 1 : -1); } });
  }
})();

// ---- loops ----
function setLoop(a, b) { loopRange = [a, b]; player.setLoop(a, b); wraps = 0; drawTimeline(player.position); renderLoopInfo(); }
// The banner under the loop buttons says which loop is running; the × switches it off.
function renderLoopInfo() {
  const box = $('loopInfo'); let txt = '';
  if (abA != null) txt = `A segnato a ${fmt(abA)}: tocca A–B alla fine del pezzo`;
  else if (loopRange && cur) {
    const [a, b] = loopRange;
    if ((loopMode === 4 || loopMode === 8) && hasBeats()) {
      const i = nearestBeat(a), c = countOf(i), pn = Math.floor((phraseStartIdx(a + 0.01) - phraseStartIdx(0)) / 8) + 1;
      txt = `Loop ${loopMode} tempi attivo: ${loopMode === 8 ? '1–8' : c === 5 ? '5–8' : '1–4'} (frase ${pn})`;
    } else { const sec = cur.marks.findIndex(m => Math.abs(m.t - a) < 0.05); txt = (sec >= 0 ? 'Loop sezione ' + cur.marks[sec].name : 'Loop A–B') + `: ${fmt(a)} – ${fmt(b)}`; }
  }
  $('loopTxt').textContent = txt; box.hidden = !txt;
}
$('loopX').addEventListener('click', () => { if (abA != null && !loopRange) { abA = null; updateLoopBtns(); return; } clearLoop(); });
function clearLoop(silent) {
  const had = !!loopRange || abA != null; loopRange = null; loopMode = null; abA = null; if (player) player.clearLoop(); updateLoopBtns();
  if (liveTempo !== cur.tempo) setLiveTempo(cur.tempo);
  if (!silent && had) toast('Loop spento');
}
function updateLoopBtns() {
  $('loop4').classList.toggle('on', loopMode === 4); $('loop8').classList.toggle('on', loopMode === 8);
  $('loopAB').classList.toggle('on', loopMode === 'ab' || abA != null);
  $('loopAB').textContent = abA != null ? 'B: fine' : 'A–B'; renderLoopInfo();
  ['loop4', 'loop8'].forEach(id => $(id).setAttribute('aria-pressed', String(loopMode === (id === 'loop4' ? 4 : 8))));
}
function beatLoop(n) {
  if (loopMode === n) return clearLoop();
  const t = player.position, i = Math.max(0, beatIdx(t)), c = countOf(i);
  let start = i - (c - 1); if (n === 4 && c > 4) start += 4;
  if (beatTime(start) < -0.05) start += n; // a first phrase cut by the region start: use the next whole one
  const a = beatTime(start), b = beatTime(start + n);
  if (b > player.duration + 0.01) { toast('Non c\'è una frase intera qui'); return; }
  abA = null; loopMode = n; setLoop(Math.max(0, a), Math.min(player.duration, b)); updateLoopBtns();
  if (t < a - 0.05 || t > b) { userSeekAt = performance.now(); player.seek(Math.max(0, a)); syncVideo(true); }
  const c2 = countOf(start); toast(n === 8 ? 'Loop di 8 tempi: dall\'1 all\'8' : c2 === 5 ? 'Loop di 4 tempi: dal 5 all\'8' : 'Loop di 4 tempi: dall\'1 al 4');
}
$('loop4').addEventListener('click', () => beatLoop(4));
$('loop8').addEventListener('click', () => beatLoop(8));
$('loopAB').addEventListener('click', () => {
  if (loopMode === 'ab') return clearLoop();
  let t = player.position; if (hasBeats()) { const i = nearestBeat(t); if (Math.abs(beatTime(i) - t) < 0.2) t = Math.max(0, beatTime(i)); }
  if (abA == null) { if (loopRange) clearLoop(true); abA = t; updateLoopBtns(); toast('A segnato: tocca di nuovo alla fine (B)'); return; }
  const a = Math.min(abA, t), b = Math.max(abA, t);
  if (b - a < 0.5) { toast('Loop troppo corto'); return; }
  abA = null; loopMode = 'ab'; setLoop(a, b); updateLoopBtns(); userSeekAt = performance.now(); player.seek(a); syncVideo(true);
});

// ---- tempo (cur.tempo is the chosen speed; liveTempo may differ while "Accelera nel loop" runs) ----
function setLiveTempo(v) { liveTempo = v; if (player) player.setTempo(v / 100); $('tempoV').textContent = v + '%'; $('tempoV').classList.toggle('slow', v !== 100); $('fsSlow').textContent = v + '%'; }
function applyTempo(v, quiet) {
  v = Math.max(50, Math.min(120, Math.round(+v)));
  if (cur) { cur.tempo = v; if (!quiet) persist(); }
  setLiveTempo(v); wraps = 0;
  document.querySelectorAll('[data-tempo]').forEach(b => b.classList.toggle('on', +b.dataset.tempo === v));
}
$('spdDown').addEventListener('click', () => { if (cur) { applyTempo(Math.ceil(cur.tempo / 5) * 5 - 5); toast('Velocità ' + cur.tempo + '%'); } });
$('spdUp').addEventListener('click', () => { if (cur) { applyTempo(Math.floor(cur.tempo / 5) * 5 + 5); toast('Velocità ' + cur.tempo + '%'); } });
$('tempoV').addEventListener('click', () => { applyTempo(100); toast('Velocità normale'); });
document.querySelectorAll('[data-tempo]').forEach(b => b.addEventListener('click', () => applyTempo(b.dataset.tempo)));
$('rampOn').addEventListener('change', e => { cur.ramp = e.target.checked; if (!cur.ramp && liveTempo !== cur.tempo) setLiveTempo(cur.tempo); persist(); });
$('countIn').addEventListener('change', e => { cur.countIn = e.target.checked; persist(); });

// ---- mixer ----
const anySolo = () => STEMS.some(s => cur.solo[s.id]);
const isOff = id => !!cur.mute[id] || (anySolo() && !cur.solo[id]) || cur.gains[id] === 0;
function applyGains() { if (!player) return; for (const s of STEMS) player.setGain(s.id, isOff(s.id) ? 0 : cur.gains[s.id]); }
function mixerChanged() { cur.preset = -1; applyGains(); renderPresets(); renderMixer(); refreshPadStates(); drawTimelineStatic(); persist(); }
function renderPresets() {
  const pi = ['check', 'target', 'eq', 'micoff', 'note', 'note', 'eq'];
  $('presets').innerHTML = PRESETS.map((p, i) => `<button data-preset="${i}" class="${cur.preset === i ? 'on' : ''}">${cur.preset === i ? ico('check') : ''}${esc(p.n)}</button>`).join('');
  $('presetBadge').textContent = PRESETS[cur.preset] ? 'Preset: ' + PRESETS[cur.preset].n : 'Personalizzato';
}
$('presets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return;
  const p = PRESETS[+b.dataset.preset]; STEMS.forEach((s, k) => { cur.gains[s.id] = p.g[k] / 100; }); cur.mute = {}; cur.solo = {};
  applyGains(); cur.preset = +b.dataset.preset; renderPresets(); renderMixer(); refreshPadStates(); drawTimelineStatic(); persist(); toast(p.n); });
const TAGS = { vocals: 'Voce principale e cori', guitar: 'Requinto e chitarra ritmica', bass: 'Groove sincopato', bongo: 'Martillo, cencerro, percussioni', guira: 'Raspa: scandisce ogni tempo', altro: 'Synth, archi, piano' };
function renderMixer() {
  $('paneMix').innerHTML = STEMS.map(s => {
    const byOther = !cur.mute[s.id] && anySolo() && !cur.solo[s.id], g = Math.round(cur.gains[s.id] * 100), solo = !!cur.solo[s.id], mute = !!cur.mute[s.id];
    const sub = byOther ? 'Spento: un altro è in solo' : s.id === 'guira' && !cur.withGuira ? 'Non separata (dentro il bongo)' : TAGS[s.id];
    return `<div class="ch${byOther ? ' byother' : ''}${solo ? ' solo' : ''}${mute ? ' muted' : ''}" data-id="${s.id}" style="--c:var(--c-${s.id})">
    <div class="hd"><span class="ic">${sico(s.id)}</span><span class="nm"><b>${s.n}</b><span class="tg${byOther ? ' why' : ''}">${sub}</span></span>
    <span class="v">${mute ? 'MUTO' : g + '%'}</span>
    <button class="m${mute ? ' on' : ''}" aria-pressed="${mute}" aria-label="Muto ${s.n}">M</button>
    <button class="s${solo ? ' on' : ''}" aria-pressed="${solo}" aria-label="Solo ${s.n}">S</button></div>
    <div class="fd"><input type="range" min="0" max="200" step="5" value="${g}" aria-label="Volume ${s.n}" style="--p:${g / 2}%"></div></div>`; }).join('');
}
$('paneMix').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const id = b.closest('.ch').dataset.id;
  if (b.classList.contains('m')) toggleMute(id);
  if (b.classList.contains('s')) toggleSolo(id);
  mixerChanged();
});
$('paneMix').addEventListener('input', e => {
  if (e.target.type !== 'range') return; const ch = e.target.closest('.ch'), id = ch.dataset.id;
  cur.gains[id] = e.target.value / 100; ch.querySelector('.v').textContent = cur.mute[id] ? 'MUTO' : e.target.value + '%';
  cur.preset = -1; applyGains(); renderPresets(); refreshPadStates(); persist();
});
$('paneMix').addEventListener('change', () => drawTimelineStatic());

// ---- sheet ----
function openSheet() { $('sheet').classList.add('on'); $('scrim').classList.add('on'); navState(); if (location.hash !== '#mixer') location.hash = 'mixer'; }
function closeSheet(fromNav) { const was = $('sheet').classList.contains('on'); $('sheet').classList.remove('on'); $('scrim').classList.remove('on'); navState(); if (was && !fromNav && location.hash === '#mixer') history.back(); }
$('mixBtn').addEventListener('click', () => { tab('mix'); openSheet(); }); $('navBpm').addEventListener('click', () => { tab('beat'); openSheet(); });
$('navLab').addEventListener('click', () => closeSheet());
$('allOn').addEventListener('click', () => { if (!cur) return; cur.mute = {}; cur.solo = {}; STEMS.forEach(s => { if (cur.gains[s.id] === 0) cur.gains[s.id] = 1; }); mixerChanged(); toast('Tutti gli strumenti accesi'); }); $('scrim').addEventListener('click', () => closeSheet()); $('sheetClose').addEventListener('click', () => closeSheet());
function navState() { const open = $('sheet').classList.contains('on'), mix = !$('tabMix').classList.contains('on') ? false : true;
  $('navLab').classList.toggle('on', !open); $('mixBtn').classList.toggle('on', open && mix); $('navBpm').classList.toggle('on', open && !mix); }
function tab(which) { $('tabMix').classList.toggle('on', which === 'mix'); setTimeout(navState); $('tabBeat').classList.toggle('on', which === 'beat'); $('paneMixWrap').hidden = which !== 'mix'; $('paneBeat').hidden = which !== 'beat'; }
$('tabMix').addEventListener('click', () => tab('mix')); $('tabBeat').addEventListener('click', () => tab('beat'));
(function sheetSwipe() { const g = $('sheet').querySelector('.grab'); let y0 = null;
  g.style.touchAction = 'none'; g.style.padding = '10px 0'; g.style.backgroundClip = 'content-box';
  g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 > 40) closeSheet(); y0 = null; }); })();

// ---- rhythm: metronome, the "1", BPM ----
function renderAcc() { document.querySelectorAll('[data-acc]').forEach(b => b.classList.toggle('on', b.dataset.acc === cur.met.acc));
  const on = !!cur.met.on; $('metBtn').classList.toggle('on', on); $('metBtn').setAttribute('aria-pressed', String(on)); $('metBtn').innerHTML = ico('timer') + '<span>METRONOMO<b>' + (on ? 'ON' : 'OFF') + '</b></span>';
  $('metVolV').textContent = cur.met.vol + '%'; }
function applyMet() {
  if (!player || !cur) return;
  const want = cur.met.acc === '48' ? [4, 8] : cur.met.acc === '15' ? [1, 5] : [1];
  const acc = []; for (let i = 0; i < cur.beats.length; i++) if (want.includes(countOf(i))) acc.push(i);
  player.setMetronome({ enabled: cur.met.on && hasBeats(), beats: Float64Array.from(cur.beats), accents: acc, volume: cur.met.vol / 100 });
}
function setMet(on) { cur.met.on = on; $('metOn').checked = on; renderAcc(); applyMet(); persist(); }
$('metOn').addEventListener('change', e => setMet(e.target.checked));
$('metBtn').addEventListener('click', () => { if (!cur) return; if (!hasBeats()) return toast('Ritmo non trovato'); setMet(!cur.met.on); toast(cur.met.on ? 'Metronomo acceso' : 'Metronomo spento'); });
$('metVol').addEventListener('input', e => { cur.met.vol = +e.target.value; $('metVolV').textContent = cur.met.vol + '%'; applyMet(); persist(); });
document.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => { cur.met.acc = b.dataset.acc; renderAcc(); applyMet(); persist(); }));
// The tap comes a little after the 1 is heard: take the beat nearest to (tap time − reaction lag).
// Measured delay between a sound and the tap on it (speakers, Bluetooth, reaction), or null if never calibrated.
const tapOffset = () => ls.get('tapOffset', null);
function setOneHere() {
  if (!hasBeats() || !player) return;
  const lag = tapOffset() != null ? tapOffset() : TAP_LAG;
  const i = nearestBeat(player.position - (player.isPlaying ? lag : 0)); if (i < 0) return;
  cur.oneIdx = ((i % 8) + 8) % 8; lastCount = -1; applyMet(); drawTimelineStatic(); computePhrases(); renderGrid(); persist();
  if (loopMode === 4 || loopMode === 8) { const n = loopMode; loopMode = null; beatLoop(n); }
  toast('Ok, l\'1 è qui'); vibrate(15);
}
$('oneBtn').addEventListener('pointerdown', e => { e.preventDefault(); setOneHere(); });
$('oneBtn').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOneHere(); } });
function regrid(bpm) {
  const t = player.position, i = Math.max(0, nearestBeat(t)), anchor = beatTime(i - (countOf(i) - 1));
  const g = Array.from(BeatTracker.grid(bpm, anchor, player.duration));
  let k = 0, best = Infinity; g.forEach((v, j) => { const d = Math.abs(v - anchor); if (d < best) { best = d; k = j; } });
  cur.bpm = bpm; cur.beats = g; cur.oneIdx = ((k % 8) + 8) % 8; lastCount = -1; if (loopRange) clearLoop(false); updateBeatInfo(); persist();
  cur.notes = cur.notes || [];
}
document.querySelectorAll('[data-bpm]').forEach(b => b.addEventListener('click', () => {
  if (!cur.bpmDetected) return toast('Ritmo non trovato'); const v = b.dataset.bpm;
  if (v === 'reset') { cur.bpm = cur.bpmDetected; cur.beats = cur.beatsDetected.slice(); cur.oneIdx = cur.oneDetected; lastCount = -1; if (loopRange) clearLoop(false); updateBeatInfo(); persist(); return; }
  regrid(v === 'half' ? cur.bpm / 2 : v === 'double' ? cur.bpm * 2 : Math.max(40, Math.min(240, cur.bpm + +v)));
}));

// ---- markers ----
function renderMarks() {
  cur.marks.sort((a, b) => a.t - b.t);
  $('marks').innerHTML = cur.marks.map((m, i) => `<button data-mark="${i}">${esc(m.name)} · ${fmt(m.t)}</button>`).join(''); lastSec = -2;
}
async function addMark(t) {
  if (!cur) return;
  if (cur.marks.length >= 12) return toast('Massimo 12 segnalibri');
  if (hasBeats()) t = Math.max(0, beatTime(phraseStartIdx(t)));
  const wrap = document.createElement('div'), inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 24; inp.placeholder = 'Nome';
  const chips = document.createElement('div'); chips.className = 'chips';
  MARK_NAMES.forEach(n => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => { inp.value = n; }; chips.append(b); });
  const p = document.createElement('p'); p.className = 'mute small'; p.textContent = 'All\'inizio della frase, a ' + fmt(t);
  wrap.append(p, chips, inp);
  const ok = await dialog('Nuovo segnalibro', wrap, [['Annulla', false], ['Salva', true, true]]);
  if (ok && cur) { cur.marks.push({ t, name: inp.value.trim() || 'Segno ' + (cur.marks.length + 1) }); renderMarks(); drawTimelineStatic(); persist(); }
}
$('markBtn').addEventListener('click', () => player && addMark(player.position));
(function markInput() {
  let lp = 0, fired = false;
  $('marks').addEventListener('pointerdown', e => { const b = e.target.closest('[data-mark]'); if (!b) return; fired = false;
    lp = setTimeout(() => { fired = true; markMenu(+b.dataset.mark); }, 600); });
  const stop = () => clearTimeout(lp);
  $('marks').addEventListener('pointerup', stop); $('marks').addEventListener('pointercancel', stop);
  $('marks').addEventListener('contextmenu', e => e.preventDefault());
  $('marks').addEventListener('click', e => { const b = e.target.closest('[data-mark]'); if (!b) return; if (fired) { fired = false; return; } seekTo(cur.marks[+b.dataset.mark].t, false); });
})();
$('menuBtn').addEventListener('click', () => cur && projectMenu(cur.id));

// ---- section loops from bookmarks (a bookmark starts a section that ends at the next one) ----
function sectionOf(idx) { const m = cur.marks[idx], next = cur.marks[idx + 1]; return [m.t, next ? next.t : player.duration]; }
async function markMenu(idx) {
  const m = cur.marks[idx]; if (!m) return;
  const v = await dialog(m.name + ' · ' + fmt(m.t), null, [['Loop sezione', 'loop', true], ['Rinomina', 'ren'], ['Elimina', 'del'], ['Chiudi', null]]);
  if (!cur) return;
  if (v === 'loop') { const [a, b] = sectionOf(idx); if (b - a < 0.5) return toast('Sezione troppo corta'); abA = null; loopMode = 'ab'; setLoop(a, b); updateLoopBtns(); userSeekAt = performance.now(); player.seek(a); syncVideo(true); toast('Loop: ' + m.name); }
  if (v === 'ren') { const inp = document.createElement('input'); inp.type = 'text'; inp.value = m.name; inp.maxLength = 24;
    if (await dialog('Rinomina segnalibro', inp, [['Annulla', false], ['Salva', true, true]]) && cur && inp.value.trim()) { m.name = inp.value.trim(); renderMarks(); persist(); } }
  if (v === 'del' && await dialog('Eliminare "' + m.name + '"?', null, [['No', false], ['Elimina', true, true]]) && cur) { cur.marks.splice(idx, 1); renderMarks(); drawTimelineStatic(); persist(); }
}

// ---- phrases: which instruments play in each 8, so changes can be seen and announced ----
let phrases = [];
const PCOLORS = ['#ff4f73', '#00e3fd', '#ffba38', '#b693ff', '#7ee0a1', '#ffd9dc', '#5ea8ff', '#ff9b5e'];
function computePhrases() {
  phrases = [];
  if (!cur || !player || !hasBeats()) return;
  const r = cur.envRate || 10, first = phraseStartIdx(0), sigs = {};
  for (let ps = first; beatTime(ps) < player.duration - 0.5; ps += 8) {
    const a = Math.max(0, beatTime(ps)), b = Math.min(player.duration, beatTime(ps + 8));
    const active = STEMS.filter(st => { const e = cur.env[st.id] || [], i0 = Math.floor(a * r), i1 = Math.max(i0 + 1, Math.floor(b * r));
      let sum = 0; for (let k = i0; k < i1; k++) sum += e[k] || 0; return sum / (i1 - i0) / (envScale[st.id] || 1) > 0.45; }).map(st => st.id);
    const sig = active.join(',');
    if (!(sig in sigs)) sigs[sig] = Object.keys(sigs).length;
    phrases.push({ ps, active, sig, color: PCOLORS[sigs[sig] % PCOLORS.length] });
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
function renderGrid() {
  const g = $('grid8'); if (!cur || !hasBeats()) { g.innerHTML = '<p class="mute small" style="padding:8px">Ritmo non trovato</p>'; return; }
  const st = styleOf();
  g.innerHTML = phrases.map((p, k) => `<div class="prow" data-k="${k}" style="--pc:${p.color}"><span class="ph">F${k + 1}<i>${p.active.map(id => `<b style="--c:var(--c-${id})"></b>`).join('')}</i></span>${
    [0, 1, 2, 3, 4, 5, 6, 7].map(j => { const i = p.ps + j, c = j + 1, t = beatTime(i); if (t < -0.05 || t > player.duration) return '<span></span>';
      return `<button class="cell${st.tag[c] ? ' tap' : ''}${notesAt(i).length ? ' note' : ''}" data-i="${i}">${c}</button>`; }).join('')}</div>`).join('');
  gridRows = [...g.querySelectorAll('.prow')]; gridNow = null;
}
let gridRows = [], gridNow = null, gridNext = null;
function updateGrid(i, k, warn) {
  if (cur.view !== 'grid') return;
  const cell = $('grid8').querySelector(`.cell[data-i="${i}"]`);
  if (gridNow && gridNow !== cell) gridNow.classList.remove('now');
  if (cell) { cell.classList.add('now'); gridNow = cell; }
  const nx = warn ? gridRows[k + 1] : null;
  if (gridNext && gridNext !== nx) gridNext.classList.remove('next');
  if (nx) nx.classList.add('next'); gridNext = nx;
  const row = gridRows[k], box = $('grid8');
  if (row && (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTo({ top: Math.max(0, row.offsetTop - 3), behavior: 'smooth' });
}
function setView(v, quiet) {
  cur.view = v === 'grid' ? 'grid' : 'timeline';
  $('tlbox').classList.toggle('gridmode', cur.view === 'grid');
  $('viewTl').classList.toggle('on', cur.view !== 'grid'); $('viewGrid').classList.toggle('on', cur.view === 'grid');
  if (cur.view === 'grid') { renderGrid(); lastCount = -1; } else requestAnimationFrame(drawTimelineStatic);
  if (!quiet) persist();
}
$('viewTl').addEventListener('click', () => cur && setView('timeline')); $('viewGrid').addEventListener('click', () => cur && setView('grid'));
if (window.ResizeObserver) new ResizeObserver(() => { if (cur && player) { drawTimelineStatic(); drawTimeline(player.position); } }).observe($('tl'));
(function gridInput() {
  const g = $('grid8'); let lp = 0, fired = false;
  g.addEventListener('pointerdown', e => { const c = e.target.closest('.cell'); if (!c) return; fired = false;
    lp = setTimeout(() => { fired = true; editNote(+c.dataset.i); }, 550); });
  const stop = () => clearTimeout(lp); g.addEventListener('pointerup', stop); g.addEventListener('pointercancel', stop);
  g.addEventListener('contextmenu', e => e.preventDefault());
  g.addEventListener('click', e => { const c = e.target.closest('.cell'); if (!c) return; if (fired) { fired = false; return; }
    const t = Math.max(0, beatTime(+c.dataset.i)); if (loopRange && (t < loopRange[0] || t >= loopRange[1])) clearLoop(false); userSeekAt = performance.now(); player.seek(t); syncVideo(true); });
})();
async function editNote(i) {
  const ex = notesAt(i)[0], inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 60; inp.placeholder = 'Es. giro, dip, body roll'; inp.value = ex ? ex.text : '';
  const wrap = document.createElement('div'); const p = document.createElement('p'); p.className = 'mute small'; p.textContent = `Frase ${Math.floor((i - phraseStartIdx(0)) / 8) + 1}, tempo ${countOf(i)}`; wrap.append(p, inp);
  const v = await dialog('Nota sul tempo', wrap, ex ? [['Elimina', 'del'], ['Annulla', false], ['Salva', true, true]] : [['Annulla', false], ['Salva', true, true]]);
  if (!cur || !v) return;
  cur.notes = (cur.notes || []).filter(n => n !== ex);
  if (v === true && inp.value.trim()) { cur.notes.push({ t: beatTime(i), text: inp.value.trim() }); toast('Nota salvata'); }
  renderGrid(); persist();
}

// ---- style of the count ----
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
    $('tapLbl').innerHTML = ico('hand') + 'TAP · ' + String(bpm).replace('.', ',') + ' BPM';
    clearTimeout(taps.t); taps.t = setTimeout(() => { if (bpm >= 60 && bpm <= 220) { regrid(bpm); toast('Tempo impostato a ' + Math.round(bpm) + ' BPM'); } taps = []; $('tapLbl').innerHTML = ico('hand') + 'TAP TEMPO'; }, 1600);
  } else $('tapLbl').innerHTML = ico('hand') + 'TAP ' + taps.length + '/4';
});

// ---- training: the count disappears, the dancer taps ----
let training = null;
const PERFECT = 0.03; // a tap within 30 ms of the beat counts as perfect
const GAMES = {
  one: { n: "Trova l'1", target: 'Primo tempo', desc: "Ascolta e tocca solo sull'1 di ogni frase (ogni 8 tempi). Allena il riconoscimento del cambio di frase.", want: c => c === 1,
    pad: "Tap sull'1", help: "Tocca esattamente sull'1", help2: 'Segui il basso e i cambi di accordo',
    tipT: 'Segui basso e accordi', tip: "Il basso e la chitarra cambiano accordo proprio sull'1: aspetta il cambio invece di anticiparlo con il corpo." },
  beat: { n: 'A tempo', target: '1-2-3-4-5-6-7-8', desc: 'Tocca su ogni tempo, come un passo. Ideale per sentire la pulsazione continua del brano.', want: () => true,
    pad: 'Tocca ogni tempo', help: 'Tocca su ogni tempo', help2: 'Segui la güira: scandisce ogni tempo',
    tipT: 'Segui la güira', tip: 'La güira raspa su ogni tempo in modo regolare: se ti perdi, ascolta lei e lascia stare la voce.' },
  tap: { n: 'Il tap', target: '4 e 8', desc: "La firma della bachata: tocca solo sul 4 e sull'8, il momento del tap. Allena a non anticipare il piede.", want: c => c === 4 || c === 8,
    pad: 'Tap sul 4 e sull\'8', help: "Tocca sul 4 e sull'8", help2: 'Senti il bongo che chiude la mezza frase',
    tipT: 'Ascolta il bongo', tip: "Il tap cade sul 4 e sull'8: il bongo chiude ogni mezza frase con un colpo più marcato. Aspettalo, non anticiparlo." } };
function trainStats() { const st = ls.get('trainStats', { best: {}, days: [] }); st.bestMs = st.bestMs || {}; return st; }
function trainOpts() { return Object.assign({ guide: 'bg', len: 4 }, ls.get('trainOpts', {})); }
function streakDays(st) { let n = 0; const d = new Date(); for (;;) { const k = d.toISOString().slice(0, 10); if (!st.days.includes(k)) break; n++; d.setDate(d.getDate() - 1); } return n; }
function showTrain(which) { ['trainMenu', 'trainPlay', 'trainDone'].forEach(id => { $(id).hidden = id !== which; }); $('train').scrollTop = 0; }
function renderTrainMenu() {
  const st = trainStats(), sd = streakDays(st), o = trainOpts();
  $('trainTitle').textContent = 'Allenamento: scegli esercizio';
  $('trainTrack').textContent = cur.name; $('trainBpm').textContent = Math.round(cur.bpm) + ' BPM';
  $('streakBox').hidden = !sd; $('trainStreak').textContent = sd === 1 ? 'Allenato oggi!' : sd + ' giorni di fila!';
  $('games').innerHTML = Object.entries(GAMES).map(([k, g], gi) => `<div class="panel game" data-g="${k}">
    <div class="gh"><span class="gi">${gi === 0 ? '1' : ico(gi === 1 ? 'gauge' : 'hand')}</span><div class="gn"><b>${g.n}</b><span>Target: ${g.target}</span></div></div>
    <p>${g.desc}</p>
    <div class="steps8">${[1, 2, 3, 4, 5, 6, 7, 8].map(c => `<i class="${g.want(c) ? 'on' : ''}${c === 1 || c === 5 ? ' one' : ''}">${c}</i>`).join('')}</div>
    <div class="gf"><span class="rec">${ico('trophy')}Record: <b>${st.best[k] != null ? st.best[k] + '%' + (st.bestMs[k] != null ? ' · ±' + st.bestMs[k] + ' ms' : '') : '–'}</b></span><button class="go" data-game="${k}">INIZIA ${ico('play')}</button></div></div>`).join('');
  document.querySelectorAll('[data-guide]').forEach(b => b.classList.toggle('on', b.dataset.guide === o.guide));
  document.querySelectorAll('[data-len]').forEach(b => b.classList.toggle('on', +b.dataset.len === o.len));
}
function renderCal() { const o = tapOffset();
  $('calTxt').textContent = o == null ? "Non calibrato. Rifallo quando cambi cuffie o casse (il Bluetooth aggiunge ritardo)." : `Calibrato: ${Math.round(o * 1000)} ms tra suono e tocco.`; }
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
  const wrap = document.createElement('div'), p = textEl('Tocca il riquadro esattamente su ogni click, come se fosse il tempo. I primi 4 servono per prendere il ritmo.'); p.className = 'mute small';
  const pad = document.createElement('div'); pad.className = 'calpad'; pad.textContent = 'Tocca sul click';
  pad.addEventListener('pointerdown', e => { e.preventDefault(); taps.push(c.currentTime); pad.classList.add('flash'); setTimeout(() => pad.classList.remove('flash'), 90); vibrate(8); });
  wrap.append(p, pad);
  const timer = setTimeout(() => closeDialog('done'), (t0 - c.currentTime + N * per + 0.6) * 1000);
  const v = await dialog('Calibra il ritardo', wrap, [['Annulla', false]]); clearTimeout(timer);
  if (v !== 'done') return;
  const d = []; for (const t of taps) { let best = null; for (let k = 4; k < N; k++) { const x = t - clicks[k]; if (best == null || Math.abs(x) < Math.abs(best)) best = x; } if (best != null && Math.abs(best) < 0.35) d.push(best); }
  if (d.length < 6) return dialog('Calibrazione non riuscita', textEl('Servono almeno 6 tocchi vicini ai click. Riprova con calma.'), [['OK', 0, true]]);
  d.sort((x, y) => x - y); const lat = c.outputLatency > 0 ? c.outputLatency : (c.baseLatency || 0);
  const off = Math.max(-0.1, Math.min(0.5, d[Math.floor(d.length / 2)] - lat));
  ls.set('tapOffset', off); renderCal(); toast('Ritardo misurato: ' + Math.round(off * 1000) + ' ms');
}
function openTraining() {
  if (!hasBeats()) return toast('Serve il ritmo: questo brano non ce l\'ha');
  renderTrainMenu(); renderCal(); showTrain('trainMenu'); $('train').classList.add('on'); if (location.hash !== '#allenamento') location.hash = 'allenamento';
}
function closeTraining(fromNav) { stopTraining(); $('train').classList.remove('on'); if (!fromNav && location.hash === '#allenamento') history.back(); }
$('trainBtn').addEventListener('click', openTraining);
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
  $('tPause').innerHTML = ico(tr.paused ? 'play' : 'pause') + `<span>${tr.paused ? 'RIPRENDI' : 'PAUSA'}</span>`; setPlayIcon(); });
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
  $('trainTitle').textContent = 'Allenamento: sessione live';
  $('tGame').textContent = 'Gioco: ' + g.n; $('tLeft').textContent = 'Preparati'; $('tHits').textContent = '0/' + targets.length; $('tErr').textContent = '–';
  $('tSegs').className = 'segs4' + (nPh > 4 ? ' n8' : ''); $('tSegs').innerHTML = '<i></i>'.repeat(nPh);
  $('tPrep').textContent = '4 tempi di preparazione: 5, 6, 7, 8…'; $('tWhat').textContent = g.pad; $('tMsg').textContent = 'Ascolta…';
  $('tHelp').textContent = g.help; $('tHelp2').textContent = 'Nessun numero sullo schermo · ' + g.help2;
  $('tLate').className = 'late'; $('tLate').innerHTML = '<i></i>Aspetta il primo tocco'; $('tLast').textContent = ''; $('tMark').style.display = 'none';
  $('tPause').innerHTML = ico('pause') + '<span>PAUSA</span>';
  showTrain('trainPlay');
  await audioCtx().resume(); trainingSound(true); userSeekAt = performance.now(); player.seek(pre); if (!player.isPlaying) player.play(); setPlayIcon(); keepAwake();
}
function trainTick(t) {
  const tr = training; if (!tr || tr.done) return;
  if (t >= tr.startT - 0.05) {
    const k = Math.min(tr.nPh - 1, Math.floor((t - tr.startT) / ((tr.endT - tr.startT) / tr.nPh)));
    if (k !== tr.ph) { tr.ph = k; $('tLeft').textContent = `Frase ${k + 1} di ${tr.nPh}`; [...$('tSegs').children].forEach((x, j) => { x.className = j < k ? 'done' : j === k ? 'now' : ''; });
      if (k === 0) $('tPrep').textContent = 'Preparazione finita · registrazione dei tocchi attiva'; }
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
    $('tMsg').textContent = ok ? 'Perfetto!' : dt < 0 ? 'In anticipo' : 'In ritardo';
    $('tLate').className = 'late' + (ok ? ' ok' : ''); $('tLate').innerHTML = '<i></i>' + (ok ? 'A tempo' : dt < 0 ? 'In anticipo di ' + -ms + ' ms' : 'In ritardo di +' + ms + ' ms');
    $('tMark').style.display = 'block'; $('tMark').style.left = (50 + Math.max(-150, Math.min(150, ms)) / 3) + '%';
    $('tLast').textContent = 'Ultimo tocco sul ' + countOf(i);
  } else {
    tr.wrong++; pad.classList.add('miss'); const ms = Math.round(dt * 1000);
    if (target && target.hit) $('tMsg').textContent = 'Già preso';
    else if (target) { // right count, too far from it: say how far, so a late tap on the 1 is not reported as "not the 1"
      $('tMsg').textContent = `Era il ${countOf(i)}, ma troppo ${dt < 0 ? 'presto' : 'tardi'}`;
      $('tLate').className = 'late'; $('tLate').innerHTML = '<i></i>' + (dt < 0 ? 'In anticipo di ' + -ms + ' ms' : 'In ritardo di +' + ms + ' ms');
      $('tMark').style.display = 'block'; $('tMark').style.left = (50 + Math.max(-150, Math.min(150, ms)) / 3) + '%';
    } else $('tMsg').textContent = 'Quello era il ' + countOf(i);
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
  $('trainTitle').textContent = 'Allenamento: risultato';
  $('tRecord').hidden = !(best && score > 0);
  $('tRing').style.strokeDashoffset = (452.4 * (1 - score / 100)).toFixed(1); $('tScore').innerHTML = score + '<small>%</small>';
  $('tResTitle').textContent = score >= 85 ? 'Ritmo eccellente · sentito sul corpo' : score >= 60 ? 'Bene · ci sei quasi' : 'Riproviamo · ascolta ancora';
  $('tHitsR').innerHTML = `${h}/${n} <small>(${Math.round(100 * h / Math.max(1, n))}%)</small>`; $('tHitsBar').style.width = (100 * h / Math.max(1, n)) + '%';
  $('tPrec').innerHTML = E.length ? `±${Math.round(meanAbs)} <small>ms</small>` : '–'; $('tPrecBar').style.width = (E.length ? Math.max(4, 100 - meanAbs / 1.5) : 0) + '%';
  const early = E.filter(x => x < -PERFECT * 1000).length, late = E.filter(x => x > PERFECT * 1000).length, ok = E.length - early - late;
  const pc = v => E.length ? Math.round(100 * v / E.length) : 0;
  $('tDist').innerHTML = `<span class="k">Distribuzione dei tocchi · ${E.length} a segno</span>` + [['Anticipo', early, 'var(--am)'], ['Perfetto (±30 ms)', ok, 'var(--cy)'], ['Ritardo', late, 'var(--pri)']]
    .map(([l, v, c]) => `<div class="row" style="--dc:${c}"><span><i></i>${l}</span><span>${pc(v)}% (${v})</span></div><div class="bar" style="--dc:${c}"><i style="width:${pc(v)}%"></i></div>`).join('');
  $('tTrend').innerHTML = E.length >= 3 && Math.abs(bias) > 25 ? `${ico('trend')}<div><span class="k">Tendenza ritmica</span><p><b style="color:var(--am)">Tendi ad arrivare ${bias < 0 ? 'in anticipo' : 'in ritardo'}</b> nel ${pc(bias < 0 ? early : late)}% dei tocchi, in media di ${Math.round(Math.abs(bias))} ms. ${bias < 0 ? 'Aspetta un attimo di più.' : 'Anticipa leggermente.'}${bias > 60 && tapOffset() == null ? ' Se usi cuffie o casse Bluetooth, prova "Calibra": parte del ritardo può essere dell\'audio.' : ''}</p></div>`
    : E.length >= 3 ? `${ico('check')}<div><span class="k" style="color:var(--cy)">Tendenza ritmica</span><p>Sei centrato: né in anticipo né in ritardo.${tr.wrong ? ' Tocchi fuori bersaglio: ' + tr.wrong + '.' : ''}</p></div>` : '';
  $('tTipT').textContent = GAMES[tr.game].tipT; $('tResTip').textContent = GAMES[tr.game].tip + (tr.wrong && !(E.length >= 3 && Math.abs(bias) <= 25) ? ` Tocchi fuori bersaglio: ${tr.wrong}.` : '');
  showTrain('trainDone');
}
function stopTraining(keepOpen) {
  const tr = training; if (!tr) return; training = null;
  if (player && player.isPlaying) { player.pause(); setPlayIcon(); }
  trainingSound(false);
  if (tr.wasLoop && !keepOpen && player) { setLoop(tr.wasLoop[0], tr.wasLoop[1]); loopMode = 'ab'; updateLoopBtns(); }
}


// ---------- start ----------
if (location.hash) history.replaceState(null, '', location.pathname);
renderHome().then(() => show('home'));
}
