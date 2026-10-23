import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore, type ToastKind } from '@/store/useAppStore';
import { IconButton } from './Button';

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

const TONES: Record<ToastKind, string> = {
  info: 'border-panel-700 text-ink-300',
  success: 'border-signal-ok/40 text-signal-ok',
  warn: 'border-signal-warn/40 text-signal-warn',
  error: 'border-signal-error/40 text-signal-error',
};

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={clsx(
              'pointer-events-auto flex gap-3 rounded-lg border bg-panel-850/95 p-3 shadow-pop backdrop-blur',
              TONES[toast.kind],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink-100">{toast.title}</p>
              {toast.message ? (
                <p className="selectable mt-0.5 break-words text-2xs leading-relaxed text-ink-400">{toast.message}</p>
              ) : null}
              {toast.hint ? (
                <p className="mt-1 text-2xs leading-relaxed text-ink-500">{toast.hint}</p>
              ) : null}
              {toast.action ? (
                <button
                  type="button"
                  onClick={() => {
                    toast.action!.run();
                    dismiss(toast.id);
                  }}
                  className="mt-1.5 text-2xs font-medium text-accent-hover hover:underline"
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>
            <IconButton label="Dismiss" onClick={() => dismiss(toast.id)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
