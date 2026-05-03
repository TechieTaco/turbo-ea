# API-Referenz

Turbo EA stellt eine vollständige **REST-API** bereit, die alles antreibt, was Sie in der Web-Oberfläche tun können. Damit lassen sich Inventaraktualisierungen automatisieren, CI/CD-Pipelines integrieren, eigene Dashboards bauen oder EA-Daten in andere Werkzeuge (BI, GRC, ITSM, Tabellenkalkulationen) übertragen.

Die vollständige OpenAPI-3-Spezifikation wird weiter unten auf dieser Seite live gerendert – jeder Endpunkt, jeder Parameter und jede Response-Struktur, in jeder Veröffentlichung neu aus dem Backend-Quellcode generiert.

---

## Basis-URL

Alle API-Endpunkte liegen unter dem Präfix `/api/v1`:

```
https://ihre-domain.example.com/api/v1
```

Lokal (Docker-Standardkonfiguration):

```
http://localhost:8920/api/v1
```

Einzige Ausnahme ist der Health-Endpunkt, der unter `/api/health` (ohne Versionspräfix) eingebunden ist.

---

## Live-OpenAPI-Referenz

Die interaktive Referenz unten wird in jeder Veröffentlichung direkt aus dem FastAPI-Quellcode generiert und mit dem Benutzerhandbuch ausgeliefert – es muss keine Backend-Instanz laufen, um sie zu durchsuchen. Nutzen Sie das Suchfeld, um einen Endpunkt zu finden, klappen Sie eine Operation auf, um Request-/Response-Schemata zu sehen, und kopieren Sie `curl`-Beispiele. Das rohe Schema lässt sich als JSON unter [`/api/openapi.json`](/api/openapi.json) herunterladen, etwa für Codegeneratoren wie `openapi-generator-cli`.

<script
  id="api-reference"
  data-url="/api/openapi.json"
></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>

!!! info "Endpunkte gegen die eigene Instanz ausprobieren"
    Ein Turbo-EA-Backend im Entwicklungsmodus (`ENVIRONMENT=development`) stellt zusätzlich Swagger UI unter `/api/docs` bereit – öffnen Sie sie, klicken Sie auf **Authorize**, fügen Sie ein JWT (ohne `Bearer `-Präfix) ein und nutzen Sie **Try it out**, um echte Anfragen abzuschicken. In Produktionsumgebungen sind diese Endpunkte aus Sicherheitsgründen deaktiviert; verwenden Sie dann diese Seite (oder eine Entwicklungsinstanz), um das Schema zu durchstöbern.

---

## Authentifizierung

Alle Endpunkte außer `/auth/*`, dem Health-Check und öffentlichen Web-Portalen erwarten ein JSON Web Token im `Authorization`-Header:

```
Authorization: Bearer <access_token>
```

### Token erhalten

`POST /api/v1/auth/login` mit E-Mail und Passwort:

```bash
curl -X POST https://ihre-domain.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "sie@example.com", "password": "ihr-passwort"}'
```

Die Antwort enthält ein `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Tokens sind standardmäßig 24 Stunden gültig (`ACCESS_TOKEN_EXPIRE_MINUTES`). Mit `POST /api/v1/auth/refresh` lässt sich eine Sitzung verlängern, ohne erneut Anmeldedaten einzugeben.

!!! tip "SSO-Benutzer"
    Wenn Ihre Organisation Single Sign-On verwendet, können Sie sich nicht mit E-Mail/Passwort anmelden. Bitten Sie entweder einen Administrator, ein Dienstkonto mit lokalem Passwort für die Automatisierung anzulegen, oder lesen Sie das JWT nach einer normalen SSO-Anmeldung aus dem Session-Storage des Browsers aus (nur zur Entwicklung).

### Token verwenden

```bash
curl https://ihre-domain.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Berechtigungen

Die API erzwingt **dieselben RBAC-Regeln wie die Web-Oberfläche**. Jeder schreibende Endpunkt prüft sowohl die App-Rolle des Aufrufers als auch alle Stakeholder-Rollen, die diese Person an der betroffenen Karte hält. Es gibt keine separaten „API-Berechtigungen" oder Service-Account-Umgehungen – Automatisierungsskripte laufen mit den Berechtigungen des Benutzers, dessen Token sie verwenden.

Schlägt eine Anfrage mit `403 Forbidden` fehl, ist das Token gültig, dem Benutzer fehlt aber die erforderliche Berechtigung. Siehe Seite [Benutzer und Rollen](users.md) für das Berechtigungsverzeichnis.

---

## Häufig genutzte Endpunktgruppen

Die Live-Referenz oben ist die vollständige Quelle der Wahrheit; die folgende Tabelle ist eine schnelle Übersicht der meistgenutzten Gruppen:

| Präfix | Zweck |
|--------|-------|
| `/auth` | Anmeldung, Registrierung, SSO-Callback, Token-Refresh, aktuelle Benutzerinformationen |
| `/cards` | CRUD auf Karten (Kernentität), Hierarchie, Historie, Freigabe, CSV-Export |
| `/relations` | CRUD auf Beziehungen zwischen Karten |
| `/metamodel` | Kartentypen, Felder, Sektionen, Subtypen, Beziehungstypen |
| `/reports` | Dashboard-KPIs, Portfolio, Matrix, Lifecycle, Abhängigkeiten, Kosten, Datenqualität |
| `/bpm` | Geschäftsprozessmanagement – Diagramme, Elemente, Flow-Versionen, Bewertungen |
| `/ppm` | Projektportfoliomanagement – Initiativen, Statusberichte, PSP, Aufgaben, Kosten, Risiken |
| `/turbolens` | KI-gestützte Analyse (Anbieter, Duplikate, Sicherheit, Architektur-KI) |
| `/risks` | EA-Risikoregister (TOGAF-Phase G) |
| `/diagrams` | DrawIO-Diagramme |
| `/soaw` | Statement-of-Architecture-Work-Dokumente |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Benutzer- und Rollenverwaltung (nur Admin) |
| `/settings` | Anwendungs­einstellungen (Logo, Währung, SMTP, KI, Modulschalter) |
| `/servicenow` | Bidirektionale ServiceNow-CMDB-Synchronisation |
| `/events`, `/notifications` | Audit-Trail und Benutzerbenachrichtigungen (inkl. SSE-Stream) |

---

## Paginierung, Filter und Sortierung

Listen-Endpunkte akzeptieren einheitliche Query-Parameter:

| Parameter | Beschreibung |
|-----------|--------------|
| `page` | Seitenzahl (1-basiert) |
| `page_size` | Einträge pro Seite (Standard 50, Maximum 200) |
| `sort_by` | Feld zum Sortieren (z. B. `name`, `updated_at`) |
| `sort_dir` | `asc` oder `desc` |
| `search` | Freitextfilter (sofern unterstützt) |

Ressourcenspezifische Filter sind je Endpunkt in der Live-Referenz oben dokumentiert (z. B. nimmt `/cards` `type`, `status`, `parent_id`, `approval_status` entgegen).

---

## Echtzeitereignisse (Server-Sent Events)

`GET /api/v1/events/stream` ist eine langlebige SSE-Verbindung, die Ereignisse pusht, sobald sie eintreten (Karte erstellt, aktualisiert, freigegeben usw.). Die Web-UI nutzt sie, um Badges und Listen ohne Polling zu aktualisieren. Jeder HTTP-Client mit SSE-Unterstützung kann sich abonnieren – nützlich für Echtzeit-Dashboards oder externe Benachrichtigungsbrücken.

---

## Codegenerierung

Da die API vollständig durch OpenAPI 3 beschrieben wird, können Sie typsichere Clients in jeder gängigen Sprache erzeugen:

```bash
# Schema herunterladen (keine laufende Instanz nötig)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Python-Client erzeugen
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … oder TypeScript, Go, Java, C# usw.
```

Für Python-Automatisierung ist `httpx` oder `requests` mit handgeschriebenen Aufrufen meist der einfachste Weg – die API ist klein genug, dass sich ein Generator selten lohnt.

---

## Rate Limiting

Auth-sensitive Endpunkte (Login, Registrierung, Passwort-Reset) sind via `slowapi` rate-limitiert, um Brute-Force-Angriffe abzuwehren. Andere Endpunkte sind standardmäßig nicht rate-limitiert; falls Sie ein lastintensives Automatisierungsskript drosseln müssen, tun Sie dies clientseitig oder hinter Ihrem Reverse-Proxy.

---

## Versionierung und Stabilität

- Die API wird über das Präfix `/api/v1` versioniert. Eine Breaking Change würde `/api/v2` parallel einführen.
- Innerhalb von `v1` können additive Änderungen (neue Endpunkte, neue optionale Felder) in Minor- und Patch-Releases ausgeliefert werden. Entfernungen oder Vertragsänderungen bleiben einer Major-Version vorbehalten.
- Die aktuelle Version wird über `GET /api/health` gemeldet, sodass Automatisierungen Upgrades erkennen können.

---

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| `/api/docs` liefert 404 auf Ihrer eigenen Instanz | Swagger UI ist in der Produktion deaktiviert. Setzen Sie `ENVIRONMENT=development` und starten Sie das Backend neu, oder nutzen Sie die Live-Referenz oben. |
| Live-Referenz oben bleibt leer | Prüfen Sie die Browser-Konsole – das Embed lädt `/api/openapi.json`; Unternehmensproxys oder strenge Adblocker blockieren gelegentlich CDN-Skripte. |
| `401 Unauthorized` | Token fehlt, ist ungültig oder abgelaufen. Authentifizieren Sie sich erneut über `/auth/login` oder `/auth/refresh`. |
| `403 Forbidden` | Token ist gültig, dem Benutzer fehlt aber die erforderliche Berechtigung. Prüfen Sie die Rolle in [Benutzer und Rollen](users.md). |
| `422 Unprocessable Entity` | Pydantic-Validierung fehlgeschlagen. Der Response-Body listet die ungültigen Felder mit Begründung. |
| CORS-Fehler aus einer Browser-App | Tragen Sie den Frontend-Origin in `ALLOWED_ORIGINS` der `.env` ein und starten Sie das Backend neu. |
