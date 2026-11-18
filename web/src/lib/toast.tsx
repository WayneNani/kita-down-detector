import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Art = 'ok' | 'fehler';
const Ctx = createContext<(text: string, art?: Art) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; art: Art; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const zeigen = useCallback((text: string, art: Art = 'ok') => {
    window.clearTimeout(timer.current);
    setToast({ text, art, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  return (
    <Ctx.Provider value={zeigen}>
      {children}
      <div className="toast-bereich" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast-${toast.art}`}>
            {toast.text}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
