# GRC

Le module **GRC** réunit la Gouvernance, le Risque et la Conformité dans un espace de travail unique à `/grc`. Il regroupe des activités auparavant éparpillées entre Livraison EA et TurboLens, afin que l'architecte, le propriétaire de risque et l'examinateur de conformité partagent un terrain commun.

GRC comporte trois onglets :

- **Gouvernance** — Principes EA et Architecture Decision Records (ADR).
- **Risque** — le [Registre des risques](risks.md) selon TOGAF Phase G.
- **Conformité** — le scanner à la demande (CVE + analyse d'écart réglementaire) qui se trouvait auparavant dans TurboLens.

Tu peux pointer directement sur un onglet via `/grc?tab=governance`, `/grc?tab=risk` ou `/grc?tab=compliance`.

![GRC — onglet Gouvernance](../assets/img/fr/52_grc_gouvernance.png)

## Gouvernance

Deux panneaux côte à côte :

- **Principes** — navigateur en lecture seule des Principes EA publiés dans le métamodèle (énoncé, justification, implications). Le catalogue se modifie depuis **Administration → Métamodèle → Principes**.
- **Décisions** — Architecture Decision Records. Chaque ADR consigne le statut, le contexte, la décision, les alternatives examinées et les conséquences. Les décisions émises par l'assistant TurboLens Architect arrivent ici sous forme de brouillons à valider.

## Risque

![GRC — Registre des risques](../assets/img/fr/53_grc_registre_risques.png)

Intègre le **Registre des risques** TOGAF Phase G. Le cycle de vie complet, le workflow de statut, les bascules de matrice et le comportement des propriétaires sont documentés dans le [guide du Registre des risques](risks.md). L'essentiel :

- Le registre vit à `/grc?tab=risk` (auparavant sous Livraison EA).
- Les risques peuvent être créés manuellement ou **promus** depuis un constat CVE ou de conformité dans l'onglet Conformité.
- La promotion est idempotente — une fois un constat promu, son bouton bascule sur **Ouvrir le risque R-000123**.

## Conformité

![GRC — scanner de conformité](../assets/img/fr/54_grc_conformite.png)

Le scanner de sécurité à la demande, en deux moitiés indépendantes :

- **Scan CVE** — interroge le NIST NVD pour les fournisseurs / produits / versions du paysage vivant, puis demande au LLM de prioriser les constats.
- **Scan de conformité** — analyse d'écart par régulation, par IA, contre les régulations activées. Six frameworks sont activés par défaut (EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001) ; les administrateurs peuvent les activer / désactiver — et ajouter des régulations personnalisées comme HIPAA ou des politiques internes — sous [**Administration → Métamodèle → Régulations**](../admin/metamodel.md#compliance-regulations).

Les constats sont **durables au fil des re-scans** — les décisions utilisateur, les notes de revue, le verdict IA de l'utilisateur sur une fiche et le lien retour vers un Risque promu survivent aux scans ultérieurs. Un constat que le scan suivant ne signale plus est marqué `auto_resolved` et masqué par défaut ; le Risque précédemment promu reste intact pour ne pas rompre la piste d'audit.

La grille Conformité reflète celle de l'Inventaire : barre latérale de filtres avec bascule de visibilité des colonnes, tri persisté, recherche plein texte et un tiroir de détail qui affiche le cycle de vie de conformité comme une chronologie horizontale :

```
new → in_review → mitigated → verified
                      ↘ accepted          (justification requise)
                      ↘ not_applicable    (revue de périmètre)
                      ↘ risk_tracked      (positionné automatiquement lors d'une promotion)
```

Avec `security_compliance.manage`, coche la case du header pour une **sélection-tout filtrée**, puis utilise la barre d'outils épinglée pour **Modifier la décision** (transition par lot) ou **Supprimer** les constats sélectionnés. Les transitions illégales sont signalées ligne par ligne dans un résumé de succès partiel, de sorte qu'une seule mauvaise ligne ne fait pas échouer tout le lot. Voir [TurboLens → Sécurité & Conformité](turbolens.md#bulk-actions-on-the-compliance-grid) pour la référence complète des actions.

Lorsqu'un Risque promu depuis un constat est clôturé ou accepté, l'opération **se propage automatiquement vers le constat** — la ligne de conformité liée bascule sur `mitigated` / `verified` / `accepted` / `in_review` pour rester synchronisée, sans entretien manuel.

### Conformité sur une seule fiche

Les fiches dans le périmètre d'un scan de conformité exposent également un onglet **Conformité** sur leur page de détail (gouverné par `security_compliance.view`). Il liste chaque constat actuellement lié à la fiche avec les mêmes actions Acquitter / Accepter / **Créer un risque** / **Ouvrir le risque** que la vue GRC — de sorte qu'un Application Owner peut trier ses constats sans quitter la fiche.

## Permissions

| Permission | Rôles par défaut |
|------------|------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | voir [Registre des risques § Permissions](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | voir [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` contrôle la visibilité de la route GRC elle-même — sans elle, l'entrée du menu supérieur est masquée. Chaque onglet impose en plus sa permission propre au domaine, de sorte qu'un visualiseur peut consulter le registre sans pouvoir déclencher un scan LLM, par exemple.
