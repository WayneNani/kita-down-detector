import { useSyncExternalStore } from 'react';

function abonnieren(f: () => void) {
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(abonnieren, () => navigator.onLine, () => true);
}
