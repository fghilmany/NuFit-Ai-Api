// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// deployed Edge Function's environment by the Supabase platform -- no manual secret needed for
// these three specifically (unlike GEMINI_API_KEY, which must be set via `supabase secrets set`).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
