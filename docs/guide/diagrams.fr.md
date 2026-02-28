# Diagrammes

Le module **Diagrammes** vous permet de creer des **diagrammes d'architecture visuels** en utilisant un editeur [DrawIO](https://www.drawio.com/) integre -- entierement connecte a votre inventaire de fiches. Vous pouvez glisser des fiches sur le canevas, les relier avec des relations, et maintenir le diagramme synchronise avec vos donnees EA.

![Galerie de diagrammes](../assets/img/en/16_diagrams.png)

## Galerie de diagrammes

La galerie affiche tous les diagrammes sous forme de **cartes miniatures** ou en **vue liste** (bascule via l'icone de vue dans la barre d'outils). Chaque diagramme affiche son nom, son type et un apercu visuel de son contenu.

**Actions depuis la galerie :**

- **Creer** -- Cliquez sur **+ Nouveau diagramme** pour creer un diagramme avec un nom, une description optionnelle et un lien optionnel vers une fiche Initiative
- **Ouvrir** -- Cliquez sur n'importe quel diagramme pour lancer l'editeur
- **Modifier les details** -- Renommer, mettre a jour la description ou reassigner l'initiative liee
- **Supprimer** -- Supprimer un diagramme (avec confirmation)

## L'editeur de diagrammes

Ouvrir un diagramme lance un **editeur DrawIO** plein ecran dans une iframe de meme origine. La barre d'outils DrawIO standard est disponible pour les formes, connecteurs, texte, mise en forme et disposition.

### Insertion de fiches

Utilisez la **Barre laterale des fiches** (bascule via l'icone de barre laterale) pour parcourir votre inventaire. Vous pouvez :

- **Rechercher** des fiches par nom
- **Filtrer** par type de fiche
- **Glisser une fiche** sur le canevas -- elle apparait comme une forme stylisee avec le nom et l'icone du type de la fiche
- Utiliser le **Dialogue de selection de fiches** pour une recherche avancee et une selection multiple

### Creation de fiches depuis le diagramme

Si vous dessinez une forme qui ne correspond pas a une fiche existante, vous pouvez en creer une directement :

1. Selectionnez la forme non liee
2. Cliquez sur **Creer une fiche** dans le panneau de synchronisation
3. Remplissez le type, le nom et les champs optionnels
4. La forme est automatiquement liee a la nouvelle fiche

### Creation de relations a partir d'aretes

Lorsque vous dessinez un connecteur entre deux formes de fiches :

1. Selectionnez l'arete
2. Le dialogue **Selecteur de relation** apparait
3. Choisissez le type de relation (seuls les types valides pour les types de fiches connectes sont affiches)
4. La relation est creee dans l'inventaire et l'arete est marquee comme synchronisee

### Synchronisation des fiches

Le **Panneau de synchronisation** maintient votre diagramme et votre inventaire en phase :

- **Fiches synchronisees** -- Les formes liees aux fiches de l'inventaire affichent un indicateur de synchronisation vert
- **Formes non synchronisees** -- Les formes pas encore liees a des fiches sont signalees pour action
- **Developper/reduire les groupes** -- Naviguez dans les groupes de fiches hierarchiques directement sur le canevas

### Liaison aux initiatives

Les diagrammes peuvent etre lies a des fiches **Initiative**, ce qui les fait apparaitre dans le module [EA Delivery](delivery.md) aux cotes des documents SoAW. Cela fournit une vue complete de tous les artefacts d'architecture pour une initiative donnee.
