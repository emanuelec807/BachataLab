# Bachata Lab

App web per la musicalità in bachata. Separa la canzone in strumenti **direttamente sul telefono** (anche güira e bongo), conta 1–8 con il tap su 4 e 8, ha loop di 4/8 tempi, salti, velocità con tono invariato, metronomo, segnalibri, griglia delle frasi, player video con specchio e allenamento dell'orecchio.

Tutte le funzionalità e il comportamento dell'app sono in **[FUNZIONALITA.md](FUNZIONALITA.md)**.

## Struttura

```
app/        l'app pronta da servire (HTML + JS, nessuna build necessaria)
  index.html        interfaccia (design "Stage Studio Pulse")
  app.js            logica dell'interfaccia
  player.js         riproduzione multitraccia, time-stretch, loop, metronomo
  beats.js          battiti e BPM
  separate.js       STFT/ISTFT e pipeline di separazione (Demucs + güira)
  worker.js         Web Worker: scarica i modelli e li esegue con ONNX Runtime Web
  models/           modelli ONNX (fp16) divisi in parti base64
build/      sorgente e script di build di player.js
tools/      script Python: esportazione ONNX dei modelli e verifiche
test/       test in Node e script Playwright
```

## Avvio in locale

Serve un server statico qualsiasi, per esempio:

```bash
cd app
python3 -m http.server 8000
```

Poi apri `http://localhost:8000` (da telefono: l'indirizzo del computer nella stessa rete). Per usarla dal telefono senza computer si può pubblicare la cartella `app/` con GitHub Pages.

## Modelli

| Modello | Uso | Parametri | File (fp16) |
|---|---|---|---|
| Demucs `htdemucs_6s` | voce, chitarra, basso, batteria, piano, altro | 27,4 M | 60 MB |
| AudioSep ResUNet30 + query "güira" | isola la güira dalle percussioni | 29,8 M | 60 MB |

I modelli si scaricano una volta e restano nella cache del browser. Il picco di RAM misurato durante la separazione è di circa 3,6 GB.

## Componenti di terze parti

- [Demucs](https://github.com/facebookresearch/demucs) (MIT): modello htdemucs_6s.
- [AudioSep](https://github.com/Audio-AGI/AudioSep) (MIT): separatore ResUNet30. La query di testo è calcolata con CLAP.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT).
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (LGPL-2.1), inclusa in `player.js` per cambiare velocità mantenendo il tono.

Prima di distribuire l'app pubblicamente conviene verificare le licenze dei pesi dei modelli.
