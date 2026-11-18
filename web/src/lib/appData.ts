import type { KitaDetail } from '../api/client';

/**
 * Der Go-Server bettet die Daten der ersten Seite als JSON ein
 * (<script id="app-data" type="application/json">), damit die Kita-Seite ohne
 * zweite Netzwerkrunde sofort angezeigt wird. Wird nur einmal gelesen.
 */
let gelesen = false;
let daten: { kita_detail?: KitaDetail } | null = null;

export function startDaten(): { kita_detail?: KitaDetail } | null {
  if (!gelesen) {
    gelesen = true;
    const el = document.getElementById('app-data');
    if (el?.textContent) {
      try {
        daten = JSON.parse(el.textContent) as { kita_detail?: KitaDetail };
      } catch {
        daten = null;
      }
    }
    el?.remove();
  }
  return daten;
}

/** Startdaten für genau diese Kita entnehmen (danach verbraucht). */
export function startDatenFuerKita(id: number): KitaDetail | undefined {
  const d = startDaten();
  if (d?.kita_detail?.kita.id === id) {
    const kd = d.kita_detail;
    daten = null;
    return kd;
  }
  return undefined;
}
