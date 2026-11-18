import { useTitel } from '../lib/titel';
import { Link } from 'react-router';

export default function NichtGefunden() {
  useTitel('Seite nicht gefunden');
  return (
    <div className="unterseite">
      <h1>Seite nicht gefunden</h1>
      <p>Diese Seite gibt es nicht (mehr).</p>
      <p>
        <Link to="/" className="knopf knopf-primaer">
          Zur Startseite
        </Link>
      </p>
    </div>
  );
}
