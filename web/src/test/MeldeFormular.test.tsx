import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeldeFormular } from '../components/MeldeFormular';
import { STANDARD_GRENZEN } from '../lib/meldung';
import { ApiError } from '../api/client';

const HEUTE = '2026-11-18';

function rendern(onSenden = vi.fn().mockResolvedValue(undefined)) {
  render(<MeldeFormular heute={HEUTE} grenzen={STANDARD_GRENZEN} mitPow={false} knopfText="Senden" onSenden={onSenden} />);
  return onSenden;
}

describe('MeldeFormular', () => {
  it('sendet Status und Zeitraum im API-Format', async () => {
    const u = userEvent.setup();
    const onSenden = rendern();
    await u.click(screen.getByLabelText(/Keine Betreuung möglich/));
    await u.click(screen.getByLabelText('Morgen'));
    await u.click(screen.getByLabelText('Streik'));
    await u.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledWith(
      { status: 'geschlossen', datum_von: '2026-11-19', datum_bis: '2026-11-19', uhrzeit_von: null, uhrzeit_bis: null, grund: 'streik' },
      null,
    );
  });

  it('zeigt Uhrzeitfelder nur bei verkürzt/Notbetreuung und prüft sie', async () => {
    const u = userEvent.setup();
    const onSenden = rendern();
    expect(screen.queryByLabelText('Beginn')).toBeNull();
    await u.click(screen.getByLabelText(/Verkürzte Betreuungszeiten/));
    expect(screen.getByLabelText('Beginn')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).not.toHaveBeenCalled();
    expect(screen.getByText(/Beginn und Ende der Betreuung/)).toBeTruthy();
    await u.type(screen.getByLabelText('Beginn'), '08:00');
    await u.type(screen.getByLabelText('Ende'), '12:30');
    await u.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledWith(expect.objectContaining({ status: 'verkuerzt', uhrzeit_von: '08:00', uhrzeit_bis: '12:30', datum_von: HEUTE }), null);
  });

  it('zeigt Fehler des Servers (problem+json) an', async () => {
    const u = userEvent.setup();
    rendern(vi.fn().mockRejectedValue(new ApiError(422, 'Ungültig', 'Bitte prüfen', [{ feld: 'datum_von', meldung: 'Zu weit zurück.' }])));
    await u.click(screen.getByLabelText(/Notbetreuung/));
    await u.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Bitte prüfen')).toBeTruthy();
    expect(screen.getByText('Zu weit zurück.')).toBeTruthy();
  });
});
