import { Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AI_ERROR_TEXT, AiError, chooseModel } from '../../../supabase/functions/_shared/gemini.ts';
import { Button, Card, Segmented, fieldClass } from '../../components/ui';
import { aiReady, useAi } from '../../lib/ai/settings';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

const PERKS = [
  'Understands anything you type or say, in any language, including Urdu',
  'Breaks big tasks into small steps with time estimates',
  'Writes a short brief for your day',
  'Takes a deeper look at your week',
];

/** Turn Gemini on with a free key from Google AI Studio. */
export function AiSection() {
  const ai = useAi();
  const signedIn = useCloud((s) => !!s.user);
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = aiReady({ enabled: true, key: ai.key });

  const connect = async () => {
    const key = draft.trim();
    if (!key) return;
    setChecking(true);
    setError(null);
    try {
      const model = await chooseModel(key);
      ai.update({ key, model, enabled: true });
      setDraft('');
      toast('Smart assistant is on.');
    } catch (err) {
      setError(err instanceof AiError ? AI_ERROR_TEXT[err.code] : 'Couldn’t check that key.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="relative overflow-hidden rounded-[28px] bg-card-lilac p-6 text-ink">
        <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[22px] border-ink/[0.06]" />
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white">
          <Sparkles size={20} />
        </span>
        <h2 className="mt-4 text-2xl font-semibold">Smart assistant</h2>
        <p className="mt-1 font-medium opacity-70">Gemini makes Dayflow understand you better. Free, optional, and off unless you turn it on.</p>
        <ul className="mt-4 grid gap-2">
          {PERKS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm font-medium">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" /> {p}
            </li>
          ))}
        </ul>
      </div>

      <Card className="grid gap-4">
        {connected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Connected</p>
                <p className="text-sm text-muted">Using {ai.model || 'Gemini Flash'} with your key</p>
              </div>
              <Segmented
                label="Smart assistant"
                value={ai.enabled ? 'on' : 'off'}
                onChange={(v) => ai.update({ enabled: v === 'on' })}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>
            {ai.error && <p className="rounded-2xl bg-card-coral p-3 text-sm font-medium text-ink">{ai.error}</p>}
            <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => ai.update({ key: '', model: '', enabled: false })}>
              Remove key from this device
            </Button>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="gemini-key" className="mb-1.5 block text-sm font-medium">
                Gemini API key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="gemini-key"
                    type={show ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${fieldClass} pr-11 font-mono`}
                    placeholder="AIza…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void connect()}
                  />
                  <button type="button" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <Button variant="primary" onClick={() => void connect()} disabled={!draft.trim() || checking}>
                  {checking ? <Loader2 size={16} className="animate-spin" /> : null} Connect
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}
            </div>
            <ol className="grid gap-1.5 rounded-[20px] bg-surface-2 p-4 text-sm">
              <li>
                <span className="font-semibold">1.</span> Open{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  aistudio.google.com/apikey
                </a>{' '}
                and sign in with Google.
              </li>
              <li>
                <span className="font-semibold">2.</span> Click <span className="font-semibold">Create API key</span> (free, no card needed).
              </li>
              <li>
                <span className="font-semibold">3.</span> Copy it, paste it above and press Connect.
              </li>
            </ol>
            {signedIn && (
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-5 w-5 accent-[var(--app-fg)]" checked={ai.enabled} onChange={(e) => ai.update({ enabled: e.target.checked })} />
                Use the server’s key instead, if it has one
              </label>
            )}
          </>
        )}
        <p className="text-xs leading-relaxed text-muted">
          The key stays on this device only and is never synced. What you type is sent to Google to be understood; on the free tier Google may use it to
          improve its products. Without the assistant, Dayflow still works fully with its built-in parser.
        </p>
      </Card>
    </div>
  );
}
