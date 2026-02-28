# Dettaglio card

Cliccando su qualsiasi card nell'inventario si apre la **vista dettagliata** dove e possibile visualizzare e modificare tutte le informazioni sul componente.

![Vista dettaglio card](../assets/img/en/04_card_detail.png)

## Intestazione della card

La parte superiore della card mostra:

- **Icona e etichetta del tipo** — Indicatore del tipo di card con codice colore
- **Nome della card** — Modificabile in linea
- **Sottotipo** — Classificazione secondaria (se applicabile)
- **Badge dello stato di approvazione** — Draft, Approved, Broken o Rejected
- **Pulsante suggerimento AI** — Cliccate per generare una descrizione con AI (visibile quando l'AI e abilitata per questo tipo di card e l'utente ha il permesso di modifica)
- **Anello della qualita dei dati** — Indicatore visivo della completezza delle informazioni (0-100%)
- **Menu azioni** — Archiviazione, eliminazione e azioni di approvazione

### Workflow di approvazione

Le card possono attraversare un ciclo di approvazione:

| Stato | Significato |
|-------|-------------|
| **Draft** | Stato predefinito, non ancora revisionato |
| **Approved** | Revisionato e accettato da un responsabile |
| **Broken** | Era approvato, ma e stato modificato da allora — necessita di nuova revisione |
| **Rejected** | Revisionato e rifiutato, necessita di correzioni |

Quando una card approvata viene modificata, il suo stato cambia automaticamente in **Broken** per indicare che necessita di nuova revisione.

## Scheda Dettaglio (Principale)

La scheda dettaglio e organizzata in **sezioni** che possono essere riordinate e configurate da un amministratore per ogni tipo di card (vedi [Editor layout card](../admin/metamodel.md#card-layout-editor)).

### Sezione Descrizione

- **Descrizione** — Descrizione in testo ricco del componente. Supporta la funzionalita di suggerimento AI per la generazione automatica
- **Campi descrizione aggiuntivi** — Alcuni tipi di card includono campi extra nella sezione descrizione (es. alias, ID esterno)

### Sezione Ciclo di vita

Il modello del ciclo di vita traccia un componente attraverso cinque fasi:

| Fase | Descrizione |
|------|-------------|
| **Plan** | In fase di valutazione, non ancora avviato |
| **Phase In** | In fase di implementazione o distribuzione |
| **Active** | Attualmente operativo |
| **Phase Out** | In fase di dismissione |
| **End of Life** | Non piu in uso o supportato |

Ogni fase ha un **selettore di data** per registrare quando il componente e entrato o entrera in quella fase. Una barra temporale visiva mostra la posizione del componente nel suo ciclo di vita.

### Sezioni attributi personalizzati

A seconda del tipo di card, vedrete sezioni aggiuntive con **campi personalizzati** configurati nel metamodello. I tipi di campo includono:

- **Testo** — Input di testo libero
- **Numero** — Valore numerico
- **Costo** — Valore numerico visualizzato con la valuta configurata della piattaforma
- **Booleano** — Interruttore on/off
- **Data** — Selettore di data
- **URL** — Link cliccabile (validato per http/https/mailto)
- **Selezione singola** — Menu a tendina con opzioni predefinite
- **Selezione multipla** — Selezione multipla con visualizzazione a chip

I campi contrassegnati come **calcolati** mostrano un badge e non possono essere modificati manualmente — i loro valori sono calcolati da [formule definite dall'amministratore](../admin/calculations.md).

### Sezione Gerarchia

Per i tipi di card che supportano la gerarchia (es. Organization, Business Capability, Application):

- **Genitore** — Il genitore della card nella gerarchia (cliccate per navigare)
- **Figli** — Elenco delle card figlie (cliccate su qualsiasi per navigare)
- **Breadcrumb gerarchico** — Mostra il percorso completo dalla radice alla card corrente

### Sezione Relazioni

Mostra tutte le connessioni con altre card, raggruppate per tipo di relazione. Per ogni relazione:

- **Nome della card correlata** — Cliccate per navigare alla card correlata
- **Tipo di relazione** — La natura della connessione (es. "utilizza", "funziona su", "dipende da")
- **Aggiungi relazione** — Cliccate su **+** per creare una nuova relazione cercando card
- **Rimuovi relazione** — Cliccate sull'icona di eliminazione per rimuovere una relazione

### Sezione Tag

Applicate tag dai [gruppi di tag](../admin/tags.md) configurati. A seconda della modalita del gruppo, potete selezionare un tag (selezione singola) o piu tag (selezione multipla).

### Sezione Documenti

Allegate link a risorse esterne:

- **Aggiungi documento** — Inserite un URL e un'etichetta opzionale
- **Cliccate per aprire** — I link si aprono in una nuova scheda
- **Rimuovi** — Eliminate un link a un documento

### Sezione EOL

Se la card e collegata a un prodotto [endoflife.date](https://endoflife.date/) (tramite [Amministrazione EOL](../admin/eol.md)):

- **Nome del prodotto e versione**
- **Stato del supporto** — Con codice colore: Supportato, In avvicinamento a EOL, End of Life
- **Date chiave** — Data di rilascio, fine supporto attivo, fine supporto di sicurezza, data EOL

## Scheda Commenti

![Sezione commenti della card](../assets/img/en/05_card_comments.png)

- **Aggiungi commenti** — Lasciate note, domande o decisioni sul componente
- **Risposte con thread** — Rispondete a commenti specifici per creare conversazioni con thread
- **Timestamp** — Visualizzate quando ogni commento e stato pubblicato e da chi

## Scheda Todo

![Todo associati a una card](../assets/img/en/06_card_todos.png)

- **Crea todo** — Aggiungete attivita collegate a questa card specifica
- **Assegna** — Impostate un responsabile per ogni attivita
- **Data di scadenza** — Impostate scadenze
- **Stato** — Alternate tra Aperto e Completato

## Scheda Stakeholder

![Stakeholder della card](../assets/img/en/07_card_stakeholders.png)

Gli stakeholder sono persone con un **ruolo** specifico su questa card. I ruoli disponibili dipendono dal tipo di card (configurati nel [metamodello](../admin/metamodel.md)). I ruoli comuni includono:

- **Application Owner** — Responsabile delle decisioni aziendali
- **Technical Owner** — Responsabile delle decisioni tecniche
- **Ruoli personalizzati** — Ruoli aggiuntivi definiti dal vostro amministratore

Le assegnazioni degli stakeholder influenzano i **permessi**: i permessi effettivi di un utente su una card sono la combinazione del suo ruolo a livello di applicazione e di qualsiasi ruolo di stakeholder che detiene su quella card.

## Scheda Cronologia

![Cronologia modifiche della card](../assets/img/en/08_card_history.png)

Mostra il **registro di audit completo** delle modifiche apportate alla card: **chi** ha effettuato la modifica, **quando** e stata fatta e **cosa** e stato modificato (valore precedente vs. nuovo valore). Questo consente la completa tracciabilita di tutte le modifiche nel tempo.

## Scheda Flusso di processo (solo card Business Process)

Per le card **Business Process**, appare una scheda aggiuntiva **Flusso di processo** con un visualizzatore/editor di diagrammi BPMN integrato. Vedi [BPM](bpm.md) per i dettagli sulla gestione dei flussi di processo.

## Archiviazione

Le card possono essere **archiviate** (eliminate temporaneamente) tramite il menu azioni. Le card archiviate:

- Sono nascoste dalla vista predefinita dell'inventario (visibili solo con il filtro "Mostra archiviate")
- Vengono automaticamente **eliminate definitivamente dopo 30 giorni**
- Possono essere ripristinate prima della scadenza dei 30 giorni
