import { Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Database, Download, Mail, Palette, Smartphone, Sparkles, Sun, Trash2, UserRound } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sheet } from '../components/Sheet';
import { Button, Card, fieldClass, Segmented } from '../components/ui';
import { AccountSection } from '../features/account/AccountSection';
import { AiSection } from '../features/settings/AiSection';
import { EmailSection } from '../features/settings/EmailSection';
import { NotificationsSection } from '../features/settings/NotificationsSection';
import type { PlannerData } from '../hooks/useData';
import { useIsDesktop } from '../hooks/useMedia';
import { useAiAvailable } from '../lib/ai/assistant';
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

type SectionId = 'account' | 'ai' | 'day' | 'reminders' | 'email' | 'look' | 'data';

const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : undefined;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
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
  <Card className="grid gap-5">
    <h2 className="text-xl font-semibold">{title}</h2>
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
  const aiOn = useAiAvailable();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const zones = useMemo(() => {
    const list = timeZones();
    return list.includes(profile.timezone) ? list : [profile.timezone, ...list];
  }, [profile.timezone]);
  const learned = useMemo(() => Object.entries(statsFromTasks(tasks)), [tasks]);

  const sections: Array<{ id: SectionId; title: string; desc: string; icon: typeof Sun; tone: string }> = [
    { id: 'account', title: 'Account & sync', desc: signedIn ? 'Signed in' : 'Local only', icon: UserRound, tone: 'bg-card-sky' },
    { id: 'ai', title: 'Smart assistant', desc: aiOn ? 'On · Gemini' : 'Off', icon: Sparkles, tone: 'bg-card-lilac' },
    { id: 'day', title: 'Your day', desc: `${toTime(profile.workStart)} – ${toTime(profile.workEnd)}`, icon: Sun, tone: 'bg-card-lime' },
    { id: 'reminders', title: 'Notifications', desc: profile.remindersEnabled ? 'On' : 'Off', icon: Bell, tone: 'bg-card-sun' },
    { id: 'email', title: 'Nightly email', desc: profile.emailEnabled ? `At ${profile.emailTime}` : 'Off', icon: Mail, tone: 'bg-card-coral' },
    { id: 'look', title: 'Look & voice', desc: profile.theme === 'system' ? 'Auto theme' : profile.theme === 'dark' ? 'Dark theme' : 'Light theme', icon: Palette, tone: 'bg-card-cream' },
    { id: 'data', title: 'Your data', desc: 'Export or delete', icon: Database, tone: 'bg-card-mist' },
  ];

  const requested = params.get('section') as SectionId | null;
  const [mobileOpen, setMobileOpen] = useState<SectionId | null>(requested);
  const [desktop, setDesktop] = useState<SectionId>(requested ?? 'ai');
  useEffect(() => {
    if (requested) {
      setDesktop(requested);
      setMobileOpen(requested);
    }
  }, [requested]);

  const open = (id: SectionId) => {
    setDesktop(id);
    setMobileOpen(id);
    setParams(id ? { section: id } : {}, { replace: true });
  };

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

  const content = (id: SectionId): ReactNode => {
    switch (id) {
      case 'account':
        return <AccountSection />;
      case 'ai':
        return <AiSection />;
      case 'reminders':
        return <NotificationsSection profile={profile} />;
      case 'email':
        return <EmailSection profile={profile} />;
      case 'day':
        return (
          <Section title="Your day">
            <div className="grid grid-cols-2 gap-3">
              <TimeField label="Day starts" value={profile.workStart} onChange={(v) => void save({ workStart: v })} />
              <TimeField label="Day ends" value={profile.workEnd} onChange={(v) => void save({ workEnd: v })} />
              <TimeField label="Best focus from" value={profile.peakStart} onChange={(v) => void save({ peakStart: v })} hint="Hard tasks go here." />
              <TimeField label="Best focus until" value={profile.peakEnd} onChange={(v) => void save({ peakEnd: v })} />
            </div>
            <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-muted hover:text-fg">
              Advanced <ChevronDown size={16} className={`transition ${advanced ? 'rotate-180' : ''}`} />
            </button>
            {advanced && (
              <div className="grid gap-4 rounded-[20px] bg-surface-2/60 p-4">
                <Field label="Timezone" hint="Day boundaries, reminders and emails follow this.">
                  {(fid) => (
                    <select id={fid} className={fieldClass} value={profile.timezone} onChange={(e) => void save({ timezone: e.target.value })}>
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Most focused work per day (hours)" hint="Dayflow won’t plan more than this; if a deadline needs more, it warns you.">
                  {(fid) => (
                    <input id={fid} type="number" min={1} max={14} step={0.5} className={fieldClass} value={profile.maxFocusMin / 60} onChange={(e) => e.target.value && void save({ maxFocusMin: Math.round(+e.target.value * 60) })} />
                  )}
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Longest block">{(fid) => <input id={fid} type="number" min={20} step={5} className={fieldClass} value={profile.maxChunkMin} onChange={(e) => e.target.value && void save({ maxChunkMin: +e.target.value })} />}</Field>
                  <Field label="Break (min)">{(fid) => <input id={fid} type="number" min={0} step={5} className={fieldClass} value={profile.breakMin} onChange={(e) => e.target.value && void save({ breakMin: +e.target.value })} />}</Field>
                  <Field label="Buffer (min)">{(fid) => <input id={fid} type="number" min={0} step={5} className={fieldClass} value={profile.bufferMin} onChange={(e) => e.target.value && void save({ bufferMin: +e.target.value })} />}</Field>
                </div>
              </div>
            )}
            {learned.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">What Dayflow has learned</p>
                <ul className="grid gap-2 text-sm">
                  {learned.map(([category, s]) => (
                    <li key={category} className="flex justify-between gap-3 rounded-[16px] bg-surface-2 px-4 py-3">
                      <span className="font-medium capitalize">{category}</span>
                      <span className="text-muted">{s.ratio >= 1 ? `takes ${Math.round((s.ratio - 1) * 100)}% longer` : `${Math.round((1 - s.ratio) * 100)}% quicker`} than estimated</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        );
      case 'look':
        return (
          <Section title="Look & voice">
            <div>
              <p className="mb-2 text-sm font-medium">Theme</p>
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
              hint={
                profile.voiceLang.startsWith('en')
                  ? undefined
                  : aiOn
                    ? 'The smart assistant understands this language.'
                    : 'Speech is written down in this language; turn on the smart assistant so Dayflow understands it too.'
              }
            >
              {(fid) => (
                <select id={fid} className={fieldClass} value={profile.voiceLang} onChange={(e) => void save({ voiceLang: e.target.value })}>
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
                className="justify-self-start"
                onClick={async () => {
                  await installEvent.prompt();
                  setInstallEvent(null);
                }}
              >
                <Smartphone size={16} /> Install Dayflow
              </Button>
            ) : (
              <p className="text-sm text-muted">Install it like an app with your browser’s “Install app” or “Add to Home Screen”. It then works offline.</p>
            )}
          </Section>
        );
      case 'data':
        return (
          <Section title="Your data">
            <p className="-mt-2 text-sm text-muted">{signedIn ? 'Stored on this device and backed up to your account.' : 'Everything stays on this device until you sign in.'}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={async () => download(`dayflow-${new Date().toISOString().slice(0, 10)}.json`, (await exportAll()).json, 'application/json')}>
                <Download size={15} /> JSON
              </Button>
              <Button size="sm" onClick={async () => download(`dayflow-tasks-${new Date().toISOString().slice(0, 10)}.csv`, (await exportAll()).csv, 'text/csv')}>
                <Download size={15} /> CSV
              </Button>
              <Button size="sm" onClick={() => download('dayflow-plan.ics', buildIcs(tasks.filter((t) => isActive(t) || t.fixedStart !== undefined), profile.timezone), 'text/calendar')}>
                <CalendarDays size={15} /> Calendar file
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="justify-self-start !text-red-700 dark:!text-red-300" onClick={() => setConfirmClear(true)}>
              <Trash2 size={15} /> Delete everything
            </Button>
          </Section>
        );
    }
  };

  const list = (activeId: SectionId | null) => (
    <ul className="grid gap-2">
      {sections.map((s) => {
        const Icon = s.icon;
        const active = activeId === s.id;
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => open(s.id)}
              className={`relative flex w-full items-center gap-3 rounded-[18px] p-3 text-left transition ${
                active ? 'bg-surface-2 ring-1 ring-fg/10' : 'hover:bg-surface-2/60'
              }`}
            >
              {/* the open section gets a bar on its left edge, like a bookmark */}
              {active && <span aria-hidden className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-fg" />}
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink ${s.tone} ${active ? 'ring-2 ring-fg' : ''}`}>
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${active ? 'font-semibold text-fg' : 'font-medium text-fg/80'}`}>{s.title}</span>
                <span className="block truncate text-xs font-medium text-muted">{s.desc}</span>
              </span>
              <ChevronRight size={18} className={active ? 'text-fg' : 'text-muted lg:hidden'} />
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      <header className="mb-6 lg:mb-8">
        <p className="text-sm font-medium text-muted">Make Dayflow yours</p>
        <h1 className="mt-1 text-[32px] font-semibold leading-none tracking-tight lg:text-[40px]">Settings</h1>
      </header>

      {error && (
        <p role="alert" className="tint mb-4 rounded-[20px] bg-card-coral p-4 text-sm font-medium text-ink">
          {error}
        </p>
      )}

      {!isDesktop ? (
        /* phones: a menu, then one section at a time */
        mobileOpen ? (
          <div className="grid gap-4">
            <button type="button" onClick={() => { setMobileOpen(null); setParams({}, { replace: true }); }} className="inline-flex items-center gap-1 justify-self-start rounded-full bg-surface px-4 py-2 text-sm font-semibold">
              <ChevronLeft size={16} /> All settings
            </button>
            {content(mobileOpen)}
          </div>
        ) : (
          list(null)
        )
      ) : (
        /* desktop: menu on the left, the open section on the right */
        <div className="grid grid-cols-[280px_1fr] gap-8">
          <nav aria-label="Settings sections">{list(desktop)}</nav>
          <div className="min-w-0 max-w-2xl">{content(desktop)}</div>
        </div>
      )}

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Delete everything?">
        <p className="mb-5 text-muted">
          This removes every task, habit and history entry from this device{signedIn ? ' and from your account' : ''}. It can’t be undone, so download a JSON backup
          first if you might want it back.{signedIn ? ' Events already added to Google Calendar stay there.' : ''}
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
