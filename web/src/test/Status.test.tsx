import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBadge, anzeigeFuer } from '../components/Status';
import { AnsichtUmschalter } from '../components/AnsichtUmschalter';
import { _zuruecksetzen } from '../lib/einstellungen';
import type { TagesStatus } from '../api/client';

const ohne: TagesStatus = { datum: '2026-11-18', status: 'unbekannt', stufe: 0, uhrzeit_von: null, uhrzeit_bis: null, grund: null, anzahl: 0 };
const not: TagesStatus = { ...ohne, status: 'notbetreuung', stufe: 10, anzahl: 1 };

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
        <StatusBadge s={ohne} />
        <StatusBadge s={not} />
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

  it('ändert nur „unbekannt“', () => {
    expect(anzeigeFuer(ohne, true)).toEqual({ status: 'regulaer', angenommen: true });
    expect(anzeigeFuer(not, true)).toEqual({ status: 'notbetreuung', angenommen: false });
    expect(anzeigeFuer(ohne, false)).toEqual({ status: 'unbekannt', angenommen: false });
  });
});
