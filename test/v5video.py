import re
from playwright.sync_api import sync_playwright
JS=re.search(r"JS = r'''(.*?)'''", open('/home/claude/app/test/inject.py').read(), re.S).group(1)
JS=JS.replace("await put('stems',{id:'ptest'","const vb=await (await fetch('_test/frio30.mp4')).blob(); await put('media',{id:'ptest',blob:vb,type:'video/mp4'});\n  await put('stems',{id:'ptest'")
JS=JS.replace("name:'Frío (prova)',","name:'Frío video (prova)',kind:'video',mirror:true,")
JS=JS.replace("marks:[]","marks:[{t:1.0,name:'Intro'},{t:9.2,name:'Derecho'},{t:17.4,name:'Majao'}]")
O='/home/claude/app/test/n_'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':390,'height':760}, device_scale_factor=2)
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://127.0.0.1:8765/index.html'); pg.wait_for_timeout(800); pg.evaluate(JS); pg.reload(); pg.wait_for_timeout(900)
    pg.screenshot(path=O+'home_v.png')
    pg.click('.proj'); pg.wait_for_timeout(1800); pg.click('#playBtn'); pg.wait_for_timeout(3000)
    print('scroll', pg.evaluate('document.documentElement.scrollHeight'), 'tl h', pg.evaluate("document.getElementById('tl').getBoundingClientRect().height"))
    pg.screenshot(path=O+'video.png')
    pg.click('#loop8'); pg.wait_for_timeout(1200); pg.screenshot(path=O+'video_loop.png')
    print('tl h with loop', pg.evaluate("document.getElementById('tl').getBoundingClientRect().height"))
    pg.click('#s-player [data-go="home"] >> nth=0'); pg.wait_for_timeout(600)
    print('ERRORS', errs); b.close()
