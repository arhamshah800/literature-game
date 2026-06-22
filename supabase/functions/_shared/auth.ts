import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./http.ts";

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header.");
  }

  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const anonKey = publishableKeys
    ? JSON.parse(publishableKeys).default
    : requireEnv("SUPABASE_ANON_KEY");

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    anonKey,
    {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    }
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Invalid or expired Supabase auth token.");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? undefined
  };
}
