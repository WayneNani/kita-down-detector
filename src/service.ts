import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Grund, LinkRolle, Quelle, Status } from './domain.ts';
import { GRUND, MAX_TAGE_VORAUS, MAX_TAGE_ZURUECK, MAX_ZEITRAUM_TAGE, STATUS } from './domain.ts';
import { endeKitaJahr, heute, istDatum, istUhrzeit, plusTage, tageImBereich, tageZwischen } from './dates.ts';
import { berechneTagesStatus, type Meldung, type TagesStatus } from './status.ts';
import { neuesToken, tokenHash } from './privacy.ts';

export interface Kita {
  id: number;
  quelle: string;
  quelle_id: string;
  name: string;
  traeger: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  lat: number | null;
  lon: number | null;
  kontakt_email: string | null;
}

export interface MeldungInput {
  status: Status;
  datum_von: string;
  datum_bis: string;
  uhrzeit_von: string | null;
  uhrzeit_bis: string | null;
  grund: Grund | null;
}

// ---------------------------------------------------------------- Kitas

export function getKita(db: Db, id: number): Kita | undefined {
  return db.prepare('SELECT * FROM kitas WHERE id = ?').get(id) as Kita | undefined;
}

export function sucheKitas(db: Db, q: string, limit = 50): Kita[] {
  const begriff = q.trim();
  if (begriff.length < 2) return [];
  if (/^\d{5}$/.test(begriff)) {
    return db.prepare('SELECT * FROM kitas WHERE plz = ? ORDER BY name LIMIT ?').all(begriff, limit) as unknown as Kita[];
  }
  const like = `%${begriff.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT * FROM kitas
       WHERE name LIKE ?1 ESCAPE '\\' OR ort LIKE ?1 ESCAPE '\\' OR strasse LIKE ?1 ESCAPE '\\' OR traeger LIKE ?1 ESCAPE '\\'
       ORDER BY name LIMIT ?2`,
    )
    .all(like, limit) as unknown as Kita[];
}

export interface KitaImport {
  quelle: string;
  quelle_id: string;
  name: string;
  traeger?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  lat?: number | null;
  lon?: number | null;
  kontakt_email?: string | null;
}

export function upsertKita(db: Db, k: KitaImport): void {
  db.prepare(
    `INSERT INTO kitas (quelle, quelle_id, name, traeger, strasse, plz, ort, lat, lon, kontakt_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (quelle, quelle_id) DO UPDATE SET
       name = excluded.name, traeger = excluded.traeger, strasse = excluded.strasse,
       plz = excluded.plz, ort = excluded.ort, lat = excluded.lat, lon = excluded.lon,
       kontakt_email = excluded.kontakt_email`,
  ).run(
    k.quelle,
    k.quelle_id,
    k.name,
    k.traeger ?? null,
    k.strasse ?? null,
    k.plz ?? null,
    k.ort ?? null,
    k.lat ?? null,
    k.lon ?? null,
    k.kontakt_email ?? null,
  );
}

// ---------------------------------------------------------------- Validierung

export type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function pruefeMeldung(form: Record<string, unknown>, jetzt: Date = new Date()): Ergebnis<MeldungInput> {
  const fehler: string[] = [];
  const status = str(form.status) as Status;
  const datum_von = str(form.datum_von);
  const datum_bis = str(form.datum_bis) || datum_von;
  let uhrzeit_von: string | null = str(form.uhrzeit_von) || null;
  let uhrzeit_bis: string | null = str(form.uhrzeit_bis) || null;
  const grundRoh = str(form.grund);
  const grund = grundRoh ? (grundRoh as Grund) : null;

  if (!STATUS.includes(status)) fehler.push('Bitte einen Status auswählen.');
  if (grund !== null && !GRUND.includes(grund)) fehler.push('Ungültiger Grund.');

  const t = heute(jetzt);
  if (!istDatum(datum_von) || !istDatum(datum_bis)) {
    fehler.push('Bitte ein gültiges Datum angeben.');
  } else {
    if (datum_bis < datum_von) fehler.push('Das Enddatum liegt vor dem Startdatum.');
    if (tageZwischen(datum_von, datum_bis) >= MAX_ZEITRAUM_TAGE) {
      fehler.push(`Ein Zeitraum darf höchstens ${MAX_ZEITRAUM_TAGE} Tage umfassen.`);
    }
    if (datum_von < plusTage(t, -MAX_TAGE_ZURUECK)) {
      fehler.push(`Meldungen sind höchstens ${MAX_TAGE_ZURUECK} Tage rückwirkend möglich.`);
    }
    if (datum_bis > plusTage(t, MAX_TAGE_VORAUS)) {
      fehler.push(`Meldungen sind höchstens ${MAX_TAGE_VORAUS} Tage im Voraus möglich.`);
    }
  }

  if (status === 'verkuerzt') {
    if (!uhrzeit_von || !uhrzeit_bis || !istUhrzeit(uhrzeit_von) || !istUhrzeit(uhrzeit_bis)) {
      fehler.push('Bei verkürzten Betreuungszeiten bitte Beginn und Ende der Betreuung angeben.');
    } else if (uhrzeit_bis <= uhrzeit_von) {
      fehler.push('Das Betreuungsende liegt vor dem Beginn.');
    }
  } else if (status === 'notbetreuung') {
    // Uhrzeiten optional, aber wenn angegeben, dann gültig.
    if ((uhrzeit_von && !istUhrzeit(uhrzeit_von)) || (uhrzeit_bis && !istUhrzeit(uhrzeit_bis))) {
      fehler.push('Ungültige Uhrzeit.');
    }
  } else {
    uhrzeit_von = null;
    uhrzeit_bis = null;
  }

  if (fehler.length) return { ok: false, fehler };
  return { ok: true, wert: { status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund } };
}

// ---------------------------------------------------------------- Status

function meldungenImZeitraum(db: Db, kitaId: number, von: string, bis: string): Meldung[] {
  return db
    .prepare('SELECT * FROM meldungen WHERE kita_id = ? AND datum_von <= ? AND datum_bis >= ? ORDER BY id')
    .all(kitaId, bis, von) as unknown as Meldung[];
}

export function statusVerlauf(db: Db, cfg: Config, kitaId: number, von: string, bis: string): TagesStatus[] {
  const meldungen = meldungenImZeitraum(db, kitaId, von, bis);
  return tageImBereich(von, bis).map((d) => berechneTagesStatus(meldungen, d, cfg.bestaetigungsSchwelle));
}

export interface KitaMitStatus {
  kita: Kita;
  status: TagesStatus;
}

/** Alle Kitas mit gemeldetem Status an einem Tag (ohne „regulär“). */
export function einschraenkungenAm(db: Db, cfg: Config, datum: string): KitaMitStatus[] {
  const rows = db
    .prepare('SELECT * FROM meldungen WHERE datum_von <= ?1 AND datum_bis >= ?1 ORDER BY id')
    .all(datum) as unknown as Meldung[];
  const proKita = new Map<number, Meldung[]>();
  for (const m of rows) {
    const l = proKita.get(m.kita_id) ?? [];
    l.push(m);
    proKita.set(m.kita_id, l);
  }
  const out: KitaMitStatus[] = [];
  for (const [kitaId, ms] of proKita) {
    const status = berechneTagesStatus(ms, datum, cfg.bestaetigungsSchwelle);
    if (status.status === 'unbekannt' || status.status === 'regulaer') continue;
    const kita = getKita(db, kitaId);
    if (kita) out.push({ kita, status });
  }
  const rang = { geschlossen: 0, notbetreuung: 1, verkuerzt: 2 } as Record<string, number>;
  return out.sort((a, b) => (rang[a.status.status] ?? 9) - (rang[b.status.status] ?? 9) || a.kita.name.localeCompare(b.kita.name, 'de'));
}

/** Status für eine Liste von Kitas an einem Tag (für Suchergebnisse). */
export function statusFuerKitas(db: Db, cfg: Config, kitaIds: number[], datum: string): Map<number, TagesStatus> {
  const out = new Map<number, TagesStatus>();
  for (const id of kitaIds) {
    out.set(id, statusVerlauf(db, cfg, id, datum, datum)[0]!);
  }
  return out;
}

// ---------------------------------------------------------------- Meldungen speichern

export interface SpeicherOptionen {
  quelle: Quelle;
  melderHash?: string | null;
  linkId?: number | null;
  jetzt?: Date;
}

/** Wie viele anonyme Meldungen hat dieses Gerät heute für diese Kita abgegeben? */
export function meldungenHeute(db: Db, kitaId: number, melderHash: string, jetzt: Date = new Date()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM meldungen WHERE kita_id = ? AND melder_hash = ? AND erstellt_am = ?')
    .get(kitaId, melderHash, heute(jetzt)) as { n: number };
  return row.n;
}

/**
 * Speichert eine Meldung und protokolliert, an welchen Tagen sich dadurch der
 * angezeigte Status geändert hat.
 */
export function speichereMeldung(db: Db, cfg: Config, kitaId: number, m: MeldungInput, opt: SpeicherOptionen): number {
  const erstellt = heute(opt.jetzt);
  db.exec('BEGIN IMMEDIATE');
  try {
    const vorher = statusVerlauf(db, cfg, kitaId, m.datum_von, m.datum_bis);
    const res = db
      .prepare(
        `INSERT INTO meldungen (kita_id, status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund, quelle, melder_hash, link_id, erstellt_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        kitaId,
        m.status,
        m.datum_von,
        m.datum_bis,
        m.uhrzeit_von,
        m.uhrzeit_bis,
        m.grund,
        opt.quelle,
        opt.melderHash ?? null,
        opt.linkId ?? null,
        erstellt,
      );
    const nachher = statusVerlauf(db, cfg, kitaId, m.datum_von, m.datum_bis);
    const prot = db.prepare(
      'INSERT INTO protokoll (kita_id, datum, alt_status, neu_status, neu_stufe, erstellt_am) VALUES (?, ?, ?, ?, ?, ?)',
    );
    nachher.forEach((n, i) => {
      const v = vorher[i]!;
      if (v.status !== n.status || v.stufe !== n.stufe) {
        prot.run(kitaId, n.datum, v.status, n.status, n.stufe, erstellt);
      }
    });
    db.exec('COMMIT');
    return Number(res.lastInsertRowid);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export interface ProtokollEintrag {
  datum: string;
  alt_status: string;
  neu_status: string;
  neu_stufe: number;
  erstellt_am: string;
}

export function protokoll(db: Db, kitaId: number, limit = 30): ProtokollEintrag[] {
  return db
    .prepare('SELECT datum, alt_status, neu_status, neu_stufe, erstellt_am FROM protokoll WHERE kita_id = ? ORDER BY id DESC LIMIT ?')
    .all(kitaId, limit) as unknown as ProtokollEintrag[];
}

// ---------------------------------------------------------------- Links

export interface Link {
  id: number;
  kita_id: number;
  rolle: LinkRolle;
  gueltig_bis: string;
  widerrufen: number;
}

export function erstelleLink(db: Db, kitaId: number, rolle: LinkRolle, gueltigBis?: string, jetzt: Date = new Date()): { id: number; token: string; gueltig_bis: string } {
  const token = neuesToken();
  const t = heute(jetzt);
  const bis = gueltigBis ?? endeKitaJahr(t);
  const res = db
    .prepare('INSERT INTO links (kita_id, rolle, token_hash, gueltig_bis, erstellt_am) VALUES (?, ?, ?, ?, ?)')
    .run(kitaId, rolle, tokenHash(token), bis, t);
  return { id: Number(res.lastInsertRowid), token, gueltig_bis: bis };
}

export function findeLink(db: Db, token: string, jetzt: Date = new Date()): Link | undefined {
  const link = db
    .prepare('SELECT id, kita_id, rolle, gueltig_bis, widerrufen FROM links WHERE token_hash = ?')
    .get(tokenHash(token)) as Link | undefined;
  if (!link || link.widerrufen || link.gueltig_bis < heute(jetzt)) return undefined;
  return link;
}

export function widerrufeLinks(db: Db, kitaId: number, rolle?: LinkRolle): number {
  const res = rolle
    ? db.prepare('UPDATE links SET widerrufen = 1 WHERE kita_id = ? AND rolle = ?').run(kitaId, rolle)
    : db.prepare('UPDATE links SET widerrufen = 1 WHERE kita_id = ?').run(kitaId);
  return Number(res.changes);
}

// ---------------------------------------------------------------- Berichtigungen

export const BERICHTIGUNG_GUELTIG_TAGE = 7;

export function erstelleBerichtigung(db: Db, kitaId: number, m: MeldungInput, jetzt: Date = new Date()): string {
  const token = neuesToken();
  const t = heute(jetzt);
  db.prepare(
    `INSERT INTO berichtigungen (kita_id, status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund, token_hash, ablauf, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(kitaId, m.status, m.datum_von, m.datum_bis, m.uhrzeit_von, m.uhrzeit_bis, m.grund, tokenHash(token), plusTage(t, BERICHTIGUNG_GUELTIG_TAGE), t);
  return token;
}

export interface Berichtigung extends MeldungInput {
  id: number;
  kita_id: number;
  bestaetigt: number;
  ablauf: string;
}

export function findeBerichtigung(db: Db, token: string, jetzt: Date = new Date()): Berichtigung | undefined {
  const b = db.prepare('SELECT * FROM berichtigungen WHERE token_hash = ?').get(tokenHash(token)) as Berichtigung | undefined;
  if (!b || b.bestaetigt || b.ablauf < heute(jetzt)) return undefined;
  return b;
}

export function bestaetigeBerichtigung(db: Db, cfg: Config, b: Berichtigung, jetzt: Date = new Date()): void {
  const upd = db.prepare('UPDATE berichtigungen SET bestaetigt = 1 WHERE id = ? AND bestaetigt = 0').run(b.id);
  if (Number(upd.changes) !== 1) return; // bereits bestätigt (Doppelklick)
  speichereMeldung(db, cfg, b.kita_id, b, { quelle: 'kita_berichtigung', jetzt });
}

// ---------------------------------------------------------------- Aufräumen

export interface AufraeumErgebnis {
  meldungen: number;
  berichtigungen: number;
  links: number;
}

/**
 * Löscht Einzelmeldungen nach Ablauf der Aufbewahrungsfrist. Das öffentliche
 * Protokoll (aggregierter Status je Tag) bleibt für Auswertungen erhalten.
 */
export function aufraeumen(db: Db, cfg: Config, jetzt: Date = new Date()): AufraeumErgebnis {
  const t = heute(jetzt);
  const grenze = plusTage(t, -cfg.aufbewahrungTage);
  const meldungen = Number(db.prepare('DELETE FROM meldungen WHERE datum_bis < ?').run(grenze).changes);
  const berichtigungen = Number(
    db.prepare('DELETE FROM berichtigungen WHERE ablauf < ? OR (bestaetigt = 1 AND erstellt_am < ?)').run(t, plusTage(t, -30)).changes,
  );
  const links = Number(
    db.prepare('DELETE FROM links WHERE (gueltig_bis < ? OR widerrufen = 1) AND id NOT IN (SELECT link_id FROM meldungen WHERE link_id IS NOT NULL)').run(t).changes,
  );
  return { meldungen, berichtigungen, links };
}
