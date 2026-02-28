# Portails web

La fonctionnalite **Portails web** (**Admin > Parametres > Portails web**) vous permet de creer des **vues publiques en lecture seule** de donnees de fiches selectionnees -- accessibles sans authentification via une URL unique.

## Cas d'utilisation

Les portails web sont utiles pour partager des informations d'architecture avec des parties prenantes qui n'ont pas de compte Turbo EA :

- **Catalogue technologique** -- Partager le paysage applicatif avec les utilisateurs metier
- **Annuaire de services** -- Publier les services IT et leurs responsables
- **Carte de capacites** -- Fournir une vue publique des capacites metier

## Creation d'un portail

1. Naviguez vers **Admin > Parametres > Portails web**
2. Cliquez sur **+ Nouveau portail**
3. Configurez le portail :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom d'affichage du portail |
| **Slug** | Identifiant compatible URL (genere automatiquement a partir du nom, modifiable). Le portail sera accessible a `/portal/{slug}` |
| **Type de fiche** | Quel type de fiche afficher |
| **Sous-types** | Optionnellement restreindre a des sous-types specifiques |
| **Afficher le logo** | Si le logo de la plateforme doit etre affiche sur le portail |

## Configuration de la visibilite

Pour chaque portail, vous controlez exactement quelles informations sont visibles. Il y a deux contextes :

### Proprietes de la vue liste

Quelles colonnes/proprietes apparaissent dans la liste des fiches :

- **Proprietes integrees** : description, cycle de vie, tags, qualite des donnees, statut d'approbation
- **Champs personnalises** : Chaque champ du schema du type de fiche peut etre active/desactive individuellement

### Proprietes de la vue detail

Quelles informations apparaissent lorsqu'un visiteur clique sur une fiche :

- Memes controles de bascule que la vue liste, mais pour le panneau de detail developpe

## Acces au portail

Les portails sont accessibles a :

```
https://votre-domaine-turbo-ea/portal/{slug}
```

Aucune connexion n'est requise. Les visiteurs peuvent parcourir la liste des fiches, rechercher et consulter les details des fiches -- mais seules les proprietes que vous avez activees sont affichees.

!!! note
    Les portails sont en lecture seule. Les visiteurs ne peuvent pas modifier, commenter ou interagir avec les fiches. Les donnees sensibles (parties prenantes, commentaires, historique) ne sont jamais exposees sur les portails.
