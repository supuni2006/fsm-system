import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE_KEY;

export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/**
 * Verifies the caller's JWT and role. Returns the profile row, or a Response
 * to return immediately if unauthorized/forbidden.
 *
 * These error Responses must carry corsHeaders just like json() below —
 * without them the browser discards the response as a CORS violation before
 * supabase-js ever sees the 401/403 body, and surfaces it as a generic
 * "Failed to send a request to the Edge Function" instead.
 */
export async function requireRole(req: Request, allowed: string[]) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: new Response('Unauthorized', { status: 401, headers: corsHeaders }) };

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return { error: new Response('Unauthorized', { status: 401, headers: corsHeaders }) };

  const { data: profile } = await adminClient.from('profiles').select('*').eq('id', userData.user.id).single();
  if (!profile || !allowed.includes(profile.role)) {
    return { error: new Response('Forbidden', { status: 403, headers: corsHeaders }) };
  }
  return { profile, userId: userData.user.id };
}

/**
 * Every function response — success or error — must include corsHeaders, or
 * the browser blocks it client-side before the caller's code ever runs.
 */
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}