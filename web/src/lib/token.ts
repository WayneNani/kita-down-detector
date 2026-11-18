/** Tokens aus Mail-Links stehen im URL-Fragment (#…) und erreichen so nie den Server. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

export function tokenAusHash(hash: string): string | null {
  const t = hash.replace(/^#/, '').trim();
  return TOKEN_FORMAT.test(t) ? t : null;
}

/**
 * Liest das Token aus `location.hash` und entfernt es sofort aus der Adresszeile
 * (Verlauf, Screenshots, versehentliches Teilen).
 */
export function tokenAusAdresse(loc: Location = window.location, hist: History = window.history): string | null {
  const token = tokenAusHash(loc.hash);
  if (loc.hash) hist.replaceState(hist.state, '', loc.pathname + loc.search);
  return token;
}

const LINK_SCHLUESSEL = 'kita-ausfall:melde-link';

export function gemerkterLink(): string | null {
  try {
    const t = localStorage.getItem(LINK_SCHLUESSEL);
    return t && TOKEN_FORMAT.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function merkeLink(token: string | null): void {
  try {
    if (token) localStorage.setItem(LINK_SCHLUESSEL, token);
    else localStorage.removeItem(LINK_SCHLUESSEL);
  } catch {
    /* privater Modus o. Ä. – dann eben nicht merken */
  }
}

let zwischenspeicher: { pfad: string; token: string | null } | null = null;

/**
 * Token für die aktuelle Seite – liest das Fragment genau einmal (auch unter
 * React StrictMode, das Initialisierer doppelt aufruft).
 */
export function tokenFuerSeite(loc: Location = window.location, hist: History = window.history): string | null {
  if (zwischenspeicher && zwischenspeicher.pfad === loc.pathname && !loc.hash) return zwischenspeicher.token;
  const token = tokenAusAdresse(loc, hist);
  zwischenspeicher = { pfad: loc.pathname, token };
  return token;
}
