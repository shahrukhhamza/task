import { WifiOff } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toasts } from './components/Toasts';
import { Skeleton } from './components/ui';
import { FocusOverlay } from './features/focus/FocusOverlay';
import { AddSheet } from './features/input/AddSheet';
import { TaskSheet } from './features/tasks/TaskSheet';
import { useData } from './hooks/useData';
import { useShortcuts } from './hooks/useShortcuts';
import { initCloud } from './lib/cloud/session';
import { useReminders } from './lib/notify';
import { useTheme } from './lib/theme';
import { TodayPage } from './pages/TodayPage';
import { useUi } from './store/ui';

// Today loads with the app; the other tabs (charts in particular) load when first opened
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const ProgressPage = lazy(() => import('./pages/ProgressPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

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
  useReminders(data.tasks, data.profile);

  const focusTask = focusTarget ? data.tasks.find((t) => t.id === focusTarget.taskId) : undefined;

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      {!online && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center pt-[max(0.5rem,env(safe-area-inset-top))]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
            <WifiOff size={13} /> Offline · everything still works
          </span>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-xl px-4 pb-36 pt-[max(1.25rem,env(safe-area-inset-top))] lg:max-w-5xl">
        <ErrorBoundary>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Routes>
              <Route path="/" element={<TodayPage data={data} />} />
              <Route path="/calendar" element={<CalendarPage data={data} />} />
              <Route path="/progress" element={<ProgressPage data={data} />} />
              <Route path="/settings" element={<SettingsPage data={data} />} />
              {/* older links (emails, bookmarks) */}
              <Route path="/upcoming" element={<Navigate to="/calendar" replace />} />
              <Route path="/report" element={<Navigate to="/progress" replace />} />
              <Route path="/habits" element={<Navigate to="/progress" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>

      <BottomNav />
      <AddSheet profile={data.profile} now={data.now} />
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
