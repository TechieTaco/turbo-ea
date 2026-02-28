# Notifications

Turbo EA vous tient informe des modifications apportees aux fiches, taches et documents qui vous concernent. Les notifications sont delivrees **dans l'application** (via la cloche de notification) et optionnellement **par e-mail** si le SMTP est configure.

## Cloche de notification

L'**icone de cloche** dans la barre de navigation superieure affiche un badge avec le nombre de notifications non lues. Cliquez dessus pour ouvrir un menu deroulant avec vos 20 notifications les plus recentes.

Chaque notification affiche :

- **Icone** indiquant le type de notification
- **Resume** de ce qui s'est passe (par ex. « Une tache vous a ete assignee sur SAP S/4HANA »)
- **Temps** ecoule depuis la creation de la notification (par ex. « il y a 5 minutes »)

Cliquez sur n'importe quelle notification pour naviguer directement vers la fiche ou le document correspondant. Les notifications sont automatiquement marquees comme lues lorsque vous les consultez.

## Types de notifications

| Type | Declencheur |
|------|-------------|
| **Tache assignee** | Une tache vous est assignee |
| **Fiche mise a jour** | Une fiche sur laquelle vous etes partie prenante est mise a jour |
| **Commentaire ajoute** | Un nouveau commentaire est publie sur une fiche sur laquelle vous etes partie prenante |
| **Statut d'approbation modifie** | Le statut d'approbation d'une fiche change (approuve, rejete, casse) |
| **Demande de signature SoAW** | On vous demande de signer un Statement of Architecture Work |
| **SoAW signe** | Un SoAW que vous suivez recoit une signature |
| **Demande d'enquete** | Une enquete vous est envoyee et necessite votre reponse |

## Livraison en temps reel

Les notifications sont delivrees en temps reel via Server-Sent Events (SSE). Vous n'avez pas besoin de rafraichir la page -- les nouvelles notifications apparaissent automatiquement et le badge se met a jour instantanement.

## Preferences de notification

Cliquez sur l'**icone d'engrenage** dans le menu deroulant des notifications (ou allez dans votre menu de profil) pour configurer vos preferences de notification.

Pour chaque type de notification, vous pouvez activer/desactiver independamment :

- **Dans l'application** -- Si elle apparait dans la cloche de notification
- **E-mail** -- Si un e-mail est egalement envoye (necessite que le SMTP soit configure par un administrateur)

Certains types de notifications (par ex. demandes d'enquete) peuvent avoir la livraison par e-mail imposee par le systeme et ne peuvent pas etre desactives.
