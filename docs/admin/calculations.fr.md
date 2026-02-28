# Calculs

La fonctionnalite **Calculs** (**Admin > Metamodele > onglet Calculs**) vous permet de definir des **formules qui calculent automatiquement des valeurs de champs** lorsque les fiches sont sauvegardees. C'est un outil puissant pour deriver des metriques, des scores et des agregations a partir de vos donnees d'architecture.

## Comment ca marche

1. Un administrateur definit une formule ciblant un type de fiche et un champ specifiques
2. Lorsqu'une fiche de ce type est creee ou mise a jour, la formule s'execute automatiquement
3. Le resultat est ecrit dans le champ cible
4. Le champ cible est marque en **lecture seule** sur la page de detail de la fiche (les utilisateurs voient un badge « calcule »)

## Creation d'un calcul

Cliquez sur **+ Nouveau calcul** et configurez :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom descriptif du calcul |
| **Type cible** | Le type de fiche auquel ce calcul s'applique |
| **Champ cible** | Le champ ou le resultat est stocke |
| **Formule** | L'expression a evaluer (voir la syntaxe ci-dessous) |
| **Ordre d'execution** | Ordre d'execution lorsque plusieurs calculs existent pour le meme type (le plus petit s'execute en premier) |
| **Actif** | Activer ou desactiver le calcul |

## Syntaxe des formules

Les formules utilisent un langage d'expression securise et isole. Vous pouvez referencer les attributs de la fiche, les donnees des fiches liees et les informations du cycle de vie.

### Variables de contexte

| Variable | Description | Exemple |
|----------|-------------|---------|
| `fieldKey` | N'importe quel attribut de la fiche courante | `businessCriticality` |
| `related_{type_key}` | Tableau de fiches liees d'un type donne | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | Valeurs de dates du cycle de vie | `lifecycle_endOfLife` |

### Fonctions integrees

| Fonction | Description | Exemple |
|----------|-------------|---------|
| `IF(condition, valeur_vraie, valeur_fausse)` | Logique conditionnelle | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(tableau)` | Somme des valeurs numeriques | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(tableau)` | Moyenne des valeurs numeriques | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(tableau)` | Valeur minimale | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(tableau)` | Valeur maximale | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(tableau)` | Nombre d'elements | `COUNT(related_interfaces)` |
| `ROUND(valeur, decimales)` | Arrondir un nombre | `ROUND(avgCost, 2)` |
| `ABS(valeur)` | Valeur absolue | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Premiere valeur non nulle | `COALESCE(customScore, 0)` |
| `LOWER(texte)` | Texte en minuscules | `LOWER(status)` |
| `UPPER(texte)` | Texte en majuscules | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Concatener des chaines | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(texte, recherche)` | Verifier si le texte contient une sous-chaine | `CONTAINS(description, "legacy")` |
| `PLUCK(tableau, cle)` | Extraire un champ de chaque element | `PLUCK(related_applications, "name")` |
| `FILTER(tableau, cle, valeur)` | Filtrer les elements par valeur de champ | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(valeur, correspondance)` | Associer des valeurs categorielles a des scores | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Exemples de formules

**Cout annuel total des applications liees :**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Score de risque base sur la criticite :**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Nombre d'interfaces actives :**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**Les commentaires** sont pris en charge avec `#` :
```
# Calculer le score de risque pondere
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Execution des calculs

Les calculs s'executent automatiquement lorsqu'une fiche est sauvegardee. Vous pouvez egalement declencher manuellement un calcul pour l'executer sur toutes les fiches du type cible :

1. Trouvez le calcul dans la liste
2. Cliquez sur le bouton **Executer**
3. La formule est evaluee pour chaque fiche correspondante et les resultats sont sauvegardes

## Ordre d'execution

Lorsque plusieurs calculs ciblent le meme type de fiche, ils s'executent dans l'ordre specifie par leur valeur d'**ordre d'execution**. C'est important lorsqu'un calcul depend du resultat d'un autre -- definissez la dependance pour qu'elle s'execute en premier (numero inferieur).
