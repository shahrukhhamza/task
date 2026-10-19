import { CalendarDays, Home, Plus, Settings, TrendingUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useUi } from '../store/ui';

const LEFT = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
];
const RIGHT = [
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Item({ to, label, icon: Icon }: (typeof LEFT)[number]) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      aria-label={label}
      className={({ isActive }) =>
        `flex h-12 items-center justify-center gap-2 rounded-full transition-all ${
          isActive ? 'bg-white px-4 text-ink' : 'w-12 text-white/75 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={21} strokeWidth={2.2} aria-hidden />
          {isActive && <span className="text-sm font-semibold">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

/** Floating dark pill with the main sections and a big add button in the middle. */
export function BottomNav() {
  const openAdd = useUi((s) => s.openAdd);
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="flex items-center gap-1 rounded-full bg-nav p-2 shadow-2xl ring-1 ring-white/10">
        {LEFT.map((item) => (
          <Item key={item.to} {...item} />
        ))}
        <button
          type="button"
          onClick={() => openAdd()}
          aria-label="Add a task (press /)"
          title="Add (press /)"
          className="mx-1 flex h-14 w-14 items-center justify-center rounded-full bg-card-lime text-ink shadow-lg transition hover:scale-105"
        >
          <Plus size={28} strokeWidth={2.6} />
        </button>
        {RIGHT.map((item) => (
          <Item key={item.to} {...item} />
        ))}
      </div>
      </nav>
    </>
  );
}
