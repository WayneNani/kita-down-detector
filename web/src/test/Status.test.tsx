import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBadge, anzeigeFuer } from '../components/Status';
import { AnsichtUmschalter } from '../components/AnsichtUmschalter';
import { _zuruecksetzen, useOhneMeldungAlsRegulaer } from '../lib/einstellungen';
import { feiertageNRW, istRegulaerGeschlossen, ostersonntag } from '../lib/feiertage';
import type { TagesStatus } from '../api/client';

const ohne: TagesStatus = { datum: '2026-11-18', status: 'unbekannt', stufe: 0, uhrzeit_von: null, uhrzeit_bis: null, grund: null, anzahl: 0 };
const not: TagesStatus = { ...ohne, status: 'notbetreuung', stufe: 10, anzahl: 1 };

function Mit() {
  const [annahme] = useOhneMeldungAlsRegulaer();
  return (
    <>
      <StatusBadge s={ohne} annahme={annahme} />
      <StatusBadge s={not} annahme={annahme} />
    </>
  );
}

describe('Ansicht „Tage ohne Meldung als regulär“', () => {
  beforeEach(() => {
    localStorage.clear();
    _zuruecksetzen();
  });

  it('ist standardmäßig aus', () => {
    render(<StatusBadge s={ohne} />);
    expect(screen.getByText('Keine Meldung')).toBeTruthy();
  });

  it('zeigt nach dem Einschalten „vermutlich regulär“ und merkt sich das lokal', async () => {
    render(
      <>
        <AnsichtUmschalter />
        <Mit />
      </>,
    );
    const schalter = screen.getByRole('switch');
    expect((schalter as HTMLInputElement).checked).toBe(false);
    await userEvent.click(schalter);
    expect(screen.getByText('Vermutlich regulär (keine Meldung)')).toBeTruthy();
    // Gemeldete Status bleiben unverändert
    expect(screen.getByText('Notbetreuung')).toBeTruthy();
    expect(localStorage.getItem('kita-ausfall:ohne-meldung-als-regulaer')).toBe('1');
    await userEvent.click(schalter);
    expect(screen.getByText('Keine Meldung')).toBeTruthy();
    expect(localStorage.getItem('kita-ausfall:ohne-meldung-als-regulaer')).toBeNull();
  });

  it('nimmt an Wochenenden und Feiertagen nichts an', () => {
    expect(anzeigeFuer({ ...ohne, datum: '2026-11-21' }, true).angenommen).toBe(false); // Samstag
    expect(anzeigeFuer({ ...ohne, datum: '2026-12-25' }, true).angenommen).toBe(false); // 1. Weihnachtstag
    expect(anzeigeFuer({ ...ohne, datum: '2026-06-04' }, true).angenommen).toBe(false); // Fronleichnam
  });

  it('kennt die beweglichen NRW-Feiertage', () => {
    expect(ostersonntag(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(ostersonntag(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    const f = feiertageNRW(2026);
    for (const d of ['2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2026-10-03', '2026-11-01']) expect(f.has(d)).toBe(true);
    expect(istRegulaerGeschlossen('2026-11-18')).toBe(false);
  });

  it('ändert nur „unbekannt“', () => {
    expect(anzeigeFuer(ohne, true)).toEqual({ status: 'regulaer', angenommen: true });
    expect(anzeigeFuer(not, true)).toEqual({ status: 'notbetreuung', angenommen: false });
    expect(anzeigeFuer(ohne, false)).toEqual({ status: 'unbekannt', angenommen: false });
  });
});
