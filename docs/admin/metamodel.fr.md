# Metamodele

Le **Metamodele** definit l'ensemble de la structure de donnees de votre plateforme -- quels types de fiches existent, quels champs elles possedent, comment elles sont reliees entre elles, et comment les pages de detail des fiches sont disposees. Tout est **pilote par les donnees** : vous configurez le metamodele via l'interface d'administration, sans modifier le code.

![Configuration du metamodele](../assets/img/en/20_admin_metamodel.png)

Naviguez vers **Admin > Metamodele** pour acceder a l'editeur de metamodele. Il comporte cinq onglets : **Types de fiches**, **Types de relations**, **Calculs**, **Tags** et **Graphe du metamodele**.

## Types de fiches

L'onglet Types de fiches liste tous les types du systeme. Turbo EA est livre avec 14 types integres repartis sur quatre couches d'architecture :

| Couche | Types |
|--------|-------|
| **Strategie et transformation** | Objectif, Plateforme, Initiative |
| **Architecture metier** | Organisation, Capacite Metier, Contexte Metier, Processus Metier |
| **Application et donnees** | Application, Interface, Objet de Donnees |
| **Architecture technique** | Composant IT, Categorie Technique, Fournisseur, Systeme |

### Creation d'un type personnalise

Cliquez sur **+ Nouveau type** pour creer un type de fiche personnalise. Configurez :

| Champ | Description |
|-------|-------------|
| **Cle** | Identifiant unique (minuscules, sans espaces) -- ne peut pas etre modifie apres la creation |
| **Libelle** | Nom d'affichage dans l'interface |
| **Icone** | Nom de l'icone Google Material Symbol |
| **Couleur** | Couleur de marque pour le type (utilisee dans l'inventaire, les rapports et les diagrammes) |
| **Categorie** | Regroupement par couche d'architecture |
| **A une hierarchie** | Si les fiches de ce type peuvent avoir des relations parent/enfant |

### Modification d'un type

Cliquez sur n'importe quel type pour ouvrir le **Tiroir de detail du type**. Vous pouvez y configurer :

#### Champs

Les champs definissent les attributs personnalises disponibles sur les fiches de ce type. Chaque champ possede :

| Parametre | Description |
|-----------|-------------|
| **Cle** | Identifiant unique du champ |
| **Libelle** | Nom d'affichage |
| **Type** | text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Options** | Pour les champs de selection : les choix disponibles avec libelles et couleurs optionnelles |
| **Obligatoire** | Si le champ doit etre rempli pour le calcul du score de qualite des donnees |
| **Poids** | Contribution de ce champ au score de qualite des donnees (0-10) |
| **Lecture seule** | Empeche la modification manuelle (utile pour les champs calcules) |

Cliquez sur **+ Ajouter un champ** pour creer un nouveau champ, ou cliquez sur un champ existant pour le modifier dans le **Dialogue de l'editeur de champs**.

#### Sections

Les champs sont organises en **sections** sur la page de detail des fiches. Vous pouvez :

- Creer des sections nommees pour regrouper des champs lies
- Definir les sections en disposition **1 colonne** ou **2 colonnes**
- Organiser les champs en **groupes** au sein d'une section (rendus comme des sous-en-tetes repliables)
- Glisser les champs entre les sections et les reorganiser

Le nom de section special `__description` ajoute les champs a la section Description de la page de detail des fiches.

#### Sous-types

Les sous-types fournissent une classification secondaire au sein d'un type. Par exemple, le type Application a pour sous-types : Application Metier, Microservice, Agent IA et Deploiement. Chaque sous-type peut avoir des libelles traduits.

#### Roles de parties prenantes

Definissez des roles personnalises pour ce type (par ex. « Responsable Applicatif », « Responsable Technique »). Chaque role porte des **permissions au niveau de la fiche** qui sont combinees avec le role au niveau de l'application de l'utilisateur lors de l'acces a une fiche. Voir [Utilisateurs et roles](users.md) pour plus de details sur le modele de permissions.

### Suppression d'un type

- Les **types integres** sont masques (suppression logique) et peuvent etre restaures
- Les **types personnalises** sont supprimes definitivement

## Types de relations

Les types de relations definissent les connexions autorisees entre les types de fiches. Chaque type de relation specifie :

| Champ | Description |
|-------|-------------|
| **Cle** | Identifiant unique |
| **Libelle** | Libelle dans le sens direct (par ex. « utilise ») |
| **Libelle inverse** | Libelle dans le sens inverse (par ex. « est utilise par ») |
| **Type source** | Le type de fiche cote « depuis » |
| **Type cible** | Le type de fiche cote « vers » |
| **Cardinalite** | n:m (plusieurs-a-plusieurs) ou 1:n (un-a-plusieurs) |

Cliquez sur **+ Nouveau type de relation** pour creer une relation, ou cliquez sur un type existant pour modifier ses libelles et attributs.

## Calculs

Les champs calcules utilisent des formules definies par l'administrateur pour calculer automatiquement des valeurs lorsque les fiches sont sauvegardees. Voir [Calculs](calculations.md) pour le guide complet.

## Tags

Les groupes de tags et les tags peuvent etre geres depuis cet onglet. Voir [Tags](tags.md) pour le guide complet.

## Graphe du metamodele

L'onglet **Graphe du metamodele** affiche un diagramme SVG visuel de tous les types de fiches et de leurs types de relations. C'est une visualisation en lecture seule qui vous aide a comprendre les connexions de votre metamodele en un coup d'oeil.

## Editeur de mise en page des fiches

Pour chaque type de fiche, la section **Mise en page** dans le tiroir du type controle la structure de la page de detail des fiches :

- **Ordre des sections** -- Glissez les sections (Description, EOL, Cycle de vie, Hierarchie, Relations et sections personnalisees) pour les reorganiser
- **Visibilite** -- Masquez les sections non pertinentes pour un type
- **Developpement par defaut** -- Choisissez si chaque section commence developpee ou repliee
- **Disposition en colonnes** -- Definissez 1 ou 2 colonnes par section personnalisee
