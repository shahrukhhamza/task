// Thin client for Google's Gemini API (free tier from Google AI Studio).
// Every call has a timeout and maps failures to a small set of codes, so callers can
// quietly fall back to the rule-based features.

const API = 'https://generativelanguage.googleapis.com/v1beta';

export type AiErrorCode = 'off' | 'invalid_key' | 'rate_limited' | 'blocked' | 'bad_response' | 'network' | 'timeout' | 'no_model';

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const AI_ERROR_TEXT: Record<AiErrorCode, string> = {
  off: 'Smart assistant is off.',
  invalid_key: 'Google rejected the API key. Check it in Settings → Smart assistant.',
  rate_limited: 'Gemini’s free limit is used up for now. Dayflow will use its built-in parser until it resets.',
  blocked: 'Gemini declined to answer that one.',
  bad_response: 'Gemini sent back something Dayflow couldn’t read.',
  network: 'Couldn’t reach Gemini. Check your connection.',
  timeout: 'Gemini took too long to answer.',
  no_model: 'This key has no Gemini Flash model available.',
};

/** OpenAPI-style schema Gemini uses for structured output. */
export type Schema = {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN';
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
  required?: string[];
  nullable?: boolean;
  description?: string;
};

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
}

interface ModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

/**
 * Picks the best free "Flash" model the key can use: stable before preview, then the
 * newest version, then full Flash before Lite. Model names change often, so this
 * asks Google rather than hard-coding one.
 */
export function pickModel(models: ModelInfo[]): string | null {
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(tts|image|audio|live|thinking|embedding|native)/.test(n));
  if (!usable.length) {
    const alias = models.find((m) => m.name.replace(/^models\//, '') === 'gemini-flash-latest');
    return alias ? 'gemini-flash-latest' : null;
  }

  const version = (n: string) => parseFloat(/^gemini-([\d.]+)/.exec(n)?.[1] ?? '0');
  const rank = (n: string) =>
    [
      /(preview|exp)/.test(n) ? 0 : 1, // previews come and go; stable first
      version(n),
      /-lite/.test(n) ? 0 : 1, // full Flash understands messy input better than Lite
      /-\d{3,}$/.test(n) ? 0 : 1, // prefer the stable alias over dated snapshots
    ] as const;
  return usable.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return a.localeCompare(b);
  })[0];
}

async function call(url: string, init: RequestInit, timeoutMs: number, fetchFn: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiError('timeout');
    throw new AiError('network', (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

function failure(status: number, body: { error?: { message?: string; status?: string } }): AiError {
  const message = body.error?.message ?? `HTTP ${status}`;
  if (status === 400 && /api key/i.test(message)) return new AiError('invalid_key', message);
  if (status === 401 || status === 403) return new AiError('invalid_key', message);
  if (status === 429) return new AiError('rate_limited', message);
  if (status === 404) return new AiError('no_model', message);
  return new AiError('bad_response', message);
}

/** Lists models for a key and returns the one Dayflow should use. */
export async function chooseModel(key: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await call(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, 10_000, fetchFn);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res.status, body);
  const model = pickModel((body as { models?: ModelInfo[] }).models ?? []);
  if (!model) throw new AiError('no_model');
  return model;
}

/** One structured-output request straight to Gemini with the user's own key. */
export async function generateJson<T>(key: string, model: string, req: JsonRequest, fetchFn: typeof fetch = fetch, timeoutMs = 15_000): Promise<T> {
  const res = await call(
    `${API}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          responseMimeType: 'application/json',
          responseSchema: req.schema,
        },
      }),
    },
    timeoutMs,
    fetchFn,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res.status, body);
  return readJson<T>(body);
}

/** Pulls the JSON answer out of a generateContent response. */
export function readJson<T>(body: unknown): T {
  const b = body as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (b.promptFeedback?.blockReason) throw new AiError('blocked', b.promptFeedback.blockReason);
  const candidate = b.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') throw new AiError('blocked');
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
  } catch {
    throw new AiError('bad_response', 'The answer was not valid JSON.');
  }
}
