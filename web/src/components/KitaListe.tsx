import { Link } from 'react-router';
import type { KitaKurz, KitaUebersicht } from '../api/client';
import { StatusBadge } from './Status';
import { IconPfeil } from './Icons';

export function adresse(k: KitaKurz): string {
  return [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function entfernung(m: number): string {
  return m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function KitaListe({ eintraege, leer, annahme = false }: { eintraege: KitaUebersicht[]; leer?: string; annahme?: boolean }) {
  if (eintraege.length === 0) return leer ? <p className="leer">{leer}</p> : null;
  return (
    <ul className="kita-liste">
      {eintraege.map((e) => (
        <li key={e.kita.id}>
          <Link to={`/kita/${e.kita.id}`} className="kita-zeile">
            <span className="kita-zeile-text">
              <span className="kita-name">{e.kita.name}</span>
              <span className="kita-adresse">
                {adresse(e.kita)}
                {e.entfernung_m !== undefined && ` · ${entfernung(e.entfernung_m)}`}
              </span>
              <span className="kita-status-zeile">
                <span className="tag-label">Heute</span> <StatusBadge s={e.heute} kurz annahme={annahme} />
                <span className="tag-label">Morgen</span> <StatusBadge s={e.morgen} kurz annahme={annahme} />
              </span>
            </span>
            <IconPfeil className="pfeil" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
