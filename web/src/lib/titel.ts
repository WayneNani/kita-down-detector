import { useEffect } from 'react';

const APP = 'Kita-Ausfall NRW';

/**
 * Setzt den Seitentitel bei Navigation innerhalb der App. Beim ersten Laden
 * setzt ihn der Go-Server; ohne diesen Hook bliebe er bei Seitenwechseln stehen
 * (wichtig für Screenreader, Tabs und Teilen).
 */
export function useTitel(titel: string | null | undefined) {
  useEffect(() => {
    if (titel === null) return;
    document.title = titel ? `${titel} – ${APP}` : APP;
  }, [titel]);
}
