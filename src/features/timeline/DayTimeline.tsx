import { TaskNumber } from '../../components/TaskNumber';
import { Check, CheckCircle2, GripVertical, Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { layoutLanes } from '../../lib/layout';
import { completeTask, moveBlock, moveFixedTask } from '../../lib/db/actions';
import type { FixedItem } from '../../lib/scheduler';
import { addDaysTz, formatDuration, formatTime, isSameDayTz, minutesOfDay, MIN, startOfDayTz } from '../../lib/time/tz';
import type { Block, Profile, Task } from '../../lib/types';
import { useUi } from '../../store/ui';
import { categoryStyle } from './categoryStyle';
import { useDragMove } from './useDragMove';

const PX_PER_MIN = 1.15;

interface Item {
  key: string;
  start: number;
  end: number;
  title: string;
  task?: Task;
  block?: Block;
  fixed?: FixedItem;
}

interface DayTimelineProps {
  /** Any timestamp inside the day to show. */
  day: number;
  tasks: Task[];
  fixedItems: FixedItem[];
  profile: Profile;
  now: number;
}

export function DayTimeline({ day, tasks, fixedItems, profile, now }: DayTimelineProps) {
  const tz = profile.timezone;
  const dayStart = startOfDayTz(day, tz);
  const dayEnd = startOfDayTz(addDaysTz(dayStart, 1, tz), tz);
  const isToday = isSameDayTz(day, now, tz);
  const nowRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'dropped') continue;
      for (const block of task.blocks) {
        if (block.end > dayStart && block.start < dayEnd) {
          out.push({ key: block.id, start: block.start, end: block.end, title: task.title, task, block });
        }
      }
    }
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const f of fixedItems) {
      if (f.end > dayStart && f.start < dayEnd) {
        out.push({ key: f.id, start: f.start, end: f.end, title: f.title, fixed: f, task: f.taskId ? byId.get(f.taskId) : undefined });
      }
    }
    return out;
  }, [tasks, fixedItems, dayStart, dayEnd]);

  const lanes = useMemo(() => layoutLanes(items), [items]);

  // visible range: working hours, widened to fit anything outside them
  const toMin = (ts: number) => Math.min(24 * 60, Math.max(0, Math.round((ts - dayStart) / MIN)));
  let startMin = profile.workStart;
  let endMin = profile.workEnd;
  for (const it of items) {
    startMin = Math.min(startMin, toMin(it.start));
    endMin = Math.max(endMin, toMin(it.end));
  }
  startMin = Math.floor(startMin / 60) * 60;
  endMin = Math.min(24 * 60, Math.ceil(endMin / 60) * 60);
  const nowMin = minutesOfDay(now, tz);
  const showNow = isToday && nowMin >= startMin && nowMin <= endMin;
  const height = (endMin - startMin) * PX_PER_MIN;
  const y = (min: number) => (min - startMin) * PX_PER_MIN;
  const hours = Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin + i * 60);

  // bring "now" into view when a day is first shown (not on every minute tick)
  useEffect(() => {
    if (showNow) nowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dayStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (h: number) => {
    const d = h % 24;
    const suffix = d >= 12 ? 'PM' : 'AM';
    return `${d % 12 === 0 ? 12 : d % 12} ${suffix}`;
  };

  return (
    <div className="relative ml-12 select-none" style={{ height }} role="list" aria-label="Schedule">
      {/* hour grid */}
      {hours.map((m) => (
        <div key={m} className="absolute inset-x-0 border-t border-line" style={{ top: y(m) }}>
          <span className="absolute -left-12 -top-2.5 w-10 text-right text-[11px] font-medium text-muted">
            {m < 24 * 60 ? label(m / 60) : ''}
          </span>
        </div>
      ))}

      {/* peak focus band */}
      {profile.peakEnd > startMin && profile.peakStart < endMin && (
        <div
          aria-hidden
          className="absolute inset-x-0 rounded-xl bg-card-lime/20"
          style={{ top: y(Math.max(profile.peakStart, startMin)), height: (Math.min(profile.peakEnd, endMin) - Math.max(profile.peakStart, startMin)) * PX_PER_MIN }}
        >
          <span className="absolute right-2 top-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Peak focus
          </span>
        </div>
      )}

      {items.map((item, i) => {
        const top = y(Math.max(toMin(item.start), startMin));
        const h = Math.max(22, (toMin(item.end) - Math.max(toMin(item.start), startMin)) * PX_PER_MIN - 2);
        const { lane, lanes: count } = lanes[i];
        return (
          <TimelineItem
            key={item.key}
            item={item}
            style={{ top, height: h, left: `${(lane / count) * 100}%`, width: `calc(${100 / count}% - 4px)` }}
            tz={tz}
            now={now}
          />
        );
      })}

      {showNow && (
        <div
          ref={nowRef}
          aria-label={`Now, ${formatTime(now, tz)}`}
          className="pointer-events-none absolute -left-1.5 right-0 z-20 flex items-center text-red-500"
          style={{ top: y(nowMin) }}
        >
          <span className="h-3 w-3 rounded-full bg-current" />
          <span className="h-0.5 flex-1 bg-current" />
        </div>
      )}
    </div>
  );
}

function TimelineItem({ item, style, tz, now }: { item: Item; style: React.CSSProperties; tz: string; now: number }) {
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);
  const { task, block, fixed } = item;

  const draggable = !!block || (!!fixed && fixed.source === 'task' && !fixed.done);
  const commit = async (deltaMin: number) => {
    const newStart = item.start + deltaMin * MIN;
    const result = block && task ? await moveBlock(task.id, block.id, newStart) : fixed?.taskId ? await moveFixedTask(fixed.taskId, newStart) : undefined;
    if (!result) return;
    if (result.ok) toast(`Moved to ${formatTime(newStart, tz)}.`, { undo: result.undo });
    else toast(result.reason, { tone: 'error' });
  };

  const drag = useDragMove({ enabled: draggable, pxPerMin: PX_PER_MIN, onCommit: commit });
  const open = () => {
    if (drag.consumeDrag()) return;
    if (task) select(task.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    } else if (e.altKey && draggable && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      void commit(e.key === 'ArrowUp' ? -15 : 15);
    }
  };

  const done = fixed?.done || task?.status === 'done';
  const missed = !!block && item.end < now && !done;
  const current = item.start <= now && now < item.end && !done;
  const external = fixed?.source === 'event';
  const shifted = drag.offsetMin * MIN;

  const tone = external
    ? 'border border-dashed border-fg/30 bg-surface-2 text-fg'
    : categoryStyle(task?.category ?? 'general');

  const spoken = `${item.title}, ${formatTime(item.start, tz)} to ${formatTime(item.end, tz)}${
    block && block.chunks > 1 ? `, part ${block.chunk} of ${block.chunks}` : ''
  }${missed ? ', missed' : ''}${current ? ', happening now' : ''}${done ? ', done' : ''}`;

  return (
    <div
      role="listitem"
      aria-label={spoken}
      tabIndex={0}
      aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onClick={open}
      onKeyDown={onKeyDown}
      {...drag.bind}
      style={{ ...style, transform: drag.offsetMin ? `translateY(${drag.offsetMin * PX_PER_MIN}px)` : undefined }}
      className={`group absolute overflow-hidden rounded-2xl px-2.5 py-1.5 text-left text-xs ${tone} ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${current ? 'ring-2 ring-fg' : ''} ${done ? 'opacity-55' : ''} ${missed ? 'opacity-75 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.06)_6px_12px)]' : ''} ${
        drag.offsetMin ? 'z-30 shadow-lg' : ''
      }`}
    >
      <div className="flex items-start gap-1">
        {task && !done && block && (
          <button
            type="button"
            data-no-drag
            aria-label={`Mark ${item.title} done`}
            onClick={async (e) => {
              e.stopPropagation();
              const undo = await completeTask(task.id);
              toast(`Done: “${task.title}”.`, { undo });
            }}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current opacity-70 hover:bg-white/60 hover:opacity-100"
          >
            <Check size={10} className="opacity-0 group-hover:opacity-100" />
          </button>
        )}
        {done && <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className={`truncate font-medium ${done ? 'line-through' : ''}`}>
            <TaskNumber id={task?.id} className="mr-1 !h-4 !min-w-4 !rounded-md !px-1 !text-[10px] align-[1px]" />
            {item.title}
            {block && block.chunks > 1 && <span className="ml-1 font-normal opacity-70">{block.chunk}/{block.chunks}</span>}
          </div>
          <div className="truncate opacity-80">
            {formatTime(item.start + shifted, tz)} – {formatTime(item.end + shifted, tz)}
            {' · '}
            {formatDuration((item.end - item.start) / MIN)}
            {missed && ' · missed'}
          </div>
        </div>
        {block?.locked && <Lock size={11} aria-label="Pinned" className="mt-0.5 shrink-0 opacity-60" />}
        {draggable && (
          <span
            data-drag-handle
            aria-hidden
            className="-mr-1 shrink-0 cursor-grab touch-none rounded p-0.5 opacity-60 [@media(hover:hover)]:hidden"
          >
            <GripVertical size={14} />
          </span>
        )}
      </div>
    </div>
  );
}
