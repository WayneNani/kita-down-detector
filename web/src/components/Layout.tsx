import { Link, Outlet } from 'react-router';
import { Suspense } from 'react';
import { Laden } from './Fehler';
import { useOnline } from '../lib/online';

export function Layout() {
  const online = useOnline();
  return (
    <>
      <a className="skip" href="#inhalt">Zum Inhalt springen</a>
      <header className="kopf">
        <div className="kopf-innen">
          <Link to="/" className="logo">
            <img src="/icon.svg" alt="" width="28" height="28" />
            <span>Kita-Ausfall NRW</span>
          </Link>
        </div>
        {!online && <div className="offline-leiste" role="status">Sie sind offline – angezeigt wird der zuletzt geladene Stand.</div>}
      </header>
      <main id="inhalt" className="inhalt">
        <Suspense fallback={<Laden />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="fuss">
        <nav aria-label="Weitere Informationen">
          <Link to="/datenschutz">Datenschutz &amp; Funktionsweise</Link>
          <a href="/api/v1/status">Offene Daten (API)</a>
          <Link to="/kita-fehlt">Kita fehlt?</Link>
        </nav>
        <p>Kita-Stammdaten: Land NRW (DL-DE BY 2.0), Städte Bonn/Köln, © OpenStreetMap-Mitwirkende (ODbL).</p>
        <p>Angaben ohne Gewähr – maßgeblich sind die Informationen der Kita.</p>
      </footer>
    </>
  );
}
