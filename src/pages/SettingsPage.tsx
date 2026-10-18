import { CalendarDays, ChevronDown, Download, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { Button, Card, fieldClass, Segmented } from '../components/ui';
import { AccountSection } from '../features/account/AccountSection';
import { EmailSection } from '../features/settings/EmailSection';
import { NotificationsSection } from '../features/settings/NotificationsSection';
import type { PlannerData } from '../hooks/useData';
import { buildIcs } from '../lib/calendar/ics';
import { deleteCloudData } from '../lib/cloud/session';
import { clearAllData, exportAll, isActive, updateProfile } from '../lib/db/actions';
import { download } from '../lib/download';
import { statsFromTasks } from '../lib/scheduler';
import { VOICE_LANGUAGES } from '../lib/speech/useSpeechRecognition';
import { timeZones } from '../lib/time/tz';
import type { Profile } from '../lib/types';
import { useCloud } from '../store/cloud';
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
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function TimeField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="time"
          className={fieldClass}
          value={toTime(value)}
          onChange={(e) => {
            const v = fromTime(e.target.value);
            if (v !== undefined) onChange(v);
          }}
        />
      )}
    </Field>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="grid gap-4">
    <h2 className="text-lg font-bold">{title}</h2>
    {children}
  </Card>
);

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

export function SettingsPage({ data }: { data: PlannerData }) {
  const { profile, tasks } = data;
  const toast = useUi((s) => s.toast);
  const signedIn = useCloud((s) => !!s.user);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
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
    if (next.workStart >= next.workEnd) return setError('Your day should end after it starts.');
    if (next.peakStart >= next.peakEnd) return setError('Your best focus time should end after it starts.');
    if (next.maxChunkMin < 20 || next.breakMin < 0 || next.bufferMin < 0 || next.maxFocusMin < 60) return setError('Check the advanced numbers.');
    setError(null);
    await updateProfile(changes);
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="text-3xl font-bold">Settings</h1>

      {error && (
        <p role="alert" className="rounded-[20px] bg-card-coral p-4 text-sm font-semibold text-ink">
          {error}
        </p>
      )}

      <AccountSection />

      <Section title="Your day">
        <div className="grid grid-cols-2 gap-3">
          <TimeField label="Day starts" value={profile.workStart} onChange={(v) => void save({ workStart: v })} />
          <TimeField label="Day ends" value={profile.workEnd} onChange={(v) => void save({ workEnd: v })} />
          <TimeField label="Best focus from" value={profile.peakStart} onChange={(v) => void save({ peakStart: v })} hint="Hard tasks go here." />
          <TimeField label="Best focus until" value={profile.peakEnd} onChange={(v) => void save({ peakEnd: v })} />
        </div>

        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="inline-flex items-center gap-1 justify-self-start text-sm font-semibold text-muted hover:text-fg">
          Advanced <ChevronDown size={16} className={`transition ${advanced ? 'rotate-180' : ''}`} />
        </button>
        {advanced && (
          <div className="grid gap-4 rounded-[20px] bg-surface-2/60 p-4">
            <Field label="Timezone" hint="Day boundaries, reminders and emails follow this.">
              {(id) => (
                <select id={id} className={fieldClass} value={profile.timezone} onChange={(e) => void save({ timezone: e.target.value })}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Most focused work per day (hours)" hint="Dayflow won’t plan more than this; if a deadline needs more, it warns you.">
              {(id) => (
                <input id={id} type="number" min={1} max={14} step={0.5} className={fieldClass} value={profile.maxFocusMin / 60} onChange={(e) => e.target.value && void save({ maxFocusMin: Math.round(+e.target.value * 60) })} />
              )}
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Longest block (min)">
                {(id) => <input id={id} type="number" min={20} step={5} className={fieldClass} value={profile.maxChunkMin} onChange={(e) => e.target.value && void save({ maxChunkMin: +e.target.value })} />}
              </Field>
              <Field label="Break (min)">
                {(id) => <input id={id} type="number" min={0} step={5} className={fieldClass} value={profile.breakMin} onChange={(e) => e.target.value && void save({ breakMin: +e.target.value })} />}
              </Field>
              <Field label="Buffer (min)">
                {(id) => <input id={id} type="number" min={0} step={5} className={fieldClass} value={profile.bufferMin} onChange={(e) => e.target.value && void save({ bufferMin: +e.target.value })} />}
              </Field>
            </div>
          </div>
        )}
      </Section>

      <NotificationsSection profile={profile} />
      <EmailSection profile={profile} />

      <Section title="Look and voice">
        <div>
          <p className="mb-1.5 text-sm font-semibold">Theme</p>
          <Segmented
            label="Theme"
            value={profile.theme}
            onChange={(theme) => void save({ theme })}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <Field
          label="Voice language"
          hint={profile.voiceLang.startsWith('en') ? undefined : 'Speech is transcribed in this language, but dates and commands are understood in English only.'}
        >
          {(id) => (
            <select id={id} className={fieldClass} value={profile.voiceLang} onChange={(e) => void save({ voiceLang: e.target.value })}>
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {installEvent ? (
          <Button
            variant="primary"
            onClick={async () => {
              await installEvent.prompt();
              setInstallEvent(null);
            }}
          >
            <Smartphone size={16} /> Install Dayflow
          </Button>
        ) : (
          <p className="text-sm text-muted">Install it like an app: use your browser’s “Install app” or “Add to Home Screen”. It then works offline.</p>
        )}
      </Section>

      {learned.length > 0 && (
        <Section title="What Dayflow has learned">
          <ul className="grid gap-2 text-sm">
            {learned.map(([category, s]) => (
              <li key={category} className="flex justify-between gap-3 rounded-[16px] bg-surface-2 px-4 py-3">
                <span className="font-semibold capitalize">{category}</span>
                <span className="text-muted">
                  {s.ratio >= 1 ? `takes ${Math.round((s.ratio - 1) * 100)}% longer` : `${Math.round((1 - s.ratio) * 100)}% quicker`} than you estimate
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Your data">
        <p className="-mt-2 text-sm text-muted">
          {signedIn ? 'Stored on this device and backed up to your account.' : 'Everything stays on this device until you sign in.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              const { json } = await exportAll();
              download(`dayflow-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
            }}
          >
            <Download size={15} /> JSON
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const { csv } = await exportAll();
              download(`dayflow-tasks-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
            }}
          >
            <Download size={15} /> CSV
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const upcoming = tasks.filter((t) => isActive(t) || t.fixedStart !== undefined);
              download('dayflow-plan.ics', buildIcs(upcoming, profile.timezone), 'text/calendar');
            }}
          >
            <CalendarDays size={15} /> Calendar file
          </Button>
          <Button size="sm" variant="ghost" className="!text-red-700 dark:!text-red-300" onClick={() => setConfirmClear(true)}>
            <Trash2 size={15} /> Delete everything
          </Button>
        </div>
      </Section>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Delete everything?">
        <p className="mb-5 text-muted">
          This removes every task, habit and history entry from this device{signedIn ? ' and from your account' : ''}. It can’t be undone, so download a JSON
          backup first if you might want it back.{signedIn ? ' Events already added to Google Calendar stay there.' : ''}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            Keep my data
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                if (signedIn) await deleteCloudData();
                await clearAllData();
                toast('All data deleted.');
              } catch (err) {
                toast(`Couldn’t delete everything: ${err instanceof Error ? err.message : err}`, { tone: 'error' });
              } finally {
                setConfirmClear(false);
              }
            }}
          >
            Delete everything
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
