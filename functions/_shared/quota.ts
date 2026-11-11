import { serviceClient } from "./supabaseClient.ts";
import type { Capability } from "./types.ts";

export class QuotaExceededError extends Error {
  constructor(public used: number, public max: number, public resetsAt: string) {
    super("Quota exceeded");
  }
}

type Period = "day" | "month";

/** ADR-009 (2026-11-09, free MVP showcase phase): CHAT_AI_BASIC 20/day is the number the dev set
 * for this phase -- the client's "X/{max} chat hari ini" quota label is driven by this `max`
 * value, not hardcoded, so bumping it here is all the client needs. NOT `pricing.md`'s 20/month
 * recommendation (a different, still-deferred number for the eventual paid phase, tracked in
 * issue #88) -- don't conflate the two. CHAT_AI_PRO and AI_CUSTOM_PLAN are untouched safety
 * ceilings only (no client UI reflects them yet), sized from pricing.md §2 as a reasonable cost
 * guard, not a designed/communicated limit.
 *
 * MEAL_PLAN changed from 5/month to 1/day (2026-11-10): generation moved from "1 call = 1 week"
 * to "1 call = 1 day" (docs/techspec/meal-plan.md §3) -- 5/month would exhaust itself filling
 * less than one week. 1/day matches the new per-day unit of work directly: at most one
 * generate-or-regenerate tap per calendar day, across however many day-slots the user picks. */
const QUOTA_CONFIG: Record<Capability, { max: number; period: Period }> = {
  CHAT_AI_BASIC: { max: 20, period: "day" },
  CHAT_AI_PRO: { max: 100, period: "day" }, // safety ceiling only; client never shows this as exhausted (chat-ai.md AC-3)
  AI_CUSTOM_PLAN: { max: 6, period: "month" },
  MEAL_PLAN: { max: 1, period: "day" },
};

function periodStart(period: Period): Date {
  const now = new Date();
  return period === "day"
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function periodEnd(period: Period, start: Date): Date {
  const end = new Date(start);
  if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

export async function getQuotaStatus(userId: string, capability: Capability) {
  const { max, period } = QUOTA_CONFIG[capability];
  const start = periodStart(period);
  const resetsAt = periodEnd(period, start).toISOString();

  const { count } = await serviceClient()
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("capability", capability)
    .eq("is_quota_unit", true)
    .gte("created_at", start.toISOString());

  return { used: count ?? 0, max, resetsAt };
}

/** Call BEFORE the LLM request. Throws QuotaExceededError -> caller maps to
 * `403 {"reason":"quota_exceeded"}` (matches ChatRemoteDataSource's existing handling).
 * `user_entitlement.unlimited_quota` (manual flag, toggled by hand like ai_access_blocked)
 * skips the check entirely -- tier gating in requireAiAccess still applies. */
export async function assertQuotaAvailable(userId: string, capability: Capability) {
  const { data: entitlement } = await serviceClient()
    .from("user_entitlement")
    .select("unlimited_quota")
    .eq("user_id", userId)
    .maybeSingle();
  if (entitlement?.unlimited_quota) return;

  const status = await getQuotaStatus(userId, capability);
  if (status.used >= status.max) {
    throw new QuotaExceededError(status.used, status.max, status.resetsAt);
  }
}

/** Call AFTER a successful LLM response, with real token counts. [isQuotaUnit] defaults true --
 * one row = one quota unit, true for every capability including meal-plan-generate's per-day
 * calls (each day-tap is its own unit, 2026-11-10). */
export async function recordUsage(
  userId: string,
  capability: Capability,
  model: string,
  tokenIn: number,
  tokenOut: number,
  isQuotaUnit: boolean = true,
) {
  await serviceClient().from("ai_usage").insert({
    user_id: userId,
    capability,
    model,
    token_in: tokenIn,
    token_out: tokenOut,
    is_quota_unit: isQuotaUnit,
  });
}
