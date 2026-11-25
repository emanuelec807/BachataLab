import sys, json
from playwright.sync_api import sync_playwright
OUT='/home/claude/app/test/'
JS = r'''
async () => {
  const ids=['vocals','guitar','bass','bongo','guira','altro'];
  const ctx=new OfflineAudioContext(2,44100,44100); const st={};
  for(const id of ids){ const b=await ctx.decodeAudioData(await (await fetch('_test/'+id+'.wav')).arrayBuffer()); st[id]=[b.getChannelData(0),b.getChannelData(1)]; }
  const n=st.vocals[0].length; const m=new Float32Array(n);
  for(const id of ['bongo','guira','bass']) for(let i=0;i<n;i++) m[i]+=(st[id][0][i]+st[id][1][i])*.5;
  const bt=BeatTracker.analyze(m,44100);
  const toI=f=>{const o=new Int16Array(f.length);for(let i=0;i<f.length;i++)o[i]=Math.max(-32767,Math.min(32767,f[i]*32767));return o;};
  const data={}; for(const id of ids) data[id]=[toI(st[id][0]),toI(st[id][1])];
  const env={}; const hop=2205; for(const id of ids){const e=[];for(let i=0;i+hop<=n;i+=hop){let a=0;for(let j=i;j<i+hop;j+=4){const v=(st[id][0][j]+st[id][1][j])*.5;a+=v*v;}const db=10*Math.log10(a/(hop/4)+1e-12);e.push(Math.min(1,Math.max(0,(db+55)/45)));}env[id]=e;}
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('bachata-lab',2);r.onupgradeneeded=()=>{for(const s of ['projects','stems','media']) if(!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const put=(s,v)=>new Promise((res,rej)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).put(v);t.oncomplete=res;t.onerror=()=>rej(t.error);});
  await put('stems',{id:'ptest',n,sr:44100,data});
  // a project shaped like v1 (no kind, step, envRate, met.acc, beatsDetected...) to test migration
  await put('projects',{id:'ptest',name:'Frío (prova)',dur:n/44100,offset:0,created:Date.now(),updated:Date.now(),withGuira:true,bpm:bt.bpm,beats:Array.from(bt.beats),confidence:bt.confidence,oneIdx:0,env,gains:Object.fromEntries(ids.map(i=>[i,1])),mute:{},solo:{},preset:0,tempo:100,marks:[],pos:0,met:{on:false,vol:60}});
  db.close(); return bt.bpm;
}
'''
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 390, 'height': 760}, device_scale_factor=2, color_scheme=sys.argv[1] if len(sys.argv)>1 else 'dark')
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://127.0.0.1:8765/index.html'); pg.wait_for_timeout(800)
    print('bpm', pg.evaluate(JS))
    pg.reload(); pg.wait_for_timeout(800); pg.screenshot(path=OUT+'i_home.png')
    pg.click('.proj'); pg.wait_for_timeout(1500)
    h = pg.evaluate('document.documentElement.scrollHeight'); print('player page height', h)
    pg.click('#playBtn'); pg.wait_for_timeout(2500)
    pg.click('#loop8'); pg.wait_for_timeout(300)
    c1=pg.inner_text('#bigNum'); pg.click('#jf'); pg.wait_for_timeout(200); print('loop8 next ->', pg.evaluate('document.getElementById("toast").textContent'))
    pg.click('#fwd5'); pg.wait_for_timeout(200); print('+5s inside loop keeps loop:', pg.evaluate('document.getElementById("loop8").classList.contains("on")'))
    pg.click('#pads .pad[data-id="guira"]', delay=700); pg.wait_for_timeout(1200)
    pg.screenshot(path=OUT+'i_player.png')
    pg.click('#mixBtn'); pg.wait_for_timeout(400)
    pg.click('.ch[data-id="bass"] .m'); pg.click('.ch[data-id="bass"] .s'); pg.wait_for_timeout(200)
    print('bass M then S:', pg.evaluate('[...document.querySelectorAll(".ch[data-id=bass] button")].map(b=>b.className).join("|")'), pg.evaluate('document.querySelector("#pads .pad[data-id=bass]").className'))
    pg.screenshot(path=OUT+'i_mixer.png')
    pg.go_back(); pg.wait_for_timeout(300); print('sheet closed by back:', not pg.evaluate('document.getElementById("sheet").classList.contains("on")'), '| still player:', pg.evaluate('document.getElementById("s-player").classList.contains("on")'))
    pg.click('#tabBeat') if pg.evaluate('document.getElementById("sheet").classList.contains("on")') else None
    pg.go_back(); pg.wait_for_timeout(600); print('back -> home:', pg.evaluate('document.getElementById("s-home").classList.contains("on")'))
    pg.click('.proj'); pg.click('.proj') if pg.evaluate('!!document.querySelector(".proj")') else None; pg.wait_for_timeout(1500)
    print('ERRORS', errs)
    b.close()
