import { Undo2, X } from 'lucide-react';
import { useUi } from '../store/ui';

/** Messages float just above the bottom navigation. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[60] lg:bottom-8 lg:left-64 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full py-2.5 pl-5 pr-2 text-sm font-medium shadow-xl ${
            t.tone === 'error' ? 'bg-card-coral text-ink' : 'bg-ink text-white ring-1 ring-white/10'
          }`}
        >
          <span className="flex-1 py-1">{t.message}</span>
          {t.undo && (
            <button
              type="button"
              onClick={async () => {
                dismiss(t.id);
                await t.undo?.();
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-ink"
            >
              <Undo2 size={14} /> Undo
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0 rounded-full p-1.5 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
