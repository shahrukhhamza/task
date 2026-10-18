import { Undo2, X } from 'lucide-react';
import { useUi } from '../store/ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-red-800 text-white' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          {t.undo && (
            <button
              type="button"
              onClick={async () => {
                dismiss(t.id);
                await t.undo?.();
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline"
            >
              <Undo2 size={14} /> Undo
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
