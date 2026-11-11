import { serviceClient } from "./supabaseClient.ts";
import type { Tier } from "./types.ts";

export class ForbiddenError extends Error {
  constructor(requiredTier: Tier) {
    super(`Requires tier ${requiredTier}`);
  }
}

/** ADR-009 kill switch -- `user_entitlement.ai_access_blocked` toggled by hand (SQL/dashboard). */
export class AiAccessBlockedError extends Error {
  constructor(public reason: string | null) {
    super("AI access blocked");
  }
}

interface EntitlementRow {
  tier: Tier;
  ai_access_blocked: boolean;
  blocked_reason: string | null;
}

/** ADR-008: server-side stand-in for RevenueCat (not integrated yet). New users default to
 * LOGGED_IN on first sight; flip a row to SUBSCRIBED manually (Supabase dashboard/SQL) to test
 * SUBSCRIBED-gated endpoints -- mirrors the client's existing `[DEBUG] Simulate subscriber`
 * bypass (SetDebugEntitlement) in spirit, just server-side. Real billing wiring is tracked
 * separately (issue #88 / docs/tech-debt-88-pricing-sync.md). */
async function getEntitlementRow(userId: string): Promise<EntitlementRow> {
  const db = serviceClient();
  const { data } = await db
    .from("user_entitlement")
    .select("tier, ai_access_blocked, blocked_reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as EntitlementRow;

  await db.from("user_entitlement").insert({ user_id: userId, tier: "LOGGED_IN" });
  return { tier: "LOGGED_IN", ai_access_blocked: false, blocked_reason: null };
}

export async function getTier(userId: string): Promise<Tier> {
  return (await getEntitlementRow(userId)).tier;
}

const TIER_RANK: Record<Tier, number> = { GUEST: 0, LOGGED_IN: 1, SUBSCRIBED: 2 };

export async function requireTier(userId: string, minTier: Tier): Promise<void> {
  const tier = await getTier(userId);
  if (TIER_RANK[tier] < TIER_RANK[minTier]) throw new ForbiddenError(minTier);
}

/** ADR-009 -- the one call every AI-calling Edge Function should make: checks min tier AND the
 * manual kill switch in a single row fetch, returns the resolved tier (chat-send needs it to pick
 * CHAT_AI_BASIC vs CHAT_AI_PRO). Throws ForbiddenError or AiAccessBlockedError. */
export async function requireAiAccess(userId: string, minTier: Tier): Promise<Tier> {
  const row = await getEntitlementRow(userId);
  if (TIER_RANK[row.tier] < TIER_RANK[minTier]) throw new ForbiddenError(minTier);
  if (row.ai_access_blocked) throw new AiAccessBlockedError(row.blocked_reason);
  return row.tier;
}
