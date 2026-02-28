# Gestion de la fin de vie (EOL)

La page d'administration **EOL** (**Admin > Parametres > EOL**) vous aide a suivre les cycles de vie des produits technologiques en liant vos fiches a la base de donnees publique [endoflife.date](https://endoflife.date/).

## Pourquoi suivre les EOL ?

Savoir quand les produits technologiques atteignent la fin de vie ou la fin de support est essentiel pour :

- **Gestion des risques** -- Les logiciels non supportes representent un risque de securite
- **Planification budgetaire** -- Planifier les migrations et les mises a niveau avant la fin du support
- **Conformite** -- De nombreuses reglementations exigent des logiciels supportes

## Recherche en masse

La fonctionnalite de recherche en masse analyse vos fiches **Application** et **Composant IT** et trouve automatiquement les produits correspondants dans la base de donnees endoflife.date.

### Lancer une recherche en masse

1. Naviguez vers **Admin > Parametres > EOL**
2. Selectionnez le type de fiche a analyser (Application ou Composant IT)
3. Cliquez sur **Rechercher**
4. Le systeme effectue une **correspondance approximative** avec le catalogue de produits endoflife.date

### Examen des resultats

Pour chaque fiche, la recherche retourne :

- **Score de correspondance** (0-100%) -- A quel point le nom de la fiche correspond a un produit connu
- **Nom du produit** -- Le produit endoflife.date correspondant
- **Versions/cycles disponibles** -- Les versions du produit avec leurs dates de support

### Filtrage des resultats

Utilisez les controles de filtre pour vous concentrer sur :

- **Tous les elements** -- Chaque fiche analysee
- **Non lies uniquement** -- Fiches pas encore liees a un produit EOL
- **Deja lies** -- Fiches qui ont deja un lien EOL

Un resume statistique affiche : nombre total de fiches analysees, deja liees, non liees et correspondances trouvees.

### Lier les fiches aux produits

1. Examinez la correspondance suggeree pour chaque fiche
2. Selectionnez la bonne **version/cycle du produit** dans la liste deroulante
3. Cliquez sur **Lier** pour sauvegarder l'association

Une fois liee, la page de detail de la fiche affiche une **section EOL** avec :

- **Nom du produit et version**
- **Statut de support** -- Code couleur : Supporte (vert), Approchant la fin de vie (orange), Fin de vie (rouge)
- **Dates cles** -- Date de sortie, fin du support actif, fin du support securite, date de fin de vie

## Rapport EOL

Les donnees EOL liees alimentent le [Rapport EOL](../guide/reports.md), qui fournit une vue tableau de bord du statut de support de votre paysage technologique sur toutes les fiches liees.
