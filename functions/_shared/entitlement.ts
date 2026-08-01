import { serviceClient } from "./supabaseClient.ts";
import type { Tier } from "./types.ts";

export class ForbiddenError extends Error {
  constructor(requiredTier: Tier) {
    super(`Requires tier ${requiredTier}`);
  }
}

/** ADR-008: server-side stand-in for RevenueCat (not integrated yet). New users default to
 * LOGGED_IN on first sight; flip a row to SUBSCRIBED manually (Supabase dashboard/SQL) to test
 * SUBSCRIBED-gated endpoints -- mirrors the client's existing `[DEBUG] Simulate subscriber`
 * bypass (SetDebugEntitlement) in spirit, just server-side. Real billing wiring is tracked
 * separately (issue #88 / docs/tech-debt-88-pricing-sync.md). */
export async function getTier(userId: string): Promise<Tier> {
  const db = serviceClient();
  const { data } = await db.from("user_entitlement").select("tier").eq("user_id", userId).maybeSingle();
  if (data) return data.tier as Tier;

  await db.from("user_entitlement").insert({ user_id: userId, tier: "LOGGED_IN" });
  return "LOGGED_IN";
}

const TIER_RANK: Record<Tier, number> = { GUEST: 0, LOGGED_IN: 1, SUBSCRIBED: 2 };

export async function requireTier(userId: string, minTier: Tier): Promise<void> {
  const tier = await getTier(userId);
  if (TIER_RANK[tier] < TIER_RANK[minTier]) throw new ForbiddenError(minTier);
}
