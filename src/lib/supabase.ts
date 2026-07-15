import { createClient } from '@supabase/supabase-js';

const cleanHeaderValue = (value: string | undefined) =>
  String(value || '').trim().replace(/[^\x20-\x7E]/g, '');

export const supabaseUrl = cleanHeaderValue(import.meta.env.VITE_SUPABASE_URL as string | undefined);
export const supabasePublishableKey = cleanHeaderValue(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

export const cloudConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = cloudConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
