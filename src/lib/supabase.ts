import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True only when both env vars are present. Other modules (main.ts) check
 * this before doing anything that touches `supabase`, so we can show a
 * friendly on-screen setup message instead of a blank page.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, then restart `npm run dev`.'
  );
}

// createClient() throws synchronously if the URL/key are empty, which would
// crash this module (and everything that imports it, i.e. the whole app)
// before anything can render. Fall back to harmless placeholder values so
// the client can always be constructed — real calls will simply fail until
// isSupabaseConfigured is true and the real .env values are in place.
//
// Note: once you run `npx supabase gen types typescript --project-id ...`,
// swap this for `createClient<Database>(...)` to get fully typed query results.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);