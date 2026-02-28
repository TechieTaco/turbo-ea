# Gestione End-of-Life (EOL)

La pagina di amministrazione **EOL** (**Admin > Impostazioni > EOL**) aiuta a tracciare il ciclo di vita dei prodotti tecnologici collegando le vostre card al database pubblico [endoflife.date](https://endoflife.date/).

## Perche tracciare l'EOL?

Sapere quando i prodotti tecnologici raggiungono l'end-of-life o la fine del supporto e fondamentale per:

- **Gestione del rischio** — Il software non supportato e una vulnerabilita di sicurezza
- **Pianificazione del budget** — Pianificate migrazioni e aggiornamenti prima che il supporto termini
- **Conformita** — Molte normative richiedono software supportato

## Ricerca massiva

La funzionalita di ricerca massiva analizza le vostre card **Application** e **IT Component** e trova automaticamente i prodotti corrispondenti nel database endoflife.date.

### Eseguire una ricerca massiva

1. Navigate su **Admin > Impostazioni > EOL**
2. Selezionate il tipo di card da analizzare (Application o IT Component)
3. Cliccate su **Cerca**
4. Il sistema esegue una **corrispondenza fuzzy** contro il catalogo prodotti endoflife.date

### Revisione dei risultati

Per ogni card, la ricerca restituisce:

- **Punteggio di corrispondenza** (0-100%) — Quanto il nome della card corrisponde a un prodotto noto
- **Nome del prodotto** — Il prodotto endoflife.date corrispondente
- **Versioni/cicli disponibili** — Le versioni di rilascio del prodotto con le rispettive date di supporto

### Filtro dei risultati

Utilizzate i controlli del filtro per concentrarvi su:

- **Tutti gli elementi** — Ogni card analizzata
- **Solo non collegati** — Card non ancora collegate a un prodotto EOL
- **Gia collegati** — Card che hanno gia un collegamento EOL

Un riepilogo delle statistiche mostra: card totali analizzate, gia collegate, non collegate e corrispondenze trovate.

### Collegamento delle card ai prodotti

1. Revisionate la corrispondenza suggerita per ogni card
2. Selezionate la **versione/ciclo del prodotto** corretta dal menu a tendina
3. Cliccate su **Collega** per salvare l'associazione

Una volta collegata, la pagina di dettaglio della card mostra una **sezione EOL** con:

- **Nome del prodotto e versione**
- **Stato del supporto** — Con codice colore: Supportato (verde), In avvicinamento a EOL (arancione), End of Life (rosso)
- **Date chiave** — Data di rilascio, fine supporto attivo, fine supporto di sicurezza, data EOL

## Report EOL

I dati EOL collegati alimentano il [Report EOL](../guide/reports.md), che fornisce una vista dashboard dello stato di supporto del vostro panorama tecnologico su tutte le card collegate.
