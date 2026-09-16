import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, created on first use.
 *
 * Deliberately NOT constructed at module scope. `next build` evaluates every
 * module it collects page data for, so a top-level `createClient(...)` makes the
 * whole build fail with "supabaseUrl is required" whenever the Supabase env vars
 * are missing from the build environment — for example a Vercel Preview
 * deployment that only has them set on Production.
 *
 * Deferring construction moves that failure from build time to request time,
 * where it surfaces as a 500 on one route instead of blocking every deploy.
 */
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase admin client unavailable: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }
    client = createClient(url, key);
  }
  return client;
}
