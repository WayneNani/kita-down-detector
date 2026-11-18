import { Component, type ReactNode } from 'react';

const NEU_GELADEN = 'kita-ausfall:chunk-neu-geladen';

function istLadefehler(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(m);
}

/**
 * Fängt Fehler beim Laden von Seiten ab (offline oder nach einem Deploy fehlen
 * alte Dateien) – statt einer weißen Seite. Bei Ladefehlern wird einmal
 * automatisch neu geladen, damit die aktuelle Version kommt.
 */
export class Fehlergrenze extends Component<{ children: ReactNode; schluessel: string }, { fehler: unknown }> {
  state = { fehler: null as unknown };

  static getDerivedStateFromError(fehler: unknown) {
    return { fehler };
  }

  componentDidCatch(fehler: unknown) {
    if (!istLadefehler(fehler) || !navigator.onLine) return;
    // höchstens einmal pro Minute automatisch neu laden (keine Endlosschleife bei kaputtem Deploy)
    try {
      const zuletzt = Number(sessionStorage.getItem(NEU_GELADEN) ?? 0);
      if (Date.now() - zuletzt < 60_000) return;
      sessionStorage.setItem(NEU_GELADEN, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }

  componentDidUpdate(vorher: { schluessel: string }) {
    // Beim Seitenwechsel neuer Versuch
    if (vorher.schluessel !== this.props.schluessel && this.state.fehler) this.setState({ fehler: null });
  }

  render() {
    if (!this.state.fehler) return this.props.children;
    const laden = istLadefehler(this.state.fehler);
    return (
      <div className="box box-fehler" role="alert">
        <strong>{laden ? 'Diese Seite konnte nicht geladen werden.' : 'Hier ist etwas schiefgegangen.'}</strong>
        <p>{laden && !navigator.onLine ? 'Sie sind offline. Bitte versuchen Sie es mit Verbindung erneut.' : 'Bitte laden Sie die Seite neu.'}</p>
        <button type="button" className="knopf knopf-primaer" onClick={() => window.location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
