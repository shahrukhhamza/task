import type { ComponentProps, ReactNode } from 'react';

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-app hover:opacity-90',
  ink: 'bg-ink text-white hover:bg-black',
  secondary: 'bg-surface-2 text-fg hover:brightness-95 dark:hover:brightness-125',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-red-700 text-white hover:bg-red-800',
};

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'h-9 px-3.5 text-sm' : size === 'lg' ? 'h-13 px-6 text-base' : 'h-11 px-5 text-[15px]';
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${sizing} ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** The black round icon button from the bento cards. */
export function IconButton({ label, children, className = '', tone = 'ink', size = 44, ...rest }: ComponentProps<'button'> & { label: string; tone?: 'ink' | 'white' | 'soft'; size?: number }) {
  const tones = {
    ink: 'bg-ink text-white hover:bg-black',
    white: 'bg-white text-ink hover:bg-white/85',
    soft: 'bg-surface-2 text-fg hover:brightness-95 dark:hover:brightness-125',
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      style={{ width: size, height: size, ...rest.style }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ cards

export type BentoTone = 'lime' | 'cream' | 'sky' | 'coral' | 'sun' | 'mist' | 'lilac' | 'surface';

const BENTO: Record<BentoTone, string> = {
  lime: 'bg-card-lime text-ink',
  cream: 'bg-card-cream text-ink',
  sky: 'bg-card-sky text-ink',
  coral: 'bg-card-coral text-ink',
  sun: 'bg-card-sun text-ink',
  mist: 'bg-card-mist text-ink',
  lilac: 'bg-card-lilac text-ink',
  surface: 'bg-surface text-fg',
};

/** Large rounded card. Pastel tones always use dark ink, in both themes. */
export function Bento({ tone = 'surface', className = '', children, ...rest }: ComponentProps<'div'> & { tone?: BentoTone }) {
  return (
    <div {...rest} className={`rounded-[28px] p-5 ${BENTO[tone]} ${className}`}>
      {children}
    </div>
  );
}

/** Neutral card (kept for older screens). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-surface p-5 text-fg ring-1 ring-line lg:p-6 ${className}`}>{children}</div>;
}

/** Small uppercase-free label above a big headline, as in "Current tasks". */
export const Kicker = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-sm font-semibold opacity-70 ${className}`}>{children}</p>
);

// ------------------------------------------------------------------ chips

const TONES = {
  neutral: 'bg-surface-2 text-fg',
  white: 'bg-white text-ink',
  ink: 'bg-ink text-white',
  teal: 'bg-card-lime text-ink',
  amber: 'bg-card-sun text-ink',
  red: 'bg-card-coral text-ink',
  violet: 'bg-card-lilac text-ink',
};

export function Chip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: keyof typeof TONES; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Black pill with a white active segment ("Weekly | Monthly"). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-ink p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${value === o.value ? 'bg-white text-ink' : 'text-white/80 hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Black rounded block with a big number and a small label: "24 / Nov", "9:30 / AM". */
export function DateBlock({ top, bottom, className = '' }: { top: string; bottom: string; className?: string }) {
  return (
    <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[18px] bg-ink leading-none text-white ${className}`}>
      <span className="text-lg font-bold">{top}</span>
      <span className="mt-0.5 text-[11px] font-semibold opacity-80">{bottom}</span>
    </div>
  );
}

// ------------------------------------------------------------------ misc

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card-lime text-ink">{icon}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-[28px] ${className}`} />;
}

export const fieldClass =
  'w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[15px] text-fg placeholder:text-muted focus:border-fg/30 focus:outline-none';
