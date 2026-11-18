-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Stammdaten. Herkunft steht in kita_zuordnung (eine Kita kann aus mehreren Quellen stammen).
CREATE TABLE kita (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  traeger       text,
  strasse       text,
  plz           text,
  ort           text,
  lat           double precision,
  lon           double precision,
  -- normalisiert (klein, ä→ae, ß→ss …) für Suche und Abgleich; wird von der App gesetzt
  suchtext      text NOT NULL,
  adresse_norm  text NOT NULL DEFAULT '',
  aktiv         boolean NOT NULL DEFAULT true,
  erstellt_am   date NOT NULL
);
CREATE INDEX kita_suchtext_trgm ON kita USING gin (suchtext gin_trgm_ops);
CREATE INDEX kita_name_trgm ON kita USING gin (name gin_trgm_ops);
CREATE INDEX kita_plz_adresse ON kita (plz, adresse_norm);
CREATE INDEX kita_lat ON kita (lat) WHERE lat IS NOT NULL;

CREATE TABLE kita_zuordnung (
  quelle           text NOT NULL,
  quelle_id        text NOT NULL,
  kita_id          bigint REFERENCES kita ON DELETE CASCADE,  -- NULL = noch ungeklärt
  aehnlichkeit     real,
  geprueft         boolean NOT NULL DEFAULT false,
  daten            jsonb NOT NULL,                             -- importierter Datensatz (ohne E-Mail)
  zuletzt_gesehen  date NOT NULL,
  PRIMARY KEY (quelle, quelle_id)
);
CREATE INDEX kita_zuordnung_kita ON kita_zuordnung (kita_id);
CREATE INDEX kita_zuordnung_offen ON kita_zuordnung (quelle) WHERE kita_id IS NULL AND NOT geprueft;

-- Nur Funktionsadressen. Nie öffentlich ausgegeben.
CREATE TABLE kita_kontakt (
  kita_id        bigint PRIMARY KEY REFERENCES kita ON DELETE CASCADE,
  email          text NOT NULL,
  herkunft       text NOT NULL CHECK (herkunft IN ('opendata', 'ifg', 'osm', 'kita_selbst', 'eingeladen', 'manuell')),
  bestaetigt_am  date,
  geaendert_am   date NOT NULL
);

-- Von Nutzer:innen vorgeschlagene Kita-Adressen, die geprüft werden müssen.
CREATE TABLE kontakt_vorschlag (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  email        text NOT NULL,
  anlass       text NOT NULL CHECK (anlass IN ('kita', 'einladung')),
  erstellt_am  date NOT NULL
);

CREATE TABLE melde_link (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  rolle        text NOT NULL CHECK (rolle IN ('elternbeirat', 'kita')),
  token_hash   bytea NOT NULL UNIQUE,
  gueltig_bis  date NOT NULL,
  widerrufen   boolean NOT NULL DEFAULT false,
  erstellt_am  date NOT NULL
);
CREATE INDEX melde_link_kita ON melde_link (kita_id);

-- Einladung: Elternbeirat beantragt Link, Kita bestätigt. eb_email wird mit der Zeile gelöscht.
CREATE TABLE einladung (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  eb_email     text NOT NULL,
  status       text NOT NULL CHECK (status IN ('pruefung', 'gesendet')),
  token_hash   bytea UNIQUE,
  ablauf       date NOT NULL,
  erstellt_am  date NOT NULL
);
CREATE INDEX einladung_kita ON einladung (kita_id);

CREATE TABLE meldung (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('regulaer', 'verkuerzt', 'notbetreuung', 'geschlossen')),
  datum_von    date NOT NULL,
  datum_bis    date NOT NULL,
  zeitraum     daterange GENERATED ALWAYS AS (daterange(datum_von, datum_bis, '[]')) STORED,
  uhrzeit_von  text CHECK (uhrzeit_von ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  uhrzeit_bis  text CHECK (uhrzeit_bis ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  grund        text CHECK (grund IN ('personalmangel', 'krankheitswelle', 'streik', 'schliesstag', 'sonstiges')),
  quelle       text NOT NULL CHECK (quelle IN ('anonym', 'elternbeirat', 'kita', 'kita_berichtigung')),
  melder_hash  bytea,
  link_id      bigint REFERENCES melde_link ON DELETE SET NULL,
  erstellt_am  date NOT NULL,
  CHECK (datum_bis >= datum_von AND datum_bis - datum_von < 31),
  CHECK (status <> 'verkuerzt' OR (uhrzeit_von IS NOT NULL AND uhrzeit_bis IS NOT NULL AND uhrzeit_bis > uhrzeit_von)),
  CHECK ((quelle = 'anonym') = (melder_hash IS NOT NULL))
);
CREATE INDEX meldung_kita_zeitraum ON meldung USING gist (kita_id, zeitraum);
CREATE INDEX meldung_ratelimit ON meldung (kita_id, melder_hash, erstellt_am) WHERE melder_hash IS NOT NULL;
CREATE INDEX meldung_datum_bis ON meldung (datum_bis);

-- Angezeigter Status je Kita und Tag. Keine Zeile = keine Meldung. Bleibt dauerhaft (Statistik).
CREATE TABLE tagesstatus (
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  datum        date NOT NULL,
  status       text NOT NULL,
  stufe        smallint NOT NULL,
  uhrzeit_von  text,
  uhrzeit_bis  text,
  grund        text,
  anzahl       smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (kita_id, datum)
);
CREATE INDEX tagesstatus_einschraenkung ON tagesstatus (datum)
  WHERE status IN ('verkuerzt', 'notbetreuung', 'geschlossen');

CREATE TABLE protokoll (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  datum        date NOT NULL,
  alt_status   text NOT NULL,
  neu_status   text NOT NULL,
  neu_stufe    smallint NOT NULL,
  erstellt_am  date NOT NULL
);
CREATE INDEX protokoll_kita ON protokoll (kita_id, id DESC);

CREATE TABLE berichtigung (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kita_id      bigint NOT NULL REFERENCES kita ON DELETE CASCADE,
  status       text NOT NULL,
  datum_von    date NOT NULL,
  datum_bis    date NOT NULL,
  uhrzeit_von  text,
  uhrzeit_bis  text,
  grund        text,
  token_hash   bytea NOT NULL UNIQUE,
  ablauf       date NOT NULL,
  bestaetigt   boolean NOT NULL DEFAULT false,
  erstellt_am  date NOT NULL
);
CREATE INDEX berichtigung_kita ON berichtigung (kita_id, erstellt_am);

CREATE TABLE fehlende_kita (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  strasse      text NOT NULL,
  plz          text NOT NULL,
  ort          text NOT NULL,
  erstellt_am  date NOT NULL
);

-- Replay-Schutz für Proof-of-Work.
CREATE TABLE pow_verwendet (
  nonce   text PRIMARY KEY,
  ablauf  timestamptz NOT NULL
);

-- Ausgehende Mails; nach Versand gelöscht.
CREATE TABLE mail_outbox (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  an                 text NOT NULL,
  betreff            text NOT NULL,
  text               text NOT NULL,
  versuche           smallint NOT NULL DEFAULT 0,
  naechster_versuch  timestamptz NOT NULL DEFAULT now(),
  erstellt           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_faellig ON mail_outbox (naechster_versuch);

-- +goose Down
DROP TABLE mail_outbox, pow_verwendet, fehlende_kita, berichtigung, protokoll, tagesstatus,
  meldung, einladung, melde_link, kontakt_vorschlag, kita_kontakt, kita_zuordnung, kita;
