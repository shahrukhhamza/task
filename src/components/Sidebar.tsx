import { CalendarDays, Home, Plus, Settings, Sparkles, TrendingUp } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useAiAvailable } from '../lib/ai/assistant';
import { useUi } from '../store/ui';

export const NAV_ITEMS = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Desktop navigation: brand, sections, the main action, and the assistant's status. */
export function Sidebar() {
  const openAdd = useUi((s) => s.openAdd);
  const ai = useAiAvailable();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col px-5 py-7 lg:flex" aria-label="Sidebar">
      <Link to="/" className="mb-10 flex items-center gap-3 px-2">
        <img src="/favicon.svg" alt="" className="h-9 w-9" />
        <span className="text-xl font-bold tracking-tight">Dayflow</span>
      </Link>

      <button
        type="button"
        onClick={() => openAdd()}
        className="mb-8 flex h-12 items-center justify-center gap-2 rounded-full bg-card-lime font-bold text-ink shadow-[0_8px_24px_-8px_rgb(182_224_140/0.7)] transition hover:brightness-105"
      >
        <Plus size={20} strokeWidth={2.6} /> New task
        <kbd className="ml-1 rounded-md bg-ink/10 px-1.5 text-xs font-semibold">/</kbd>
      </button>

      <nav aria-label="Main" className="grid gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex h-12 items-center gap-3 rounded-2xl px-4 font-semibold transition ${
                isActive ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface/60 hover:text-fg'
              }`
            }
          >
            <Icon size={20} strokeWidth={2.2} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>

      <Link
        to="/settings?section=ai"
        className={`mt-auto flex items-center gap-3 rounded-[20px] p-4 text-sm transition ${ai ? 'bg-card-lilac text-ink' : 'bg-surface text-fg ring-1 ring-line hover:brightness-95'}`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ai ? 'bg-ink text-white' : 'bg-surface-2'}`}>
          <Sparkles size={17} />
        </span>
        <span>
          <span className="block font-bold">{ai ? 'Smart assistant on' : 'Smart assistant'}</span>
          <span className={`block text-xs font-semibold ${ai ? 'opacity-70' : 'text-muted'}`}>{ai ? 'Powered by Gemini' : 'Turn on with a free key'}</span>
        </span>
      </Link>
    </aside>
  );
}

/** Soft colour glows behind everything, so the page never looks flat. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-card-lime opacity-[0.16] blur-[120px] dark:opacity-[0.10]" />
      <div className="absolute -right-32 top-1/3 h-[30rem] w-[30rem] rounded-full bg-card-sky opacity-[0.18] blur-[120px] dark:opacity-[0.09]" />
      <div className="absolute -bottom-40 left-1/3 h-[26rem] w-[26rem] rounded-full bg-card-lilac opacity-[0.16] blur-[120px] dark:opacity-[0.08]" />
    </div>
  );
}
