import { lokalerWert } from './lokalerSpeicher';

/**
 * Ansichts-Einstellung „Tage ohne Meldung als reguläre Betreuung anzeigen“.
 * Nur auf diesem Gerät gespeichert, ändert ausschließlich die Darstellung.
 * Standard: aus.
 */
const ohneMeldungAlsRegulaer = lokalerWert<boolean>(
  'kita-ausfall:ohne-meldung-als-regulaer',
  false,
  (roh) => roh === '1',
  (wert) => (wert ? '1' : null),
);

export function useOhneMeldungAlsRegulaer(): [boolean, (wert: boolean) => void] {
  return [ohneMeldungAlsRegulaer.useWert(), ohneMeldungAlsRegulaer.schreiben];
}

/** Nur für Tests. */
export const _zuruecksetzen = ohneMeldungAlsRegulaer._zuruecksetzen;
