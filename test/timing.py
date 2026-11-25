import sys, time
from playwright.sync_api import sync_playwright
port=sys.argv[1]; guira=sys.argv[2]=='1'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':390,'height':760})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: print('console:', m.text) if 'thread' in m.text.lower() or m.type=='error' else None)
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_timeout(800)
    print('coi', pg.evaluate('crossOriginIsolated'), 'hw', pg.evaluate('navigator.hardwareConcurrency'))
    pg.set_input_files('#file', '/home/claude/app/test/frio30.mp4'); pg.wait_for_timeout(2500)
    if not guira: pg.click('label.opt .sw')
    pg.click('#createBtn'); t0=time.time(); tw=None
    while time.time()-t0 < 900:
        h=pg.evaluate('location.hash')
        if tw is None and pg.evaluate("(document.getElementById('procWhat')||{}).textContent")=='Separazione': tw=time.time()
        if h=='#player': break
        pg.wait_for_timeout(500)
    print('total', round(time.time()-t0,1), 'work', round(time.time()-(tw or t0),1), 'ERR', errs[:3]); b.close()
