// Supabase Edge Function: delete-technician
// Removes a technician account (admin-only). Runs with the service role so
// it can delete the auth user directly — deleting `public.profiles` row
// alone isn't possible client-side, and `profiles.id` cascades from
// `auth.users`, so removing the auth user is what actually cleans it up.
//
// Deploy:  supabase functions deploy delete-technician

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const auth = await requireRole(req, ['admin']);
  if ('error' in auth) return auth.error;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }
    const { id } = body ?? {};
    if (!id || !String(id).trim()) return json({ error: 'Technician id is required' }, 400);

    if (id === auth.userId) return json({ error: "You can't delete your own account." }, 400);

    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', id).single();
    if (!profile) return json({ error: 'Technician not found' }, 404);
    if (profile.role !== 'technician') return json({ error: 'That account is not a technician' }, 400);

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(id);
    if (deleteErr) {
      // Most commonly this is a foreign-key restriction — e.g. the
      // technician is referenced as `created_by` on a work order, invoice,
      // or note, none of which cascade or null out on delete. Surface the
      // real Postgres message so the admin knows to reassign that history
      // first, rather than a generic failure.
      return json({ error: deleteErr.message || 'Could not delete technician account' }, 400);
    }

    return json({ success: true });
  } catch (err) {
    console.error('delete-technician unexpected error', err);
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    return json({ error: message }, 500);
  }
});