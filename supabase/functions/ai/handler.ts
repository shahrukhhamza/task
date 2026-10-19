// Gemini proxy for signed-in users, so the API key can live on the server as a secret
// instead of on each device. The request shape is the same one the app uses directly.

import { AiError, chooseModel, generateJson, type JsonRequest } from '../_shared/gemini.ts';
import { corsHeaders, json } from '../_shared/http.ts';

export interface AiDeps {
  fetch: typeof fetch;
  apiKey: string;
  /** Optional fixed model; otherwise the best Flash model for the key is picked. */
  model?: string;
  authenticate(req: Request): Promise<string | null>;
}

const MAX_SYSTEM = 16_000;
const MAX_PROMPT = 6_000;

export function createAiHandler(deps: AiDeps) {
  let model = deps.model ?? '';

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!deps.apiKey) return json({ error: 'not_configured', message: 'The server has no Gemini key.' }, 503);

    const userId = await deps.authenticate(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = (await req.json().catch(() => null)) as Partial<JsonRequest> | null;
    if (!body || typeof body.system !== 'string' || typeof body.prompt !== 'string' || !body.schema || typeof body.schema !== 'object') {
      return json({ error: 'bad_request' }, 400);
    }
    if (body.system.length > MAX_SYSTEM || body.prompt.length > MAX_PROMPT) return json({ error: 'too_large' }, 413);

    const request: JsonRequest = {
      system: body.system,
      prompt: body.prompt,
      schema: body.schema,
      temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(1, body.temperature)) : 0.2,
    };

    try {
      if (!model) model = await chooseModel(deps.apiKey, deps.fetch);
      try {
        return json({ json: await generateJson(deps.apiKey, model, request, deps.fetch) });
      } catch (err) {
        if (err instanceof AiError && err.code === 'no_model' && !deps.model) {
          model = await chooseModel(deps.apiKey, deps.fetch);
          return json({ json: await generateJson(deps.apiKey, model, request, deps.fetch) });
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof AiError) {
        const status = err.code === 'rate_limited' ? 429 : err.code === 'invalid_key' ? 503 : 502;
        // never pass Google's raw message for key problems back to the browser
        const code = err.code === 'invalid_key' ? 'not_configured' : err.code;
        return json({ error: code, message: err.code === 'invalid_key' ? 'The server’s Gemini key is invalid.' : err.message }, status);
      }
      return json({ error: 'internal', message: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}
