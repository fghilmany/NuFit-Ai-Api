import { serviceClient } from "./supabaseClient.ts";
import type { Capability } from "./types.ts";

export class QuotaExceededError extends Error {
  constructor(public used: number, public max: number, public resetsAt: string) {
    super("Quota exceeded");
  }
}

type Period = "day" | "month";

/** CHAT_AI_BASIC's 5/day is the one number the client actually surfaces today ("X/5 chat hari
 * ini", ChatQuota UI) -- keep it exact per the dev's "functional first" instruction (pricing.md's
 * 20/month recommendation is deferred, tracked in issue #88). The other three are safety
 * ceilings only (no client UI reflects them yet), sized from pricing.md §2 as a reasonable
 * cost guard, not a designed/communicated limit. */
const QUOTA_CONFIG: Record<Capability, { max: number; period: Period }> = {
  CHAT_AI_BASIC: { max: 5, period: "day" },
  CHAT_AI_PRO: { max: 100, period: "day" }, // safety ceiling only; client never shows this as exhausted (chat-ai.md AC-3)
  AI_CUSTOM_PLAN: { max: 6, period: "month" },
  MEAL_PLAN: { max: 8, period: "month" },
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
    .gte("created_at", start.toISOString());

  return { used: count ?? 0, max, resetsAt };
}

/** Call BEFORE the LLM request. Throws QuotaExceededError -> caller maps to
 * `403 {"reason":"quota_exceeded"}` (matches ChatRemoteDataSource's existing handling). */
export async function assertQuotaAvailable(userId: string, capability: Capability) {
  const status = await getQuotaStatus(userId, capability);
  if (status.used >= status.max) {
    throw new QuotaExceededError(status.used, status.max, status.resetsAt);
  }
}

/** Call AFTER a successful LLM response, with real token counts. */
export async function recordUsage(
  userId: string,
  capability: Capability,
  model: string,
  tokenIn: number,
  tokenOut: number,
) {
  await serviceClient().from("ai_usage").insert({
    user_id: userId,
    capability,
    model,
    token_in: tokenIn,
    token_out: tokenOut,
  });
}
