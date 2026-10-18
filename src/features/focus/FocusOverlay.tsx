import { Check, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addFocusMinutes, completeTask, startTask } from '../../lib/db/actions';
import type { Task } from '../../lib/types';
import { useUi } from '../../store/ui';

type Phase = 'focus' | 'short' | 'long';

const PRESETS = {
  classic: { label: '25 / 5', focus: 25, short: 5, long: 15 },
  deep: { label: '50 / 10', focus: 50, short: 10, long: 20 },
} as const;

const PHASE_LABEL: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function beep(ctx: AudioContext | null) {
  try {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch {
    /* audio is a nice-to-have */
  }
}

/** Pomodoro timer for one task, shown full-screen with nothing else competing for attention. */
export function FocusOverlay({ task }: { task: Task }) {
  const stop = useUi((s) => s.stopFocus);
  const toast = useUi((s) => s.toast);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('classic');
  const [phase, setPhase] = useState<Phase>('focus');
  const [cycle, setCycle] = useState(0);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState<number>(PRESETS.classic.focus * 60_000);
  const [tick, setTick] = useState(0);
  const [announce, setAnnounce] = useState('');

  const endsAt = useRef(0);
  const runStart = useRef<number | null>(null);
  const accumMs = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);
  const started = useRef(false);

  const lengthMs = useCallback(
    (p: Phase, key = preset) => PRESETS[key][p] * 60_000,
    [preset],
  );

  /** Adds the focus time run so far (rounded to whole minutes) to the task and resets the counter. */
  const logFocus = useCallback(async () => {
    if (runStart.current !== null) {
      accumMs.current += Date.now() - runStart.current;
      runStart.current = null;
    }
    const minutes = Math.round(accumMs.current / 60_000);
    accumMs.current = 0;
    if (minutes >= 1) await addFocusMinutes(task.id, minutes);
  }, [task.id]);

  const alertUser = useCallback((message: string) => {
    setAnnounce(message);
    beep(audio.current);
    navigator.vibrate?.([200, 100, 200]);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification('Dayflow', { body: message });
    }
  }, []);

  const finishPhase = useCallback(async () => {
    if (phase === 'focus') {
      await logFocus();
      const nextCycle = cycle + 1;
      const next: Phase = nextCycle % 4 === 0 ? 'long' : 'short';
      setCycle(nextCycle);
      setPhase(next);
      setRemaining(lengthMs(next));
      endsAt.current = Date.now() + lengthMs(next);
      alertUser(`${PHASE_LABEL[next]}. Nice work, ${nextCycle} focus ${nextCycle === 1 ? 'session' : 'sessions'} done.`);
    } else {
      setPhase('focus');
      setRemaining(lengthMs('focus'));
      setRunning(false);
      alertUser('Break over. Ready when you are.');
    }
  }, [phase, cycle, logFocus, lengthMs, alertUser]);

  // the clock is derived from timestamps, so a throttled background tab can't drift
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = endsAt.current - Date.now();
      setRemaining(Math.max(0, left));
      setTick((t) => t + 1);
      if (left <= 0) void finishPhase();
    }, 250);
    return () => clearInterval(id);
  }, [running, finishPhase]);

  const toggle = async () => {
    if (!audio.current) {
      try {
        audio.current = new AudioContext();
      } catch {
        /* no audio */
      }
    }
    if (running) {
      if (phase === 'focus' && runStart.current !== null) accumMs.current += Date.now() - runStart.current;
      runStart.current = null;
      setRemaining(Math.max(0, endsAt.current - Date.now()));
      setRunning(false);
      return;
    }
    endsAt.current = Date.now() + remaining;
    if (phase === 'focus') {
      runStart.current = Date.now();
      if (!started.current && task.status !== 'doing' && task.fixedStart === undefined) {
        started.current = true;
        await startTask(task.id);
      }
    }
    setRunning(true);
  };

  const reset = () => {
    setRunning(false);
    runStart.current = null;
    setRemaining(lengthMs(phase));
  };

  const changePreset = (key: keyof typeof PRESETS) => {
    setPreset(key);
    if (!running && phase === 'focus') setRemaining(lengthMs('focus', key));
  };

  const exit = useCallback(async () => {
    setRunning(false);
    await logFocus();
    stop();
  }, [logFocus, stop]);

  const finishTask = async () => {
    await exit();
    const undo = await completeTask(task.id);
    toast(`Done: “${task.title}”.`, { undo });
  };

  // Esc leaves; the screen stays awake while the timer is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void exit();
      if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        void toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request('screen').then((lock) => (wakeLock.current = lock)).catch(() => {});
    return () => void wakeLock.current?.release().catch(() => {});
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = running ? `${mmss(remaining)} · ${PHASE_LABEL[phase]}` : previous;
    return () => {
      document.title = previous;
    };
  }, [remaining, running, phase, tick]);

  const total = lengthMs(phase);
  const progress = useMemo(() => 1 - remaining / total, [remaining, total]);
  const radius = 120;
  const circumference = 2 * Math.PI * radius;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Focus timer for ${task.title}`} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-slate-950 p-6 text-white">
      <button
        type="button"
        onClick={() => void exit()}
        aria-label="Exit focus mode"
        className="absolute right-4 top-4 rounded-full p-2 text-slate-300 hover:bg-white/10"
      >
        <X size={22} />
      </button>

      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-teal-300">{PHASE_LABEL[phase]}</p>
        <h2 className="mt-2 max-w-sm text-2xl font-semibold">{task.title}</h2>
      </div>

      <div className="relative flex h-72 w-72 items-center justify-center">
        <svg viewBox="0 0 280 280" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="140" cy="140" r={radius} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="10" />
          <circle
            cx="140"
            cy="140"
            r={radius}
            fill="none"
            stroke={phase === 'focus' ? '#2dd4bf' : '#fbbf24'}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          />
        </svg>
        <span role="timer" aria-live="off" className="text-6xl font-light tabular-nums tracking-tight">
          {mmss(remaining)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={reset} aria-label="Reset timer" className="rounded-full p-3 text-slate-300 hover:bg-white/10">
          <RotateCcw size={22} />
        </button>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={running ? 'Pause' : 'Start'}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-500 text-slate-950 hover:bg-teal-400"
        >
          {running ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
        </button>
        <button
          type="button"
          onClick={() => void finishTask()}
          aria-label="Mark task done"
          className="rounded-full p-3 text-slate-300 hover:bg-white/10"
        >
          <Check size={22} />
        </button>
      </div>

      <div className="flex flex-col items-center gap-3 text-sm text-slate-300">
        <div className="flex gap-1.5" aria-label={`${cycle} focus sessions completed`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i < cycle % 4 || (cycle > 0 && cycle % 4 === 0) ? 'bg-teal-400' : 'bg-white/20'}`} />
          ))}
        </div>
        <div className="flex gap-2" role="group" aria-label="Interval length">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => changePreset(key)}
              className={`rounded-full px-3 py-1 ${preset === key ? 'bg-white/20 text-white' : 'text-slate-300 hover:bg-white/10'}`}
            >
              {PRESETS[key].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">Space to start or pause · Esc to leave</p>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
