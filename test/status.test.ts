import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneTagesStatus, type Meldung } from '../src/status.ts';
import { STUFE } from '../src/domain.ts';

let id = 0;
function m(teil: Partial<Meldung>): Meldung {
  return {
    id: ++id,
    kita_id: 1,
    status: 'notbetreuung',
    datum_von: '2026-11-18',
    datum_bis: '2026-11-18',
    uhrzeit_von: null,
    uhrzeit_bis: null,
    grund: null,
    quelle: 'anonym',
    melder_hash: `h${id}`,
    ...teil,
  };
}

const TAG = '2026-11-18';

test('ohne Meldungen ist der Status unbekannt', () => {
  const s = berechneTagesStatus([], TAG, 2);
  assert.equal(s.status, 'unbekannt');
  assert.equal(s.stufe, STUFE.keine);
});

test('Meldungen außerhalb des Zeitraums zählen nicht', () => {
  const s = berechneTagesStatus([m({ datum_von: '2026-11-19', datum_bis: '2026-11-20' })], TAG, 2);
  assert.equal(s.status, 'unbekannt');
});

test('eine anonyme Meldung ist unbestätigt', () => {
  const s = berechneTagesStatus([m({})], TAG, 2);
  assert.equal(s.status, 'notbetreuung');
  assert.equal(s.stufe, STUFE.unbestaetigt);
  assert.equal(s.anzahl, 1);
});

test('zwei unabhängige anonyme Meldungen bestätigen den Status', () => {
  const s = berechneTagesStatus([m({}), m({})], TAG, 2);
  assert.equal(s.stufe, STUFE.bestaetigt);
  assert.equal(s.anzahl, 2);
});

test('mehrere Meldungen desselben Geräts zählen nur einmal', () => {
  const s = berechneTagesStatus([m({ melder_hash: 'x' }), m({ melder_hash: 'x' })], TAG, 2);
  assert.equal(s.stufe, STUFE.unbestaetigt);
});

test('bei widersprüchlichen anonymen Meldungen gewinnt die Mehrheit', () => {
  const s = berechneTagesStatus([m({ status: 'geschlossen' }), m({ status: 'geschlossen' }), m({ status: 'regulaer' })], TAG, 2);
  assert.equal(s.status, 'geschlossen');
});

test('bei Gleichstand gewinnt die neueste Meldung', () => {
  const s = berechneTagesStatus([m({ status: 'geschlossen' }), m({ status: 'verkuerzt', uhrzeit_von: '08:00', uhrzeit_bis: '12:00' })], TAG, 2);
  assert.equal(s.status, 'verkuerzt');
  assert.equal(s.uhrzeit_bis, '12:00');
});

test('Elternbeirat schlägt bestätigte anonyme Meldungen', () => {
  const s = berechneTagesStatus([m({ quelle: 'elternbeirat', status: 'verkuerzt' }), m({}), m({}), m({})], TAG, 2);
  assert.equal(s.status, 'verkuerzt');
  assert.equal(s.stufe, STUFE.elternbeirat);
});

test('Kita schlägt Elternbeirat, Berichtigung schlägt alles', () => {
  const eb = m({ quelle: 'elternbeirat', status: 'geschlossen' });
  const kita = m({ quelle: 'kita', status: 'notbetreuung' });
  assert.equal(berechneTagesStatus([kita, eb], TAG, 2).stufe, STUFE.kita);
  const ber = m({ quelle: 'kita_berichtigung', status: 'regulaer' });
  const neuerEb = m({ quelle: 'elternbeirat', status: 'geschlossen' });
  const s = berechneTagesStatus([ber, kita, neuerEb], TAG, 2);
  assert.equal(s.status, 'regulaer');
  assert.equal(s.stufe, STUFE.berichtigung);
});

test('bei gleicher Stufe gewinnt die neueste verifizierte Meldung', () => {
  const s = berechneTagesStatus([m({ quelle: 'elternbeirat', status: 'geschlossen' }), m({ quelle: 'elternbeirat', status: 'regulaer' })], TAG, 2);
  assert.equal(s.status, 'regulaer');
});
