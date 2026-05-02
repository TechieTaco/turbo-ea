# API-Referenz

Turbo EA stellt eine vollständige **REST-API** bereit, die alles antreibt, was Sie in der Web-Oberfläche tun können. Damit lassen sich Inventaraktualisierungen automatisieren, CI/CD-Pipelines integrieren, eigene Dashboards bauen oder EA-Daten in andere Werkzeuge (BI, GRC, ITSM, Tabellenkalkulationen) übertragen.

Dieselbe API ist interaktiv über die in **FastAPI eingebaute Swagger-UI** dokumentiert, sodass Administratoren und Entwickler jeden Endpunkt durchsuchen, Request- und Response-Schemata einsehen und Aufrufe direkt aus dem Browser ausprobieren können.

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

## Interaktive API-Referenz (Swagger UI)

FastAPI generiert automatisch eine OpenAPI-3-Spezifikation aus dem Backend-Code und stellt daneben eine interaktive Swagger-UI bereit. Sie ist die **maßgebliche Quelle** für jeden Endpunkt, jeden Parameter und jede Response-Struktur.

| URL | Beschreibung |
|-----|--------------|
| `/api/docs` | Swagger UI – Endpunkte im Browser durchsuchen, prüfen und ausprobieren |
| `/api/redoc` | ReDoc – alternative reine Lese-Ansicht der Dokumentation |
| `/api/openapi.json` | Reines OpenAPI-3-Schema (nützlich für Codegeneratoren wie `openapi-generator-cli`) |

!!! warning "Nur im Entwicklungsmodus verfügbar"
    Aus Sicherheitsgründen sind die API-Dokumentations-Endpunkte **in der Produktion deaktiviert**. Sie werden nur ausgeliefert, wenn `ENVIRONMENT=development` in Ihrer `.env`-Datei gesetzt ist. In Produktionsumgebungen wird das OpenAPI-Schema nicht öffentlich angeboten – die API selbst funktioniert jedoch unverändert.

    Um die API-Referenz für eine Produktionsinstanz zu durchstöbern, starten Sie eine lokale Turbo-EA-Instanz im Entwicklungsmodus (das Schema ist über alle Bereitstellungen derselben Version identisch) oder setzen Sie vorübergehend `ENVIRONMENT=development`, starten den Backend-Dienst neu und nehmen die Änderung anschließend zurück.

### Endpunkte aus der Swagger-UI ausprobieren

1. Öffnen Sie `/api/docs` in Ihrem Browser.
2. Klicken Sie oben rechts auf **Authorize**.
3. Fügen Sie ein gültiges JWT (ohne den Präfix `Bearer `) in das Feld `bearerAuth` ein und bestätigen Sie.
4. Klappen Sie einen beliebigen Endpunkt auf, klicken Sie auf **Try it out**, füllen Sie die Parameter aus und klicken Sie auf **Execute**.

Swagger sendet die Anfrage aus Ihrem Browser mit Ihrem Token, sodass alles, was über die API möglich ist, auch von dieser Seite aus erreichbar ist – nützlich für Ad-hoc-Administrationsaufgaben und zum Überprüfen des Berechtigungsverhaltens.

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

Die vollständige Referenz finden Sie in Swagger; die folgende Tabelle ist eine schnelle Übersicht der meistgenutzten Gruppen:

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

Ressourcenspezifische Filter sind je Endpunkt in Swagger dokumentiert (z. B. nimmt `/cards` `type`, `status`, `parent_id`, `approval_status` entgegen).

---

## Echtzeitereignisse (Server-Sent Events)

`GET /api/v1/events/stream` ist eine langlebige SSE-Verbindung, die Ereignisse pusht, sobald sie eintreten (Karte erstellt, aktualisiert, freigegeben usw.). Die Web-UI nutzt sie, um Badges und Listen ohne Polling zu aktualisieren. Jeder HTTP-Client mit SSE-Unterstützung kann sich abonnieren – nützlich für Echtzeit-Dashboards oder externe Benachrichtigungsbrücken.

---

## Codegenerierung

Da die API vollständig durch OpenAPI 3 beschrieben wird, können Sie typsichere Clients in jeder gängigen Sprache erzeugen:

```bash
# Schema von einer Entwicklungsinstanz herunterladen
curl http://localhost:8920/api/openapi.json -o turbo-ea-openapi.json

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
| `/api/docs` liefert 404 | Swagger UI ist in der Produktion deaktiviert. Setzen Sie `ENVIRONMENT=development` und starten Sie das Backend neu, oder verwenden Sie eine Entwicklungsinstanz, um das Schema einzusehen. |
| `401 Unauthorized` | Token fehlt, ist ungültig oder abgelaufen. Authentifizieren Sie sich erneut über `/auth/login` oder `/auth/refresh`. |
| `403 Forbidden` | Token ist gültig, dem Benutzer fehlt aber die erforderliche Berechtigung. Prüfen Sie die Rolle in [Benutzer und Rollen](users.md). |
| `422 Unprocessable Entity` | Pydantic-Validierung fehlgeschlagen. Der Response-Body listet die ungültigen Felder mit Begründung. |
| CORS-Fehler aus einer Browser-App | Tragen Sie den Frontend-Origin in `ALLOWED_ORIGINS` der `.env` ein und starten Sie das Backend neu. |
