// Deno entry point for the ai Edge Function.
// Secret: GEMINI_API_KEY (free from https://aistudio.google.com/apikey). Optional: GEMINI_MODEL.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer } from '../_shared/http.ts';
import { createAiHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(
  createAiHandler({
    fetch,
    apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
    model: Deno.env.get('GEMINI_MODEL') || undefined,
    async authenticate(req) {
      const jwt = bearer(req);
      if (!jwt) return null;
      const { data } = await admin.auth.getUser(jwt);
      return data.user?.id ?? null;
    },
  }),
);
