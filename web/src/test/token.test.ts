import { describe, expect, it, vi } from 'vitest';
import { tokenAusAdresse, tokenAusHash } from '../lib/token';

const T = 'HOrbF0Hx-2DGBzPI2lcNL_rkGyOgrHxBRo8qpPKWuUs';

describe('Token aus dem URL-Fragment', () => {
  it('liest gültige Tokens', () => {
    expect(tokenAusHash(`#${T}`)).toBe(T);
    expect(tokenAusHash(T)).toBe(T);
  });
  it('verwirft ungültige', () => {
    expect(tokenAusHash('')).toBeNull();
    expect(tokenAusHash('#kurz')).toBeNull();
    expect(tokenAusHash('#<script>alert(1)</script>xxxxxxxxxx')).toBeNull();
  });
  it('entfernt das Fragment aus der Adresszeile', () => {
    const loc = { hash: `#${T}`, pathname: '/m', search: '' } as Location;
    const hist = { state: null, replaceState: vi.fn() } as unknown as History;
    expect(tokenAusAdresse(loc, hist)).toBe(T);
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/m');
  });
  it('lässt die Adresse ohne Fragment unverändert', () => {
    const loc = { hash: '', pathname: '/m', search: '' } as Location;
    const hist = { state: null, replaceState: vi.fn() } as unknown as History;
    expect(tokenAusAdresse(loc, hist)).toBeNull();
    expect(hist.replaceState).not.toHaveBeenCalled();
  });
});
