import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const resolvedSupabaseUrl = supabaseUrl?.trim();
const resolvedSupabaseAnonKey = supabaseAnonKey?.trim();

export const hasSupabaseConfig = Boolean(resolvedSupabaseUrl && resolvedSupabaseAnonKey);

export const supabase = createClient(
  resolvedSupabaseUrl || "https://example.supabase.co",
  resolvedSupabaseAnonKey || "missing",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  }
);
