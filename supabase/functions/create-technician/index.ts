// Supabase Edge Function: create-technician
// Lets an admin register a technician account from inside the app, without
// signUp()'ing on the client — client-side signUp would replace the admin's
// own session with the new technician's session, which we don't want.
// Uses the service role key to create the auth user directly, then fills in
// the profile fields that auth.users metadata doesn't cover (phone, skills).
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

  const { email, password, full_name, phone, skills } = await req.json();
  if (!email || !password || !full_name) {
    return json({ error: 'email, password, and full_name are required' }, 400);
  }
  if (String(password).length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'technician', phone: phone || null }
  });
  if (createErr) return json({ error: createErr.message }, 400);

  const userId = created.user!.id;

  // trg_on_auth_user_created already inserted a profiles row from the metadata
  // above (full_name, role) — fill in the fields it doesn't read.
  const { data: profile, error: updateErr } = await adminClient
    .from('profiles')
    .update({
      phone: phone || null,
      skills: Array.isArray(skills) && skills.length ? skills : null
    })
    .eq('id', userId)
    .select()
    .single();

  if (updateErr) {
    // The auth user exists but the profile update failed — surface it rather
    // than silently leaving a half-configured technician.
    return json({ error: `Technician account created, but profile setup failed: ${updateErr.message}` }, 500);
  }

  return json({ ok: true, profile });
});