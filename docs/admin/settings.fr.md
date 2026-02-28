# Parametres generaux

La page **Parametres** (**Admin > Parametres**) fournit une configuration centralisee pour l'apparence de la plateforme, l'e-mail et les bascules de modules.

## Apparence

### Logo

Telechargez un logo personnalise qui apparait dans la barre de navigation superieure. Formats pris en charge : PNG, JPEG, SVG, WebP, GIF. Cliquez sur **Reinitialiser** pour revenir au logo Turbo EA par defaut.

### Favicon

Telechargez une icone de navigateur personnalisee (favicon). Le changement prend effet au prochain chargement de page. Cliquez sur **Reinitialiser** pour revenir a l'icone par defaut.

### Devise

Selectionnez la devise utilisee pour les champs de cout dans toute la plateforme. Cela affecte la maniere dont les valeurs de cout sont formatees dans les pages de detail des fiches, les rapports et les exports. Plus de 20 devises sont prises en charge, incluant USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, et plus.

### Langues activees

Basculez les langues disponibles pour les utilisateurs dans leur selecteur de langue. Les sept langues supportees peuvent etre activees ou desactivees individuellement :

- English, Deutsch, Francais, Espanol, Italiano, Portugues, 中文

Au moins une langue doit rester activee en permanence.

## E-mail (SMTP)

Configurez la livraison d'e-mails pour les e-mails d'invitation, les notifications d'enquete et autres messages systeme.

| Champ | Description |
|-------|-------------|
| **Hote SMTP** | Le nom d'hote de votre serveur de messagerie (par ex. `smtp.gmail.com`) |
| **Port SMTP** | Port du serveur (generalement 587 pour TLS) |
| **Utilisateur SMTP** | Nom d'utilisateur d'authentification |
| **Mot de passe SMTP** | Mot de passe d'authentification (stocke chiffre) |
| **Utiliser TLS** | Activer le chiffrement TLS (recommande) |
| **Adresse d'expedition** | L'adresse e-mail de l'expediteur pour les messages sortants |
| **URL de base de l'application** | L'URL publique de votre instance Turbo EA (utilisee dans les liens des e-mails) |

Apres la configuration, cliquez sur **Envoyer un e-mail de test** pour verifier que les parametres fonctionnent correctement.

!!! note
    L'e-mail est optionnel. Si le SMTP n'est pas configure, les fonctionnalites qui envoient des e-mails (invitations, notifications d'enquete) passeront gracieusement la livraison par e-mail.

## Module BPM

Activez ou desactivez le module **Gestion des processus metier**. Lorsqu'il est desactive :

- L'element de navigation **BPM** est masque pour tous les utilisateurs
- Les fiches Processus Metier restent dans la base de donnees mais les fonctionnalites specifiques au BPM (editeur de flux de processus, tableau de bord BPM, rapports BPM) ne sont pas accessibles

Ceci est utile pour les organisations qui n'utilisent pas le BPM et souhaitent une experience de navigation plus epuree.
