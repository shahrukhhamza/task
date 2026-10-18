/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Without it Dayflow runs fully local. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key. Safe to expose; row level security protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Public VAPID key for push reminders while the app is closed. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
