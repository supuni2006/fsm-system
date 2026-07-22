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

async function extractError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    return body?.error?.message || body?.error || error.message || 'Request failed';
  } catch {
    return error?.message ?? 'Request failed';
  }
}