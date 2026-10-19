import { useTaskNumber } from '../hooks/useTaskNumbers';

/** The small number on a task, so you can say "task 2". Renders nothing for things that aren't numbered (calendar events). */
export function TaskNumber({ id, className = '' }: { id?: string; className?: string }) {
  const n = useTaskNumber(id);
  if (n === undefined) return null;
  return (
    <span
      title={`Say “task ${n}”`}
      className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-lg bg-fg/10 px-1.5 text-xs font-bold tabular-nums ${className}`}
    >
      <span aria-hidden>{n}</span>
      <span className="sr-only">Task {n}</span>
    </span>
  );
}
