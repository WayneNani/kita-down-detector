# Kita-Ausfall NRW (kita-down-detector)

Datensparsames Tracking, welche Kitas wann **verkürzte Betreuungszeiten**, **Notbetreuung** oder **keine Betreuung** haben – zunächst für NRW.

- Anonyme Meldungen durch Eltern, geschützt per **Proof-of-Work** (ALTCHA, selbst gehostet) statt Captcha
- **Vertrauensstufen**: unbestätigt → von mehreren Eltern bestätigt → verifiziert (Elternbeirat-/Kita-Link) → berichtigt durch Kita
- **Berichtigung** durch Kitas über ihre öffentlich bekannte E-Mail-Adresse
- Keine IP-Adressen, keine Cookies, kein Freitext, keine externen Ressourcen; Einzelmeldungen werden nach Frist gelöscht
- Öffentliches Änderungsprotokoll und offene JSON-API (nur aggregierte Daten)

Details und Begründungen: [`docs/konzept.md`](docs/konzept.md).

## Schnellstart

Voraussetzung: Node.js ≥ 22.18 (TypeScript läuft direkt, SQLite über `node:sqlite`).

```sh
npm install
npm run seed      # legt erfundene Test-Kitas an
npm run dev       # http://localhost:3000
```

Echte Daten aus OpenStreetMap importieren:

```sh
npm run import:osm                      # live über die Overpass-API
npm run import:osm -- --datei nrw.json  # oder aus einer gespeicherten Overpass-Antwort
```

Melde-Link für einen Elternbeirat oder eine Kita erzeugen bzw. widerrufen:

```sh
npm run link:create -- --kita 12 --rolle elternbeirat
npm run link:create -- --kita 12 --rolle kita --gueltig-bis 2027-07-31
npm run link:create -- --kita 12 --widerrufen
```

Tests und Typprüfung:

```sh
npm test
npm run typecheck
```

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | |
| `DB_PATH` | `data/kita.db` | SQLite-Datei |
| `BASE_URL` | `http://localhost:$PORT` | Öffentliche URL (für Links in Mails/CLI) |
| `ALTCHA_HMAC_SECRET` | zufällig (dev) | **Pflicht in Produktion** (`NODE_ENV=production`) |
| `ALTCHA_COST` / `ALTCHA_COUNTER_MIN` / `ALTCHA_COUNTER_MAX` | `5000` / `2000` / `5000` | Schwierigkeit des Proof-of-Work (≈ 2–4 s im Browser) |
| `BESTAETIGUNG_SCHWELLE` | `2` | Unabhängige anonyme Meldungen bis „bestätigt“ |
| `MAX_MELDUNGEN_PRO_TAG` | `3` | Anonyme Meldungen je Gerät, Kita und Tag |
| `AUFBEWAHRUNG_TAGE` | `180` | Löschfrist für Einzelmeldungen |
| `TRUST_PROXY` | – | `1`, wenn ein Reverse-Proxy `X-Forwarded-For` setzt |
| `SMTP_URL` | – | z. B. `smtps://user:pass@mail.example:465`; ohne: Mails werden auf der Konsole ausgegeben |
| `MAIL_FROM` | `Kita-Ausfall NRW <noreply@localhost>` | |
| `KONTAKT_EMAIL` | `kontakt@localhost` | Kontakt der Betreibenden |

## Aufbau

```
src/
  server.ts    Einstieg, täglicher Aufräumlauf
  app.ts       Routen (Hono), Sicherheits-Header
  status.ts    Berechnung des angezeigten Status (Vertrauensstufen)
  service.ts   Datenbankzugriffe, Validierung, Links, Berichtigungen, Löschfristen
  privacy.ts   Tagesrotierender Melder-Hash, Token-Hashing
  pow.ts       Proof-of-Work (ALTCHA)
  views.ts     Server-gerenderte HTML-Seiten
  db.ts        Schema
scripts/       OSM-Import, Testdaten, Melde-Links, Aufräumen
test/          node:test
```

## API

- `GET /api/v1/status?datum=YYYY-MM-DD` – alle Kitas mit gemeldeter Einschränkung an dem Tag
- `GET /api/v1/kitas/:id` – Status der nächsten 14 Tage

Fehlende Kitas bedeuten „keine Meldung“, **nicht** „regulär“.

Kita-Stammdaten © OpenStreetMap-Mitwirkende, ODbL.
