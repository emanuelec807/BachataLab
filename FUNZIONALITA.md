# Bachata Lab: funzionalità e comportamento

Questo file descrive **tutto quello che fa l'app e come si comporta**. È il riferimento unico: ogni modifica all'app aggiorna anche questo file (vedi "Registro modifiche" in fondo).

Bachata Lab è un'app per studiare la **musicalità in bachata**. Carichi una canzone o un video, l'app la divide nei suoi strumenti **direttamente sul telefono** e ti fa ascoltare, contare e allenare l'orecchio frase per frase.

- Piattaforma: app web per il browser del telefono (Chrome su Android). In futuro: APK Android.
- Privacy: nessun server. Il brano, le tracce separate e i modelli restano nel browser del telefono.
- Stile di conteggio: **solo bachata**. Il conteggio va da 1 a 8 e il **tap** cade sempre sul **4** e sull'**8**. Non esistono modalità salsa, On1 od On2.

---

## 1. Schermate e navigazione

| Schermata | Indirizzo | Come ci si arriva |
|---|---|---|
| Progetti (home) | `/` | apertura dell'app, tasto Indietro, "Progetti" |
| Nuovo progetto | `#nuovo` | "Nuovo progetto" → scelta del file |
| Separazione | `#elabora` | "Crea progetto" |
| Player (Lab) | `#player` | tocco su un progetto, oppure fine della separazione |
| Mixer & ritmo (pannello) | `#mixer` | barra in basso del player: "Strumenti" o "Ritmo" |
| Video a schermo intero | `#schermo` | tasto schermo intero sul video |
| Allenamento | `#allenamento` | "Allenati" nel player o nella home |

- Il **tasto Indietro** del telefono chiude prima il pannello o l'overlay aperto, poi torna alla home.
- Durante la separazione Indietro **non esce subito**: chiede "Annullare la separazione?". Anche chiudere o ricaricare la pagina chiede conferma.
- La cronologia resta corta: home → una schermata → eventuale pannello.

---

## 2. Home (Progetti)

**Intestazione e spazio**
- Riquadro "Elaborazione 100% sul telefono" con lo spazio usato e quello disponibile del browser (es. "37 MB / 10,8 GB") e una barra.
- "Gestisci" apre le **Impostazioni**.

**Nuovo progetto**
- Il grande riquadro "Nuovo progetto" apre la scelta del file: MP3, M4A, WAV, OGG, FLAC, AAC, oppure video MP4, MOV, WEBM.

**Elenco progetti**
- **Ricerca** per nome: compare con 3 o più progetti.
- **Filtri** Tutti / Video / Audio con il numero di progetti: compaiono solo se ci sono sia audio sia video.
- **Ordine** Recenti oppure A–Z (si ricorda la scelta): compare con 2 o più progetti.
- Ogni scheda mostra:
  - miniatura: fotogramma del video, oppure un'icona per l'audio;
  - tipo e durata;
  - nome, BPM, numero di tracce (5 o 6) e data dell'ultima modifica ("Oggi, 18:30", "Ieri, …", "12 mag");
  - il primo segnalibro (es. "Derecho · 0:09 +2");
  - una riga di stato con il mix lasciato: "Solo Bongo + Güira", "Voce spenta", "Preset Trova l'1" oppure "6 strumenti · mix completo";
  - il tasto "Apri Lab".
- Tocco sulla scheda: apre il player. I tre puntini: **Rinomina** o **Elimina**. Elimina chiede conferma e cancella tracce e video.

**Guida rapida**
- Tre passi (scegli il brano, ritaglia 30–90 s, isola gli strumenti). Sparisce quando hai più di 2 progetti.

**Barra in basso**
- **Progetti**: la pagina attuale.
- **Lab**: riapre l'ultimo progetto usato.
- **Allenati**: riapre l'ultimo progetto e apre subito l'allenamento.
- **Impostazioni**: vedi sotto.
- Lab e Allenati sono disattivati finché non c'è un progetto.

**Impostazioni**
- Mostra: progetti salvati, spazio usato e disponibile, se i modelli sono già scaricati, versione.
- **Elimina i modelli scaricati** (circa 160 MB): si riscaricano al prossimo progetto.
- **Mostra di nuovo i suggerimenti**.

---

## 3. Nuovo progetto

1. **Nome progetto**: preso dal nome del file (trattini e underscore diventano spazi). Si può cambiare; la X lo cancella.
2. **Anteprima video** (solo per i video): mostra durata e nome del file e ha "Cambia file". Segue la posizione delle maniglie.
3. **Ritaglio sezione**
   - All'inizio sono selezionati i primi 60 secondi (o tutto il brano se è più corto).
   - Il riquadro "Durata selezionata" dice quanti secondi e se la parte è "una frase", "ideale per studiare" o "sezione lunga".
   - **Forma d'onda** con le maniglie INIZIO (rosa) e FINE (ciano): si trascinano, e si muove la maniglia più vicina al dito.
   - **−1 s / +1 s** per l'inizio e per la fine.
   - **Ascolta** suona solo la parte scelta. Mentre suona: **Inizio qui** sposta l'inizio dove sei, **Fine qui** sposta la fine e ferma.
   - Limiti: **minimo 8 s, massimo 3 min**. Oltre i 2 minuti compare un avviso (più memoria e più tempo); oltre i 3 minuti "Crea progetto" si disattiva.
   - File oltre i 350 MB vengono rifiutati con un messaggio. Un file che il telefono non riesce a leggere dà un messaggio chiaro.
4. **Separa la güira dal bongo** (attivo di default)
   - Acceso: 6 tracce (Voce, Chitarra, Basso, Bongo, Güira, Altro).
   - Spento: 5 tracce, e la güira resta dentro "Bongo + güira". È più veloce.
   - "Tracce che ottieni" mostra l'elenco aggiornato.
5. **Tempo stimato**
   - La stima parte dalla velocità misurata su computer e assume che il telefono sia circa 2 volte più lento. Dopo il primo progetto si corregge con la velocità reale del telefono.
   - Al primo utilizzo avvisa che scarica anche i modelli (circa 160 MB, una volta sola, meglio con il Wi‑Fi).
6. **Crea progetto** avvia la separazione. **Annulla** torna alla home.

---

## 4. Separazione (sul telefono)

**Passaggi mostrati**
1. Scarico i modelli (la prima volta; poi li legge dalla memoria del browser).
2. Separo voce, chitarra, basso, percussioni.
3. Isolo la güira (solo se l'opzione è attiva).
4. Trovo il ritmo e salvo.

Il passaggio in corso ha una barra sua. Quelli finiti sono segnati FATTO, quelli in arrivo ATTESA.

**Indicatori**
- Cerchio con la percentuale totale e la fase attuale.
- Riga di stato (es. "Separo gli strumenti: parte 3 di 8").
- Tempo trascorso, tempo rimanente stimato e parte in lavorazione.
- "Schermo acceso" compare quando il telefono tiene lo schermo acceso (wake lock).

**Regole**
- Bisogna restare nella pagina con lo schermo acceso: se il telefono va in standby il lavoro si ferma.
- **Annulla elaborazione** chiede conferma e torna alla home.
- Errori:
  - di rete: "Non riesco a scaricare i modelli: controlla la connessione";
  - altri: messaggio con il motivo e il consiglio di provare una parte più corta;
  - spazio pieno: "Spazio insufficiente", con "Riprova" o "Rinuncia".
- Alla fine il progetto si apre da solo nel player.

**Cosa viene salvato**
- Le 6 (o 5) tracce stereo, a 16 bit.
- Il video originale, se c'è, e una miniatura.
- Il livello di ogni strumento nel tempo (20 valori al secondo), usato da luci, timeline e griglia.
- BPM, posizione di ogni battito e posizione dell'1 (vedi §11).
- L'app chiede al browser di non cancellare questi dati quando manca spazio.

---

## 5. Player (Lab), versione audio

Tutto il player sta in **una sola schermata senza scorrere** (pensato per 390×760 e adattato agli schermi più bassi). Dall'alto in basso:

### 5.1 Intestazione
- "‹ Progetti", nome del brano, tipo e durata, **BPM** del brano, menu (Rinomina / Elimina).

### 5.2 Pannello del conteggio
- **Frase n/N**: in quale frase da 8 sei, sul totale.
- Al centro, il **nome della sezione** in cui sei (dai segnalibri, es. "Derecho"). Dal tempo 5 in poi, se la frase successiva cambia strumenti, diventa rosso lampeggiante: **"Cambio tra N"**.
- "Tap 4 & 8", sempre visibile come promemoria.
- **Numero grande** del tempo attuale:
  - bianco con alone ciano: tempi 2, 3, 6, 7;
  - rosa: **1 e 5** (inizio di ogni mezza frase);
  - ambra: **4 e 8** (tap).
  - Accanto: "Tempo" o "Tap" e "prima metà" / "seconda metà".
- **Otto caselle 1–8**: si accende quella attuale (ciano, rosa per 1 e 5, ambra per 4 e 8). Le caselle 4 e 8 riportano "TAP".
- **Scorrere** col dito sul pannello: a sinistra salta avanti, a destra salta indietro (di 4 o 8 tempi).
- Se il ritmo non è stato trovato, il numero grande mostra il tempo in minuti e secondi. Sotto compare un avviso; un altro avviso compare se il ritmo è incerto.

### 5.3 Strumenti (pad)
- Sei pad: Voce, Chitarra, Basso, Bongo, Güira, Altro. Ognuno ha un'icona e un **misuratore a 5 barre** che si accende quando lo strumento suona.
- Il misuratore è tarato su ogni strumento, così anche una güira bassa si accende chiaramente.
- **Tocco**: spegne lo strumento (nome barrato, icona muto). Un altro tocco lo riaccende.
- **Tieni premuto** (circa mezzo secondo): **solo**. Bordo ambra, badge "S" e vibrazione. Si possono mettere più strumenti in solo.
- Tocco su un pad in solo: toglie il solo.
- Tocco su un pad spento mentre altri sono in solo: lo aggiunge al solo.
- **Attiva tutti**: toglie tutti i muti e i solo e riporta a 100% gli strumenti a volume zero.
- Pad e mixer sono sempre allineati.

### 5.4 Timeline / Griglia 8 tempi
Due viste, selezionabili con le linguette e ricordate per ogni progetto.

- **Timeline**
  - Una corsia per strumento con il suo livello nel tempo (le corsie degli strumenti spenti sono sbiadite).
  - Il numero di ogni frase sull'1, le tacche dei tempi, i segnalibri come bandierine ambra.
  - La zona del loop evidenziata e la linea di riproduzione.
  - **Tocco**: va lì (si aggancia al tempo più vicino entro 0,25 s). **Trascinare**: scorre. **Tenere premuto**: nuovo segnalibro in quel punto.
- **Griglia 8 tempi**
  - Una riga per frase: F1, F2… con dei pallini che dicono quali strumenti suonano in quella frase.
  - Le frasi con la stessa combinazione di strumenti hanno lo stesso colore, così si vedono le ripetizioni e i cambi.
  - La casella del tempo attuale si accende e la griglia scorre da sola.
  - La frase successiva lampeggia in ambra quando sta per cambiare.
  - **Tocco su una casella**: va a quel tempo. **Tieni premuto**: aggiungi, modifica o elimina una **nota** (fino a 60 caratteri, es. "giro", "dip"). Un puntino ciano segna le caselle con una nota.
- Sopra: posizione attuale / durata.
- **Segnalibri** (chip sotto la timeline)
  - Tocco: va lì.
  - Tieni premuto: **Loop sezione** (dal segnalibro fino al successivo), **Rinomina**, **Elimina**.
  - Il chip della sezione in cui sei è evidenziato.

### 5.5 Loop, salti, segnalibri
- **Loop 4**: ripete la mezza frase in cui sei (1–4 oppure 5–8).
- **Loop 8**: ripete la frase in cui sei (1–8). Se la prima frase è tagliata dall'inizio del ritaglio, usa quella intera successiva.
- **A–B**
  - Primo tocco: segna A. Secondo tocco: segna B e parte il loop. Entrambi i punti si agganciano al tempo se sono vicini (0,2 s). Un loop deve durare almeno mezzo secondo.
  - Un altro tocco sul tasto toglie il loop.
- Ritoccare Loop 4 o Loop 8 quando è attivo lo spegne.
- **Barra del loop**: dice quale loop è attivo (es. "Loop 8 tempi attivo: 1–8 (frase 3)", "Loop sezione Derecho: 0:09 – 0:17", "A segnato a 0:32…"). La **X** lo spegne. Nella versione video questa barra è nascosta per lasciare spazio al video.
- **Salta 4 / 8**: sceglie di quanti tempi saltano i tasti ◀ e ▶ (si ricorda per progetto).
  - Senza loop: salta di 4 o 8 tempi, agganciandosi al tempo.
  - Con Loop 4 o Loop 8 attivo: il loop si sposta al **loop precedente o successivo della stessa misura**.
  - Con A–B: il loop si sposta di 4 o 8 tempi.
- **Segna** (icona segnalibro): nuovo segnalibro all'**inizio della frase** in cui sei.
  - Nomi pronti: Intro, Derecho, Majao, Mambo, Break, Finale; oppure un nome libero.
  - Massimo 12 segnalibri.
- Andare fuori dal loop (con un tocco sulla timeline o sulla griglia) spegne il loop.

### 5.6 Velocità, metronomo, allenamento
- **Velocità** da 50% a 120%: − e + cambiano di 5% alla volta. Il **tono resta invariato**.
  - Il valore è ambra quando non è 100%. Un tocco sul valore torna al 100%.
- **Metronomo ON/OFF**: un click su ogni tempo, con l'accento scelto nel pannello Ritmo. Senza ritmo trovato non si accende.
- **Allenati**: apre l'allenamento (§9).

### 5.7 Trasporto
- **◀ 4/8 tempi**, **−5 s**, **Play/Pausa** (grande, rosa), **+5 s**, **4/8 tempi ▶**.
- Dentro un loop, ±5 s resta nel loop (ricomincia dall'altro lato).
- Tastiera (da computer): Spazio = play/pausa, frecce = salti.

### 5.8 Barra in basso
- **Lab** (il player), **Strumenti** (pannello mixer), **Ritmo** (pannello ritmo e velocità), **Progetti** (torna alla home).

### 5.9 Comportamenti automatici
- La musica si **ferma** se l'app va in secondo piano o se il telefono interrompe l'audio.
- Lo schermo resta acceso mentre il progetto è aperto.
- Posizione e impostazioni si salvano da sole: mix, preset, velocità, salto, segnalibri, note, metronomo, automazioni, specchio, vista, 1, BPM.
- Riaprendo un progetto riparte da dove l'avevi lasciato.
- Al primo progetto aperto compare il suggerimento "Tocca uno strumento per spegnerlo, tienilo premuto per sentirlo da solo".

---

## 6. Player, versione video

Stesse funzioni dell'audio, con queste differenze:

- In alto c'è il **video** al posto del pannello del conteggio. Sul video:
  - il **numero del tempo** grande (stessi colori);
  - sezione e frase (o "Cambio tra N");
  - **Specchio**: ribalta il video come in sala. È acceso di default per i video e si ricorda.
  - **Schermo intero**: gira il telefono in orizzontale e mostra una barra con indietro, play, avanti, velocità a scatti (100 → 85 → 70%) ed Esci.
- Sotto il video, le **8 caselle** del conteggio.
- Pad compatti in 3 colonne, con piccoli misuratori.
- Tocco sul video: play/pausa. Scorrere sul video: salti.
- **Il suono viene dalle tracce separate**. Il video è muto e segue l'orologio dell'audio: corregge da solo piccoli ritardi e salta se è troppo indietro. Questo vale anche a velocità ridotta.
- Se il video salvato non si trova, resta solo l'audio (con un avviso).
- La barra del loop è nascosta (il loop si vede dal tasto acceso e sulla timeline).

---

## 7. Pannello "Mixer & ritmo": Strumenti

- Si apre dal basso. Si chiude con **Fatto**, con un tocco fuori, trascinando giù la maniglia o con Indietro.
- **Preset didattici** (l'etichetta dice "Preset: …" oppure "Personalizzato"):

  | Preset | Voce | Chitarra | Basso | Bongo | Güira | Altro |
  |---|---|---|---|---|---|---|
  | Completo | 100 | 100 | 100 | 100 | 100 | 100 |
  | Trova l'1 | 0 | 0 | 100 | 0 | 150 | 0 |
  | Solo ritmo | 0 | 0 | 100 | 100 | 100 | 0 |
  | Senza voce | 0 | 100 | 100 | 100 | 100 | 100 |
  | Solo voce | 100 | 0 | 0 | 0 | 0 | 0 |
  | Chitarra | 0 | 150 | 60 | 40 | 60 | 0 |
  | Bongo | 0 | 0 | 50 | 160 | 80 | 0 |

- Un preset azzera muti e solo. Qualsiasi modifica a mano lo fa diventare "Personalizzato".
- **Canale per strumento**:
  - icona, nome e descrizione (es. "Raspa: scandisce ogni tempo");
  - volume in %;
  - **M** (muto) e **S** (solo);
  - cursore da 0 a 200% a passi di 5, con una **tacca ambra al 100%**.
- Un canale in solo ha il bordo ambra. Un canale spento perché un altro è in solo è sbiadito e dice "Spento: un altro è in solo".
- Se la güira non è stata separata, il canale Güira dice "Non separata (dentro il bongo)".

## 8. Pannello "Mixer & ritmo": Ritmo e velocità

**Tempo del brano**
- BPM attuali e il valore **rilevato** dall'app.
- **−1,0 / −0,1 / +0,1 / +1,0**: cambiano i BPM. La griglia dei tempi viene ricostruita regolare, tenendo fermo l'inizio della frase in cui sei. Limiti 40–240.
- **÷2 Metà** e **×2 Doppio**: per quando l'app ha contato il doppio o la metà dei tempi.
- **Ripristina**: torna ai battiti, ai BPM e all'1 trovati dall'app.
- **Tap tempo**: tocca almeno 4 volte sul tempo. Usa l'intervallo medio (mediana); dopo 1,6 s senza tocchi applica i BPM (se tra 60 e 220).
- Ogni cambio di BPM spegne il loop attivo.

**L'1 è qui!**
- Con il brano in riproduzione, tocca esattamente sull'1. L'app sposta il conteggio sul tempo più vicino al tuo tocco, tenendo conto di circa 0,15 s di ritardo di reazione.
- Il loop 4 o 8 attivo si riallinea. Vibra e conferma.

**Velocità di studio**
- Scorciatoie 60 / 70 / 80 / 90 / 100%. Tono invariato.

**Metronomo**
- Interruttore, volume (0–200%) e **accento**: solo sull'1, su 4 e 8 (tap), oppure su 1 e 5.

**Automazioni esercizi**
- **Accelera nel loop**: a ogni 2 giri completi del loop la velocità sale di 5%, fino al 100%. Contano solo i giri veri, non i salti fatti a mano. Spegnendo il loop si torna alla velocità scelta.
- **Conta d'ingresso**: con Play, la musica parte 4 tempi prima dell'inizio della frase (o del loop), così senti 5‑6‑7‑8 prima dell'1.

---

## 9. Allenamento (allena l'orecchio)

Il conteggio sparisce: si ascolta e si tocca.

### 9.1 Scelta dell'esercizio
- Brano attivo con i suoi BPM.
- Serie di giorni consecutivi di allenamento (es. "5 giorni di fila!").
- Tre esercizi, ognuno con descrizione, 8 caselle che mostrano quali tempi toccare, record (punteggio migliore e scarto migliore in ms) e "Inizia":

  | Esercizio | Tempi da toccare | Consiglio a fine esercizio |
  |---|---|---|
  | **Trova l'1** | 1 | segui basso e cambi di accordo |
  | **A tempo** | tutti, da 1 a 8 | segui la güira |
  | **Il tap** | 4 e 8 | ascolta il bongo che chiude la mezza frase |

- **Parametri sessione** (ricordati per tutti i brani):
  - **Guida audio**: Basso + güira (default; senza güira separata usa basso e bongo), Tutti, oppure Mix attuale.
  - **Durata**: 4 frasi (32 tempi) oppure 8 frasi (64 tempi). Se il brano è più corto si usano le frasi disponibili.
- Durante l'esercizio il **metronomo è spento**. La guida audio vale solo per l'esercizio: alla fine torna il mix del progetto.
- "Torna al player" chiude.

### 9.2 Sessione
- Parte dalla frase in cui eri (o dall'ultima utile). Ci sono 4 tempi di preparazione (5, 6, 7, 8) e poi la registrazione dei tocchi.
- Un loop attivo viene sospeso e rimesso alla fine.
- Sullo schermo:
  - gioco e "Frase k di N", con una barra a segmenti;
  - colpi presi sul totale e scarto medio in ms;
  - **barra di precisione** da −150 a +150 ms, con il segno dell'ultimo tocco e la scritta "A tempo", "In anticipo di X ms" o "In ritardo di +X ms";
  - il grande **pad da toccare**: diventa ciano se il tocco va a segno, rosso se è sbagliato ("Quello era il 6", "Già preso").
- Un tocco vale se cade entro il 30% di un tempo dal tempo giusto. Entro ±30 ms è "Perfetto".
- **Pausa/Riprendi**, **Ricomincia**, **Esci** (torna alla scelta dell'esercizio).

### 9.3 Risultato
- **Punteggio** = (colpi presi − 0,5 × tocchi sbagliati) / colpi possibili. Se è il migliore: "Nuovo record personale!".
- Giudizio: "Ritmo eccellente" (≥ 85%), "Bene, ci sei quasi" (≥ 60%), "Riproviamo".
- Colpi a segno, precisione media (± ms) e distribuzione dei tocchi: anticipo, perfetto (±30 ms), ritardo.
- **Tendenza**: se in media anticipi o ritardi di più di 25 ms, lo dice e suggerisce come correggere; altrimenti "Sei centrato".
- Consiglio di ascolto dell'esercizio.
- **Riprova esercizio**, **Altri esercizi**, **Torna al player**.
- Record e giorni di allenamento restano nel browser.

---

## 10. Cosa succede "sotto" (in breve)

- **Separazione degli strumenti**: Demucs **htdemucs_6s** (27,4 milioni di parametri) esportato in ONNX.
  - Lavora a pezzi di 7,8 s, sovrapposti del 25%.
  - I calcoli che trasformano l'audio in spettro e ritorno (STFT/ISTFT) li fa l'app in JavaScript.
  - Dà: voce, chitarra, basso, batteria, piano, altro. Nell'app "Altro" contiene piano + altro, e "Batteria" diventa il gruppo bongo/percussioni.
- **Güira**: AudioSep ResUNet30 (29,8 milioni di parametri).
  - La descrizione testuale della güira ("guiro scraping metal scraper") è calcolata una volta e salvata dentro il modello.
  - Lavora a 32 kHz a finestre di 5 s.
  - Poi la traccia delle percussioni viene divisa con una maschera morbida: **güira** = la parte che somiglia alla güira, **bongo** = il resto.
- **Motore**: ONNX Runtime Web (WebAssembly, 1 thread) in un Web Worker.
  - Modelli a metà precisione: circa 60 MB l'uno, scaricati una volta e conservati nel browser.
  - In memoria i pesi sono a piena precisione. Il picco misurato durante la separazione è di circa 3,6 GB (consigliati telefoni da 6–8 GB).
- **Ritmo**: i battiti si trovano dal flusso spettrale di basso, bongo e güira, con una preferenza per tempi intorno ai 128 BPM.
- **L'1**: in bachata gli accordi cambiano sull'1 (e sul 5). L'app confronta l'armonia di chitarra, basso e altro prima e dopo ogni battito e prende come 1 il punto di cambio più forte. Tra 1 e 5 decide il cambio più forte più l'accento del basso. Si corregge con "L'1 è qui!".
- **Riproduzione**: le tracce si mescolano in tempo reale con volume per strumento. Il cambio di velocità mantiene il tono (SoundTouch). Il loop è senza interruzioni e il metronomo è sincronizzato ai battiti trovati.
- **Salvataggio**: IndexedDB `bachata-lab` (progetti, tracce, video). Modelli nella Cache `bachata-models-v1`. Preferenze in `localStorage`.

---

## 11. Limiti noti

- Non ancora provata su un telefono Android vero: tempi e memoria vengono da prove su computer.
- La separazione richiede lo schermo acceso e la pagina aperta.
- Un ritaglio può durare al massimo 3 minuti; consigliati 30–90 secondi.
- I dati stanno nel browser: cancellando i dati del sito si perdono i progetti.

---

## Registro modifiche

- **25/11/2026**: nuovo design "Stage Studio Pulse" da Google Stitch.
  - Home con spazio, ricerca, stato del mix sulle schede e barra in basso (Progetti, Lab, Allenati, Impostazioni); nuova finestra Impostazioni.
  - Nuovo progetto con durata grande, avvisi e tracce con icone. Separazione con passaggi, tempo trascorso e rimanente e stato dello schermo acceso.
  - Player con pannello del conteggio, pad con misuratori, linguette Timeline/Griglia, barra del loop, velocità − / +, metronomo e barra in basso.
  - Allenamento con guida audio, durata (4/8 frasi), barra di precisione, pausa, distribuzione dei tocchi e tendenza.
  - Corretto: la scelta del salto (4/8) non veniva salvata nel progetto.
- **25/11/2026**: tolta la salsa (On1/On2): solo bachata, tap su 4 e 8. Salti solo di 4 o 8 tempi.
- **24–25/11/2026**: prima versione: separazione a 6 strumenti sul telefono, güira separata dal bongo, player con conteggio, loop, segnalibri, griglia, note, mixer, metronomo, video con specchio, allenamento.
