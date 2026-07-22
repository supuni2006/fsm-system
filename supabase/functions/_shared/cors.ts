// Shared CORS headers for edge functions that are called directly from the
// browser via supabase.functions.invoke(...).
//
// The app (http://localhost:5173, or your deployed domain) and the edge
// function (https://YOUR_PROJECT_REF.functions.supabase.co/...) are always
// different origins, even in local dev. That means the browser sends a
// preflight OPTIONS request first, and expects these headers back on BOTH
// the preflight response and the real response — otherwise it blocks the
// request before your handler code ever runs, and supabase-js surfaces that
// as a generic "Failed to send a request to the Edge Function" error.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/**
 * Call this first in every Deno.serve handler that's invoked from the
 * browser. Returns a Response to send immediately if this was a preflight
 * request, or null if the caller should keep handling the real request.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}