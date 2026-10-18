import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Hide the visible title (it is still announced to screen readers). */
  bare?: boolean;
}

/** Bottom sheet on phones, centred dialog on larger screens. Native <dialog> gives focus trapping and Esc. */
export function Sheet({ open, onClose, title, children, wide, bare }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-0 mt-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-[32px] bg-surface p-0 text-fg shadow-2xl sm:m-auto sm:rounded-[32px] ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-fg/15 sm:hidden" aria-hidden />
          <div className={`flex items-start justify-between gap-3 ${bare ? 'mb-1' : 'mb-4'}`}>
            <h2 className={bare ? 'sr-only' : 'text-xl font-bold'}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-fg hover:brightness-95"
            >
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
