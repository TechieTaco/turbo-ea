# GRC

Il modulo **GRC** riunisce Governance, Rischio e Conformità in un unico spazio di lavoro a `/grc`. Consolida attività che prima vivevano tra Consegna EA e TurboLens, in modo che un'architetta, un proprietario di rischio e un revisore di conformità lavorino su un terreno comune.

GRC ha tre schede:

- **Governance** — Principi EA e Architecture Decision Records (ADR).
- **Rischio** — il [Registro dei rischi](risks.md) secondo TOGAF Fase G.
- **Conformità** — lo scanner on-demand (CVE + analisi degli scostamenti normativi) che prima si trovava in TurboLens.

Puoi puntare direttamente a una scheda con `/grc?tab=governance`, `/grc?tab=risk` o `/grc?tab=compliance`.

![GRC — scheda Governance](../assets/img/it/52_grc_governance.png)

## Governance

Due pannelli affiancati:

- **Principi** — visualizzatore in sola lettura dei Principi EA pubblicati nel metamodello (enunciato, motivazione, implicazioni). Il catalogo si modifica da **Amministrazione → Metamodello → Principi**.
- **Decisioni** — Architecture Decision Records. Ogni ADR cattura stato, contesto, decisione, alternative considerate e conseguenze. Le decisioni emesse dalla procedura guidata TurboLens Architect arrivano qui come bozze da approvare.

## Rischio

![GRC — Registro dei rischi](../assets/img/it/53_grc_registro_rischi.png)

Incorpora il **Registro dei rischi** TOGAF Fase G. Ciclo di vita completo, workflow degli stati, interruttori della matrice e comportamento dei proprietari sono documentati nella [guida del Registro dei rischi](risks.md). I punti più rilevanti:

- Il registro vive a `/grc?tab=risk` (prima era sotto Consegna EA).
- I rischi possono essere creati manualmente o **promossi** da un riscontro CVE o di conformità nella scheda Conformità.
- La promozione è idempotente — una volta promosso un riscontro, il suo pulsante diventa **Apri rischio R-000123**.

## Conformità

![GRC — scanner di conformità](../assets/img/it/54_grc_conformita.png)

Lo scanner di sicurezza on-demand, con due metà indipendenti:

- **Scansione CVE** — interroga NIST NVD per i fornitori / prodotti / versioni del paesaggio vivo, poi chiede all'LLM di prioritizzare i riscontri.
- **Scansione di conformità** — analisi degli scostamenti per regolamento, basata su IA, contro i regolamenti abilitati. Sei framework sono abilitati per default (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001); gli amministratori possono abilitarli o disabilitarli — e aggiungere regolamenti personalizzati come HIPAA o policy interne — da [**Amministrazione → Metamodello → Regolamenti**](../admin/metamodel.md#compliance-regulations).

I riscontri sono **durevoli tra re-scansioni** — decisioni utente, note di revisione, il verdetto AI dell'utente su una card e il rimando a un Rischio promosso sopravvivono alle scansioni successive. Un riscontro che la passata seguente non riporta più viene marcato `auto_resolved` e nascosto per default; il Rischio promosso in precedenza resta intatto per non rompere il percorso di audit.

La griglia Conformità riflette quella dell'Inventario: barra laterale dei filtri con visibilità delle colonne, ordinamento persistito, ricerca a testo libero e un cassetto di dettaglio che mostra il ciclo di vita di conformità come una timeline orizzontale di fasi:

```
new → in_review → mitigated → verified
                      ↘ accepted          (motivazione richiesta)
                      ↘ not_applicable    (revisione dell'ambito)
                      ↘ risk_tracked      (impostato automaticamente alla promozione a Rischio)
```

Con `security_compliance.manage`, spunta la casella nell'header per una **selezione filtrata di tutte le righe**, poi usa la barra degli strumenti agganciata per **Modifica decisione** (transizione in batch) o **Elimina** i riscontri selezionati. Le transizioni illegali sono segnalate riga per riga in un riepilogo di successo parziale, così una singola riga errata non fa fallire l'intero batch. Vedi [TurboLens → Sicurezza & Conformità](turbolens.md#bulk-actions-on-the-compliance-grid) per il riferimento completo delle azioni.

Quando un Rischio promosso da un riscontro viene chiuso o accettato, l'operazione **si propaga automaticamente al riscontro** — la riga di conformità collegata passa a `mitigated` / `verified` / `accepted` / `in_review` per restare sincronizzata, senza manutenzione manuale.

### Conformità su una singola card

Le card nell'ambito di una scansione di conformità espongono anche una scheda **Conformità** nella loro pagina di dettaglio (governata da `security_compliance.view`). Elenca ogni riscontro attualmente collegato alla card con le stesse azioni Riconosci / Accetta / **Crea rischio** / **Apri rischio** della vista GRC — così che un Application Owner possa triagiare i propri riscontri senza lasciare la card.

## Permessi

| Permesso | Ruoli predefiniti |
|----------|-------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | vedi [Registro dei rischi § Permessi](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | vedi [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controlla la visibilità della rotta GRC stessa — senza di esso, la voce del menu superiore è nascosta. Ogni scheda inoltre impone il proprio permesso di dominio, così che una visualizzatrice possa leggere il registro senza poter avviare una scansione LLM, ad esempio.
