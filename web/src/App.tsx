import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ToastProvider } from './lib/toast';
import { ApiError } from './api/client';
import Start from './pages/Start';

// Startseite direkt, alles andere per Code-Splitting.
const Kita = lazy(() => import('./pages/Kita'));
const BerichtigungAnfragen = lazy(() => import('./pages/BerichtigungAnfragen'));
const Elternbeirat = lazy(() => import('./pages/Elternbeirat'));
const KontaktHinterlegen = lazy(() => import('./pages/KontaktHinterlegen'));
const KitaFehlt = lazy(() => import('./pages/KitaFehlt'));
const LinkMelden = lazy(() => import('./pages/LinkMelden'));
const BerichtigungBestaetigen = lazy(() => import('./pages/BerichtigungBestaetigen'));
const Einladung = lazy(() => import('./pages/Einladung'));
const Datenschutz = lazy(() => import('./pages/Datenschutz'));
const NichtGefunden = lazy(() => import('./pages/NichtGefunden'));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Start />} />
              <Route path="kita/:id" element={<Kita />} />
              <Route path="kita/:id/berichtigung" element={<BerichtigungAnfragen />} />
              <Route path="kita/:id/elternbeirat" element={<Elternbeirat />} />
              <Route path="kita/:id/kontakt" element={<KontaktHinterlegen />} />
              <Route path="kita-fehlt" element={<KitaFehlt />} />
              <Route path="m" element={<LinkMelden />} />
              <Route path="berichtigung" element={<BerichtigungBestaetigen />} />
              <Route path="einladung" element={<Einladung />} />
              <Route path="datenschutz" element={<Datenschutz />} />
              <Route path="*" element={<NichtGefunden />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
