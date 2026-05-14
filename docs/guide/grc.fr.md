# GRC

Le module **GRC** réunit la Gouvernance, le Risque et la Conformité dans un espace de travail unique à `/grc`. Il regroupe des activités auparavant éparpillées entre Livraison EA et TurboLens, afin que l'architecte, le propriétaire de risque et l'examinateur de conformité partagent un terrain commun.

GRC comporte trois onglets :

- **Gouvernance** — Principes EA et Architecture Decision Records (ADR).
- **Risque** — le [Registre des risques](risks.md) selon TOGAF Phase G.
- **Conformité** — le scanner à la demande (CVE + analyse d'écart réglementaire) qui se trouvait auparavant dans TurboLens.

Tu peux pointer directement sur un onglet via `/grc?tab=governance`, `/grc?tab=risk` ou `/grc?tab=compliance`.

## Gouvernance

Deux panneaux côte à côte :

- **Principes** — navigateur en lecture seule des Principes EA publiés dans le métamodèle (énoncé, justification, implications). Le catalogue se modifie depuis **Administration → Métamodèle → Principes**.
- **Décisions** — Architecture Decision Records. Chaque ADR consigne le statut, le contexte, la décision, les alternatives examinées et les conséquences. Les décisions émises par l'assistant TurboLens Architect arrivent ici sous forme de brouillons à valider.

## Risque

Intègre le **Registre des risques** TOGAF Phase G. Le cycle de vie complet, le workflow de statut, les bascules de matrice et le comportement des propriétaires sont documentés dans le [guide du Registre des risques](risks.md). L'essentiel :

- Le registre vit à `/grc?tab=risk` (auparavant sous Livraison EA).
- Les risques peuvent être créés manuellement ou **promus** depuis un constat CVE ou de conformité dans l'onglet Conformité.
- La promotion est idempotente — une fois un constat promu, son bouton bascule sur **Ouvrir le risque R-000123**.

## Conformité

Le scanner de sécurité à la demande, en deux moitiés indépendantes :

- **Scan CVE** — interroge le NIST NVD pour les fournisseurs / produits / versions du paysage vivant, puis demande au LLM de prioriser les constats.
- **Scan de conformité** — analyse d'écart par régulation, par IA, contre les régulations activées (EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001 par défaut ; les administrateurs peuvent en activer d'autres sous **Administration → Régulations**).

Les constats sont **durables au fil des re-scans** — les décisions utilisateur, les notes de revue et le lien retour vers un Risque promu survivent aux scans ultérieurs. Un constat que le scan suivant ne signale plus est marqué `auto_resolved` et masqué par défaut ; le Risque précédemment promu reste intact pour ne pas rompre la piste d'audit.

La grille Conformité reflète celle de l'Inventaire : barre latérale de filtres avec bascule de visibilité des colonnes, tri persisté et un tiroir de détail qui montre le cycle de vie de conformité (`new → in_review → mitigated → verified`, avec `risk_tracked`, `accepted` et `not_applicable` comme branches latérales).

## Permissions

| Permission | Rôles par défaut |
|------------|------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | voir [Registre des risques § Permissions](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | voir [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` contrôle la visibilité de la route GRC elle-même — sans elle, l'entrée du menu supérieur est masquée. Chaque onglet impose en plus sa permission propre au domaine, de sorte qu'un visualiseur peut consulter le registre sans pouvoir déclencher un scan LLM, par exemple.
