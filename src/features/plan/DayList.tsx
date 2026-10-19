import { CalendarDays, Check } from 'lucide-react';
import { TaskNumber } from '../../components/TaskNumber';
import { completeTask } from '../../lib/db/actions';
import { formatDuration, formatTime, MIN } from '../../lib/time/tz';
import { useUi } from '../../store/ui';
import type { DayItem } from './dayItems';

const BAR: Record<string, string> = {
  study: 'bg-card-lilac',
  work: 'bg-card-sky',
  fitness: 'bg-card-lime',
  health: 'bg-card-coral',
  finance: 'bg-card-sun',
  social: 'bg-card-coral',
  home: 'bg-card-cream',
  personal: 'bg-card-lime',
};

/** The day as calm rows: time, a colour bar for the kind of work, the task, one tap to finish. */
export function DayList({ items, tz, now }: { items: DayItem[]; tz: string; now: number }) {
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);

  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const current = item.start <= now && now < item.end;
        const missed = item.kind === 'block' && item.end <= now;
        const category = item.task?.category ?? 'general';
        const meta = [
          `${formatTime(item.start, tz)} – ${formatTime(item.end, tz)}`,
          formatDuration((item.end - item.start) / MIN),
          item.kind === 'event' ? 'Calendar' : item.kind === 'appointment' ? 'Appointment' : '',
          item.block && item.block.chunks > 1 ? `part ${item.block.chunk}/${item.block.chunks}` : '',
        ].filter(Boolean);

        return (
          <li key={item.key}>
            <div className={`group flex items-center gap-3 rounded-[20px] px-3 py-3 transition ${current ? 'tint bg-card-lime text-ink' : 'hover:bg-surface-2'} ${missed ? 'opacity-60' : ''}`}>
              <span className={`h-10 w-1.5 shrink-0 rounded-full ${item.kind === 'event' ? 'bg-fg/20' : (BAR[category] ?? 'bg-card-mist')}`} aria-hidden />

              <button
                type="button"
                disabled={!item.task}
                onClick={() => item.task && select(item.task.id)}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
                aria-label={`${item.title}, ${formatTime(item.start, tz)} to ${formatTime(item.end, tz)}${current ? ', happening now' : ''}${missed ? ', missed' : ''}. Open details`}
              >
                <span className="flex items-center gap-2">
                  {item.kind === 'event' && <CalendarDays size={14} className="shrink-0 opacity-60" aria-hidden />}
                  <TaskNumber id={item.task?.id} className={current ? 'bg-ink/15' : ''} />
                  <span className="truncate text-[15px] font-semibold">{item.title}</span>
                  {current && <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Now</span>}
                  {missed && <span className="shrink-0 rounded-full bg-card-coral px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">Missed</span>}
                </span>
                <span className={`mt-0.5 block truncate text-[13px] font-medium ${current ? 'opacity-70' : 'text-muted'}`}>{meta.join(' · ')}</span>
              </button>

              {item.task && item.kind !== 'event' ? (
                <button
                  type="button"
                  aria-label={`Mark ${item.title} done`}
                  onClick={async () => {
                    const undo = await completeTask(item.task!.id);
                    toast(`Done: “${item.title}”. Nice.`, { undo });
                  }}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    current ? 'border-ink/40 hover:border-ink hover:bg-ink hover:text-white' : 'border-fg/20 text-transparent hover:border-fg hover:bg-fg hover:text-app'
                  }`}
                >
                  <Check size={16} strokeWidth={3} />
                </button>
              ) : (
                <span className="w-9 shrink-0" aria-hidden />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
