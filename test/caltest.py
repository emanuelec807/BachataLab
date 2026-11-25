import re
from playwright.sync_api import sync_playwright
JS=re.search(r"JS = r'''(.*?)'''", open('/home/claude/app/test/inject.py').read(), re.S).group(1)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg = b.new_page(viewport={'width':390,'height':760}, device_scale_factor=2)
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8765/index.html'); pg.wait_for_timeout(800); pg.evaluate(JS); pg.reload(); pg.wait_for_timeout(800)
    print('storage', pg.inner_text('#storageUse'))
    pg.click('.proj'); pg.wait_for_timeout(1500); pg.click('#trainBtn'); pg.wait_for_timeout(400)
    print('cal', pg.inner_text('#calTxt'))
    pg.click('#calBtn'); pg.wait_for_timeout(1000+4*600)
    for k in range(12): pg.click('.calpad'); pg.wait_for_timeout(600)
    pg.screenshot(path='/home/claude/app/test/n_cal.png'); pg.wait_for_timeout(2500)
    print('cal after', pg.inner_text('#calTxt'), pg.evaluate("localStorage.getItem('tapOffset')"))
    print('ERR', errs); b.close()
