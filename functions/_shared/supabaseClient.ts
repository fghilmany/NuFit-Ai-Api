// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// deployed Edge Function's environment by the Supabase platform -- no manual secret needed for
// these three specifically (unlike GEMINI_API_KEY, which must be set via `supabase secrets set`).
//
// Local `supabase functions serve --env-file` CANNOT override these -- the CLI silently drops any
// env-file entry whose name starts with "SUPABASE_" (reserved for its own local-stack injection),
// so a local run always points at the local demo stack no matter what .env.local says. The
// CLOUD_SUPABASE_* fallback below lets local runs opt into the real cloud project (per
// deploy-supabase.md's "connect to cloud DB, run function locally" flow) without touching the
// deployed-function path, which never sets CLOUD_SUPABASE_* and falls straight through to the
// platform-injected values.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("CLOUD_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("CLOUD_SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("CLOUD_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Used only to verify the caller's bearer token (auth.getUser) -- never for privileged reads/writes. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** Service-role client: bypasses RLS. Used for user_entitlement/ai_usage/exercise reads+writes and
 * for reading synced user tables (full_assessment_result, monthly_plan, chat_message) by user_id --
 * the Edge Function itself is the trusted boundary, per architecture.md's "server only via HTTP". */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
