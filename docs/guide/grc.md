# GRC

The **GRC** module brings Governance, Risk and Compliance into a single workspace at `/grc`. It consolidates work that previously lived across EA Delivery and TurboLens so an architect, a risk owner and a compliance reviewer can stand on common ground.

GRC has three tabs:

- **Governance** — EA Principles and Architecture Decision Records (ADRs).
- **Risk** — the TOGAF Phase G [Risk Register](risks.md).
- **Compliance** — the on-demand scanner (CVE + regulation gap analysis) that used to sit in TurboLens.

You can deep-link any tab via `/grc?tab=governance`, `/grc?tab=risk` or `/grc?tab=compliance`.

![GRC — Governance tab](../assets/img/en/52_grc_governance.png)

## Governance

Two side-by-side panels:

- **Principles** — read-only browser of EA Principles published in the metamodel (statement, rationale, implications). Edit the catalogue from **Administration → Metamodel → Principles**.
- **Decisions** — Architecture Decision Records. Each ADR captures status, context, decision, alternatives considered, and consequences. Decisions emitted by the TurboLens Architect wizard land here as drafts so reviewers can sign off.

## Risk

![GRC — Risk Register](../assets/img/en/53_grc_risk_register.png)

Embeds the TOGAF Phase G **Risk Register**. The full lifecycle, status workflow, matrix toggles and ownership behaviour are documented in the [Risk Register guide](risks.md). The most relevant points:

- The register lives at `/grc?tab=risk` (it used to live under EA Delivery).
- Risks can be created manually or **promoted** from a CVE or compliance finding under the Compliance tab.
- Promotion is idempotent — once a finding has been promoted its button flips to **Open risk R-000123**.

## Compliance

![GRC — Compliance scanner](../assets/img/en/54_grc_compliance.png)

The on-demand security scanner, with two independent halves:

- **CVE scan** — queries NIST NVD for the live landscape's vendors / products / versions, then asks the LLM to prioritise findings.
- **Compliance scan** — per-regulation AI gap analysis against the enabled regulations. Six frameworks ship enabled by default (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001); admins can enable or disable any of them — and add custom regulations like HIPAA or internal policies — under [**Administration → Metamodel → Regulations**](../admin/metamodel.md#compliance-regulations).

Findings are **durable across re-scans** — user decisions, reviewer notes, the user's AI verdict on a card, and the back-link to a promoted Risk all survive subsequent scans. A finding the next pass no longer reports is flagged `auto_resolved` and hidden by default; the previously-promoted Risk is left intact so its audit trail isn't broken.

The Compliance grid mirrors the Inventory grid: filter sidebar with column visibility toggles, persisted sort, full-text search, and a detail drawer that shows the finding's compliance lifecycle as a horizontal phase timeline:

```
new → in_review → mitigated → verified
                      ↘ accepted          (requires rationale)
                      ↘ not_applicable    (scope review)
                      ↘ risk_tracked      (set automatically on promote-to-Risk)
```

When `security_compliance.manage` is granted, tick the header checkbox for a **filter-aware select-all**, then use the sticky toolbar to **Edit decision** (batch transition) or **Delete** the selected findings. Illegal transitions are reported per row in a partial-success summary so a single bad row doesn't fail the batch. See [TurboLens → Security & Compliance](turbolens.md#bulk-actions-on-the-compliance-grid) for the full action reference.

Closing or accepting a Risk that was promoted from a finding **propagates back to the finding** automatically — the linked compliance row moves to `mitigated` / `verified` / `accepted` / `in_review` to match, so the two registers stay in sync without manual upkeep.

### Compliance on a single card

![Card detail — Compliance tab](../assets/img/en/56_card_compliance_tab.png)

Cards that are in scope of a compliance scan also surface a **Compliance** tab on their detail page (gated on `security_compliance.view`). It lists every finding currently linked to the card with the same Acknowledge / Accept / **Create risk** / **Open risk** actions as the GRC view, so an Application owner can triage their own findings without leaving the card.

## Permissions

| Permission | Default roles |
|------------|---------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | see [Risk Register § Permissions](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | see [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controls visibility of the GRC route itself — without it the top-nav entry is hidden. Each tab additionally enforces its domain-specific permission so a viewer can read the register without being able to trigger an LLM scan, for example.
