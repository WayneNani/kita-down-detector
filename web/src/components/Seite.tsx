import { useTitel } from '../lib/titel';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useKita } from '../api/queries';
import { adresse } from './KitaListe';
import { FehlerBox, Laden } from './Fehler';
import type { KitaDetail } from '../api/client';

/** Rahmen für Unterseiten einer Kita (Berichtigung, Elternbeirat, Kontakt). */
export function KitaUnterseite({ titel, children }: { titel: string; children: (d: KitaDetail) => ReactNode }) {
  const id = Number(useParams().id);
  const kita = useKita(id);
  useTitel(kita.data ? `${titel} – ${kita.data.kita.name}` : null);
  if (kita.isPending) return <Laden />;
  if (!kita.data) return <FehlerBox fehler={kita.error} />;
  const k = kita.data.kita;
  return (
    <div className="unterseite">
      <p className="zurueck">
        <Link to={`/kita/${k.id}`}>← {k.name}</Link>
      </p>
      <h1>{titel}</h1>
      <p className="kita-adresse">
        <strong>{k.name}</strong>
        <br />
        {adresse(k)}
      </p>
      {children(kita.data)}
    </div>
  );
}

export function Erfolg({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div className="box box-ok" role="status">
      <strong>{titel}</strong>
      <div>{children}</div>
    </div>
  );
}
