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

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
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
