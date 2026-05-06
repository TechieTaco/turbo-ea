# EA Delivery

Le module **EA Delivery** gère les **initiatives d'architecture et leurs artefacts** -- diagrammes et Statements of Architecture Work (SoAW). Il fournit une vue unique de tous les projets d'architecture en cours et de leurs livrables.

![Gestion EA Delivery](../assets/img/fr/17_livraison_ea.png)

## Vue d'ensemble des initiatives

La page est organisée autour des fiches **Initiative**. Chaque initiative affiche :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom de l'initiative |
| **Sous-type** | Idée, Programme, Projet ou Epic |
| **Statut** | En bonne voie, À risque, Hors piste, En attente ou Terminé |
| **Artefacts** | Nombre de diagrammes et de documents SoAW liés |

Vous pouvez basculer entre une vue **galerie de cartes** et une vue **liste**, et filtrer les initiatives par statut (Actif ou Archive).

Cliquer sur une initiative la développe pour afficher tous ses **diagrammes** et **documents SoAW** liés.

## Statement of Architecture Work (SoAW)

Un **Statement of Architecture Work (SoAW)** est un document formel défini par le [standard TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Il établit la portée, l'approche, les livrables et la gouvernance d'un engagement d'architecture. Dans TOGAF, le SoAW est produit pendant la **Phase préliminaire** et la **Phase A (Vision de l'architecture)** et sert d'accord entre l'équipe d'architecture et ses parties prenantes.

Turbo EA fournit un éditeur SoAW intégré avec des modèles de sections alignés sur TOGAF, l'édition de texte riche et des capacités d'export -- vous permettant de rédiger et gérer des documents SoAW directement aux côtés de vos données d'architecture.

### Création d'un SoAW

1. Cliquez sur le bouton **+** d'une carte initiative et sélectionnez **Nouveau SoAW**
2. Entrez le titre du document
3. L'éditeur s'ouvre avec des **modèles de sections préconstruits** basés sur le standard TOGAF

### L'éditeur SoAW

L'éditeur offre :

- **Édition de texte riche** -- Barre d'outils de mise en forme complète (titres, gras, italique, listes, liens) propulsée par l'éditeur TipTap
- **Modèles de sections** -- Sections prédéfinies suivant les standards TOGAF (par ex. Description du problème, Objectifs, Approche, Parties prenantes, Contraintes, Plan de travail)
- **Tableaux éditables en ligne** -- Ajoutez et éditez des tableaux dans n'importe quelle section
- **Workflow de statut** -- Les documents progressent à travers des étapes définies :

| Statut | Signification |
|--------|---------------|
| **Brouillon** | En cours de rédaction, pas encore prêt pour examen |
| **En revue** | Soumis pour examen par les parties prenantes |
| **Approuvé** | Examiné et accepté |
| **Signé** | Formellement validé |

### Workflow de signature

Une fois qu'un SoAW est approuvé, vous pouvez demander des signatures aux parties prenantes. Cliquez sur **Demander des signatures** puis utilisez le champ de recherche pour trouver et ajouter des signataires par nom ou e-mail. Le système suit qui a signé et envoie des notifications aux signataires en attente.

### Aperçu et export

- **Mode aperçu** -- Vue en lecture seule du document SoAW complet
- **Export DOCX** -- Téléchargez le SoAW sous forme de document Word formaté pour le partage hors ligne ou l'impression

## Architecture Decision Records (ADR)

![Onglet Décisions EA Delivery](../assets/img/fr/17b_livraison_ea_decisions.png)

Un **Architecture Decision Record (ADR)** documente les décisions d'architecture importantes ainsi que leur contexte, leurs conséquences et les alternatives envisagées. Les ADR fournissent un historique traçable expliquant pourquoi des choix de conception clés ont été faits.

### Vue d'ensemble des ADR

La page EA Delivery dispose d'un onglet **Décisions** dédié qui affiche tous les ADR dans un **tableau AG Grid** avec une barre latérale de filtres persistante, similaire à la page Inventaire.

#### Colonnes du tableau

Le tableau des ADR affiche les colonnes suivantes :

| Colonne | Description |
|---------|-------------|
| **N° de réf.** | Numéro de référence généré automatiquement (ADR-001, ADR-002, etc.) |
| **Titre** | Titre de l'ADR |
| **Statut** | Puce colorée affichant Brouillon, En revue ou Signé |
| **Cartes liées** | Pilules colorées correspondant à la couleur du type de carte (par ex. bleu pour Application, violet pour Objet de données) |
| **Créé** | Date de création |
| **Modifié** | Date de dernière modification |
| **Signé** | Date de signature |
| **Révision** | Numéro de révision |

#### Barre latérale de filtres

Une barre latérale de filtres persistante sur la gauche propose les filtres suivants :

- **Types de carte** -- Cases à cocher avec des points colorés correspondant aux couleurs des types de cartes, pour filtrer par types de cartes liées
- **Statut** -- Filtrer par Brouillon, En revue ou Signé
- **Date de création** -- Plage de dates de/à
- **Date de modification** -- Plage de dates de/à
- **Date de signature** -- Plage de dates de/à

#### Filtre rapide et menu contextuel

Utilisez la barre de **filtre rapide** pour une recherche en texte intégral dans tous les ADR. Faites un clic droit sur n'importe quelle ligne pour accéder à un menu contextuel avec les actions **Modifier**, **Aperçu**, **Dupliquer** et **Supprimer**.

### Créer un ADR

Les ADR peuvent être créés depuis trois endroits :

1. **EA Delivery → onglet Décisions** : Cliquez sur **+ Nouvel ADR**, remplissez le titre et liez optionnellement des cartes (y compris des initiatives).
2. **Bouton «+» de l'initiative** (onglet Initiatives) : Choisissez **Nouvelle Décision d'Architecture** dans le menu — l'initiative est pré-liée en tant que liaison de carte.
3. **Onglet Ressources de la carte** : Cliquez sur **Créer ADR** — la carte actuelle est pré-liée.

Dans tous les cas, vous pouvez rechercher et lier des cartes supplémentaires lors de la création. Les initiatives sont liées via le même mécanisme de liaison de cartes que toute autre carte, ce qui signifie qu'un ADR peut être lié à plusieurs initiatives. L'éditeur s'ouvre avec des sections pour le Contexte, la Décision, les Conséquences et les Alternatives envisagées.

### L'éditeur ADR

L'éditeur offre :

- Édition de texte riche pour chaque section (Contexte, Décision, Conséquences, Alternatives envisagées)
- Liaison de cartes -- connectez l'ADR aux cartes pertinentes (applications, composants IT, initiatives, etc.). Les initiatives sont liées via la fonctionnalité standard de liaison de cartes, et non via un champ dédié, ce qui permet à un ADR de référencer plusieurs initiatives
- Décisions associées -- référencez d'autres ADR

### Workflow de signature

Les ADR prennent en charge un processus formel de signature :

1. Créez l'ADR avec le statut **Brouillon**
2. Cliquez sur **Demander des signatures** et recherchez des signataires par nom ou e-mail
3. L'ADR passe à **En revue** -- chaque signataire reçoit une notification et une tâche
4. Les signataires examinent et cliquent sur **Signer**
5. Lorsque tous les signataires ont signé, l'ADR passe automatiquement au statut **Signé**

Les ADR signés sont verrouillés et ne peuvent pas être modifiés. Pour apporter des modifications, créez une **nouvelle révision**.

### Révisions

Les ADR signés peuvent être révisés :

1. Ouvrez un ADR signé
2. Cliquez sur **Réviser** pour créer un nouveau brouillon basé sur la version signée
3. La nouvelle révision hérite du contenu et des liens de cartes
4. Chaque révision a un numéro de révision incrémentiel

### Aperçu de l'ADR

Cliquez sur l'icône d'aperçu pour afficher une version en lecture seule et formatée de l'ADR -- utile pour la révision avant la signature.

## Onglet Ressources

![Onglet Ressources de la fiche](../assets/img/fr/17c_fiche_ressources.png)

Les cartes incluent désormais un onglet **Ressources** qui regroupe :

- **Décisions d'architecture** -- ADR liés à cette carte, affichés sous forme de pilules colorées correspondant aux couleurs du type de carte. Vous pouvez lier des ADR existants ou en créer un nouveau directement depuis l'onglet Ressources -- le nouvel ADR est automatiquement lié à la carte.
- **Pièces jointes** -- Téléchargez et gérez des fichiers (PDF, DOCX, XLSX, images, jusqu'à 10 Mo). Lors du téléchargement, sélectionnez une **catégorie de document** parmi : Architecture, Sécurité, Conformité, Opérations, Notes de réunion, Design ou Autre. La catégorie s'affiche sous forme de puce à côté de chaque fichier.
- **Liens de documents** -- Références de documents basées sur des URL. Lors de l'ajout d'un lien, sélectionnez un **type de lien** parmi : Documentation, Sécurité, Conformité, Architecture, Opérations, Support ou Autre. Le type de lien s'affiche sous forme de puce à côté de chaque lien, et l'icône change en fonction du type sélectionné.
