# Checks the Android-app path of the page with a fake Capacitor bridge (no real separation).
from playwright.sync_api import sync_playwright
MOCK = r'''
(() => {
  let frames = 0, polls = 0, st = 'idle', files = null, appended = 0;
  window.Capacitor = { isNativePlatform: () => true, convertFileSrc: p => p,
    nativePromise: async (plugin, m, o) => {
      if (plugin === 'KeepAwake') return {};
      if (m === 'begin') { frames = o.frames; return {}; }
      if (m === 'append') { appended += atob(o.data).length / 2; return {}; }
      if (m === 'run') { st = 'loading'; polls = 0; return {}; }
      if (m === 'status') { polls++;
        if (polls > 2) st = 'running';
        if (polls > 8) { st = 'done'; files = {};
          for (const id of ['vocals','guitar','bass','bongo','guira','altro']) { const a = new Int16Array(frames * 2); for (let i = 0; i < a.length; i++) a[i] = Math.round(8000 * Math.sin(i / (20 + id.length))); files[id] = URL.createObjectURL(new Blob([a.buffer])); } }
        return { state: st, stage: polls < 6 ? 'demucs' : 'guira', i: polls % 6 + 1, n: 6, threads: 4, files };
      }
      if (m === 'cleanup' || m === 'cancel') return {};
      throw new Error('unknown ' + m);
    } };
  window.__appended = () => appended;
})();
'''
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':390,'height':760})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
    pg.add_init_script(MOCK)
    pg.goto('http://127.0.0.1:8765/index.html'); pg.wait_for_timeout(800)
    pg.set_input_files('#file', '/home/claude/app/test/frio30.mp4'); pg.wait_for_timeout(2500)
    print('est', pg.inner_text('#estMin'), '|', pg.inner_text('#est')[:80])
    pg.click('#createBtn')
    for k in range(40):
        pg.wait_for_timeout(500)
        if pg.evaluate('location.hash')=='#player': break
    print('hash', pg.evaluate('location.hash'), 'appended', pg.evaluate('__appended()'), 'title', pg.inner_text('#pTitle'))
    print('ERR', errs); b.close()
