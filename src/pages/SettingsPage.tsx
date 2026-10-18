import { Download, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { Button, Card, fieldClass } from '../components/ui';
import type { PlannerData } from '../hooks/useData';
import { clearAllData, exportAll, updateProfile } from '../lib/db/actions';
import { statsFromTasks } from '../lib/scheduler';
import { timeZones } from '../lib/time/tz';
import type { Profile } from '../lib/types';
import { useUi } from '../store/ui';

const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : undefined;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage({ data }: { data: PlannerData }) {
  const { profile, tasks } = data;
  const toast = useUi((s) => s.toast);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const zones = useMemo(() => {
    const list = timeZones();
    return list.includes(profile.timezone) ? list : [profile.timezone, ...list];
  }, [profile.timezone]);
  const learned = useMemo(() => Object.entries(statsFromTasks(tasks)), [tasks]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const save = async (changes: Partial<Profile>) => {
    const next = { ...profile, ...changes };
    if (next.workStart >= next.workEnd) return setError('Work should end after it starts.');
    if (next.peakStart >= next.peakEnd) return setError('Peak focus should end after it starts.');
    if (next.maxChunkMin < 20 || next.breakMin < 0 || next.bufferMin < 0 || next.maxFocusMin < 60) return setError('Check the block, break and buffer lengths.');
    setError(null);
    await updateProfile(changes);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-100">
          {error}
        </p>
      )}

      <Card className="grid gap-4">
        <h2 className="font-semibold">Your day</h2>
        <Field label="Timezone" hint="Day boundaries, reminders and emails all follow this.">
          {(id) => (
            <select id={id} className={fieldClass} value={profile.timezone} onChange={(e) => save({ timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work starts">
            {(id) => <input id={id} type="time" className={fieldClass} value={toTime(profile.workStart)} onChange={(e) => { const v = fromTime(e.target.value); if (v !== undefined) void save({ workStart: v }); }} />}
          </Field>
          <Field label="Work ends">
            {(id) => <input id={id} type="time" className={fieldClass} value={toTime(profile.workEnd)} onChange={(e) => { const v = fromTime(e.target.value); if (v !== undefined) void save({ workEnd: v }); }} />}
          </Field>
          <Field label="Peak focus starts" hint="Hard tasks are placed here.">
            {(id) => <input id={id} type="time" className={fieldClass} value={toTime(profile.peakStart)} onChange={(e) => { const v = fromTime(e.target.value); if (v !== undefined) void save({ peakStart: v }); }} />}
          </Field>
          <Field label="Peak focus ends">
            {(id) => <input id={id} type="time" className={fieldClass} value={toTime(profile.peakEnd)} onChange={(e) => { const v = fromTime(e.target.value); if (v !== undefined) void save({ peakEnd: v }); }} />}
          </Field>
        </div>
        <Field label="Most focused work per day (hours)" hint="Dayflow won’t plan more than this in one day. If a deadline needs more, you’ll be warned instead.">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={14}
              step={0.5}
              className={`${fieldClass} !w-28`}
              value={profile.maxFocusMin / 60}
              onChange={(e) => e.target.value && void save({ maxFocusMin: Math.round(+e.target.value * 60) })}
            />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Longest block (min)">
            {(id) => <input id={id} type="number" min={20} step={5} className={fieldClass} value={profile.maxChunkMin} onChange={(e) => e.target.value && void save({ maxChunkMin: +e.target.value })} />}
          </Field>
          <Field label="Break (min)">
            {(id) => <input id={id} type="number" min={0} step={5} className={fieldClass} value={profile.breakMin} onChange={(e) => e.target.value && void save({ breakMin: +e.target.value })} />}
          </Field>
          <Field label="Buffer (min)" hint="Around events.">
            {(id) => <input id={id} type="number" min={0} step={5} className={fieldClass} value={profile.bufferMin} onChange={(e) => e.target.value && void save({ bufferMin: +e.target.value })} />}
          </Field>
        </div>
      </Card>

      <Card className="grid gap-4">
        <h2 className="font-semibold">Appearance</h2>
        <Field label="Theme">
          {(id) => (
            <select id={id} className={fieldClass} value={profile.theme} onChange={(e) => save({ theme: e.target.value as Profile['theme'] })}>
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          )}
        </Field>
        {installEvent ? (
          <Button
            onClick={async () => {
              await installEvent.prompt();
              setInstallEvent(null);
            }}
          >
            <Smartphone size={16} /> Install Dayflow
          </Button>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            To install: use your browser’s “Install app” or “Add to Home Screen” option. Dayflow then works offline like a native app.
          </p>
        )}
      </Card>

      <Card className="grid gap-3">
        <h2 className="font-semibold">What Dayflow has learned</h2>
        {learned.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Once you’ve finished a few timed tasks (using the focus timer) in a category, estimates there will be corrected automatically.
          </p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {learned.map(([category, s]) => (
              <li key={category} className="flex justify-between">
                <span className="capitalize">{category}</span>
                <span>
                  {s.ratio >= 1 ? `takes ${Math.round((s.ratio - 1) * 100)}% longer` : `${Math.round((1 - s.ratio) * 100)}% faster`} than you
                  estimate <span className="text-slate-600 dark:text-slate-400">({s.samples} tasks)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="grid gap-3">
        <h2 className="font-semibold">Your data</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Everything is stored on this device. Nothing leaves it until you connect an account.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              const { json } = await exportAll();
              download(`dayflow-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
            }}
          >
            <Download size={16} /> Export JSON
          </Button>
          <Button
            onClick={async () => {
              const { csv } = await exportAll();
              download(`dayflow-tasks-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
            }}
          >
            <Download size={16} /> Export CSV
          </Button>
          <Button variant="ghost" className="!text-red-700 dark:!text-red-300" onClick={() => setConfirmClear(true)}>
            <Trash2 size={16} /> Delete all data
          </Button>
        </div>
      </Card>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Delete everything?">
        <p className="mb-4 text-sm">
          This removes every task and history entry from this device and can’t be undone. Export a JSON backup first if you might want it back.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            Keep my data
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await clearAllData();
              setConfirmClear(false);
              toast('All data deleted.');
            }}
          >
            Delete everything
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
