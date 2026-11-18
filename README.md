# Kita-Ausfall NRW (kita-down-detector)

Datensparsames Tracking, welche Kitas wann **verkürzte Betreuungszeiten**, **Notbetreuung** oder **keine Betreuung** haben – zunächst für NRW, Start in **Bonn und Köln**.

- **Mobile first**: React-PWA, „Meine Kitas“ nur auf dem Gerät, Teilen in die Eltern-Gruppe, offline der letzte Stand
- **Vertrauensstufen**: unbestätigt → von mehreren Eltern bestätigt → verifiziert (Elternbeirat-/Kita-Link) → berichtigt durch Kita
- **Proof-of-Work** statt Captcha (ALTCHA, selbst gehostet), Rate-Limits ohne IP-Speicherung
- **Berichtigung** durch Kitas über ihre hinterlegte Adresse; **Einladung**: Elternbeirat beantragt Link, Kita bestätigt
- Keine IP-Adressen, keine Cookies, kein Freitext, keine externen Ressourcen; Einzelmeldungen werden nach Frist gelöscht
- Öffentliches Änderungsprotokoll und offene JSON-API ([`api/openapi.yaml`](api/openapi.yaml))

Konzepte: [`docs/konzept.md`](docs/konzept.md) (fachlich) · [`docs/technisches-konzept.md`](docs/technisches-konzept.md) (technisch) · Betrieb: [`deploy/README.md`](deploy/README.md)

## Aufbau

```
cmd/kita-ausfall/   ein Binary: Server + Verwaltungsbefehle
internal/
  dienst/           Anwendungsfälle (melden, berichtigen, einladen, aufräumen)
  status/           Berechnung des angezeigten Status (reine Logik)
  httpapi/          JSON-API, Sicherheits-Header, Rate-Limits, Auslieferung des Frontends
  importer/         Kita-Verzeichnisse einlesen (CSV, GeoJSON, Esri-JSON, Overpass) und abgleichen
  privacy/          Melder-Hash mit Tagesschlüssel, Tokens, Adress-Normalisierung
  pow/ mail/ config/ datum/ domain/
  db/               Migrationen (goose) + sqlc-generierter Code
  web/dist/         gebautes Frontend (wird ins Binary eingebettet)
web/                React-Frontend (Vite, TypeScript)
api/openapi.yaml    API-Vertrag
deploy/             Docker Compose, Caddy, Postgres-Init, Backup
```

## Entwicklung

Voraussetzungen: Go ≥ 1.26, Node.js 22, PostgreSQL ≥ 16.

Datenbank einmalig anlegen (als Superuser):

```sql
CREATE ROLE kita_migrate LOGIN PASSWORD 'dev';
CREATE ROLE kita_app LOGIN PASSWORD 'dev';
CREATE DATABASE kita OWNER kita_migrate;
CREATE DATABASE kita_test OWNER kita_migrate;
-- in beiden Datenbanken:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

```sh
make web        # Frontend bauen (nach internal/web/dist)
make dev        # Migration, Testdaten (erfundene Kitas in Bonn/Köln), Server auf :8080
cd web && npm run dev   # optional: Vite-Dev-Server mit Hot Reload, /api → :8080

make test       # Go-Tests (inkl. Integrationstests gegen PostgreSQL) + Frontend-Tests
make e2e        # Ende-zu-Ende-Tests mit Playwright (iPhone SE, Pixel 7) gegen den echten Server
make lint       # vet, staticcheck, govulncheck, sqlc diff, Typprüfung
make generate   # sqlc-Code und API-Typen neu erzeugen
```

Mails werden ohne `SMTP_URL` auf der Konsole ausgegeben.

## Kita-Daten importieren

```sh
# erst prüfen, welche Spalten erkannt werden
bin/kita-ausfall import --quelle bonn --datei kitas-bonn.csv --modus primaer --ort Bonn --trockenlauf
# Spalten bei Bedarf selbst zuordnen
bin/kita-ausfall import --quelle koeln --datei kitas-koeln.json --modus primaer --spalte name=BEZEICHNUNG
```

- `--modus primaer`: maßgebliches Verzeichnis (Landesdatensatz, oder zum Start Bonn/Köln) – legt Kitas an, aktualisiert sie, blendet verschwundene aus.
- `--modus ergaenzung`: gleicht nur ab (Adresse + Namensähnlichkeit), ergänzt Koordinaten, Träger und Kontaktadressen; Unklares landet in `kita-ausfall zuordnung liste`.
- Koordinaten in WGS84 oder UTM 32N (EPSG:25832) werden automatisch erkannt; CSV in UTF-8 oder Windows-1252.
- Persönlich aussehende E-Mail-Adressen (`vorname.nachname@`) werden verworfen.

OpenStreetMap als Ergänzung: Overpass-Antwort speichern und importieren:

```sh
curl -s https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:600];area["ISO3166-2"="DE-NW"]["admin_level"="4"]->.nrw;nwr["amenity"="kindergarten"](area.nrw);out center tags;' > osm.json
bin/kita-ausfall import --quelle osm --datei osm.json --modus ergaenzung --herkunft osm
```

## Verwaltung

```sh
kita-ausfall link erstellen --kita 12 --rolle elternbeirat     # Link wird einmal angezeigt
kita-ausfall link widerrufen --kita 12 [--rolle kita]
kita-ausfall kontakt setzen --kita 12 --email kita-xy@stadt.de
kita-ausfall vorschlaege liste | annehmen <id> | ablehnen <id>  # von Nutzer:innen vorgeschlagene Kita-Adressen
kita-ausfall fehlend liste | annehmen <id> | ablehnen <id>      # gemeldete fehlende Kitas
kita-ausfall aufraeumen                                         # Löschfristen (läuft im Server stündlich)
```

## Konfiguration

| Variable | Standard | Beschreibung |
|---|---|---|
| `APP_ENV` | – | `production` aktiviert Pflichtprüfungen |
| `ADDR` | `:8080` | |
| `BASE_URL` | `http://localhost:8080` | Öffentliche URL (Links in Mails); in Produktion `https://` |
| `DATABASE_URL` | lokal `kita_app` | App-Verbindung (nur DML-Rechte) |
| `MIGRATE_DATABASE_URL` | – | Verbindung für Migrationen (Schema-Besitzer) |
| `ALTCHA_HMAC_SECRET` | zufällig (dev) | **Pflicht in Produktion**, ≥ 32 Zeichen |
| `ALTCHA_COST` / `ALTCHA_COUNTER_MIN` / `ALTCHA_COUNTER_MAX` | `5000` / `2000` / `5000` | Proof-of-Work-Schwierigkeit (≈ 2–4 s auf dem Handy) |
| `BESTAETIGUNG_SCHWELLE` | `2` | Unabhängige anonyme Meldungen bis „bestätigt“ |
| `MAX_MELDUNGEN_PRO_TAG` | `3` | Anonyme Meldungen je Gerät, Kita und Tag |
| `AUFBEWAHRUNG_TAGE` | `180` | Löschfrist für Einzelmeldungen |
| `TRUSTED_PROXY_CIDRS` | – | Netze, deren `X-Forwarded-For` vertraut wird |
| `VERTRAUTE_DOMAINS` | – | Träger-Domains, deren Kita-Adressen ohne manuelle Prüfung gelten |
| `SMTP_URL` | – | `smtps://user:pass@host:465` oder `smtp://…:587` (STARTTLS); Pflicht in Produktion |
| `MAIL_FROM` / `KONTAKT_EMAIL` | | Absender / Kontakt der Betreibenden |

Secrets können auch als Datei übergeben werden: `*_FILE` (z. B. `ALTCHA_HMAC_SECRET_FILE`, `DATABASE_URL_FILE`).

## Lizenzen der Daten

Statusdaten der API: CC BY 4.0 (Vorschlag). Kita-Stammdaten je nach Quelle: Land NRW (DL-DE BY 2.0), Städte, © OpenStreetMap-Mitwirkende (ODbL).
