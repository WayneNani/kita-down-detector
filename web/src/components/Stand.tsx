import { useOnline } from '../lib/online';
import { uhrzeitAus } from '../lib/datum';

/** Zeigt offline an, von wann die (zwischengespeicherten) Daten stammen. */
export function Stand({ aktualisiert }: { aktualisiert: number }) {
  const online = useOnline();
  if (online || !aktualisiert) return null;
  return (
    <p className="stand-offline" role="status">
      Stand: {uhrzeitAus(aktualisiert)} Uhr – offline
    </p>
  );
}
