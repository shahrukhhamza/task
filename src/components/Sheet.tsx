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
      className={`m-0 mt-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-line bg-surface p-0 text-fg shadow-[0_24px_80px_-20px_rgb(0_0_0/0.35)] sm:m-auto sm:rounded-[24px] ${wide ? 'max-w-2xl' : 'max-w-xl'}`}
    >
      {open && (
        <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-5">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-fg/15 sm:hidden" aria-hidden />
          <div className={`flex items-start justify-between gap-3 ${bare ? 'mb-1' : 'mb-4'}`}>
            <h2 className={bare ? 'sr-only' : 'text-lg font-semibold'}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
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
