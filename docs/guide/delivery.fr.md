# EA Delivery

Le module **EA Delivery** gere les **initiatives d'architecture et leurs artefacts** -- diagrammes et Statements of Architecture Work (SoAW). Il fournit une vue unique de tous les projets d'architecture en cours et de leurs livrables.

![Gestion EA Delivery](../assets/img/en/17_ea_delivery.png)

## Vue d'ensemble des initiatives

La page est organisee autour des fiches **Initiative**. Chaque initiative affiche :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom de l'initiative |
| **Sous-type** | Idee, Programme, Projet ou Epic |
| **Statut** | En bonne voie, A risque, Hors piste, En attente ou Termine |
| **Artefacts** | Nombre de diagrammes et de documents SoAW lies |

Vous pouvez basculer entre une vue **galerie de cartes** et une vue **liste**, et filtrer les initiatives par statut (Actif ou Archive).

Cliquer sur une initiative la developpe pour afficher tous ses **diagrammes** et **documents SoAW** lies.

## Statement of Architecture Work (SoAW)

Un **Statement of Architecture Work (SoAW)** est un document formel defini par le [standard TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Il etablit la portee, l'approche, les livrables et la gouvernance d'un engagement d'architecture. Dans TOGAF, le SoAW est produit pendant la **Phase preliminaire** et la **Phase A (Vision de l'architecture)** et sert d'accord entre l'equipe d'architecture et ses parties prenantes.

Turbo EA fournit un editeur SoAW integre avec des modeles de sections alignes sur TOGAF, l'edition de texte riche et des capacites d'export -- vous permettant de rediger et gerer des documents SoAW directement aux cotes de vos donnees d'architecture.

### Creation d'un SoAW

1. Cliquez sur **+ Nouveau SoAW** depuis une initiative
2. Entrez le titre du document
3. L'editeur s'ouvre avec des **modeles de sections preconstruits** bases sur le standard TOGAF

### L'editeur SoAW

L'editeur offre :

- **Edition de texte riche** -- Barre d'outils de mise en forme complete (titres, gras, italique, listes, liens) propulsee par l'editeur TipTap
- **Modeles de sections** -- Sections predefinies suivant les standards TOGAF (par ex. Description du probleme, Objectifs, Approche, Parties prenantes, Contraintes, Plan de travail)
- **Tableaux editables en ligne** -- Ajoutez et editez des tableaux dans n'importe quelle section
- **Workflow de statut** -- Les documents progressent a travers des etapes definies :

| Statut | Signification |
|--------|---------------|
| **Brouillon** | En cours de redaction, pas encore pret pour examen |
| **En revue** | Soumis pour examen par les parties prenantes |
| **Approuve** | Examine et accepte |
| **Signe** | Formellement valide |

### Workflow de signature

Une fois qu'un SoAW est approuve, vous pouvez demander des signatures aux parties prenantes. Le systeme suit qui a signe et envoie des notifications aux signataires en attente.

### Apercu et export

- **Mode apercu** -- Vue en lecture seule du document SoAW complet
- **Export DOCX** -- Telechargez le SoAW sous forme de document Word formate pour le partage hors ligne ou l'impression
