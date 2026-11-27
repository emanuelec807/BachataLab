# Componenti di terze parti

Elenco dei componenti e dei modelli usati da Bachata Lab, con la licenza **dichiarata dalla fonte**. Per i modelli
la licenza del codice non copre automaticamente i pesi: la colonna «Pesi» dice cosa risulta per i checkpoint.
Prima di una distribuzione commerciale ogni voce va ricontrollata alla fonte (revisione usata, testo della licenza).

## Modelli

| Componente | Uso nell'app | Codice | Pesi | Note |
|---|---|---|---|---|
| SCNet small (starrytong) | voce, basso, batteria, altro (APK MIT) | MIT | MIT, confermato dall'autore (issue #35 del repository) | checkpoint MUSDB18 |
| MVSep Mega 53 BS-RoFormer (ZFTurbo) | chitarra, piano (APK MIT) | MIT (Music-Source-Separation-Training) | pubblicato nella release v1.0.21 del repository MIT; nessuna licenza separata per i pesi | ridotto alle teste usate |
| AudioSep (Audio-AGI) | güira | MIT | nessuna frase esplicita sui pesi | ResUNet30 + descrizione testuale precalcolata |
| Demucs htdemucs_6s (Meta) | separazione nell'app normale e nella versione web | MIT | nessuna concessione esplicita per i pesi | non incluso nell'APK MIT |
| Whisper base (OpenAI, conversione Xenova) | trascrizione dei testi | MIT | MIT | |
| Opus-MT (Helsinki-NLP, conversioni Xenova) | traduzione dei testi | MIT (Marian) | **CC-BY 4.0**: serve l'attribuzione | scaricati solo se si usa la traduzione |
| YAMNet (Google) | nome dello strumento in «Altro» | Apache-2.0 | Apache-2.0 | |

## Librerie

| Componente | Licenza | Note |
|---|---|---|
| ONNX Runtime (Android, Web) | MIT | |
| Transformers.js (Hugging Face) | Apache-2.0 | |
| SoundTouchJS | **LGPL-2.1+** | dentro `app/player.js`; va lasciata sostituibile e va indicato dove trovarne il sorgente |
| lamejs | **LGPL-3.0** | `app/lame.min.js`, stesse condizioni |
| Capacitor e plugin (`@capacitor/*`, keep-awake) | MIT | |

## Servizi

| Servizio | Uso | Note |
|---|---|---|
| LRCLIB | testi sincronizzati | i testi delle canzoni restano dei rispettivi titolari dei diritti |
