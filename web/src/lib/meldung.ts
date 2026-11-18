import type { FeldFehler, Grund, Info, MeldungInput, Status } from '../api/client';
import { istDatum, istUhrzeit, plusTage, tageZwischen } from './datum';

export type Zeitraum = 'heute' | 'morgen' | 'heute_morgen' | 'anders';

export interface FormZustand {
  status: Status | null;
  zeitraum: Zeitraum;
  datumVon: string;
  datumBis: string;
  uhrzeitVon: string;
  uhrzeitBis: string;
  grund: Grund | '';
}

export const LEERER_ZUSTAND: FormZustand = {
  status: null,
  zeitraum: 'heute',
  datumVon: '',
  datumBis: '',
  uhrzeitVon: '',
  uhrzeitBis: '',
  grund: '',
};

export type Grenzen = Pick<Info, 'max_tage_zurueck' | 'max_tage_voraus' | 'max_zeitraum_tage'>;

export const STANDARD_GRENZEN: Grenzen = { max_tage_zurueck: 7, max_tage_voraus: 90, max_zeitraum_tage: 31 };

/** Zeigt das Formular Uhrzeitfelder an? */
export function zeigtUhrzeiten(status: Status | null): boolean {
  return status === 'verkuerzt' || status === 'notbetreuung';
}

/** Zeitraum-Auswahl → konkretes Von/Bis-Datum. */
export function zeitraumDaten(z: FormZustand, heute: string): { von: string; bis: string } {
  switch (z.zeitraum) {
    case 'heute':
      return { von: heute, bis: heute };
    case 'morgen':
      return { von: plusTage(heute, 1), bis: plusTage(heute, 1) };
    case 'heute_morgen':
      return { von: heute, bis: plusTage(heute, 1) };
    case 'anders':
      return { von: z.datumVon, bis: z.datumBis || z.datumVon };
  }
}

export type Ergebnis = { ok: true; meldung: MeldungInput } | { ok: false; fehler: FeldFehler[] };

/** Prüft den Formularzustand und baut die Meldung für die API (gleiche Regeln wie der Server). */
export function baueMeldung(z: FormZustand, heute: string, grenzen: Grenzen = STANDARD_GRENZEN): Ergebnis {
  const fehler: FeldFehler[] = [];
  if (!z.status) fehler.push({ feld: 'status', meldung: 'Bitte auswählen, was gilt.' });

  const { von, bis } = zeitraumDaten(z, heute);
  if (!istDatum(von) || !istDatum(bis)) {
    fehler.push({ feld: 'datum_von', meldung: 'Bitte ein gültiges Datum angeben.' });
  } else {
    if (bis < von) fehler.push({ feld: 'datum_bis', meldung: 'Das Enddatum liegt vor dem Startdatum.' });
    else if (tageZwischen(von, bis) + 1 > grenzen.max_zeitraum_tage)
      fehler.push({ feld: 'datum_bis', meldung: `Ein Zeitraum darf höchstens ${grenzen.max_zeitraum_tage} Tage umfassen.` });
    if (von < plusTage(heute, -grenzen.max_tage_zurueck))
      fehler.push({ feld: 'datum_von', meldung: `Höchstens ${grenzen.max_tage_zurueck} Tage rückwirkend möglich.` });
    if (bis > plusTage(heute, grenzen.max_tage_voraus))
      fehler.push({ feld: 'datum_bis', meldung: `Höchstens ${grenzen.max_tage_voraus} Tage im Voraus möglich.` });
  }

  let uhrzeit_von: string | null = null;
  let uhrzeit_bis: string | null = null;
  if (zeigtUhrzeiten(z.status)) {
    const v = z.uhrzeitVon.trim();
    const b = z.uhrzeitBis.trim();
    const pflicht = z.status === 'verkuerzt';
    if (pflicht && (!v || !b)) {
      fehler.push({ feld: 'uhrzeit_von', meldung: 'Bitte Beginn und Ende der Betreuung angeben.' });
    } else if (v || b) {
      if (!v || !b) fehler.push({ feld: 'uhrzeit_von', meldung: 'Bitte Beginn und Ende angeben – oder beide leer lassen.' });
      else if (!istUhrzeit(v) || !istUhrzeit(b)) fehler.push({ feld: 'uhrzeit_von', meldung: 'Ungültige Uhrzeit.' });
      else if (b <= v) fehler.push({ feld: 'uhrzeit_bis', meldung: 'Das Betreuungsende liegt vor dem Beginn.' });
      else {
        uhrzeit_von = v;
        uhrzeit_bis = b;
      }
    }
  }

  if (fehler.length || !z.status) return { ok: false, fehler };
  return {
    ok: true,
    meldung: { status: z.status, datum_von: von, datum_bis: bis, uhrzeit_von, uhrzeit_bis, grund: z.grund || null },
  };
}
