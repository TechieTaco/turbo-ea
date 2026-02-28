# Enquetes

Le module **Enquetes** (**Admin > Enquetes**) permet aux administrateurs de creer des **enquetes de maintenance de donnees** qui collectent des informations structurees aupres des parties prenantes sur des fiches specifiques.

## Cas d'utilisation

Les enquetes aident a maintenir vos donnees d'architecture a jour en contactant les personnes les plus proches de chaque composant. Par exemple :

- Demander aux responsables applicatifs de confirmer la criticite metier et les dates de cycle de vie annuellement
- Collecter des evaluations d'adequation technique aupres des equipes IT
- Recueillir des mises a jour de couts aupres des responsables de budget

## Cycle de vie des enquetes

Chaque enquete progresse a travers trois etats :

| Statut | Signification |
|--------|---------------|
| **Brouillon** | En cours de conception, pas encore visible par les repondants |
| **Active** | Ouverte aux reponses, les parties prenantes assignees la voient dans leurs Taches |
| **Fermee** | N'accepte plus de reponses |

## Creation d'une enquete

1. Naviguez vers **Admin > Enquetes**
2. Cliquez sur **+ Nouvelle enquete**
3. Le **Constructeur d'enquete** s'ouvre avec la configuration suivante :

### Type cible

Selectionnez le type de fiche auquel l'enquete s'applique (par ex. Application, Composant IT). L'enquete sera envoyee pour chaque fiche de ce type correspondant a vos filtres.

### Filtres

Optionnellement, reduisez le perimetre en filtrant les fiches (par ex. uniquement les applications Actives, uniquement les fiches detenues par une organisation specifique).

### Questions

Concevez vos questions. Chaque question peut etre :

- **Texte libre** -- Reponse ouverte
- **Selection unique** -- Choisir une option dans une liste
- **Selection multiple** -- Choisir plusieurs options
- **Nombre** -- Saisie numerique
- **Date** -- Selecteur de date
- **Booleen** -- Bascule Oui/Non

### Actions automatiques

Configurez des regles qui mettent automatiquement a jour les attributs des fiches en fonction des reponses a l'enquete. Par exemple, si un repondant selectionne « Mission critique » pour la criticite metier, le champ `businessCriticality` de la fiche peut etre mis a jour automatiquement.

## Envoi d'une enquete

Une fois votre enquete en statut **Active** :

1. Cliquez sur **Envoyer** pour distribuer l'enquete
2. Chaque fiche ciblee genere une tache pour les parties prenantes assignees
3. Les parties prenantes voient l'enquete dans leur onglet **Mes enquetes** sur la [page Taches](../guide/tasks.md)

## Consultation des resultats

Naviguez vers **Admin > Enquetes > [Nom de l'enquete] > Resultats** pour voir :

- Statut des reponses par fiche (repondu, en attente)
- Reponses individuelles avec les reponses par question
- Une action **Appliquer** pour valider les regles d'action automatique sur les attributs des fiches
