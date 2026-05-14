# GRC

The **GRC** module brings Governance, Risk and Compliance into a single workspace at `/grc`. It consolidates work that previously lived across EA Delivery and TurboLens so an architect, a risk owner and a compliance reviewer can stand on common ground.

GRC has three tabs:

- **Governance** — EA Principles and Architecture Decision Records (ADRs).
- **Risk** — the TOGAF Phase G [Risk Register](risks.md).
- **Compliance** — the on-demand scanner (CVE + regulation gap analysis) that used to sit in TurboLens.

You can deep-link any tab via `/grc?tab=governance`, `/grc?tab=risk` or `/grc?tab=compliance`.

## Governance

Two side-by-side panels:

- **Principles** — read-only browser of EA Principles published in the metamodel (statement, rationale, implications). Edit the catalogue from **Administration → Metamodel → Principles**.
- **Decisions** — Architecture Decision Records. Each ADR captures status, context, decision, alternatives considered, and consequences. Decisions emitted by the TurboLens Architect wizard land here as drafts so reviewers can sign off.

## Risk

Embeds the TOGAF Phase G **Risk Register**. The full lifecycle, status workflow, matrix toggles and ownership behaviour are documented in the [Risk Register guide](risks.md). The most relevant points:

- The register lives at `/grc?tab=risk` (it used to live under EA Delivery).
- Risks can be created manually or **promoted** from a CVE or compliance finding under the Compliance tab.
- Promotion is idempotent — once a finding has been promoted its button flips to **Open risk R-000123**.

## Compliance

The on-demand security scanner, with two independent halves:

- **CVE scan** — queries NIST NVD for the live landscape's vendors / products / versions, then asks the LLM to prioritise findings.
- **Compliance scan** — per-regulation AI gap analysis against the enabled regulations (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001 by default; admins can enable more under **Administration → Regulations**).

Findings are **durable across re-scans** — user decisions, reviewer notes and the back-link to a promoted Risk all survive subsequent scans. A finding the next pass no longer reports is flagged `auto_resolved` and hidden by default; the previously-promoted Risk is left intact so its audit trail isn't broken.

The Compliance grid mirrors the Inventory grid: filter sidebar with column visibility toggles, persisted sort, and a detail drawer that shows the finding's compliance lifecycle (`new → in_review → mitigated → verified`, with `risk_tracked`, `accepted` and `not_applicable` as side branches).

## Permissions

| Permission | Default roles |
|------------|---------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | see [Risk Register § Permissions](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | see [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controls visibility of the GRC route itself — without it the top-nav entry is hidden. Each tab additionally enforces its domain-specific permission so a viewer can read the register without being able to trigger an LLM scan, for example.
