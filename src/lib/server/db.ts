import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const hasDatabase = url.length > 0 && serviceRoleKey.length > 0;

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it must only ever be reached from
 * server code that has already established who the caller is.
 */
export function db(): SupabaseClient {
  if (!hasDatabase) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  client ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
