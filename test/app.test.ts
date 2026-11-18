import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb, type Db } from '../src/db.ts';
import type { Mail, Mailer } from '../src/mailer.ts';
import { erstelleLink, upsertKita, aufraeumen } from '../src/service.ts';
import { STUFE } from '../src/domain.ts';

const JETZT = new Date('2026-11-18T10:00:00+01:00');
const cfg = loadConfig({ altchaCost: 1, altchaCounterMin: 1, altchaCounterMax: 5, dbPath: ':memory:', baseUrl: 'https://test.example' });

class TestMailer implements Mailer {
  gesendet: Mail[] = [];
  async senden(m: Mail) {
    this.gesendet.push(m);
  }
}

let db: Db;
let mailer: TestMailer;
let geraet: string;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  upsertKita(db, { quelle: 'test', quelle_id: '1', name: 'Kita Sonnenschein', plz: '40210', ort: 'Düsseldorf', kontakt_email: 'leitung@kita.example' });
  upsertKita(db, { quelle: 'test', quelle_id: '2', name: 'Kita Ohne Mail', plz: '50667', ort: 'Köln' });
  mailer = new TestMailer();
  geraet = 'geraet-a';
  app = createApp({ cfg, db, mailer, geraet: () => geraet, jetzt: () => JETZT });
});

async function powPayload(): Promise<string> {
  const challenge = await (await app.request('/pow/challenge')).json();
  const solution = await solveChallenge({ challenge, deriveKey });
  assert.ok(solution);
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}

function post(pfad: string, felder: Record<string, string>) {
  return app.request(pfad, { method: 'POST', body: new URLSearchParams(felder), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
}

async function apiStatus(kitaId = 1) {
  const res = await app.request(`/api/v1/kitas/${kitaId}`);
  const json = (await res.json()) as { kita: Record<string, unknown>; tage: { datum: string; status: string; stufe: number }[] };
  return json;
}

test('Startseite und Suche funktionieren', async () => {
  const res = await app.request('/?q=40210');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Kita Sonnenschein/);
  assert.doesNotMatch(text, /Kita Ohne Mail/);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
});

test('anonyme Meldung braucht gültigen Proof-of-Work', async () => {
  const res = await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Sicherheitsprüfung/);
  assert.equal((await apiStatus()).tage[0]!.status, 'unbekannt');
});

test('Proof-of-Work kann nicht wiederverwendet werden', async () => {
  const altcha = await powPayload();
  assert.equal((await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18', altcha })).status, 303);
  assert.equal((await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18', altcha })).status, 400);
});

test('anonyme Meldungen: unbestätigt, dann bestätigt durch zweites Gerät', async () => {
  let res = await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18', datum_bis: '2026-11-19', altcha: await powPayload() });
  assert.equal(res.status, 303);
  let st = await apiStatus();
  assert.equal(st.tage[0]!.status, 'notbetreuung');
  assert.equal(st.tage[0]!.stufe, STUFE.unbestaetigt);
  assert.equal(st.tage[1]!.status, 'notbetreuung');
  assert.equal(st.tage[2]!.status, 'unbekannt');

  // Gleiches Gerät erneut: bleibt unbestätigt
  await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18', altcha: await powPayload() });
  assert.equal((await apiStatus()).tage[0]!.stufe, STUFE.unbestaetigt);

  geraet = 'geraet-b';
  res = await post('/kita/1/meldung', { status: 'notbetreuung', datum_von: '2026-11-18', altcha: await powPayload() });
  assert.equal(res.status, 303);
  st = await apiStatus();
  assert.equal(st.tage[0]!.stufe, STUFE.bestaetigt);

  const html = await (await app.request('/kita/1')).text();
  assert.match(html, /von mehreren Eltern bestätigt/);
  assert.match(html, /Änderungsprotokoll/);
});

test('es werden keine Gerätedaten im Klartext gespeichert', async () => {
  geraet = '203.0.113.7\nMozilla/5.0';
  await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-11-18', altcha: await powPayload() });
  const row = db.prepare('SELECT * FROM meldungen').get() as Record<string, unknown>;
  assert.ok(!JSON.stringify(row).includes('203.0.113.7'));
  assert.equal(row.erstellt_am, '2026-11-18');
  assert.equal(typeof row.melder_hash, 'string');
});

test('Rate-Limit pro Gerät, Kita und Tag', async () => {
  for (let i = 0; i < cfg.maxMeldungenProTag; i++) {
    assert.equal((await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-11-18', altcha: await powPayload() })).status, 303);
  }
  assert.equal((await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-11-18', altcha: await powPayload() })).status, 429);
});

test('Validierung: verkürzte Zeiten brauchen Uhrzeiten, Zeitraum begrenzt', async () => {
  let res = await post('/kita/1/meldung', { status: 'verkuerzt', datum_von: '2026-11-18', altcha: await powPayload() });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Beginn und Ende/);
  res = await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-11-18', datum_bis: '2027-03-01', altcha: await powPayload() });
  assert.equal(res.status, 400);
  res = await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-10-01', altcha: await powPayload() });
  assert.equal(res.status, 400);
});

test('Elternbeirat-Link: verifizierte Meldung ohne Proof-of-Work', async () => {
  const link = erstelleLink(db, 1, 'elternbeirat', undefined, JETZT);
  assert.equal(link.gueltig_bis, '2027-07-31');
  assert.equal((await app.request(`/m/${link.token}`)).status, 200);
  const res = await post(`/m/${link.token}`, { status: 'verkuerzt', datum_von: '2026-11-18', uhrzeit_von: '08:00', uhrzeit_bis: '13:00' });
  assert.equal(res.status, 303);
  const st = await apiStatus();
  assert.equal(st.tage[0]!.status, 'verkuerzt');
  assert.equal(st.tage[0]!.stufe, STUFE.elternbeirat);
  assert.equal((await app.request('/m/falsches-token')).status, 404);
});

test('widerrufener oder abgelaufener Link funktioniert nicht', async () => {
  const abgelaufen = erstelleLink(db, 1, 'kita', '2026-11-17', JETZT);
  assert.equal((await app.request(`/m/${abgelaufen.token}`)).status, 404);
  const link = erstelleLink(db, 1, 'kita', undefined, JETZT);
  db.prepare('UPDATE links SET widerrufen = 1 WHERE id = ?').run(link.id);
  assert.equal((await post(`/m/${link.token}`, { status: 'geschlossen', datum_von: '2026-11-18' })).status, 404);
});

test('Berichtigung: Mail an öffentliche Kita-Adresse, Bestätigung per POST überschreibt alles', async () => {
  const link = erstelleLink(db, 1, 'elternbeirat', undefined, JETZT);
  await post(`/m/${link.token}`, { status: 'geschlossen', datum_von: '2026-11-18' });

  let res = await post('/kita/1/berichtigung', { status: 'notbetreuung', datum_von: '2026-11-18', altcha: await powPayload() });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /l\*\*\*@kita\.example/);
  assert.equal(mailer.gesendet.length, 1);
  assert.equal(mailer.gesendet[0]!.an, 'leitung@kita.example');
  const url = /https:\/\/test\.example(\/berichtigung\/\S+)/.exec(mailer.gesendet[0]!.text)![1]!;

  // GET allein ändert nichts (Link-Scanner in Mailprogrammen)
  assert.equal((await app.request(url)).status, 200);
  assert.equal((await apiStatus()).tage[0]!.status, 'geschlossen');

  res = await app.request(url, { method: 'POST' });
  assert.equal(res.status, 303);
  const st = await apiStatus();
  assert.equal(st.tage[0]!.status, 'notbetreuung');
  assert.equal(st.tage[0]!.stufe, STUFE.berichtigung);

  // Token nur einmal verwendbar
  assert.equal((await app.request(url, { method: 'POST' })).status, 404);
});

test('Berichtigung ohne bekannte Kita-Adresse verweist auf Kontakt', async () => {
  const res = await app.request('/kita/2/berichtigung');
  assert.match(await res.text(), /keine öffentliche E-Mail-Adresse/);
  assert.equal((await post('/kita/2/berichtigung', { status: 'regulaer', datum_von: '2026-11-18' })).status, 400);
  assert.equal(mailer.gesendet.length, 0);
});

test('öffentliche API gibt keine Kontaktadressen heraus', async () => {
  const st = await apiStatus();
  assert.equal('kontakt_email' in st.kita, false);
});

test('Aufräumen löscht alte Einzelmeldungen, behält das Protokoll', async () => {
  await post('/kita/1/meldung', { status: 'geschlossen', datum_von: '2026-11-18', altcha: await powPayload() });
  const spaeter = new Date('2027-07-01T10:00:00Z');
  const r = aufraeumen(db, cfg, spaeter);
  assert.equal(r.meldungen, 1);
  const prot = db.prepare('SELECT COUNT(*) AS n FROM protokoll').get() as { n: number };
  assert.equal(prot.n, 1);
});

test('statische Dateien inkl. ALTCHA-Widget werden selbst ausgeliefert', async () => {
  const res = await app.request('/static/altcha.js');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).length > 10_000);
});
