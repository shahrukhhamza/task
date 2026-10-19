import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dailyBrief, useAiAvailable, type DayContext } from '../../lib/ai/assistant';
import { AI_ERROR_TEXT, AiError } from '../../../supabase/functions/_shared/gemini.ts';

const KEY = 'dayflow-brief';
/** Adding tasks updates the plan in a few quick steps; wait for it to settle before writing. */
const SETTLE_MS = 1500;

interface Cached {
  day: string;
  signature: string;
  text: string;
}

function read(): Cached | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Cached | null;
  } catch {
    return null;
  }
}

/**
 * One short AI brief per day. It is generated once the plan has settled and then cached,
 * so the free quota is spent on purpose; when the plan changes the card offers a refresh.
 */
export function useDailyBrief(day: string, context: DayContext | null) {
  const available = useAiAvailable();
  const [cached, setCached] = useState<Cached | null>(read);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // what's on the plan matters; small time shifts from re-planning don't
  const signature = useMemo(
    () => (context ? [...new Set(context.items.map((i) => i.title))].sort().join('|') + `#${context.done}` : ''),
    [context],
  );

  // the latest plan, read when the request actually goes out
  const latest = useRef({ context, signature });
  latest.current = { context, signature };

  const generate = useCallback(async () => {
    const { context: ctx, signature: sig } = latest.current;
    if (!ctx) return;
    setLoading(true);
    setError(null);
    try {
      const text = await dailyBrief(ctx);
      const next = { day, signature: sig, text };
      setCached(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* fine: it just won't survive a reload */
      }
    } catch (err) {
      setError(err instanceof AiError ? AI_ERROR_TEXT[err.code] : 'Couldn’t get a brief right now.');
    } finally {
      setLoading(false);
    }
  }, [day]);

  const hasPlan = !!context && context.items.length > 0;
  const fresh = cached?.day === day ? cached : null;

  useEffect(() => {
    if (!available || !hasPlan || fresh || loading || error) return;
    const timer = setTimeout(() => void generate(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [available, hasPlan, fresh, loading, error, signature, generate]);

  return {
    available,
    hasPlan,
    text: fresh?.text ?? null,
    stale: !!fresh && fresh.signature !== signature,
    loading,
    error,
    refresh: generate,
  };
}
