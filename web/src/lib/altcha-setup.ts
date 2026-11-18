// Wird nur auf Formularseiten nachgeladen (eigener Chunk).
// CSP-freundliche „external“-Variante: CSS als Datei, Worker als eigene Datei.
import 'altcha/external';
import 'altcha/altcha.css';
import 'altcha/i18n/de';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';

globalThis.$altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker());
