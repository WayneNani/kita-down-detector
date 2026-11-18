import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Stammdaten aus öffentlichen Quellen (OSM, Open Data der Kommunen).
CREATE TABLE IF NOT EXISTS kitas (
  id            INTEGER PRIMARY KEY,
  quelle        TEXT NOT NULL,
  quelle_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  traeger       TEXT,
  strasse       TEXT,
  plz           TEXT,
  ort           TEXT,
  lat           REAL,
  lon           REAL,
  -- nur öffentlich bekannte Funktionsadresse der Einrichtung, für Berichtigungen
  kontakt_email TEXT,
  UNIQUE (quelle, quelle_id)
);
CREATE INDEX IF NOT EXISTS kitas_plz ON kitas (plz);
CREATE INDEX IF NOT EXISTS kitas_ort ON kitas (ort);

-- Personalisierte Links (pro Kita und Rolle, nicht pro Person).
CREATE TABLE IF NOT EXISTS links (
  id           INTEGER PRIMARY KEY,
  kita_id      INTEGER NOT NULL REFERENCES kitas (id) ON DELETE CASCADE,
  rolle        TEXT NOT NULL CHECK (rolle IN ('elternbeirat', 'kita')),
  token_hash   TEXT NOT NULL UNIQUE,
  gueltig_bis  TEXT NOT NULL,
  widerrufen   INTEGER NOT NULL DEFAULT 0,
  erstellt_am  TEXT NOT NULL
);

-- Einzelmeldungen. Keine IP, keine Uhrzeit, kein Freitext.
CREATE TABLE IF NOT EXISTS meldungen (
  id           INTEGER PRIMARY KEY,
  kita_id      INTEGER NOT NULL REFERENCES kitas (id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('regulaer', 'verkuerzt', 'notbetreuung', 'geschlossen')),
  datum_von    TEXT NOT NULL,
  datum_bis    TEXT NOT NULL,
  uhrzeit_von  TEXT,
  uhrzeit_bis  TEXT,
  grund        TEXT CHECK (grund IN ('personalmangel', 'krankheitswelle', 'streik', 'schliesstag', 'sonstiges')),
  quelle       TEXT NOT NULL CHECK (quelle IN ('anonym', 'elternbeirat', 'kita', 'kita_berichtigung')),
  -- HMAC(Tagesgeheimnis, Gerät + Kita); das Tagesgeheimnis existiert nur im Arbeitsspeicher
  melder_hash  TEXT,
  link_id      INTEGER REFERENCES links (id) ON DELETE SET NULL,
  erstellt_am  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meldungen_kita_zeitraum ON meldungen (kita_id, datum_von, datum_bis);
CREATE INDEX IF NOT EXISTS meldungen_zeitraum ON meldungen (datum_von, datum_bis);

-- Berichtigungsanfragen von Kitas, bestätigt über die öffentliche Kita-Adresse.
CREATE TABLE IF NOT EXISTS berichtigungen (
  id           INTEGER PRIMARY KEY,
  kita_id      INTEGER NOT NULL REFERENCES kitas (id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  datum_von    TEXT NOT NULL,
  datum_bis    TEXT NOT NULL,
  uhrzeit_von  TEXT,
  uhrzeit_bis  TEXT,
  grund        TEXT,
  token_hash   TEXT NOT NULL UNIQUE,
  ablauf       TEXT NOT NULL,
  bestaetigt   INTEGER NOT NULL DEFAULT 0,
  erstellt_am  TEXT NOT NULL
);

-- Öffentliches Änderungsprotokoll des angezeigten Status (ohne Melderdaten).
CREATE TABLE IF NOT EXISTS protokoll (
  id           INTEGER PRIMARY KEY,
  kita_id      INTEGER NOT NULL REFERENCES kitas (id) ON DELETE CASCADE,
  datum        TEXT NOT NULL,
  alt_status   TEXT NOT NULL,
  neu_status   TEXT NOT NULL,
  neu_stufe    INTEGER NOT NULL,
  erstellt_am  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS protokoll_kita ON protokoll (kita_id, id);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export type Db = DatabaseSync;
