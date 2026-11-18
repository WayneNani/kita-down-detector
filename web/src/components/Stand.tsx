import { useOnline } from '../lib/online';
import { ausCacheVom } from '../api/client';
import { datumKurz, heuteBerlin, uhrzeitAus } from '../lib/datum';

function zeitpunkt(ms: number): string {
  const d = new Date(ms);
  const tag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
  return (tag === heuteBerlin() ? '' : datumKurz(tag) + ', ') + uhrzeitAus(ms) + ' Uhr';
}

/**
 * Zeigt an, wenn die Daten nicht frisch vom Server kommen: offline, aus dem
 * Zwischenspeicher oder weil die letzte Aktualisierung fehlgeschlagen ist.
 */
export function Stand({ aktualisiert, daten, fehlgeschlagen = false }: { aktualisiert: number; daten?: unknown; fehlgeschlagen?: boolean }) {
  const online = useOnline();
  const cache = ausCacheVom(daten);
  if (cache !== null) {
    return (
      <p className="stand-offline" role="status">
        Gespeicherter Stand{cache ? ` vom ${zeitpunkt(cache)}` : ''} – keine Verbindung zum Server.
      </p>
    );
  }
  if (fehlgeschlagen && aktualisiert) {
    return (
      <p className="stand-offline" role="status">
        Aktualisierung fehlgeschlagen – angezeigt wird der Stand von {zeitpunkt(aktualisiert)}.
      </p>
    );
  }
  if (online || !aktualisiert) return null;
  return (
    <p className="stand-offline" role="status">
      Stand: {zeitpunkt(aktualisiert)} – offline
    </p>
  );
}
