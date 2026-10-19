import { CalendarDays, Home, Mic, Plus, Settings, Sparkles, TrendingUp } from 'lucide-react';
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
  const openVoice = useUi((s) => s.openVoice);
  const ai = useAiAvailable();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-app px-5 py-7 lg:flex" aria-label="Sidebar">
      <Link to="/" className="mb-10 flex items-center gap-3 px-2">
        <img src="/favicon.svg" alt="" className="h-9 w-9" />
        <span className="text-lg font-medium tracking-tight">Dayflow</span>
      </Link>

      <button
        type="button"
        onClick={() => openAdd()}
        className="mb-2 flex h-11 items-center justify-center gap-2 rounded-full bg-fg font-medium text-app transition hover:opacity-90 dark:bg-card-lime dark:text-ink"
      >
        <Plus size={20} strokeWidth={2.6} /> New task
        <kbd className="ml-1 rounded-md bg-app/15 px-1.5 text-xs font-medium dark:bg-ink/10">/</kbd>
      </button>
      <button
        type="button"
        onClick={openVoice}
        className="mb-8 flex h-11 items-center justify-center gap-2 rounded-full border border-line font-medium text-fg transition hover:bg-surface-2"
      >
        <Mic size={18} strokeWidth={2.4} /> Talk to Dayflow
        <kbd className="ml-1 rounded-md bg-surface-2 px-1.5 text-xs font-medium text-muted">V</kbd>
      </button>

      <nav aria-label="Main" className="grid gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] transition ${
                isActive ? 'bg-surface-2 font-semibold text-fg' : 'font-medium text-muted hover:bg-surface-2/70 hover:text-fg'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute -left-5 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-fg" />}
                <Icon size={20} strokeWidth={2.2} aria-hidden /> {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <Link
        to="/settings?section=ai"
        className={`mt-auto flex items-center gap-3 rounded-[20px] p-3.5 text-sm transition ${ai ? 'tint bg-card-lilac text-ink' : 'bg-surface-2 text-fg hover:brightness-95'}`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ai ? 'bg-ink text-white' : 'bg-surface-2'}`}>
          <Sparkles size={17} />
        </span>
        <span>
          <span className="block font-semibold">{ai ? 'Smart assistant on' : 'Smart assistant'}</span>
          <span className={`block text-xs font-medium ${ai ? 'opacity-70' : 'text-muted'}`}>{ai ? 'Powered by Gemini' : 'Turn on with a free key'}</span>
        </span>
      </Link>
    </aside>
  );
}
