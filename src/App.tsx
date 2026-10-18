import { CalendarDays, Settings, Sun, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Toasts } from './components/Toasts';
import { FocusOverlay } from './features/focus/FocusOverlay';
import { InputBar } from './features/input/InputBar';
import { TaskSheet } from './features/tasks/TaskSheet';
import { useData } from './hooks/useData';
import { initCloud } from './lib/cloud/session';
import { useShortcuts } from './hooks/useShortcuts';
import { useTheme } from './lib/theme';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { UpcomingPage } from './pages/UpcomingPage';
import { useUi } from './store/ui';

const NAV = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/upcoming', label: 'Upcoming', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Shell() {
  const data = useData();
  const online = useOnline();
  const focusTarget = useUi((s) => s.focusTarget);
  useShortcuts();
  useTheme(data.profile.theme);
  useEffect(() => {
    void initCloud();
  }, []);

  const focusTask = focusTarget ? data.tasks.find((t) => t.id === focusTarget.taskId) : undefined;

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            Dayflow
            {!online && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                <WifiOff size={12} /> Offline
              </span>
            )}
          </div>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-teal-700 text-white' : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
                <span className="sr-only sm:hidden">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 pb-80 pt-4">
        <Routes>
          <Route path="/" element={<TodayPage data={data} />} />
          <Route path="/upcoming" element={<UpcomingPage data={data} />} />
          <Route path="/settings" element={<SettingsPage data={data} />} />
          <Route path="*" element={<TodayPage data={data} />} />
        </Routes>
      </main>

      <InputBar profile={data.profile} now={data.now} />
      <TaskSheet tasks={data.tasks} profile={data.profile} now={data.now} risks={data.livePlan.risks} />
      {focusTask && <FocusOverlay key={focusTask.id} task={focusTask} />}
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
