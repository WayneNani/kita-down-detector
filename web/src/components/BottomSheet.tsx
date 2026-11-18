import { useEffect, useRef, type ReactNode } from 'react';
import { IconSchliessen } from './Icons';

/**
 * Natives <dialog>: Fokusfalle, Esc zum Schließen und Barrierefreiheit gibt es gratis.
 * Auf dem Handy als Bottom Sheet, auf großen Bildschirmen zentriert.
 */
export function BottomSheet({ offen, onSchliessen, titel, children }: { offen: boolean; onSchliessen: () => void; titel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (offen && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      document.documentElement.classList.add('sheet-offen');
    } else if (!offen && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
    if (!offen) document.documentElement.classList.remove('sheet-offen');
    return () => document.documentElement.classList.remove('sheet-offen');
  }, [offen]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-titel"
      onClose={onSchliessen}
      onClick={(e) => {
        if (e.target === ref.current) onSchliessen(); // Klick auf den Hintergrund
      }}
    >
      <div className="sheet-innen">
        <div className="sheet-kopf">
          <span className="sheet-griff" aria-hidden="true" />
          <h2 id="sheet-titel">{titel}</h2>
          <button type="button" className="icon-knopf" onClick={onSchliessen} aria-label="Schließen">
            <IconSchliessen />
          </button>
        </div>
        {offen && children}
      </div>
    </dialog>
  );
}
