import { describe, expect, it } from 'vitest';
import { baueMeldung, LEERER_ZUSTAND, zeitraumDaten, zeigtUhrzeiten, type FormZustand } from '../lib/meldung';

const HEUTE = '2026-11-18';
const z = (teil: Partial<FormZustand>): FormZustand => ({ ...LEERER_ZUSTAND, ...teil });

describe('Zeitraum-Chips', () => {
  it('Heute', () => expect(zeitraumDaten(z({ zeitraum: 'heute' }), HEUTE)).toEqual({ von: HEUTE, bis: HEUTE }));
  it('Morgen', () => expect(zeitraumDaten(z({ zeitraum: 'morgen' }), HEUTE)).toEqual({ von: '2026-11-19', bis: '2026-11-19' }));
  it('Heute + morgen', () => expect(zeitraumDaten(z({ zeitraum: 'heute_morgen' }), HEUTE)).toEqual({ von: HEUTE, bis: '2026-11-19' }));
  it('Monatswechsel', () => expect(zeitraumDaten(z({ zeitraum: 'morgen' }), '2026-11-30')).toEqual({ von: '2026-12-01', bis: '2026-12-01' }));
  it('Anderer Zeitraum ohne Bis-Datum = ein Tag', () =>
    expect(zeitraumDaten(z({ zeitraum: 'anders', datumVon: '2026-11-20' }), HEUTE)).toEqual({ von: '2026-11-20', bis: '2026-11-20' }));
});

describe('baueMeldung', () => {
  it('verlangt einen Status', () => {
    const e = baueMeldung(z({}), HEUTE);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.fehler[0]?.feld).toBe('status');
  });

  it('baut die Meldung im API-Format', () => {
    const e = baueMeldung(z({ status: 'geschlossen', zeitraum: 'heute_morgen', grund: 'streik' }), HEUTE);
    expect(e).toEqual({
      ok: true,
      meldung: { status: 'geschlossen', datum_von: HEUTE, datum_bis: '2026-11-19', uhrzeit_von: null, uhrzeit_bis: null, grund: 'streik' },
    });
  });

  it('verkürzte Zeiten brauchen Beginn und Ende', () => {
    expect(baueMeldung(z({ status: 'verkuerzt' }), HEUTE).ok).toBe(false);
    expect(baueMeldung(z({ status: 'verkuerzt', uhrzeitVon: '08:00' }), HEUTE).ok).toBe(false);
    const e = baueMeldung(z({ status: 'verkuerzt', uhrzeitVon: '08:00', uhrzeitBis: '12:30' }), HEUTE);
    expect(e.ok && e.meldung).toMatchObject({ uhrzeit_von: '08:00', uhrzeit_bis: '12:30', grund: null });
  });

  it('Ende vor Beginn ist ein Fehler', () => {
    const e = baueMeldung(z({ status: 'verkuerzt', uhrzeitVon: '12:00', uhrzeitBis: '08:00' }), HEUTE);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.fehler[0]?.feld).toBe('uhrzeit_bis');
  });

  it('Notbetreuung: Uhrzeiten optional, aber nur beide oder keine', () => {
    expect(baueMeldung(z({ status: 'notbetreuung' }), HEUTE).ok).toBe(true);
    expect(baueMeldung(z({ status: 'notbetreuung', uhrzeitVon: '08:00' }), HEUTE).ok).toBe(false);
    expect(baueMeldung(z({ status: 'notbetreuung', uhrzeitVon: '08:00', uhrzeitBis: '14:00' }), HEUTE).ok).toBe(true);
  });

  it('Uhrzeiten bei regulär/geschlossen werden verworfen', () => {
    const e = baueMeldung(z({ status: 'regulaer', uhrzeitVon: '08:00', uhrzeitBis: '12:00' }), HEUTE);
    expect(e.ok && e.meldung.uhrzeit_von).toBeNull();
    expect(zeigtUhrzeiten('regulaer')).toBe(false);
  });

  it('prüft Grenzen: rückwirkend, Vorlauf, Länge', () => {
    const g = { max_tage_zurueck: 7, max_tage_voraus: 90, max_zeitraum_tage: 31 };
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2026-11-10' }), HEUTE, g).ok).toBe(false);
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2026-11-11' }), HEUTE, g).ok).toBe(true);
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2027-02-17' }), HEUTE, g).ok).toBe(false);
    // 31 Tage inklusive sind erlaubt, 32 nicht
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2026-12-01', datumBis: '2026-12-31' }), HEUTE, g).ok).toBe(true);
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2026-12-01', datumBis: '2027-01-01' }), HEUTE, g).ok).toBe(false);
    expect(baueMeldung(z({ status: 'geschlossen', zeitraum: 'anders', datumVon: '2026-12-05', datumBis: '2026-12-01' }), HEUTE, g).ok).toBe(false);
  });
});
