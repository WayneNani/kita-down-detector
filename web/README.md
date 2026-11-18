# Frontend (React) – Kita-Ausfall NRW

Mobile-first Single-Page-App (Vite, React 19, TypeScript, react-router, TanStack Query).
Der Go-Server liefert den Build aus `../internal/web/dist/` aus und ersetzt in `index.html`
die Platzhalter `<!--app-head-->` (Titel, Vorschau-Tags) und `<!--app-data-->` (Startdaten der Kita-Seite).

## Befehle

```sh
npm ci                 # Abhängigkeiten (legacy-peer-deps ist in .npmrc gesetzt)
npm run dev            # Entwicklungsserver, /api → http://localhost:8080 (Go-Backend)
npm run build          # Typprüfung + Build nach ../internal/web/dist
npm test               # Vitest
npm run typecheck      # tsc --noEmit
npm run check:no-html  # verbietet dangerouslySetInnerHTML
npm run gen:api        # Typen aus ../api/openapi.yaml neu erzeugen
```

Ende-zu-Ende-Tests (Playwright, Handy-Profile iPhone SE und Pixel 7) laufen gegen den echten
Go-Server mit Testdaten – am einfachsten über `make e2e` im Hauptverzeichnis, oder bei laufendem Server:

```sh
npm run e2e
```

PNG-Icons aus den SVGs neu erzeugen: `node scripts/icons.cjs` (braucht Playwright/Chromium).

## Aufbau

- `src/api/` – generierte Typen (`schema.d.ts`), Fetch-Client (problem+json → `ApiError`), Query-Hooks
- `src/lib/` – Formularlogik (`meldung.ts`), Tokens aus dem URL-Fragment (`token.ts`), „Meine Kitas“ (`favoriten.ts`, nur `localStorage`), Standort-Rundung (`geo.ts`)
- `src/components/` – Status-Anzeige, Liste, Bottom Sheet (`<dialog>`), Meldeformular, Proof-of-Work-Widget (ALTCHA, nachgeladen)
- `src/pages/` – eine Datei pro Route (per `React.lazy` aufgeteilt)
- `public/sw.js` – Service Worker (Offline-Anzeige des letzten Stands), `manifest.webmanifest`, Icons
