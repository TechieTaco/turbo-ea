# GRC

Das **GRC**-Modul vereint Governance, Risk und Compliance in einem gemeinsamen Arbeitsbereich unter `/grc`. Es bündelt Aufgaben, die zuvor zwischen EA-Bereitstellung und TurboLens verteilt waren, sodass Architektin, Risikoeigentümer und Compliance-Prüferin auf gemeinsamem Boden arbeiten.

GRC hat drei Reiter:

- **Governance** — EA-Prinzipien und Architecture Decision Records (ADRs).
- **Risk** — das [Risikoregister](risks.md) gemäß TOGAF Phase G.
- **Compliance** — der On-Demand-Scanner (CVE + regulatorische Lückenanalyse), der zuvor in TurboLens lebte.

Du kannst jeden Reiter direkt verlinken: `/grc?tab=governance`, `/grc?tab=risk` oder `/grc?tab=compliance`.

## Governance

Zwei nebeneinanderliegende Panels:

- **Prinzipien** — schreibgeschützter Browser für die im Metamodell veröffentlichten EA-Prinzipien (Aussage, Begründung, Auswirkungen). Den Katalog bearbeitest du unter **Administration → Metamodell → Prinzipien**.
- **Decisions** — Architecture Decision Records. Jeder ADR erfasst Status, Kontext, Entscheidung, geprüfte Alternativen und Konsequenzen. Vom TurboLens-Architect-Wizard erzeugte Entscheidungen landen hier als Entwürfe für Reviewer.

## Risk

Bindet das **Risikoregister** gemäß TOGAF Phase G ein. Lebenszyklus, Statusworkflow, Matrix-Umschalter und Eigentümer-Verhalten sind im [Risikoregister-Leitfaden](risks.md) dokumentiert. Die wichtigsten Punkte:

- Das Register lebt unter `/grc?tab=risk` (vorher unter EA-Bereitstellung).
- Risiken können manuell angelegt oder aus einem CVE- bzw. Compliance-Befund unter dem Compliance-Reiter **promotet** werden.
- Die Promotion ist idempotent — sobald ein Befund promotet wurde, wechselt sein Button auf **Risiko R-000123 öffnen**.

## Compliance

Der On-Demand-Sicherheitsscanner mit zwei unabhängigen Hälften:

- **CVE-Scan** — fragt die NIST NVD nach den Anbietern / Produkten / Versionen der lebenden Landschaft ab und lässt das LLM Funde priorisieren.
- **Compliance-Scan** — KI-gestützte Lückenanalyse pro Regulierung gegen die aktivierten Regulierungen (standardmäßig EU AI Act, DSGVO, NIS2, DORA, SOC 2, ISO 27001; Administratorinnen können unter **Administration → Regulierungen** weitere aktivieren).

Befunde sind **über Re-Scans hinweg dauerhaft** — Benutzerentscheidungen, Prüfnotizen und der Rückverweis auf ein promotetes Risiko überleben spätere Scans. Ein Befund, den der nächste Lauf nicht mehr meldet, wird mit `auto_resolved` markiert und standardmäßig ausgeblendet; das zuvor promotete Risiko bleibt erhalten, damit der Audit-Pfad nicht abreißt.

Das Compliance-Grid spiegelt das Inventar-Grid: Filter-Sidebar mit Spaltensichtbarkeit, persistierter Sortierung und einer Detail-Schublade, die den Compliance-Lebenszyklus zeigt (`new → in_review → mitigated → verified`, mit `risk_tracked`, `accepted` und `not_applicable` als Seitenpfade).

## Berechtigungen

| Berechtigung | Standardrollen |
|--------------|----------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | siehe [Risikoregister § Berechtigungen](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | siehe [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` steuert die Sichtbarkeit der GRC-Route selbst — ohne diese Berechtigung wird der Eintrag im Top-Menü ausgeblendet. Jeder Reiter erzwingt zusätzlich seine domänenspezifische Berechtigung, sodass etwa eine Viewerin das Register lesen kann, ohne einen LLM-Scan auslösen zu dürfen.
