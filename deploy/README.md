# Betrieb

Eine VM in der EU (z. B. 2 vCPU / 4 GB), Docker mit Compose-Plugin, Firewall nur 22/80/443, SSH nur mit Schlüssel.

## Erstinstallation

```sh
cd deploy
umask 077
openssl rand -hex 32 > secrets/altcha_secret
openssl rand -hex 24 > secrets/postgres_password
openssl rand -hex 24 > secrets/kita_migrate_password
openssl rand -hex 24 > secrets/kita_app_password
echo "postgres://kita_app:$(cat secrets/kita_app_password)@db:5432/kita?sslmode=disable" > secrets/database_url
echo "postgres://kita_migrate:$(cat secrets/kita_migrate_password)@db:5432/kita?sslmode=disable" > secrets/migrate_database_url
echo "smtps://BENUTZER:PASSWORT@smtp.example.eu:465" > secrets/smtp_url   # SMTP-Relay in der EU mit AV-Vertrag

export DOMAIN=kita-ausfall.example KONTAKT_EMAIL=kontakt@kita-ausfall.example
export VERTRAUTE_DOMAINS=stadt-koeln.de,bonn.de   # Adressen dieser Träger ohne manuelle Prüfung
docker compose up -d --build
```

Die Datenbank ist nur im internen Netz erreichbar. Die App läuft als `kita_app` (nur Daten lesen/schreiben), Migrationen laufen beim Start mit `kita_migrate`.

## Kita-Daten importieren

```sh
docker compose cp kitas-bonn.csv app:/tmp/   # oder Volume einhängen
docker compose run --rm -v "$PWD/daten:/daten:ro" app import --quelle bonn --datei /daten/kitas-bonn.csv --modus primaer --ort Bonn --trockenlauf
```

Erst mit `--trockenlauf` prüfen, welche Spalten erkannt werden; bei Bedarf `--spalte name=Spaltenname` angeben.
Der Landesdatensatz wird monatlich mit `--quelle kibiz --modus primaer` importiert; städtische Daten danach mit `--modus ergaenzung`.

## Prüflisten

```sh
docker compose run --rm app vorschlaege liste       # vorgeschlagene Kita-Adressen
docker compose run --rm app vorschlaege annehmen 12
docker compose run --rm app fehlend liste           # gemeldete fehlende Kitas
docker compose run --rm app zuordnung liste         # ungeklärte Import-Zuordnungen
docker compose run --rm app link erstellen --kita 42 --rolle kita
```

## Updates

Möglichst nachts (`docker compose up -d --build`): Bei einem Neustart wird der Tagesschlüssel für die Melder-Hashes neu erzeugt, die Tageszählung gegen Mehrfachmeldungen beginnt dann neu.

## Backups

`backup.sh` per Cron, verschlüsselt mit age, 14 Tage Aufbewahrung.
