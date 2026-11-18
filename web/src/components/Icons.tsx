// Schlichte Inline-SVG-Icons (keine Icon-Bibliothek, kein externer Abruf).
type P = { className?: string };
const basis = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconStern = ({ voll, className }: P & { voll?: boolean }) => (
  <svg {...basis} className={className} fill={voll ? 'currentColor' : 'none'}>
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
  </svg>
);
export const IconTeilen = ({ className }: P) => (
  <svg {...basis} className={className}>
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);
export const IconOrt = ({ className }: P) => (
  <svg {...basis} className={className}>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
export const IconSuche = ({ className }: P) => (
  <svg {...basis} className={className}>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconSchliessen = ({ className }: P) => (
  <svg {...basis} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconPlus = ({ className }: P) => (
  <svg {...basis} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconPfeil = ({ className }: P) => (
  <svg {...basis} className={className}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
