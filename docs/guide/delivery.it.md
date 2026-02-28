# EA Delivery

Il modulo **EA Delivery** gestisce le **iniziative architetturali e i relativi artefatti** — diagrammi e Statement of Architecture Work (SoAW). Fornisce una vista unica di tutti i progetti architetturali in corso e i loro deliverable.

![Gestione EA Delivery](../assets/img/en/17_ea_delivery.png)

## Panoramica delle iniziative

La pagina e organizzata attorno alle card **Initiative**. Ogni iniziativa mostra:

| Campo | Descrizione |
|-------|-------------|
| **Nome** | Nome dell'iniziativa |
| **Sottotipo** | Idea, Program, Project o Epic |
| **Stato** | On Track, At Risk, Off Track, On Hold o Completed |
| **Artefatti** | Conteggio dei diagrammi e documenti SoAW collegati |

Potete alternare tra una vista a **galleria di schede** e una vista a **elenco**, e filtrare le iniziative per stato (Attive o Archiviate).

Cliccando su un'iniziativa la si espande per mostrare tutti i **diagrammi** e i **documenti SoAW** collegati.

## Statement of Architecture Work (SoAW)

Uno **Statement of Architecture Work (SoAW)** e un documento formale definito dallo [standard TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Stabilisce l'ambito, l'approccio, i deliverable e la governance per un impegno architetturale. In TOGAF, il SoAW viene prodotto durante la **Fase preliminare** e la **Fase A (Visione dell'architettura)** e serve come accordo tra il team di architettura e i suoi stakeholder.

Turbo EA fornisce un editor SoAW integrato con template di sezioni allineati a TOGAF, editing di testo ricco e funzionalita di esportazione — cosi potete creare e gestire documenti SoAW direttamente insieme ai vostri dati architetturali.

### Creazione di un SoAW

1. Cliccate su **+ Nuovo SoAW** dall'interno di un'iniziativa
2. Inserite il titolo del documento
3. L'editor si apre con **template di sezioni predefiniti** basati sullo standard TOGAF

### L'editor SoAW

L'editor fornisce:

- **Editing di testo ricco** — Barra degli strumenti di formattazione completa (intestazioni, grassetto, corsivo, elenchi, link) alimentata dall'editor TipTap
- **Template di sezioni** — Sezioni predefinite seguendo gli standard TOGAF (es. Descrizione del problema, Obiettivi, Approccio, Stakeholder, Vincoli, Piano di lavoro)
- **Tabelle modificabili in linea** — Aggiungete e modificate tabelle all'interno di qualsiasi sezione
- **Workflow degli stati** — I documenti progrediscono attraverso fasi definite:

| Stato | Significato |
|-------|-------------|
| **Draft** | In fase di scrittura, non ancora pronto per la revisione |
| **In Review** | Inviato per la revisione degli stakeholder |
| **Approved** | Revisionato e accettato |
| **Signed** | Formalmente firmato |

### Workflow di firma

Una volta approvato un SoAW, potete richiedere le firme dagli stakeholder. Il sistema traccia chi ha firmato e invia notifiche ai firmatari in attesa.

### Anteprima ed esportazione

- **Modalita anteprima** — Vista di sola lettura del documento SoAW completo
- **Esportazione DOCX** — Scaricate il SoAW come documento Word formattato per la condivisione offline o la stampa
