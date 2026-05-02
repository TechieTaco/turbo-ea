# Référence API

Turbo EA expose une **API REST** complète qui alimente tout ce que vous pouvez faire dans l'interface web. Vous pouvez l'utiliser pour automatiser les mises à jour de l'inventaire, intégrer des pipelines CI/CD, construire des tableaux de bord personnalisés ou extraire des données EA vers d'autres outils (BI, GRC, ITSM, tableurs).

La même API est documentée de manière interactive grâce à la **Swagger UI intégrée à FastAPI**, ce qui permet aux administrateurs et aux développeurs d'explorer chaque endpoint, d'inspecter les schémas requête/réponse et d'essayer des appels directement depuis le navigateur.

---

## URL de base

Tous les endpoints de l'API se trouvent sous le préfixe `/api/v1` :

```
https://votre-domaine.example.com/api/v1
```

En local (configuration Docker par défaut) :

```
http://localhost:8920/api/v1
```

La seule exception est l'endpoint de santé, monté sur `/api/health` (sans préfixe de version).

---

## Référence interactive de l'API (Swagger UI)

FastAPI génère automatiquement une spécification OpenAPI 3 à partir du code backend et sert une Swagger UI interactive à côté. C'est la **source unique de vérité** pour chaque endpoint, paramètre et forme de réponse.

| URL | Description |
|-----|-------------|
| `/api/docs` | Swagger UI — parcourir, rechercher et essayer les endpoints depuis le navigateur |
| `/api/redoc` | ReDoc — vue alternative en lecture seule de la documentation |
| `/api/openapi.json` | Schéma OpenAPI 3 brut (utile pour les générateurs de code comme `openapi-generator-cli`) |

!!! warning "Disponible uniquement en mode développement"
    Pour des raisons de sécurité, les endpoints de documentation API sont **désactivés en production**. Ils ne sont servis que lorsque `ENVIRONMENT=development` est défini dans votre fichier `.env`. Dans les déploiements en production, le schéma OpenAPI n'est pas exposé publiquement — mais l'API elle-même fonctionne exactement de la même manière.

    Pour parcourir la référence API d'une instance de production, lancez une instance Turbo EA locale en mode développement (le schéma est identique pour tous les déploiements de la même version) ou basculez temporairement `ENVIRONMENT=development`, redémarrez le backend et annulez le changement une fois terminé.

### Essayer des endpoints depuis Swagger UI

1. Ouvrez `/api/docs` dans votre navigateur.
2. Cliquez sur **Authorize** en haut à droite.
3. Collez un JWT valide (sans le préfixe `Bearer `) dans le champ `bearerAuth` et confirmez.
4. Dépliez n'importe quel endpoint, cliquez sur **Try it out**, remplissez les paramètres et cliquez sur **Execute**.

Swagger envoie la requête depuis votre navigateur en utilisant votre jeton, donc tout ce que vous pouvez faire via l'API est accessible depuis cette page — utile pour les tâches d'administration ponctuelles et pour vérifier le comportement des permissions.

---

## Authentification

Tous les endpoints, sauf `/auth/*`, le contrôle de santé et les portails web publics, requièrent un JSON Web Token envoyé dans l'en-tête `Authorization` :

```
Authorization: Bearer <access_token>
```

### Obtenir un jeton

`POST /api/v1/auth/login` avec votre e-mail et votre mot de passe :

```bash
curl -X POST https://votre-domaine.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "vous@example.com", "password": "votre-mot-de-passe"}'
```

La réponse contient un `access_token` :

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Les jetons sont valides 24 heures par défaut (`ACCESS_TOKEN_EXPIRE_MINUTES`). Utilisez `POST /api/v1/auth/refresh` pour prolonger une session sans ressaisir d'identifiants.

!!! tip "Utilisateurs SSO"
    Si votre organisation utilise l'authentification unique, vous ne pouvez pas vous connecter avec e-mail/mot de passe. Demandez à un administrateur de créer un compte de service avec un mot de passe local pour l'automatisation, ou récupérez le JWT depuis le session storage du navigateur après une connexion SSO normale (à des fins de développement uniquement).

### Utiliser le jeton

```bash
curl https://votre-domaine.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permissions

L'API applique **les mêmes règles RBAC que l'interface web**. Chaque endpoint mutateur vérifie à la fois le rôle applicatif de l'appelant et tous les rôles de partie prenante qu'il détient sur la fiche concernée. Il n'existe pas de « permissions API » distinctes ni de contournement par compte de service — les scripts d'automatisation s'exécutent avec les permissions de l'utilisateur dont ils utilisent le jeton.

Si une requête échoue avec `403 Forbidden`, le jeton est valide mais l'utilisateur n'a pas la permission requise. Consultez la page [Utilisateurs et rôles](users.md) pour le registre des permissions.

---

## Groupes d'endpoints courants

La référence complète se trouve dans Swagger ; le tableau ci-dessous est une cartographie rapide des groupes les plus utilisés :

| Préfixe | Objet |
|---------|-------|
| `/auth` | Connexion, enregistrement, callback SSO, rafraîchissement de jeton, informations utilisateur courant |
| `/cards` | CRUD sur les fiches (entité centrale), hiérarchie, historique, approbation, export CSV |
| `/relations` | CRUD sur les relations entre fiches |
| `/metamodel` | Types de fiches, champs, sections, sous-types, types de relation |
| `/reports` | KPI du tableau de bord, portefeuille, matrice, cycle de vie, dépendances, coût, qualité des données |
| `/bpm` | Gestion des processus métier — diagrammes, éléments, versions de flux, évaluations |
| `/ppm` | Gestion de portefeuille de projets — initiatives, rapports d'état, OTP, tâches, coûts, risques |
| `/turbolens` | Analyse pilotée par IA (fournisseurs, doublons, sécurité, IA d'architecture) |
| `/risks` | Registre des risques EA (TOGAF Phase G) |
| `/diagrams` | Diagrammes DrawIO |
| `/soaw` | Documents Statement of Architecture Work |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Administration des utilisateurs et des rôles (admin uniquement) |
| `/settings` | Paramètres applicatifs (logo, devise, SMTP, IA, interrupteurs de modules) |
| `/servicenow` | Synchronisation bidirectionnelle CMDB ServiceNow |
| `/events`, `/notifications` | Piste d'audit et notifications utilisateur (y compris flux SSE) |

---

## Pagination, filtres et tri

Les endpoints de liste acceptent un ensemble cohérent de paramètres de requête :

| Paramètre | Description |
|-----------|-------------|
| `page` | Numéro de page (commence à 1) |
| `page_size` | Éléments par page (défaut 50, maximum 200) |
| `sort_by` | Champ de tri (par exemple `name`, `updated_at`) |
| `sort_dir` | `asc` ou `desc` |
| `search` | Filtre plein texte (lorsque pris en charge) |

Les filtres spécifiques à une ressource sont documentés par endpoint dans Swagger (par exemple `/cards` accepte `type`, `status`, `parent_id`, `approval_status`).

---

## Événements en temps réel (Server-Sent Events)

`GET /api/v1/events/stream` est une connexion SSE longue durée qui pousse les événements à mesure qu'ils se produisent (fiche créée, mise à jour, approuvée, etc.). L'interface web s'en sert pour rafraîchir les badges et listes sans polling. Tout client HTTP compatible SSE peut s'abonner — utile pour construire des tableaux de bord en temps réel ou des passerelles de notification externes.

---

## Génération de code

Comme l'API est entièrement décrite par OpenAPI 3, vous pouvez générer des clients typés dans tous les langages majeurs :

```bash
# Télécharger le schéma depuis une instance de développement
curl http://localhost:8920/api/openapi.json -o turbo-ea-openapi.json

# Générer un client Python
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … ou TypeScript, Go, Java, C#, etc.
```

Pour de l'automatisation Python, le plus simple est généralement `httpx` ou `requests` avec des appels écrits à la main — l'API est suffisamment compacte pour qu'un générateur soit rarement utile.

---

## Limitation de débit

Les endpoints sensibles à l'authentification (login, enregistrement, réinitialisation de mot de passe) sont limités via `slowapi` pour se protéger des attaques par force brute. Les autres endpoints ne sont pas limités par défaut ; si vous devez ralentir un script d'automatisation lourd, faites-le côté client ou derrière votre reverse proxy.

---

## Versionnage et stabilité

- L'API est versionnée via le préfixe `/api/v1`. Une rupture introduirait un `/api/v2` en parallèle.
- Au sein de `v1`, des changements additifs (nouveaux endpoints, nouveaux champs optionnels) peuvent paraître en versions mineures et correctives. Les suppressions ou changements de contrat sont réservés à un saut de version majeure.
- La version courante est renvoyée par `GET /api/health` afin que l'automatisation détecte les mises à niveau.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| `/api/docs` renvoie 404 | Swagger UI est désactivée en production. Définissez `ENVIRONMENT=development` et redémarrez le backend, ou utilisez une instance de développement pour parcourir le schéma. |
| `401 Unauthorized` | Jeton manquant, malformé ou expiré. Réauthentifiez-vous via `/auth/login` ou `/auth/refresh`. |
| `403 Forbidden` | Le jeton est valide mais l'utilisateur n'a pas la permission requise. Vérifiez son rôle dans [Utilisateurs et rôles](users.md). |
| `422 Unprocessable Entity` | La validation Pydantic a échoué. Le corps de la réponse liste les champs invalides et la raison. |
| Erreurs CORS depuis une application navigateur | Ajoutez l'origine du frontend à `ALLOWED_ORIGINS` dans `.env` et redémarrez le backend. |
