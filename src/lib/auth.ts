import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database.types';

export async function signUp(params: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string;
}) {
  const { email, password, fullName, role, phone } = params;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role, phone }
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (error) {
    console.error('Failed to load profile', error);
    return null;
  }
  return data as Profile;
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    window.location.hash = '#/login';
    throw new Error('Not authenticated');
  }
  return profile;
}

export function onAuthStateChange(callback: (isSignedIn: boolean) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(!!session);
  });
}
