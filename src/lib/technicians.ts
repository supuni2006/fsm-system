import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database.types';

export async function listTechnicians(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'technician').order('full_name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface CreateTechnicianInput {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  skills?: string[];
}

/**
 * Registers a new technician account via the `create-technician` edge
 * function (admin-only, service role) so the admin's own session isn't
 * replaced the way a client-side `auth.signUp()` call would.
 */
export async function createTechnician(input: CreateTechnicianInput): Promise<Profile> {
  const { data, error } = await supabase.functions.invoke('create-technician', { body: input });
  if (error) throw new Error(await extractError(error));
  return data.profile as Profile;
}

export async function updateTechnician(
  id: string,
  updates: Partial<Pick<Profile, 'full_name' | 'phone' | 'skills' | 'is_active'>>
): Promise<void> {
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setTechnicianActive(id: string, isActive: boolean): Promise<void> {
  await updateTechnician(id, { is_active: isActive });
}

/**
 * Permanently deletes a technician's account via the `delete-technician`
 * edge function (admin-only, service role), since removing the auth user
 * isn't possible with a plain client-side call.
 */
export async function deleteTechnician(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-technician', { body: { id } });
  if (error) throw new Error(await extractError(error));
}

async function extractError(error: any): Promise<string> {
  // Always log the raw error so the real cause is visible in devtools,
  // even though the UI only ever shows a clean, human-readable string.
  console.error('Edge function error:', error);

  let body: any;
  try {
    body = await error?.context?.json?.();
  } catch {
    body = undefined;
  }

  const candidate = (typeof body?.error === 'string' && body.error) || (typeof body?.error?.message === 'string' && body.error.message) || (typeof error?.message === 'string' && error.message);

  if (candidate && candidate.trim() && candidate.trim() !== '{}') {
    return candidate;
  }
  return 'Request failed — check the Supabase function logs for details.';
}