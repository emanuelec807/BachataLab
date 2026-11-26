# Bachata Lab: funzionalità e comportamento

Questo file descrive **tutto quello che fa l'app e come si comporta**. È il riferimento unico: ogni modifica all'app aggiorna anche questo file (vedi "Registro modifiche" in fondo).

Bachata Lab è un'app per studiare la **musicalità in bachata**. Carichi una canzone o un video, l'app la divide nei suoi strumenti **direttamente sul telefono** e ti fa ascoltare, contare e allenare l'orecchio frase per frase.

- Piattaforma: app web per il browser del telefono (Chrome su Android) e **app Android (APK)**, costruita automaticamente da GitHub Actions.
- Privacy: nessun server. Il brano, le tracce separate e i modelli restano nel browser del telefono.
- Stile di conteggio: **solo bachata**. Il conteggio va da 1 a 8 e il **tap** cade sempre sul **4** e sull'**8**. Non esistono modalità salsa, On1 od On2.

---

## 1. Schermate e navigazione

| Schermata | Indirizzo | Come ci si arriva |
|---|---|---|
| Progetti (home) | `/` | apertura dell'app, tasto Indietro, "Progetti" nella barra in basso |
| Impostazioni | `#impostazioni` | "Impostazioni" nella barra in basso |
| Nuovo progetto | `#nuovo` | "Nuovo progetto" → scelta del file |
| Separazione | `#elabora` | "Separa gli strumenti" |
| Player | `#player` | tocco su un progetto, oppure fine della separazione |
| Mappa (Strumenti / Testo) | `#mappa` | "Mappa" nel player |
| Popup del player | `#pop` | Velocità, Metronomo, Sezioni, volume di uno strumento, menu ⋮ |
| Video a schermo intero | `#schermo` | tasto schermo intero sul video |
| Allenamento | `#allenamento` | "Allenati" nella barra in basso |

- Il **tasto Indietro** e lo **swipe dal bordo** di Android chiudono, nell'ordine: la finestra di dialogo aperta, il popup aperto, il video a schermo intero, l'allenamento, la mappa. Poi torna alla home. Dalla home manda l'app in secondo piano (non la chiude). Nell'app Android lo gestisce il plugin App di Capacitor: senza, Android chiudeva subito l'app.
- Durante la separazione Indietro **non esce subito**: chiede "Annullare la separazione?". Anche chiudere o ricaricare la pagina chiede conferma.

**Aspetto**
- Stile pulito ispirato a Moises: sfondo quasi nero (o chiaro), un solo colore principale.
- Ogni strumento ha il suo colore fisso, uguale in righe, mappa e popup.
- Tema e colore si scelgono nelle Impostazioni (§2).

---

## 2. Home (Progetti) e Impostazioni

**Home**
- In alto: logo e un tasto per passare al volo da tema scuro a chiaro.
- "Progetti" con il numero di progetti e lo spazio usato (es. "1 progetto · 41 MB"). Non c'è un limite dell'app: lo spazio dipende solo dalla memoria del telefono.
- Ogni progetto è una riga con:
  - miniatura: fotogramma del video con la scritta VIDEO, oppure un'icona per l'audio;
  - nome, durata, BPM e numero di tracce;
  - data dell'ultima modifica ("Oggi, 17:33", "Ieri, …", "12 mag");
  - lo stato del mix lasciato (es. "Mix completo", "Voce spenta", "Solo Bongo + Güira").
- Tocco sulla riga: apre il player. I tre puntini: **Rinomina** o **Elimina** (chiede conferma e cancella tracce e video).
- "Come funziona" (tre passi) compare finché hai al massimo 2 progetti.
- **Playlist** (riga di chip sopra l'elenco):
  - **Tutti**, una chip per playlist (con il numero di brani) e **＋ Playlist** per crearne una.
  - Toccare una chip mostra solo i suoi brani; la scelta si ricorda.
  - Ogni brano sta in al massimo una playlist. **Sposta in playlist** si trova nel ⋯ del brano nella home e nel menu ⋯ del player (Ritmo del brano); da lì si può anche creare una playlist nuova o togliere il brano.
  - Con una playlist aperta, il ⋯ accanto al titolo permette: **Aggiungi brani** (elenco con caselle di tutti i progetti, con l'indicazione se un brano è già in un'altra playlist), **Rinomina**, **Elimina playlist** (i brani restano, senza playlist).
  - Le playlist stanno sul telefono, come i progetti.
- Il grande tasto **Nuovo progetto** apre la scelta del file: MP3, M4A, WAV, OGG, FLAC, AAC, oppure video MP4, MOV, WEBM.
- **Barra in basso**: Progetti, Allenati (sull'ultimo brano usato, disattivato senza progetti), Impostazioni.

**Impostazioni**
- **Tema**: Scuro (predefinito), Chiaro o Come il telefono.
- **Colore** principale da una lista: Corallo (predefinito), Lime, Azzurro, Viola, Menta, Rosa. Nel tema chiaro si usa una tonalità più scura dello stesso colore, così si legge bene.
- **Ritardo dell'audio**: mostra il ritardo misurato e il tasto **Calibra** (vedi §9).
- **Traduci il testo in**: Italiano (predefinito), English, Español, Français, Deutsch, Português, oppure Non tradurre.
- **Memoria**: progetti e spazio usato, dove stanno i modelli ("dentro l'app" nell'APK), versione. Nel browser c'è anche "Elimina modelli" (circa 160 MB, si riscaricano al prossimo progetto).

---

## 3. Nuovo progetto

1. **Nome**: preso dal nome del file (trattini e underscore diventano spazi). Si può cambiare; la X lo cancella.
2. **File scelto**: icona (nota o video), nome e durata, con **Cambia**.
3. **Usa solo l'audio** (compare solo per i video, spento di default)
   - Acceso: il video **non viene salvato**. Il progetto diventa un progetto audio e occupa meno spazio.
   - L'MP3 si scarica poi dal player (§5.6).
   - Spento: il video resta e il player mostra il video (§6).
4. **Scegli la parte**
   - All'inizio sono selezionati i primi 60 secondi (o tutto il brano se è più corto). La durata scelta è scritta in grande; consigliati 30–90 secondi.
   - **Forma d'onda** con le maniglie di inizio e fine: si trascinano, e si muove la maniglia più vicina al dito.
   - **−1 s / +1 s** per l'inizio e per la fine.
   - **Ascolta la parte** suona solo la parte scelta. Mentre suona: **Inizio qui** sposta l'inizio dove sei, **Fine qui** sposta la fine e ferma.
   - **Tutto il brano** seleziona la canzone intera.
   - Limiti: **minimo 8 s, nessun massimo**. Oltre i 2 minuti compare un avviso (più memoria e più tempo); oltre i 3 minuti avvisa che sui telefoni con meno di 8 GB potrebbe non riuscire. Se la separazione nativa finisce la memoria, l'app passa a quella nel browser (molto più lenta).
   - File oltre i 350 MB vengono rifiutati con un messaggio. Un file che il telefono non riesce a leggere dà un messaggio chiaro.
5. **6 tracce separate**: Voce, Chitarra, Basso, Bongo, Güira, Altro. La **güira è sempre separata** dal bongo: non è più un'opzione.
   - Il modello riconosce anche il **piano**. Se nel brano il piano suona davvero (almeno il 3% del suono del brano e il 35% di "Altro"), diventa una **settima traccia** "Piano"; altrimenti resta dentro "Altro". Nella bachata di solito non c'è (su "Frío" è 0%).
   - Tutto quello che il modello non riconosce (requinto, synth, archi, fiati, fisarmonica, effetti) va in "Altro".
   - **"Altro" prende il nome di quello che c'è dentro.** Dopo la separazione YAMNet (Google, 7,5 MB, dentro l'app) ascolta le parti dove "Altro" suona e riconosce la famiglia: **Requinto** (corde pizzicate acute), **Fisarmonica**, **Tastiere**, **Archi** o **Fiati**. La traccia prende quel nome solo se una famiglia vince nettamente; altrimenti resta "Altro".
     - Se lo strumento principale è meno del 70% di quello che si riconosce, la riga dice **"Requinto · + altro"** (nella mappa "Requinto +"): vuol dire che lì suona anche altro.
     - Toccando il nome si apre il popup del volume con il dettaglio, momento per momento. Su "Pobre de Mí" (Mickey Then): requinto 42%, campanelli ed effetti 7%, archi 7%, fiati 6%, fisarmonica 5%, tastiere 4%, non riconosciuto 29% → "Requinto + altro". Su "Frío" resta "Altro".
   - Il requinto viene diviso dal modello in due: una parte resta in "Chitarra", il resto (gli arpeggi più acuti) va in questa traccia. Separarlo del tutto dalla chitarra ritmica non è possibile con questi modelli: con AudioSep e descrizioni come "mandolino" o "chitarra solista" non si distinguono le due chitarre (provato).
   - I progetti fatti prima vengono riconosciuti la prima volta che si aprono.
6. **Tempo stimato**: impara la velocità reale del telefono dopo ogni progetto (separatamente per app e browser). Nel browser, al primo utilizzo, avvisa che scarica anche i modelli (circa 160 MB, una volta sola).
7. **Separa gli strumenti** avvia la separazione. La freccia indietro torna alla home.

---

## 4. Separazione (sul telefono)

**Passaggi mostrati**
1. Scarico i modelli (la prima volta; poi li legge dalla memoria del browser).
2. Separo voce, chitarra, basso, percussioni.
3. Isolo la güira.
4. Trovo il ritmo e salvo.

Il cerchio mostra la percentuale totale; sotto, i passaggi finiti, quello in corso e quelli in attesa.

**Indicatori**
- Cerchio con la percentuale totale e la fase attuale.
- Riga di stato (es. "Separo gli strumenti: parte 3 di 8").
- Tempo trascorso, tempo rimanente stimato e parte in lavorazione.
- "Schermo acceso" compare quando il telefono tiene lo schermo acceso (wake lock).

**Velocità**
- **Nell'app Android** la separazione gira in codice nativo (ONNX Runtime per Android) su 4 core: nei test è circa 5 volte più veloce della versione nel browser. La prima volta l'app prepara i modelli (qualche secondo), poi li riusa. Se la separazione nativa non parte o si blocca, l'app passa da sola a quella nel browser (più lenta) e lo dice.
- **Nel browser** usa WebAssembly: più core solo se la pagina è "isolata" (non succede nell'anteprima di Claude), altrimenti uno.
- La güira si calcola a finestre di 5 s con 0,5 s di contesto per lato (4 s utili per finestra): un quarto di lavoro in meno rispetto a prima, con un risultato praticamente identico.
- La stima del tempo impara la velocità reale del telefono dopo ogni progetto (separatamente per app e browser).

**Regole**
- Bisogna restare nella pagina con lo schermo acceso: se il telefono va in standby il lavoro si ferma.
- **Annulla elaborazione** chiede conferma e torna alla home.
- Errori:
  - di rete: "Non riesco a scaricare i modelli: controlla la connessione";
  - altri: messaggio con il motivo e il consiglio di provare una parte più corta;
  - spazio pieno: "Spazio insufficiente", con "Riprova" o "Rinuncia".
- Alla fine il progetto si apre da solo nel player.

**Cosa viene salvato**
- Le tracce stereo (6 o 7), **compresse in Opus a 128 kb/s** con il codificatore del telefono (WebCodecs), in file Ogg: circa 10 volte meno spazio del PCM a 16 bit (3:20 di brano: da circa 250 MB a circa 25 MB). Prima di usarla, l'app fa una prova di codifica e decodifica e misura il piccolo ritardo del decodificatore, così tutte le tracce restano allineate al campione. Se la prova non riesce, salva a 16 bit come prima. Impostazioni → Memoria dice se la compressione è attiva.
- Aprendo un progetto le tracce si decomprimono tutte insieme, in parallelo (sul computer 3:20 di brano: circa 6 s con 2 core; sui telefoni con più core va più veloce).
- I progetti salvati prima vengono compressi da soli la prima volta che si aprono (dopo aver controllato la copia compressa), oppure tutti insieme da Impostazioni → Memoria → **Comprimi**.
- Analisi (ritmo, 1, livelli, piano, "Altro") si fanno sulle tracce non compresse, prima di comprimerle.
- Il video originale e una miniatura, se c'è un video e non hai scelto "Usa solo l'audio".
- Il livello di ogni strumento nel tempo (20 valori al secondo), usato da forme d'onda, mappa e pulsanti che si accendono.
- BPM, posizione di ogni battito e posizione dell'1 (vedi §11).
- L'app chiede al browser di non cancellare questi dati quando manca spazio.

---

## 5. Player, versione audio

Tutto il player sta in **una sola schermata senza scorrere** (pensato per 390×760). Dall'alto in basso:

### 5.1 Intestazione
- Freccia indietro, nome del brano, durata, BPM e tipo.
- **⋮** apre il popup "Ritmo del brano" (§5.7).

### 5.2 Conteggio
- **Numero grande** del tempo attuale, con "Frase n di N" e il nome della sezione in cui sei. Dal tempo 5 in poi, se la frase successiva cambia strumenti, avvisa "Cambio tra N".
- **Otto caselle 1–8**: si accende quella attuale; le caselle 4 e 8 riportano "TAP".
- Se il ritmo non è stato trovato, al posto del numero c'è il tempo in minuti e secondi, con un avviso.

### 5.3 Strumenti
- Una **riga per strumento** (Voce, Chitarra, Basso, Bongo, Güira, eventualmente Piano, Altro), con:
  - a sinistra una **stanghetta spessa** nel colore dello strumento, che si accende quando lo strumento suona;
  - nome e **volume in %**: un tocco apre il **popup del volume** (cursore 0–200%, 100% = originale, Spegni, Solo, ripristino a 100%);
  - una **linea del volume** nel colore dello strumento: si trascina da 0 a 200%, si aggancia al 100% vicino al centro e sta a 0 quando lo strumento è spento;
  - **M** (spegni) e **S** (solo). Si possono mettere più strumenti in solo.
- Uno strumento spento o escluso dal solo ha la riga sbiadita.
- **Accendi tutti**: toglie muti e solo e riporta a 100% gli strumenti a volume 0.
- Sotto: barra della posizione con tempo attuale e durata. Toccarla o trascinarla sposta la riproduzione.

### 5.4 Loop e sezioni
- **Loop 4**: ripete la mezza frase in cui sei (1–4 oppure 5–8). **Loop 8**: ripete la frase in cui sei. Se la prima frase è tagliata dal ritaglio, usa quella intera successiva.
- **A–B**: primo tocco segna A, secondo segna B e parte il loop. I punti si agganciano al tempo se vicini (0,2 s). Minimo mezzo secondo.
- Ritoccare il tasto del loop attivo lo spegne.
- La scritta del loop dice cosa è attivo, per esempio "Loop 8 · frase 3", oppure "Loop 4 · frase 3 dal 5" dopo uno spostamento di 4 tempi.
- **Sezioni** apre il popup dei segnalibri:
  - **Segna l'inizio della frase qui**: nomi pronti (Intro, Derecho, Majao, Mambo, Break, Finale) o libero. Massimo 12.
  - Tocco su una sezione: va lì. Tieni premuto: **Loop sezione** (fino alla successiva), **Rinomina**, **Elimina**.

### 5.5 Trasporto
- **−8 · −4 · Play/Pausa · +4 · +8** (in tempi), uguali in tutte le schermate del player (anche nella mappa).
  - Senza loop: salta di 4 o 8 tempi, agganciandosi al tempo.
  - Con un loop attivo: **sposta il loop** di 4 o 8 tempi, e la riproduzione lo segue.
- Tastiera (da computer): Spazio = play/pausa, frecce = salti di 8 tempi (con Maiusc di 4).

### 5.6 Tasti in basso
- **Velocità**: popup con − / + (5% alla volta, da 50% a 120%) e scorciatoie 60–100%. Il **tono resta invariato**. Il tasto mostra la velocità attuale.
- **Metronomo**: popup con acceso/spento, volume, **Click forte su** (sull'1, su 4 e 8, su 1 e 5) e **Conta d'ingresso** (il Play parte da 5-6-7-8 prima dell'1). Senza ritmo trovato non si accende.
- **Mappa**: apre la mappa strumenti e testo (§5.8).

### 5.7 Ritmo del brano (menu ⋮)
- BPM attuali e quelli rilevati.
- **−1 BPM / +1 BPM**, **Metà**, **Doppio**: la griglia dei tempi viene ricostruita regolare, tenendo fermo l'inizio della frase in cui sei. Limiti 40–240. Ogni cambio spegne il loop.
- **Tap tempo**: tocca almeno 4 volte sul tempo; dopo 1,6 s senza tocchi applica i BPM (se tra 60 e 220).
- **L'1 è qui!**: con il brano in riproduzione tocca esattamente sull'1. Il conteggio si sposta sul tempo più vicino al tocco, tenendo conto del ritardo calibrato (o di 0,15 s senza calibrazione). Il loop attivo si riallinea.
- **Ripristina**: torna a battiti, BPM e 1 trovati dall'app.
- **Rinomina** ed **Elimina** il progetto.
- **Scarica l'MP3 del mix attuale**: crea un MP3 (192 kbps, alla velocità originale) con gli strumenti come li senti, cioè con volumi, muti e solo attuali. Il nome dice cosa manca (es. "Frío - senza voce.mp3").
  - Nel browser il file si scarica.
  - Nell'app Android si apre la condivisione del telefono: salvalo in File o Drive, o mandalo su WhatsApp.
  - Per un video caricato con "Usa solo l'audio" è il modo per avere l'MP3 della canzone.

### 5.8 Mappa (Strumenti / Testo)
Si apre a tutto schermo da "Mappa"; la freccia in giù o Indietro la chiude. In alto il conteggio resta sempre visibile.

- **È una vista del player, non un player a parte**: velocità, metronomo, mix e loop restano quelli del player.
- **Strumenti**:
  - sei pulsanti degli strumenti che si **illuminano nel loro colore** mentre suonano ("suona", "forte", "pausa");
  - sotto, le **forme d'onda** di ogni strumento su un asse orizzontale, con il numero di ogni frase;
  - **zoom − / +**: 1, 2, 4 (predefinito), 8 o 16 frasi per schermata, oppure **tutta la canzone** senza scorrere; anche con due dita (pinch). Lo zoom si ricorda. Da lontano spariscono le tacche dei tempi e i numeri di frase si diradano; una linea segna dove sei; il loop attivo è disegnato come un riquadro; le note sono puntini;
  - **tocco sulle onde**: va lì; **scorrere**: mostra le altre frasi; **tieni premuto**: aggiungi, modifica o elimina una **nota** su quel tempo (fino a 60 caratteri, es. "giro", "dip");
  - −8 / −4 / +4 / +8 funzionano come nel player (spostano anche il loop).
- **Toccare un pulsante strumento lo spegne solo dentro la mappa.** Uscendo dalla mappa tutti gli strumenti tornano come erano nel player.
  - Uno strumento che nel player era spento o a volume 0 parte spento nella mappa; toccandolo si accende a 100%, sempre solo nella mappa.
- **Testo**: il testo sincronizzato, con la traduzione (§5.10).

### 5.10 Testo sincronizzato e traduzione
- **Da dove arriva il testo**: da **LRCLIB** (lrclib.net), un archivio libero e gratuito di testi con il tempo di ogni riga, scritto dagli utenti. Non ci sono altri archivi: quelli commerciali (Musixmatch e simili) chiedono una chiave a pagamento e non permettono questo uso.
- **Trovare il testo** (linguetta Testo della mappa):
  - **Cerca** con titolo e artista. Il campo parte dal nome del progetto ripulito ("JENSEN FRIO (Official Video)" → "JENSEN FRIO"). I risultati mostrano titolo, artista, durata e se hanno i tempi; si scelgono solo quelli "con i tempi", e quelli con una durata vicina al file caricato vengono prima.
  - **Come va a tempo**: i tempi di LRCLIB sono quelli della canzone pubblicata. L'app toglie l'inizio del ritaglio, poi **allinea il testo alla voce separata**: prova a far scorrere tutte le righe fino a ±40 s e tiene lo spostamento per cui l'inizio delle righe cade dove la voce attacca. Lo applica solo se è nettamente migliore di ogni altro (sui test ritrova spostamenti di 3–14 s al decimo di secondo; su un segnale a caso non trova niente e non sposta). Serve per i video con un'intro o le versioni diverse. Compare "Testo allineato alla voce (+x s)".
  - **Genera con Whisper**: se la canzone non c'è su LRCLIB, Whisper "base" (dentro l'app, nessun download) trascrive la voce separata. Riconosce la lingua da solo, toglie le frasi inventate tipiche e spezza le righe troppo lunghe (alla punteggiatura, altrimenti a circa 40 caratteri) dividendo il tempo in proporzione. Non parte più da solo dopo l'import: lo avvii tu.
  - Se scegli un testo da LRCLIB mentre Whisper sta lavorando, Whisper si ferma e la sua scritta sparisce (prima restava "Riconosco la lingua…").
  - Cercare su LRCLIB serve Internet. Nella versione web dentro Claude la rete esterna è bloccata.
- **Lettura**:
  - la riga cantata è grande e bianca, quelle passate sbiadite; la pagina scorre da sola (si ferma per 2,5 s se scorri col dito);
  - tocco su una riga: il brano va lì;
  - in alto: la fonte (LRCLIB o Whisper), la lingua e lo spostamento applicato.
- **Correggere**, tenendo premuta una riga:
  - **Questa riga inizia adesso**: sposta tutto il testo, per allinearlo a un'altra versione del brano;
  - **Sposta solo questa riga qui**;
  - **Correggi il testo**, **Elimina la riga**.
  - Dal tasto ⋯: **Allinea alla voce**, anticipa o ritarda tutto di 0,5 s, traduci di nuovo, cerca un altro testo, **Genera con Whisper** (sostituisce il testo attuale).
- **Traduzione**:
  - l'app riconosce la lingua del testo e lo traduce sul telefono con Opus-MT (circa 110 MB da scaricare la prima volta, serve Internet), in **italiano** di default;
  - **non parte da sola**: si avvia con il tasto "Traduci in italiano"; la traduzione compare piccola sotto ogni riga;
  - il tasto **Traduzione** la mostra o la nasconde;
  - se nelle Impostazioni scegli un'altra lingua, il tasto diventa "Traduci in …";
  - se non esiste un modello diretto per la coppia di lingue, traduce passando dall'inglese.
- Testo, correzioni e traduzione si salvano nel progetto e restano anche senza Internet.

### 5.9 Comportamenti automatici
- La musica si **ferma** se l'app va in secondo piano o se il telefono interrompe l'audio.
- Lo schermo resta acceso mentre il progetto è aperto.
- Posizione e impostazioni si salvano da sole: mix, velocità, segnalibri, note, metronomo, specchio, 1, BPM. Riaprendo un progetto riparte da dove l'avevi lasciato.

---

## 6. Player, versione video

Stesse funzioni dell'audio, con queste differenze:

- In alto c'è il **video** al posto del conteggio grande. Sul video: il numero del tempo, "Frase n di N", **Specchio** (ribalta il video come in sala; acceso di default e ricordato) e **Schermo intero** (telefono in orizzontale, con indietro, play, avanti, velocità a scatti 100 → 85 → 70% ed Esci).
- Sotto il video le **8 caselle** del conteggio.
- Gli strumenti sono **pulsanti compatti** in 3 colonne al posto delle righe con le onde:
  - tocco: spegne o riaccende;
  - tieni premuto: solo.
- Tocco sul video: play/pausa.
- **Il suono viene dalle tracce separate**: il video è muto e segue l'orologio dell'audio (corregge piccoli ritardi e salta se è troppo indietro), anche a velocità ridotta.
- Se il video salvato non si trova, resta solo l'audio (con un avviso).

---

## 7–8. Funzioni tolte con il nuovo design

- Preset del mixer (Trova l'1, Solo ritmo, …): si fa lo stesso con M/S e "Accendi tutti".
- Ritocchi di BPM da ±0,1.
- "Accelera nel loop".
- Pannello "Mixer & ritmo", vista Griglia e Timeline: sostituiti da righe con onde, popup e Mappa.
- Opzione "Separa la güira": ora sempre attiva.
- Riquadro "Elaborazione 100% sul telefono" nella home.

---

## 9. Allenamento (allena l'orecchio)

Il conteggio sparisce: si ascolta e si tocca.

### 9.1 Scelta dell'esercizio
- **Brano** su cui allenarsi, con BPM e **Cambia** per sceglierne un altro.
- Tre esercizi, ognuno con descrizione, le 8 caselle con i tempi da toccare e il record:

  | Esercizio | Tempi da toccare | Consiglio a fine esercizio |
  |---|---|---|
  | **Trova l'1** | 1 | segui basso e cambi di accordo |
  | **A tempo** | tutti, da 1 a 8 | segui la güira |
  | **Il tap** | 4 e 8 | ascolta il bongo che chiude la mezza frase |

- **Durata**: 4 frasi (32 tempi) oppure 8 frasi (64 tempi). Se il brano è più corto si usano le frasi disponibili.
- **Cosa si sente**: Basso + güira (predefinito), Tutti, oppure Il tuo mix.
- **Ritardo dell'audio · Calibra**: suonano 16 click e tu tocchi su ognuno (i primi 4 servono a prendere il ritmo). L'app misura il ritardo tipico tra suono e tocco (Bluetooth, altoparlante e reazione compresi) e lo toglie da ogni tocco negli esercizi e in "L'1 è qui!". Va rifatta quando cambi cuffie o passi all'altoparlante. Senza calibrazione: 0 ms negli esercizi e 150 ms per "L'1 è qui!".
- Durante l'esercizio il metronomo è spento; alla fine torna il mix del progetto.

### 9.2 Sessione
- Parte dalla frase in cui eri. Ci sono 4 tempi di preparazione (5, 6, 7, 8) e poi la registrazione dei tocchi.
- Un loop attivo viene sospeso e rimesso alla fine.
- Sullo schermo: frase e barra a segmenti, colpi presi e scarto medio in ms, **barra di precisione** (prima · a tempo · dopo) con il segno dell'ultimo tocco, e il grande pad **Tocca** che si colora se il tocco va a segno e diventa rosso se è sbagliato ("Quello era il 6", "Già preso").
- Un tocco vale se cade entro il 30% di un tempo dal tempo giusto. Entro ±30 ms è "Perfetto".
- Se tocchi il tempo giusto ma troppo presto o troppo tardi, l'app lo dice ("Era l'1, ma troppo tardi").
- **Pausa/Riprendi**, **Ricomincia**, **Esci**.

### 9.3 Risultato
- **Punteggio** = (colpi presi − 0,5 × tocchi sbagliati) / colpi possibili. Se è il migliore: "Nuovo record personale!".
- Colpi a segno, precisione media (± ms) e distribuzione dei tocchi: anticipo, perfetto, ritardo.
- **Tendenza**: se in media anticipi o ritardi di più di 25 ms, lo dice e suggerisce come correggere. Se ritardi molto e non hai calibrato, suggerisce "Calibra".
- **Riprova**, **Altri esercizi**, **Torna al player**. Record e giorni di allenamento restano sul telefono.

---

## 10. Cosa succede "sotto" (in breve)

- **Separazione degli strumenti**: Demucs **htdemucs_6s** (27,4 milioni di parametri) esportato in ONNX.
  - Lavora a pezzi di 7,8 s, sovrapposti del 25%.
  - I calcoli che trasformano l'audio in spettro e ritorno (STFT/ISTFT) li fa l'app in JavaScript.
  - Dà: voce, chitarra, basso, batteria, piano, altro. "Batteria" diventa il gruppo bongo/percussioni. Il piano diventa una traccia sua solo se suona davvero (vedi §3), altrimenti va in "Altro".
- **Velocità misurata su un telefono vero**: Vivo X300 (Dimensity 9500), app Android: circa 1 minuto per 1 minuto di brano.
- **Güira**: AudioSep ResUNet30 (29,8 milioni di parametri).
  - La descrizione testuale della güira ("guiro scraping metal scraper") è calcolata una volta e salvata dentro il modello.
  - Lavora a 32 kHz a finestre di 5 s.
  - Poi la traccia delle percussioni viene divisa con una maschera morbida: **güira** = la parte che somiglia alla güira, **bongo** = il resto. La divisione si fa a blocchi di circa 30 s (con un po' di margine ai bordi): il risultato è identico a quello sul brano intero (verificato: differenza 0), ma la memoria non cresce più con la lunghezza. Prima, su 4 minuti, questo passaggio da solo prendeva circa 1 GB.
- **Motore**: nell'app Android ONNX Runtime nativo su 4 core (plugin `SeparatorPlugin`, codice in `android/.../Separator.java`, verificato identico alla versione JavaScript); nel browser ONNX Runtime Web (WebAssembly) in un Web Worker.
  - Modelli a metà precisione: circa 60 MB l'uno, scaricati una volta e conservati nel browser.
  - In memoria i pesi sono a piena precisione. Il picco misurato durante la separazione è di circa 3,6 GB (consigliati telefoni da 6–8 GB).
- **Ritmo**: i battiti si trovano dal flusso spettrale di basso, bongo e güira, con una preferenza per tempi intorno ai 128 BPM.
  - **Cambi di tempo**: l'app misura il tempo finestra per finestra (8 s ogni secondo, entro ±25% del tempo medio). Se varia più del 4% (intro lenta, rallentando, cambio di velocità) segue i battiti con un periodo che cambia lungo il brano. Su un test con la seconda metà rallentata del 10% ritrova tutti i battiti della parte lenta; sui brani a tempo costante i battiti restano identici a prima.
  - I BPM mostrati sono la mediana.
- **L'1, frase per frase**: in bachata gli accordi cambiano sull'1 (e sul 5). Per ogni battito l'app misura quanto cambia l'armonia (chitarra, basso, altro) e quanto è forte il basso; poi segue il conteggio 1–8 battito per battito (algoritmo di Viterbi). Il conteggio può **ripartire** (break di 2 o 4 tempi, battute aggiunte o saltate) solo quando più frasi di fila sono d'accordo, così non salta per sbaglio. Su un brano con 2 tempi tolti a metà ritrova il punto di ripartenza (con circa una frase di ritardo) e il conteggio giusto dopo; su "Frío" e "Pobre de Mí" non trova ripartenze.
  - **L'1 è qui!** corregge il tratto in cui sei (tutto il brano se non ci sono ripartenze). **Da qui in poi** fa ripartire il conteggio solo da quel battito: per un break che l'app non ha visto.
  - I progetti vecchi vengono rianalizzati una volta all'apertura (battiti con il tempo variabile e ripartenze), solo se il ritmo non è mai stato modificato a mano; se ci sono note sui tempi i battiti restano quelli e si ricalcola solo il conteggio.
  - Cambiare i BPM a mano (±1, metà, doppio) rimette una griglia regolare con un solo 1.
- **Riproduzione**: le tracce si mescolano in tempo reale con volume per strumento. Il cambio di velocità mantiene il tono (SoundTouch). Il loop è senza interruzioni e il metronomo è sincronizzato ai battiti trovati.
- **Salvataggio**: IndexedDB `bachata-lab` (progetti, tracce, video). Modelli nella Cache `bachata-models-v1`. Preferenze in `localStorage`.

---

## 11. App Android (APK)

- L'APK contiene la stessa app web, impacchettata con **Capacitor** (Android 7.0 o più recente).
- I **modelli sono dentro l'app** (APK di circa 160 MB): niente download al primo progetto e nessuna seconda copia nella cache. Al primo progetto vengono preparati una volta nella memoria dell'app. Le Impostazioni lo indicano ("dentro l'app") e nascondono "Elimina i modelli scaricati".
- La **separazione è nativa** e molto più veloce (vedi §4). Solo telefoni a 64 bit (arm64), cioè praticamente tutti quelli con 6 GB di RAM o più.
- Lo **schermo resta acceso** durante la separazione e con un progetto aperto, tramite il plugin KeepAwake.
- Il tasto Indietro di Android segue la stessa navigazione dell'app (chiude pannelli e overlay, poi torna alla home).
- I font si scaricano da Internet la prima volta; senza connessione l'app usa i font di sistema.
- **Come si costruisce**: a ogni modifica su `main` (cartelle `app/`, `android/` o configurazione) il workflow GitHub Actions "APK Android":
  1. copia `app/` nel progetto Android;
  2. compila l'APK;
  3. lo firma;
  4. lo pubblica nelle **Release** del repository come `BachataLab-5.0.N.apk` (N = numero della build, usato anche come versionCode).
  Si può avviare anche a mano da Actions → "APK Android" → "Run workflow".
- **Firma**: senza segreti configurati usa la chiave `android-signing/sideload.jks` del repository, così ogni nuova versione si installa sopra la precedente senza perdere i progetti. Per il Play Store servono una chiave privata e i segreti `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`: se ci sono, il workflow usa quelli. Cambiare chiave obbliga a disinstallare l'app una volta.

## 12. Note aperte

- **Ritardo nel conteggio degli esercizi**: l'utente l'ha notato con l'altoparlante del telefono. Sui telefoni Android anche l'altoparlante può avere 100–250 ms di ritardo che il browser non dichiara: va calibrato con l'altoparlante. Se invece è l'1 a essere nel posto sbagliato, si corregge con "L'1 è qui".
- Testo e traduzione non sono ancora stati provati su un telefono vero (velocità di Whisper e memoria).

## 13. Limiti noti

- Provata su un solo telefono (Vivo X300, Dimensity 9500). La separazione usa la CPU (4 core), uguale su tutti i telefoni a 64 bit: MediaTek, Snapdragon, Tensor, Kirin, Xiaomi.
- La separazione richiede lo schermo acceso e la pagina aperta.
- Nessun limite di durata, ma la memoria cresce con la lunghezza: circa 200 MB per ogni minuto di brano nella separazione nativa (le tracce stesse), più le tracce aperte nel player. Consigliati 30–90 secondi.
- I dati stanno nel browser: cancellando i dati del sito si perdono i progetti.

---

## Registro modifiche

- **26/11/2026**: cambi di tempo seguiti (tempo locale) e conteggio che riparte dopo i break, con "Da qui in poi"; tracce decompresse in parallelo all'apertura; tolta la chip "Senza playlist".

- **26/11/2026**: playlist (crea, rinomina, elimina, sposta e aggiungi brani). Tracce compresse in Opus 128 kb/s: circa 10 volte meno spazio, anche per i progetti già fatti.

- **26/11/2026**: testi: prima si cerca su LRCLIB, Whisper solo a richiesta; allineamento automatico del testo alla voce; righe lunghe di Whisper spezzate; Whisper si ferma se scegli un testo (la scritta non resta più).

- **25/11/2026**: "Altro" dice anche se dentro c'è altro oltre allo strumento principale ("Requinto + altro") e mostra il dettaglio nel popup del volume.

- **25/11/2026**: "Altro" prende il nome dello strumento riconosciuto (Requinto, Fisarmonica, Tastiere, Archi, Fiati) con YAMNet. APK più leggero: modelli di separazione come file .onnx unici invece del base64 e libreria di ONNX Runtime compressa (circa 50 MB in meno).

- **25/11/2026**: separazione nativa senza tetto di memoria (tracce in file mappati: 3:20 separati con 300 MB di heap, risultati identici). Whisper dentro l'app: trascrizione automatica dopo ogni import, senza download, sul processore (corretto l'errore "Cannot set properties of null" sul telefono). Traduzione solo a richiesta. Indietro/swipe di Android gestiti dall'app.

- **25/11/2026**: separazione con meno memoria per i brani lunghi: divisione bongo/güira a blocchi di 30 s (risultato identico) e "Altro" sommato sul posto. Picco su 4 minuti da circa 1,6 GB a circa 0,8 GB.

- **25/11/2026**: tolto il limite dei 3 minuti; tasto "Tutto il brano".

- **25/11/2026**: tornate le righe degli strumenti di prima, con la stanghetta colorata più spessa. Piano come settima traccia solo quando suona davvero; con 7 strumenti la mappa mostra i pulsanti su 4 colonne.

- **25/11/2026**: righe degli strumenti più spesse, che si illuminano quando lo strumento suona; zoom − / + nella mappa fino a tutta la canzone.

- **25/11/2026**: corretto il blocco a 100% su "Trovo il ritmo e salvo" (introdotto con il testo sincronizzato). Un errore alla fine della separazione ora mostra un messaggio invece di restare fermo.

- **25/11/2026**: testo sincronizzato nella mappa (LRCLIB, oppure Whisper sulla voce separata con riconoscimento della lingua), correzione delle righe, traduzione sul telefono con Opus-MT (italiano di default, lingua nelle Impostazioni). Nel player le forme d'onda degli strumenti sono sostituite da una linea per il volume.

- **25/11/2026**: nuovo design ispirato a Moises, disegnato con Claude.
  - Tema scuro, chiaro o come il telefono; colore principale a scelta (Corallo predefinito).
  - Home a righe con stato del mix; barra in basso Progetti / Allenati / Impostazioni.
  - Player con una riga per strumento (onda, %, M/S), popup per volume, velocità, metronomo (con accento), sezioni e ritmo; tasti −8 −4 ▶ +4 +8 che spostano anche il loop.
  - Nuova **Mappa** strumenti a tutto schermo, con muto valido solo nella mappa.
  - **Usa solo l'audio** per i video e **MP3 del mix attuale** (download nel browser, condivisione nell'app Android).
  - Güira sempre separata. Tolti preset del mixer, BPM ±0,1, "Accelera nel loop", griglia e pannello Mixer & ritmo.

- **25/11/2026**: separazione nativa nell'app Android (ONNX Runtime su 4 core, circa 5 volte più veloce), finestre della güira più efficienti (−25% di lavoro), ripiego automatico sulla versione nel browser. Calibrazione del ritardo di cuffie e casse per esercizi e "L'1 è qui!"; messaggio chiaro quando il tempo è giusto ma il tocco è in anticipo o in ritardo. Tolto il "limite" di spazio dalla home: si vede solo lo spazio usato.

- **25/11/2026**: app Android (APK) con Capacitor, costruita da GitHub Actions e pubblicata nelle Release. Modelli inclusi nell'APK, schermo sempre acceso con il plugin KeepAwake, icona dell'app.

- **25/11/2026**: nuovo design "Stage Studio Pulse" da Google Stitch.
  - Home con spazio, ricerca, stato del mix sulle schede e barra in basso (Progetti, Lab, Allenati, Impostazioni); nuova finestra Impostazioni.
  - Nuovo progetto con durata grande, avvisi e tracce con icone. Separazione con passaggi, tempo trascorso e rimanente e stato dello schermo acceso.
  - Player con pannello del conteggio, pad con misuratori, linguette Timeline/Griglia, barra del loop, velocità − / +, metronomo e barra in basso.
  - Allenamento con guida audio, durata (4/8 frasi), barra di precisione, pausa, distribuzione dei tocchi e tendenza.
  - Corretto: la scelta del salto (4/8) non veniva salvata nel progetto.
- **25/11/2026**: tolta la salsa (On1/On2): solo bachata, tap su 4 e 8. Salti solo di 4 o 8 tempi.
- **24–25/11/2026**: prima versione: separazione a 6 strumenti sul telefono, güira separata dal bongo, player con conteggio, loop, segnalibri, griglia, note, mixer, metronomo, video con specchio, allenamento.
