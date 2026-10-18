import { RefreshCw } from 'lucide-react';
import { Bento, IconButton } from '../../components/ui';
import { signInWithGoogle } from '../../lib/cloud/session';
import { useCloud } from '../../store/cloud';

/** Shown on Today when Google access expired, so a stale calendar never goes unnoticed. */
export function ReconnectBanner() {
  const google = useCloud((s) => s.google);
  const user = useCloud((s) => s.user);
  if (!user || google !== 'reconnect') return null;
  return (
    <Bento tone="coral" className="mb-4 flex items-center gap-3 !py-4" role="alert">
      <p className="min-w-0 flex-1 font-semibold">Google Calendar needs reconnecting, so new events aren’t coming in.</p>
      <IconButton label="Reconnect Google" onClick={() => void signInWithGoogle()}>
        <RefreshCw size={18} />
      </IconButton>
    </Bento>
  );
}
