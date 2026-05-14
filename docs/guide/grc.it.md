# GRC

Il modulo **GRC** riunisce Governance, Rischio e Conformità in un unico spazio di lavoro a `/grc`. Consolida attività che prima vivevano tra Consegna EA e TurboLens, in modo che un'architetta, un proprietario di rischio e un revisore di conformità lavorino su un terreno comune.

GRC ha tre schede:

- **Governance** — Principi EA e Architecture Decision Records (ADR).
- **Rischio** — il [Registro dei rischi](risks.md) secondo TOGAF Fase G.
- **Conformità** — lo scanner on-demand (CVE + analisi degli scostamenti normativi) che prima si trovava in TurboLens.

Puoi puntare direttamente a una scheda con `/grc?tab=governance`, `/grc?tab=risk` o `/grc?tab=compliance`.

## Governance

Due pannelli affiancati:

- **Principi** — visualizzatore in sola lettura dei Principi EA pubblicati nel metamodello (enunciato, motivazione, implicazioni). Il catalogo si modifica da **Amministrazione → Metamodello → Principi**.
- **Decisioni** — Architecture Decision Records. Ogni ADR cattura stato, contesto, decisione, alternative considerate e conseguenze. Le decisioni emesse dalla procedura guidata TurboLens Architect arrivano qui come bozze da approvare.

## Rischio

Incorpora il **Registro dei rischi** TOGAF Fase G. Ciclo di vita completo, workflow degli stati, interruttori della matrice e comportamento dei proprietari sono documentati nella [guida del Registro dei rischi](risks.md). I punti più rilevanti:

- Il registro vive a `/grc?tab=risk` (prima era sotto Consegna EA).
- I rischi possono essere creati manualmente o **promossi** da un riscontro CVE o di conformità nella scheda Conformità.
- La promozione è idempotente — una volta promosso un riscontro, il suo pulsante diventa **Apri rischio R-000123**.

## Conformità

Lo scanner di sicurezza on-demand, con due metà indipendenti:

- **Scansione CVE** — interroga NIST NVD per i fornitori / prodotti / versioni del paesaggio vivo, poi chiede all'LLM di prioritizzare i riscontri.
- **Scansione di conformità** — analisi degli scostamenti per regolamento, basata su IA, contro i regolamenti abilitati (per default EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001; gli amministratori possono abilitarne altri da **Amministrazione → Regolamenti**).

I riscontri sono **durevoli tra re-scansioni** — decisioni utente, note di revisione e il rimando a un Rischio promosso sopravvivono alle scansioni successive. Un riscontro che la passata seguente non riporta più viene marcato `auto_resolved` e nascosto per default; il Rischio promosso in precedenza resta intatto per non rompere il percorso di audit.

La griglia Conformità riflette quella dell'Inventario: barra laterale dei filtri con visibilità delle colonne, ordinamento persistito e un cassetto di dettaglio che mostra il ciclo di vita di conformità (`new → in_review → mitigated → verified`, con `risk_tracked`, `accepted` e `not_applicable` come rami laterali).

## Permessi

| Permesso | Ruoli predefiniti |
|----------|-------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | vedi [Registro dei rischi § Permessi](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | vedi [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controlla la visibilità della rotta GRC stessa — senza di esso, la voce del menu superiore è nascosta. Ogni scheda inoltre impone il proprio permesso di dominio, così che una visualizzatrice possa leggere il registro senza poter avviare una scansione LLM, ad esempio.
