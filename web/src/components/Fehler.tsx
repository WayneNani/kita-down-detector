import { ApiError } from '../api/client';

export function FehlerBox({ fehler }: { fehler: unknown }) {
  if (!fehler) return null;
  const e = fehler instanceof ApiError ? fehler : null;
  const text = e ? e.detail : fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
  return (
    <div className="box box-fehler" role="alert">
      <strong>{text}</strong>
      {e && e.fehler.length > 0 && (
        <ul>
          {e.fehler.map((f, i) => (
            <li key={i}>{f.meldung}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Laden({ text = 'Wird geladen …' }: { text?: string }) {
  return (
    <p className="laden" aria-busy="true">
      <span className="spinner" aria-hidden="true" /> {text}
    </p>
  );
}
