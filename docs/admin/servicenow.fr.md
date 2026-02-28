# Integration ServiceNow

L'integration ServiceNow (**Admin > Parametres > ServiceNow**) permet la synchronisation bidirectionnelle entre Turbo EA et votre ServiceNow CMDB. Ce guide couvre tout, de la configuration initiale aux recettes avancees et aux bonnes pratiques operationnelles.

## Pourquoi integrer ServiceNow avec Turbo EA ?

ServiceNow CMDB et les outils d'architecture d'entreprise servent des objectifs differents mais complementaires :

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Focus** | Operations IT -- ce qui fonctionne, qui en est responsable, quels incidents se sont produits | Planification strategique -- a quoi devrait ressembler le paysage dans 3 ans ? |
| **Maintenu par** | Operations IT, Gestion des actifs | Equipe EA, Architectes metier |
| **Point fort** | Decouverte automatisee, workflows ITSM, precision operationnelle | Contexte metier, cartographie des capacites, planification du cycle de vie, evaluations |
| **Donnees typiques** | Noms d'hotes, IP, statut d'installation, groupes d'affectation, contrats | Criticite metier, adequation fonctionnelle, dette technique, feuille de route strategique |

**Turbo EA est le systeme de reference** pour votre paysage d'architecture -- les noms, descriptions, plans de cycle de vie, evaluations et contexte metier vivent tous ici. ServiceNow complete Turbo EA avec des metadonnees operationnelles et techniques (noms d'hotes, IP, donnees SLA, statut d'installation) provenant de la decouverte automatisee et des workflows ITSM. L'integration maintient ces deux systemes connectes tout en respectant que Turbo EA dirige.

### Ce que vous pouvez faire

- **Synchronisation pull** -- Alimenter Turbo EA avec des CI depuis ServiceNow, puis en prendre la propriete. Les pulls suivants ne mettent a jour que les champs operationnels (IP, statut, SLA) que SNOW decouvre automatiquement
- **Synchronisation push** -- Exporter les donnees curees par l'EA vers ServiceNow (noms, descriptions, evaluations, plans de cycle de vie) pour que les equipes ITSM voient le contexte EA
- **Synchronisation bidirectionnelle** -- Turbo EA dirige la plupart des champs ; SNOW dirige un petit ensemble de champs operationnels/techniques. Les deux systemes restent synchronises
- **Cartographie d'identite** -- Un suivi persistant de references croisees (sys_id <-> UUID de fiche) garantit que les enregistrements restent lies entre les synchronisations

---

## Architecture de l'integration

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Fiches          |  Pull: SNOW CIs -> Fiches Turbo     |  CMDB CIs        |
|  (Application,   |  Push: Fiches Turbo -> SNOW CIs     |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map suit sys_id <-> UUID   |   core_company)  |
+------------------+                                     +------------------+
```

L'integration utilise l'API Table de ServiceNow via HTTPS. Les identifiants sont chiffres au repos en utilisant Fernet (AES-128-CBC) derive de votre `SECRET_KEY`. Toutes les operations de synchronisation sont enregistrees comme evenements avec `source: "servicenow_sync"` pour une piste d'audit complete.

---

## Planification de votre integration

Avant de configurer quoi que ce soit, repondez a ces questions :

### 1. Quels types de fiches ont besoin de donnees depuis ServiceNow ?

Commencez petit. Les points d'integration les plus courants sont :

| Priorite | Type Turbo EA | Source ServiceNow | Pourquoi |
|----------|---------------|-------------------|----------|
| **Haute** | Application | `cmdb_ci_business_app` | Les applications sont le coeur de l'EA -- la CMDB a les noms, proprietaires et statuts faisant autorite |
| **Haute** | ITComponent (Logiciel) | `cmdb_ci_spkg` | Les produits logiciels alimentent le suivi EOL et le radar technologique |
| **Moyenne** | ITComponent (Materiel) | `cmdb_ci_server` | Paysage de serveurs pour la cartographie d'infrastructure |
| **Moyenne** | Provider | `core_company` | Registre de fournisseurs pour la gestion des couts et des relations |
| **Faible** | Interface | `cmdb_ci_endpoint` | Points d'integration (souvent maintenus manuellement en EA) |
| **Faible** | DataObject | `cmdb_ci_database` | Instances de base de donnees |

### 2. Quel systeme est la source de verite pour chaque champ ?

C'est la decision la plus importante. Le choix par defaut devrait etre **Turbo EA dirige** -- l'outil EA est le systeme de reference pour votre paysage d'architecture. ServiceNow ne devrait diriger que pour un ensemble restreint de champs operationnels et techniques provenant de la decouverte automatisee ou des workflows ITSM. Tout le reste -- noms, descriptions, evaluations, planification du cycle de vie, couts -- est possede et cure par l'equipe EA dans Turbo EA.

**Modele recommande -- « Turbo EA dirige, SNOW complete » :**

| Type de champ | Source de verite | Pourquoi |
|---------------|-----------------|----------|
| **Noms et descriptions** | **Turbo dirige** | L'equipe EA cure les noms faisant autorite et ecrit les descriptions strategiques ; les noms CMDB peuvent etre brouillons ou auto-generes |
| **Criticite metier** | **Turbo dirige** | Evaluation strategique de l'equipe EA -- pas des donnees operationnelles |
| **Adequation fonctionnelle / technique** | **Turbo dirige** | Les scores du modele TIME relevent de l'EA |
| **Cycle de vie (toutes les phases)** | **Turbo dirige** | Plan, phaseIn, active, phaseOut, endOfLife -- toutes des donnees de planification EA |
| **Donnees de cout** | **Turbo dirige** | L'EA suit le cout total de possession ; la CMDB peut avoir des lignes de contrat mais l'EA possede la vue consolidee |
| **Type d'hebergement, categorie** | **Turbo dirige** | L'EA classe les applications par modele d'hebergement pour l'analyse strategique |
| **Metadonnees techniques** | SNOW dirige | IP, versions OS, noms d'hotes, numeros de serie -- donnees de decouverte automatisee que l'EA ne maintient pas |
| **SLA / statut operationnel** | SNOW dirige | Statut d'installation, objectifs SLA, metriques de disponibilite -- donnees operationnelles ITSM |
| **Groupe d'affectation / support** | SNOW dirige | Propriete operationnelle suivie dans les workflows ServiceNow |
| **Dates de decouverte** | SNOW dirige | Premiere/derniere decouverte, dernier scan -- metadonnees d'automatisation CMDB |

### 3. A quelle frequence synchroniser ?

| Scenario | Frequence | Notes |
|----------|-----------|-------|
| Import initial | Une fois | Mode additif, examiner attentivement |
| Gestion active du paysage | Quotidien | Automatise via cron pendant les heures creuses |
| Rapports de conformite | Hebdomadaire | Avant de generer les rapports |
| Ad-hoc | Selon les besoins | Avant les revues ou presentations EA majeures |

---

## Etape 1 : Prerequis ServiceNow

### Creer un compte de service

Dans ServiceNow, creez un compte de service dedie (n'utilisez jamais de comptes personnels) :

| Role | Objectif | Requis ? |
|------|----------|----------|
| `itil` | Acces en lecture aux tables CMDB | Oui |
| `cmdb_read` | Lire les elements de configuration | Oui |
| `rest_api_explorer` | Utile pour tester les requetes | Recommande |
| `import_admin` | Acces en ecriture aux tables cibles | Uniquement pour le push sync |

**Bonne pratique** : Creez un role personnalise avec un acces en lecture seule aux tables specifiques que vous prevoyez de synchroniser. Le role `itil` est large -- un role personnalise limite le rayon d'impact.

### Exigences reseau

- Le backend Turbo EA doit pouvoir atteindre votre instance SNOW via HTTPS (port 443)
- Configurez les regles de pare-feu et les listes blanches IP
- Format de l'URL de l'instance : `https://entreprise.service-now.com` ou `https://entreprise.servicenowservices.com`

### Choisir la methode d'authentification

| Methode | Avantages | Inconvenients | Recommandation |
|---------|-----------|---------------|----------------|
| **Basic Auth** | Configuration simple | Identifiants envoyes a chaque requete | Developpement/test uniquement |
| **OAuth 2.0** | Base sur les jetons, scope, compatible audit | Plus d'etapes de configuration | **Recommande pour la production** |

Pour OAuth 2.0 :
1. Dans ServiceNow : **System OAuth > Application Registry**
2. Creez un nouveau point de terminaison OAuth API pour les clients externes
3. Notez le Client ID et le Client Secret
4. Renouvelez les secrets tous les 90 jours

---

## Etape 2 : Creer une connexion

Naviguez vers **Admin > ServiceNow > onglet Connexions**.

### Creer et tester

1. Cliquez sur **Ajouter une connexion**
2. Remplissez :

| Champ | Exemple de valeur | Notes |
|-------|-------------------|-------|
| Nom | `CMDB Production` | Libelle descriptif pour votre equipe |
| URL de l'instance | `https://entreprise.service-now.com` | Doit utiliser HTTPS |
| Type d'auth | Basic Auth ou OAuth 2.0 | OAuth recommande pour la production |
| Identifiants | (selon le type d'auth) | Chiffres au repos via Fernet |

3. Cliquez sur **Creer**, puis cliquez sur l'**icone de test** (symbole wifi) pour verifier la connectivite

- **Badge vert « Connecte »** -- Pret a l'emploi
- **Badge rouge « Echoue »** -- Verifiez les identifiants, le reseau et l'URL

### Connexions multiples

Vous pouvez creer plusieurs connexions pour :
- Instances de **Production** vs **developpement**
- Instances SNOW **regionales** (par ex. EMEA, APAC)
- **Differentes equipes** avec des comptes de service separes

Chaque mapping reference une connexion specifique.

---

## Etape 3 : Concevoir vos mappings

Basculez vers l'onglet **Mappings**. Un mapping connecte un type de fiche Turbo EA a une table ServiceNow.

### Creer un mapping

Cliquez sur **Ajouter un mapping** et configurez :

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Connexion** | Quelle instance ServiceNow utiliser | CMDB Production |
| **Type de fiche** | Le type de fiche Turbo EA a synchroniser | Application |
| **Table SNOW** | Le nom API de la table ServiceNow | `cmdb_ci_business_app` |
| **Direction de sync** | Quelles operations sont disponibles (voir ci-dessous) | ServiceNow -> Turbo EA |
| **Mode de sync** | Comment gerer les suppressions | Conservateur |
| **Ratio max de suppression** | Seuil de securite pour les suppressions en masse | 50% |
| **Requete de filtre** | Requete encodee ServiceNow pour limiter le perimetre | `active=true^install_status=1` |
| **Sauter le staging** | Appliquer les modifications directement sans examen | Desactive (recommande pour la synchronisation initiale) |

### Mappings de tables SNOW courants

| Type Turbo EA | Table ServiceNow | Description |
|---------------|------------------|-------------|
| Application | `cmdb_ci_business_app` | Applications metier (le plus courant) |
| Application | `cmdb_ci_appl` | CI d'applications generaux |
| ITComponent (Logiciel) | `cmdb_ci_spkg` | Paquets logiciels |
| ITComponent (Materiel) | `cmdb_ci_server` | Serveurs physiques/virtuels |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Comptes de services cloud |
| Provider | `core_company` | Fournisseurs / entreprises |
| Interface | `cmdb_ci_endpoint` | Points de terminaison d'integration |
| DataObject | `cmdb_ci_database` | Instances de base de donnees |
| System | `cmdb_ci_computer` | CI d'ordinateurs |
| Organization | `cmn_department` | Departements |

### Exemples de requetes de filtre

Toujours filtrer pour eviter d'importer des enregistrements obsoletes ou retires :

```
# Uniquement les CI actifs (filtre minimum recommande)
active=true

# CI actifs avec statut d'installation « Installe »
active=true^install_status=1

# Applications en utilisation de production
active=true^used_for=Production

# CI mis a jour dans les 30 derniers jours
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Groupe d'affectation specifique
active=true^assignment_group.name=IT Operations

# Exclure les CI retires
active=true^install_statusNOT IN7,8
```

**Bonne pratique** : Incluez toujours `active=true` au minimum. Les tables CMDB contiennent souvent des milliers d'enregistrements retires ou decommissionnes qui ne devraient pas etre importes dans votre paysage EA.

---

## Etape 4 : Configurer les mappings de champs

Chaque mapping contient des **mappings de champs** qui definissent comment les champs individuels se traduisent entre les deux systemes. Le champ Turbo EA fournit des suggestions d'autocompletion basees sur le type de fiche selectionne -- incluant les champs principaux, les dates de cycle de vie et tous les attributs personnalises du schema du type.

### Ajout de champs

Pour chaque mapping de champ, vous configurez :

| Parametre | Description |
|-----------|-------------|
| **Champ Turbo EA** | Chemin du champ dans Turbo EA (l'autocompletion suggere des options basees sur le type de fiche) |
| **Champ SNOW** | Nom de colonne API ServiceNow (par ex. `name`, `short_description`) |
| **Direction** | Source de verite par champ : SNOW dirige ou Turbo dirige |
| **Transformation** | Comment convertir les valeurs : Direct, Correspondance de valeurs, Date, Booleen |
| **Identite** (case ID) | Utilise pour la correspondance des enregistrements lors de la synchronisation initiale |

### Chemins de champs Turbo EA

L'autocompletion regroupe les champs par section. Voici la reference complete des chemins :

| Chemin | Cible | Exemple de valeur |
|--------|-------|-------------------|
| `name` | Nom d'affichage de la fiche | `"SAP S/4HANA"` |
| `description` | Description de la fiche | `"Systeme ERP principal pour les finances"` |
| `lifecycle.plan` | Cycle de vie : Date de planification | `"2024-01-15"` |
| `lifecycle.phaseIn` | Cycle de vie : Date de mise en service | `"2024-03-01"` |
| `lifecycle.active` | Cycle de vie : Date d'activation | `"2024-06-01"` |
| `lifecycle.phaseOut` | Cycle de vie : Date de retrait progressif | `"2028-12-31"` |
| `lifecycle.endOfLife` | Cycle de vie : Date de fin de vie | `"2029-06-30"` |
| `attributes.<cle>` | Tout attribut personnalise du schema de champs du type de fiche | Varie selon le type de champ |

Par exemple, si votre type Application a un champ avec la cle `businessCriticality`, selectionnez `attributes.businessCriticality` dans la liste deroulante.

### Champs d'identite -- Comment fonctionne la correspondance

Marquez un ou plusieurs champs comme **Identite** (icone de cle). Ceux-ci sont utilises lors de la premiere synchronisation pour faire correspondre les enregistrements ServiceNow aux fiches Turbo EA existantes :

1. **Recherche dans la carte d'identite** -- Si un lien sys_id <-> UUID de fiche existe deja, l'utiliser
2. **Correspondance exacte du nom** -- Correspondance sur la valeur du champ d'identite (par ex. correspondance par nom d'application)
3. **Correspondance approximative** -- Si aucune correspondance exacte, utilisation de SequenceMatcher avec un seuil de similarite de 85%

**Bonne pratique** : Marquez toujours le champ `name` comme champ d'identite. Si les noms different entre les systemes (par ex. SNOW inclut des numeros de version comme « SAP S/4HANA v2.1 » mais Turbo EA a « SAP S/4HANA »), nettoyez-les avant la premiere synchronisation pour une meilleure qualite de correspondance.

Apres la premiere synchronisation qui etablit les liens de la carte d'identite, les synchronisations suivantes utilisent la carte d'identite persistante et ne reposent plus sur la correspondance par nom.

---

## Etape 5 : Executer votre premiere synchronisation

Basculez vers l'onglet **Tableau de bord de synchronisation**.

### Declenchement d'une synchronisation

Pour chaque mapping actif, vous voyez des boutons Pull et/ou Push selon la direction de synchronisation configuree :

- **Pull** (icone de telechargement cloud) -- Recupere les donnees de SNOW vers Turbo EA
- **Push** (icone d'envoi cloud) -- Envoie les donnees Turbo EA vers ServiceNow

### Ce qui se passe pendant un Pull Sync

```
1. FETCH     Recuperer tous les enregistrements correspondants de SNOW (lots de 500)
2. MATCH     Faire correspondre chaque enregistrement a une fiche existante :
             a) Carte d'identite (recherche persistante sys_id <-> UUID de fiche)
             b) Correspondance exacte du nom sur les champs d'identite
             c) Correspondance approximative du nom (seuil de similarite 85%)
3. TRANSFORM Appliquer les mappings de champs pour convertir SNOW -> format Turbo EA
4. DIFF      Comparer les donnees transformees aux champs de la fiche existante
5. STAGE     Assigner une action a chaque enregistrement :
             - create : Nouveau, aucune fiche correspondante trouvee
             - update : Correspondance trouvee, champs differents
             - skip :   Correspondance trouvee, aucune difference
             - delete : Dans la carte d'identite mais absent de SNOW
6. APPLY     Executer les actions du staging (creer/mettre a jour/archiver les fiches)
```

Lorsque **Sauter le staging** est active, les etapes 5 et 6 fusionnent -- les actions sont appliquees directement sans ecrire d'enregistrements en staging.

### Examen des resultats de synchronisation

Le tableau **Historique de synchronisation** affiche apres chaque execution :

| Colonne | Description |
|---------|-------------|
| Debut | Quand la synchronisation a commence |
| Direction | Pull ou Push |
| Statut | `completed`, `failed` ou `running` |
| Recuperes | Nombre total d'enregistrements recuperes de ServiceNow |
| Crees | Nouvelles fiches creees dans Turbo EA |
| Mis a jour | Fiches existantes mises a jour |
| Supprimes | Fiches archivees (supprimees de maniere logique) |
| Erreurs | Enregistrements qui n'ont pas pu etre traites |
| Duree | Temps reel |

Cliquez sur l'**icone de liste** sur n'importe quelle execution pour inspecter les enregistrements individuels du staging, y compris le diff au niveau des champs pour chaque mise a jour.

### Procedure recommandee pour la premiere synchronisation

```
1. Definir le mapping en mode ADDITIF avec le staging ACTIVE
2. Executer la synchronisation pull
3. Examiner les enregistrements en staging -- verifier que les creations sont correctes
4. Aller dans l'Inventaire, verifier les fiches importees
5. Ajuster les mappings de champs ou la requete de filtre si necessaire
6. Relancer jusqu'a satisfaction
7. Basculer en mode CONSERVATEUR pour l'utilisation continue
8. Apres plusieurs executions reussies, activer Sauter le staging
```

---

## Comprendre la direction de synchronisation vs la direction des champs

C'est le concept le plus frequemment mal compris. Il y a **deux niveaux de direction** qui fonctionnent ensemble :

### Niveau table : Direction de synchronisation

Definie sur le mapping lui-meme. Controle **quelles operations de synchronisation sont disponibles** sur le tableau de bord de synchronisation :

| Direction de sync | Bouton Pull ? | Bouton Push ? | A utiliser quand... |
|-------------------|--------------|--------------|---------------------|
| **ServiceNow -> Turbo EA** | Oui | Non | La CMDB est la source maitresse, vous importez uniquement |
| **Turbo EA -> ServiceNow** | Non | Oui | L'outil EA enrichit la CMDB avec des evaluations |
| **Bidirectionnel** | Oui | Oui | Les deux systemes contribuent des champs differents |

### Niveau champ : Direction

Definie **par mapping de champ**. Controle **quelle valeur du systeme prend le dessus** lors d'une execution de synchronisation :

| Direction du champ | Pendant le Pull (SNOW -> Turbo) | Pendant le Push (Turbo -> SNOW) |
|--------------------|--------------------------------|--------------------------------|
| **SNOW dirige** | La valeur est importee depuis ServiceNow | La valeur est **ignoree** (non pushee) |
| **Turbo dirige** | La valeur est **ignoree** (non ecrasee) | La valeur est exportee vers ServiceNow |

### Comment ils fonctionnent ensemble -- Exemple

Mapping : Application <-> `cmdb_ci_business_app`, **Bidirectionnel**

| Champ | Direction | Le Pull fait... | Le Push fait... |
|-------|-----------|----------------|----------------|
| `name` | **Turbo dirige** | Ignore (l'EA cure les noms) | Pousse le nom EA -> SNOW |
| `description` | **Turbo dirige** | Ignore (l'EA ecrit les descriptions) | Pousse la description -> SNOW |
| `lifecycle.active` | **Turbo dirige** | Ignore (l'EA gere le cycle de vie) | Pousse la date de mise en prod -> SNOW |
| `attributes.businessCriticality` | **Turbo dirige** | Ignore (evaluation EA) | Pousse l'evaluation -> champ SNOW personnalise |
| `attributes.ipAddress` | SNOW dirige | Importe l'IP depuis la decouverte | Ignore (donnee operationnelle) |
| `attributes.installStatus` | SNOW dirige | Importe le statut operationnel | Ignore (donnee ITSM) |

**Point cle** : La direction au niveau de la table determine *quels boutons apparaissent*. La direction au niveau du champ determine *quels champs sont effectivement transferes* lors de chaque operation. Un mapping bidirectionnel ou Turbo EA dirige la plupart des champs et SNOW ne dirige que les champs operationnels/techniques est la configuration la plus puissante.

### Bonne pratique : Direction des champs par type de donnees

Le choix par defaut devrait etre **Turbo dirige** pour la grande majorite des champs. Ne definissez SNOW dirige que pour les metadonnees operationnelles et techniques provenant de la decouverte automatisee ou des workflows ITSM.

| Categorie de donnees | Direction recommandee | Justification |
|-----------------------|----------------------|---------------|
| **Noms, libelles d'affichage** | **Turbo dirige** | L'equipe EA cure des noms faisant autorite et propres -- les noms CMDB sont souvent auto-generes ou incoherents |
| **Description** | **Turbo dirige** | Les descriptions EA capturent le contexte strategique, la valeur metier et la signification architecturale |
| **Criticite metier (modele TIME)** | **Turbo dirige** | Evaluation fondamentale de l'EA -- pas des donnees operationnelles |
| **Adequation fonctionnelle/technique** | **Turbo dirige** | Notation et classification de feuille de route specifiques a l'EA |
| **Cycle de vie (toutes les phases)** | **Turbo dirige** | Plan, phaseIn, active, phaseOut, endOfLife sont toutes des decisions de planification EA |
| **Donnees de cout** | **Turbo dirige** | L'EA suit le cout total de possession et l'allocation budgetaire |
| **Type d'hebergement, classification** | **Turbo dirige** | Categorisation strategique maintenue par les architectes |
| **Informations fournisseur** | **Turbo dirige** | L'EA gere la strategie fournisseur, les contrats et les risques -- SNOW peut avoir un nom de fournisseur mais l'EA possede la relation |
| Metadonnees techniques (OS, IP, nom d'hote) | SNOW dirige | Donnees de decouverte automatisee -- l'EA ne maintient pas cela |
| Objectifs SLA, metriques de disponibilite | SNOW dirige | Donnees operationnelles des workflows ITSM |
| Statut d'installation, etat operationnel | SNOW dirige | La CMDB suit si un CI est installe, retire, etc. |
| Groupe d'affectation, equipe de support | SNOW dirige | Propriete operationnelle geree dans ServiceNow |
| Metadonnees de decouverte (premiere/derniere fois vu) | SNOW dirige | Horodatages d'automatisation CMDB |

---

## Sauter le staging -- Quand l'utiliser

Par defaut, les synchronisations pull suivent un workflow **staging puis application** :

```
Fetch -> Match -> Transform -> Diff -> STAGE -> Review -> APPLY
```

Les enregistrements sont ecrits dans une table de staging, vous permettant de passer en revue ce qui va changer avant d'appliquer. Ceci est visible dans le tableau de bord de synchronisation sous « Voir les enregistrements en staging ».

### Mode Sauter le staging

Lorsque vous activez **Sauter le staging** sur un mapping, les enregistrements sont appliques directement :

```
Fetch -> Match -> Transform -> Diff -> APPLIQUER DIRECTEMENT
```

Aucun enregistrement de staging n'est cree -- les modifications sont immediates.

| | Staging (par defaut) | Sauter le staging |
|--|---------------------|-------------------|
| **Etape de revue** | Oui -- inspecter les diffs avant d'appliquer | Non -- les modifications s'appliquent immediatement |
| **Table d'enregistrements staging** | Remplie avec les entrees de creation/mise a jour/suppression | Non remplie |
| **Piste d'audit** | Enregistrements staging + historique des evenements | Historique des evenements uniquement |
| **Performance** | Legerement plus lent (ecriture des lignes de staging) | Legerement plus rapide |
| **Annulation** | Peut annuler avant d'appliquer | Doit revenir manuellement |

### Quand utiliser chaque option

| Scenario | Recommandation |
|----------|---------------|
| Premier import | **Utiliser le staging** -- Examiner ce qui sera cree avant d'appliquer |
| Mapping nouveau ou modifie | **Utiliser le staging** -- Verifier que les transformations de champs produisent le bon resultat |
| Mapping stable et bien teste | **Sauter le staging** -- Pas besoin de revoir chaque execution |
| Synchronisations quotidiennes automatisees (cron) | **Sauter le staging** -- Les executions sans surveillance ne peuvent pas attendre une revue |
| CMDB volumineuse (10 000+ CI) | **Sauter le staging** -- Evite de creer des milliers de lignes de staging |
| Environnement sensible a la conformite | **Utiliser le staging** -- Maintenir une piste d'audit complete dans la table de staging |

**Bonne pratique** : Commencez avec le staging active pour vos premieres synchronisations. Une fois que vous etes confiant que le mapping produit des resultats corrects, activez le saut de staging pour les executions automatisees.

---

## Modes de synchronisation et securite des suppressions

### Modes de synchronisation

| Mode | Creations | Mises a jour | Suppressions | Ideal pour |
|------|-----------|-------------|-------------|------------|
| **Additif** | Oui | Oui | **Jamais** | Imports initiaux, environnements a faible risque |
| **Conservateur** | Oui | Oui | Uniquement les fiches **creees par la sync** | Par defaut pour les synchronisations continues |
| **Strict** | Oui | Oui | Toutes les fiches liees | Miroir complet de la CMDB |

Le mode **Additif** ne supprime jamais de fiches de Turbo EA, ce qui en fait l'option la plus sure pour les premiers imports et les environnements ou Turbo EA contient des fiches absentes de ServiceNow (fiches creees manuellement, fiches d'autres sources).

Le mode **Conservateur** (par defaut) suit si chaque fiche a ete originellement creee par le moteur de synchronisation. Seules ces fiches peuvent etre auto-archivees si elles disparaissent de ServiceNow. Les fiches creees manuellement dans Turbo EA ou importees d'autres sources ne sont jamais touchees.

Le mode **Strict** archive toute fiche liee dont le CI ServiceNow correspondant n'apparait plus dans les resultats de la requete, quel que soit le createur. Utilisez-le uniquement lorsque ServiceNow est la source de verite absolue et que vous souhaitez que Turbo EA soit un miroir exact.

### Ratio max de suppression -- Filet de securite

Par mesure de securite, le moteur **saute toutes les suppressions** si le nombre depasse le ratio configure :

```
suppressions / total_lies > ratio_max_suppression  ->  SAUTER TOUTES LES SUPPRESSIONS
```

Exemple avec 10 enregistrements lies et un seuil de 50% :

| Scenario | Suppressions | Ratio | Resultat |
|----------|-------------|-------|----------|
| 3 CI supprimes normalement | 3 / 10 = 30% | Sous le seuil | Les suppressions procedent |
| 6 CI supprimes d'un coup | 6 / 10 = 60% | **Au-dessus du seuil** | Toutes les suppressions sautees |
| SNOW retourne vide (panne) | 10 / 10 = 100% | **Au-dessus du seuil** | Toutes les suppressions sautees |

Cela previent la perte catastrophique de donnees suite a des changements de requete de filtre, des pannes temporaires de ServiceNow ou des noms de tables mal configures.

**Bonne pratique** : Maintenez le ratio de suppression a **50% ou moins** pour les tables avec moins de 100 enregistrements. Pour les grandes tables (1 000+), vous pouvez le definir en securite a 25%.

### Progression recommandee

```
Semaine 1 :   Mode ADDITIF, staging ACTIVE, executer manuellement, examiner chaque enregistrement
Semaine 2-4 : Mode CONSERVATEUR, staging ACTIVE, executer quotidiennement, verifier les resultats par echantillonnage
Mois 2+ :     Mode CONSERVATEUR, staging DESACTIVE (sauter), cron quotidien automatise
```

---

## Recettes recommandees par type

### Recette 1 : Applications depuis la CMDB (La plus courante)

**Objectif** : Importer le paysage applicatif depuis ServiceNow, puis prendre la propriete des noms, descriptions, evaluations et cycle de vie dans Turbo EA. SNOW ne dirige que les champs operationnels.

**Mapping :**

| Parametre | Valeur |
|-----------|--------|
| Type de fiche | Application |
| Table SNOW | `cmdb_ci_business_app` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true^install_status=1` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `lifecycle.active` | `go_live_date` | **Turbo dirige** | Date | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo dirige** | Date | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo dirige** | Correspondance de valeurs | |
| `attributes.hostingType` | `hosting_type` | **Turbo dirige** | Direct | |
| `attributes.installStatus` | `install_status` | SNOW dirige | Direct | |
| `attributes.ipAddress` | `ip_address` | SNOW dirige | Direct | |

Configuration de la correspondance de valeurs pour `businessCriticality` :

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Conseil pour la premiere sync** : Lors du tout premier pull, les valeurs SNOW remplissent tous les champs (puisque les fiches n'existent pas encore). Apres cela, les champs ou Turbo dirige sont possedes par l'equipe EA -- les pulls suivants ne mettent a jour que les champs operationnels ou SNOW dirige (statut d'installation, IP), tandis que l'equipe EA gere tout le reste directement dans Turbo EA.

**Apres l'import** : Affinez les noms d'applications, ecrivez les descriptions strategiques, mappez aux Capacites Metier, ajoutez les evaluations d'adequation fonctionnelle/technique et definissez les phases du cycle de vie -- tout cela est maintenant possede par Turbo EA et sera repoussee vers ServiceNow lors des push syncs.

---

### Recette 2 : Composants IT (Serveurs)

**Objectif** : Importer l'infrastructure de serveurs pour la cartographie d'infrastructure et l'analyse de dependances. Les serveurs sont plus operationnels que les applications, donc plus de champs viennent de SNOW -- mais Turbo EA dirige toujours les noms et les descriptions.

**Mapping :**

| Parametre | Valeur |
|-----------|--------|
| Type de fiche | ITComponent |
| Table SNOW | `cmdb_ci_server` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true^hardware_statusNOT IN6,7` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo dirige** | Direct | |
| `attributes.operatingSystem` | `os` | SNOW dirige | Direct | |
| `attributes.ipAddress` | `ip_address` | SNOW dirige | Direct | |
| `attributes.serialNumber` | `serial_number` | SNOW dirige | Direct | |
| `attributes.hostname` | `host_name` | SNOW dirige | Direct | |

**Note** : Pour les serveurs, les champs operationnels/de decouverte comme l'OS, l'IP, le numero de serie et le nom d'hote proviennent naturellement de la decouverte automatisee de SNOW. Mais l'equipe EA possede toujours le nom d'affichage (qui peut differer du nom d'hote) et la description pour le contexte strategique.

**Apres l'import** : Liez les Composants IT aux Applications en utilisant les relations, ce qui alimente le graphe de dependances et les rapports d'infrastructure.

---

### Recette 3 : Produits logiciels avec suivi EOL

**Objectif** : Importer les produits logiciels et les combiner avec l'integration endoflife.date de Turbo EA. Turbo EA dirige sur les noms, descriptions et le fournisseur -- la version est un champ factuel que SNOW peut diriger.

**Mapping :**

| Parametre | Valeur |
|-----------|--------|
| Type de fiche | ITComponent |
| Table SNOW | `cmdb_ci_spkg` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `attributes.version` | `version` | SNOW dirige | Direct | |
| `attributes.vendor` | `manufacturer.name` | **Turbo dirige** | Direct | |

**Apres l'import** : Allez dans **Admin > EOL** et utilisez la recherche en masse pour faire correspondre automatiquement les Composants IT importes avec les produits endoflife.date. Cela vous donne un suivi automatise des risques EOL qui combine l'inventaire CMDB avec les donnees publiques de cycle de vie.

---

### Recette 4 : Fournisseurs (Bidirectionnel)

**Objectif** : Maintenir le registre de fournisseurs en synchronisation. Turbo EA possede les noms de fournisseurs, les descriptions et le contexte strategique. SNOW complete avec les donnees de contact operationnelles.

**Mapping :**

| Parametre | Valeur |
|-----------|--------|
| Type de fiche | Provider |
| Table SNOW | `core_company` |
| Direction | Bidirectionnel |
| Mode | Additif |
| Filtre | `vendor=true` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `notes` | **Turbo dirige** | Direct | |
| `attributes.website` | `website` | **Turbo dirige** | Direct | |
| `attributes.contactEmail` | `email` | SNOW dirige | Direct | |

**Pourquoi Turbo dirige pour la plupart des champs** : L'equipe EA cure la strategie fournisseur, gere les relations et suit les risques -- cela inclut le nom d'affichage du fournisseur, la description et la presence web. SNOW ne dirige que sur les donnees de contact operationnelles qui peuvent etre mises a jour par les equipes d'approvisionnement ou de gestion des actifs.

---

### Recette 5 : Pousser les evaluations EA vers ServiceNow

**Objectif** : Exporter les evaluations specifiques a l'EA vers des champs personnalises ServiceNow pour que les equipes ITSM voient le contexte EA.

**Mapping :**

| Parametre | Valeur |
|-----------|--------|
| Type de fiche | Application |
| Table SNOW | `cmdb_ci_business_app` |
| Direction | Turbo EA -> ServiceNow |
| Mode | Additif |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | SNOW dirige | Direct | Oui |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo dirige | Correspondance de valeurs | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo dirige | Correspondance de valeurs | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo dirige | Correspondance de valeurs | |

> **Important** : Le push sync vers des champs personnalises (prefixes par `u_`) necessite que ces colonnes existent deja dans ServiceNow. Travaillez avec votre administrateur ServiceNow pour les creer avant de configurer le mapping push. Le compte de service a besoin du role `import_admin` pour l'acces en ecriture.

**Pourquoi c'est important** : Les equipes ITSM voient les evaluations EA directement dans les workflows d'incident/changement ServiceNow. Lorsqu'une application « Mission critique » a un incident, les regles d'escalade de priorite peuvent utiliser le score de criticite fourni par l'EA.

---

## Reference des types de transformation

### Direct (par defaut)

Passe la valeur sans modification. Utilisez pour les champs texte qui ont le meme format dans les deux systemes.

### Correspondance de valeurs

Traduit les valeurs enumerees entre les systemes. Configurez avec un mapping JSON :

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

Le mapping s'inverse automatiquement lors du push de Turbo EA vers ServiceNow. Par exemple, lors du push, `"missionCritical"` devient `"1"`.

### Format date

Tronque les valeurs datetime de ServiceNow (`2024-06-15 14:30:00`) en date seule (`2024-06-15`). Utilisez pour les dates de phase de cycle de vie ou l'heure n'est pas pertinente.

### Booleen

Convertit entre les booleens en chaines ServiceNow (`"true"`, `"1"`, `"yes"`) et les booleens natifs. Utile pour les champs comme « is_virtual », « active », etc.

---

## Bonnes pratiques de securite

### Gestion des identifiants

| Pratique | Details |
|----------|---------|
| **Chiffrement au repos** | Tous les identifiants chiffres via Fernet (AES-128-CBC) derive de `SECRET_KEY`. Si vous changez `SECRET_KEY`, ressaisissez tous les identifiants ServiceNow. |
| **Moindre privilege** | Creez un compte de service SNOW dedie avec un acces en lecture seule aux tables specifiques. N'accordez l'acces en ecriture que si vous utilisez le push sync. |
| **OAuth 2.0 prefere** | Basic Auth envoie les identifiants a chaque appel API. OAuth utilise des jetons de courte duree avec des restrictions de portee. |
| **Rotation des identifiants** | Changez les mots de passe ou les secrets client tous les 90 jours. |

### Securite reseau

| Pratique | Details |
|----------|---------|
| **HTTPS impose** | Les URL HTTP sont rejetees lors de la validation. Toutes les connexions doivent utiliser HTTPS. |
| **Validation des noms de table** | Les noms de table sont valides par rapport a `^[a-zA-Z0-9_]+$` pour prevenir l'injection. |
| **Validation des sys_id** | Les valeurs sys_id sont validees comme des chaines hexadecimales de 32 caracteres. |
| **Liste blanche IP** | Configurez le controle d'acces IP ServiceNow pour n'autoriser que l'IP de votre serveur Turbo EA. |

### Controle d'acces

| Pratique | Details |
|----------|---------|
| **Protege par RBAC** | Tous les endpoints ServiceNow requierent la permission `servicenow.manage`. |
| **Piste d'audit** | Toutes les modifications creees par la synchronisation publient des evenements avec `source: "servicenow_sync"`, visibles dans l'historique de la fiche. |
| **Pas d'exposition des identifiants** | Les mots de passe et secrets ne sont jamais retournes dans les reponses API. |

### Checklist de production

- [ ] Compte de service ServiceNow dedie (pas un compte personnel)
- [ ] OAuth 2.0 avec grant client credentials
- [ ] Calendrier de rotation des identifiants (tous les 90 jours)
- [ ] Compte de service restreint aux tables mappees uniquement
- [ ] Liste blanche IP ServiceNow configuree pour l'IP du serveur Turbo EA
- [ ] Ratio max de suppression defini a 50% ou moins
- [ ] Executions de synchronisation surveillees pour les nombres inhabituels d'erreurs ou de suppressions
- [ ] Les requetes de filtre incluent `active=true` au minimum

---

## Guide operationnel

### Sequence de configuration initiale

```
1. Creer le compte de service ServiceNow avec les roles minimum requis
2. Verifier la connectivite reseau (Turbo EA peut-il atteindre SNOW via HTTPS ?)
3. Creer la connexion dans Turbo EA et la tester
4. Verifier que les types du metamodele ont tous les champs que vous souhaitez synchroniser
5. Creer le premier mapping avec le mode ADDITIF, staging ACTIVE
6. Utiliser le bouton Apercu (via API) pour verifier que le mapping produit le bon resultat
7. Executer la premiere synchronisation pull -- examiner les enregistrements en staging dans le tableau de bord
8. Appliquer les enregistrements en staging
9. Verifier les fiches importees dans l'Inventaire
10. Ajuster les mappings de champs si necessaire, relancer
11. Basculer le mapping en mode CONSERVATEUR pour l'utilisation continue
12. Apres plusieurs executions reussies, activer Sauter le staging pour l'automatisation
```

### Operations courantes

| Tache | Frequence | Comment |
|-------|-----------|---------|
| Executer la synchronisation pull | Quotidien ou hebdomadaire | Tableau de bord de sync > bouton Pull (ou cron) |
| Examiner les statistiques de sync | Apres chaque execution | Verifier les compteurs d'erreurs/suppressions |
| Tester les connexions | Mensuel | Cliquer sur le bouton de test de chaque connexion |
| Changer les identifiants | Trimestriel | Mettre a jour dans SNOW et Turbo EA |
| Examiner la carte d'identite | Trimestriel | Verifier les entrees orphelines via les stats de sync |
| Auditer l'historique des fiches | Selon les besoins | Filtrer les evenements par source `servicenow_sync` |

### Configuration des synchronisations automatisees

Les synchronisations peuvent etre declenchees via API pour l'automatisation :

```bash
# Synchronisation pull quotidienne a 2h00 du matin
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.entreprise.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Bonne pratique** : Executez les synchronisations pendant les heures creuses. Pour les grandes tables CMDB (10 000+ CI), prevoyez 2 a 5 minutes selon la latence reseau et le nombre d'enregistrements.

### Planification de capacite

| Taille CMDB | Duree prevue | Recommandation |
|-------------|--------------|----------------|
| < 500 CI | < 30 secondes | Synchroniser quotidiennement, staging optionnel |
| 500-5 000 CI | 30s - 2 minutes | Synchroniser quotidiennement, sauter le staging |
| 5 000-20 000 CI | 2-5 minutes | Synchroniser la nuit, sauter le staging |
| 20 000+ CI | 5-15 minutes | Synchroniser hebdomadairement, utiliser des requetes de filtre pour diviser |

---

## Depannage

### Problemes de connexion

| Symptome | Cause | Solution |
|----------|-------|----------|
| `Connection failed: [SSL]` | Certificat auto-signe ou expire | Assurez-vous que SNOW utilise un certificat CA public valide |
| `HTTP 401: Unauthorized` | Mauvais identifiants | Ressaisissez le nom d'utilisateur/mot de passe ; verifiez que le compte n'est pas verrouille |
| `HTTP 403: Forbidden` | Roles insuffisants | Accordez `itil` et `cmdb_read` au compte de service |
| `Connection failed: timed out` | Blocage du pare-feu | Verifiez les regles ; mettez l'IP de Turbo EA en liste blanche dans SNOW |
| Test OK mais sync echoue | Permissions au niveau de la table | Accordez l'acces en lecture a la table CMDB specifique |

### Problemes de synchronisation

| Symptome | Cause | Solution |
|----------|-------|----------|
| 0 enregistrements recuperes | Mauvaise table ou filtre | Verifiez le nom de la table ; simplifiez la requete de filtre |
| Tous les enregistrements sont des « create » | Non-correspondance d'identite | Marquez `name` comme identite ; verifiez que les noms correspondent entre les systemes |
| Nombre eleve d'erreurs | Echecs de transformation | Verifiez les enregistrements staging pour les messages d'erreur |
| Suppressions sautees | Ratio depasse | Augmentez le seuil ou investiguez pourquoi les CI ont disparu |
| Modifications non visibles | Cache du navigateur | Rafraichissement force ; verifiez l'historique de la fiche pour les evenements |
| Fiches en double | Mappings multiples pour le meme type | Utilisez un mapping par type de fiche par connexion |
| Modifications push rejetees | Permissions SNOW manquantes | Accordez le role `import_admin` au compte de service |

### Outils de diagnostic

```bash
# Apercu du mapping des enregistrements (5 echantillons, sans effet de bord)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Parcourir les tables sur l'instance SNOW
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Inspecter les colonnes d'une table
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filtrer les enregistrements staging par action ou statut
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## Reference API (rapide)

Tous les endpoints necessitent `Authorization: Bearer <token>` et la permission `servicenow.manage`. Chemin de base : `/api/v1`.

### Connexions

| Methode | Chemin | Description |
|---------|--------|-------------|
| GET | `/servicenow/connections` | Lister les connexions |
| POST | `/servicenow/connections` | Creer une connexion |
| GET | `/servicenow/connections/{id}` | Obtenir une connexion |
| PATCH | `/servicenow/connections/{id}` | Mettre a jour une connexion |
| DELETE | `/servicenow/connections/{id}` | Supprimer une connexion + tous les mappings |
| POST | `/servicenow/connections/{id}/test` | Tester la connectivite |
| GET | `/servicenow/connections/{id}/tables` | Parcourir les tables SNOW |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Lister les colonnes de la table |

### Mappings

| Methode | Chemin | Description |
|---------|--------|-------------|
| GET | `/servicenow/mappings` | Lister les mappings avec les mappings de champs |
| POST | `/servicenow/mappings` | Creer un mapping avec les mappings de champs |
| GET | `/servicenow/mappings/{id}` | Obtenir un mapping avec les mappings de champs |
| PATCH | `/servicenow/mappings/{id}` | Mettre a jour un mapping (remplace les champs si fournis) |
| DELETE | `/servicenow/mappings/{id}` | Supprimer un mapping |
| POST | `/servicenow/mappings/{id}/preview` | Apercu dry-run (5 enregistrements echantillons) |

### Operations de synchronisation

| Methode | Chemin | Description |
|---------|--------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Pull sync (`?auto_apply=true` par defaut) |
| POST | `/servicenow/sync/push/{mapping_id}` | Push sync |
| GET | `/servicenow/sync/runs` | Lister l'historique des syncs (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Obtenir les details de l'execution + statistiques |
| GET | `/servicenow/sync/runs/{id}/staged` | Lister les enregistrements staging d'une execution |
| POST | `/servicenow/sync/runs/{id}/apply` | Appliquer les enregistrements staging en attente |
