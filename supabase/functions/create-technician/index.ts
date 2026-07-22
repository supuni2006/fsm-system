// Supabase Edge Function: create-technician
// Registers a new technician account (admin-only). Runs with the service
// role so it can create the auth user directly, without disturbing the
// calling admin's own session the way a client-side `auth.signUp()` would.
//
// Deploy:  supabase functions deploy create-technician

import { adminClient, requireRole, json } from '../_shared/auth.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const auth = await requireRole(req, ['admin']);
  if ('error' in auth) return auth.error;

  // Everything below is wrapped so ANY unexpected failure — a bad request
  // body, a Postgres error, createUser() throwing instead of returning
  // `error`, etc. — still comes back as a proper { error: "..." } JSON
  // response. Without this, an uncaught exception here makes the Edge
  // Runtime return its own generic error body, which doesn't match what
  // the client's extractError() expects and renders as an empty "{}".
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }
    const { full_name, email, password, phone, skills } = body ?? {};

    if (!full_name || !String(full_name).trim()) return json({ error: 'Full name is required' }, 400);
    if (!email || !String(email).trim()) return json({ error: 'Email is required' }, 400);
    if (!password || String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    // Create the auth user. The `trg_on_auth_user_created` trigger picks up
    // `full_name`/`role` from user_metadata and inserts the matching
    // `public.profiles` row for us.
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: String(email).trim(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: String(full_name).trim(),
        role: 'technician'
      }
    });
    if (createErr) return json({ error: createErr.message || 'Could not create the technician account' }, 400);
    if (!created?.user) return json({ error: 'Account creation returned no user' }, 500);

    const userId = created.user.id;

    // Fill in the technician-only fields the trigger doesn't set.
    const { data: profile, error: updateErr } = await adminClient
      .from('profiles')
      .update({
        phone: phone ? String(phone).trim() : null,
        skills: Array.isArray(skills) ? skills : []
      })
      .eq('id', userId)
      .select()
      .single();

    if (updateErr || !profile) {
      // The auth user was created but the profile update failed — clean up
      // so the admin can retry with the same email instead of hitting a
      // "user already exists" error next time.
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: updateErr?.message || 'Could not save technician profile' }, 500);
    }

    return json({ profile });
  } catch (err) {
    console.error('create-technician unexpected error', err);
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    return json({ error: message }, 500);
  }
});