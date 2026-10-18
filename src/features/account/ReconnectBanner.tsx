import { TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui';
import { signInWithGoogle } from '../../lib/cloud/session';
import { useCloud } from '../../store/cloud';

/** Shown on Today when Google access expired, so a stale calendar never goes unnoticed. */
export function ReconnectBanner() {
  const google = useCloud((s) => s.google);
  const user = useCloud((s) => s.user);
  if (!user || google !== 'reconnect') return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-900/25 dark:text-amber-100">
      <TriangleAlert size={18} className="shrink-0" />
      <p className="flex-1">Google Calendar access expired, so new events aren’t being imported.</p>
      <Button size="sm" variant="primary" onClick={() => void signInWithGoogle()}>
        Reconnect Google
      </Button>
    </div>
  );
}
