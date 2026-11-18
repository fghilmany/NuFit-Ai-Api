import { serviceClient } from "./supabaseClient.ts";

/** Grounding data actually available server-side today (chat-ai.md's "context injection" half of
 * its no-vector-RAG design). Only header/parent rows are synced (see ADR-008) -- nested
 * plan_day/workout_set_log detail is a known follow-up, not fabricated here. */
export async function getFullAssessmentSummary(userId: string) {
  const { data } = await serviceClient()
    .from("full_assessment_result")
    .select("age, gender, goal, sessions_per_week, injury_history, equipment_preference, activity_level")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** [get_tdee_macros] tool's other input half -- height/weight lives in its own synced table
 * (body_measurement), not full_assessment_result (see 20261116000001_onboarding_sync_tables.sql). */
export async function getLatestBodyMeasurement(userId: string) {
  const { data } = await serviceClient()
    .from("body_measurement")
    .select("height_cm, weight_kg")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getActivePlanSummary(userId: string) {
  const { data } = await serviceClient()
    .from("monthly_plan")
    .select("id, level_meta, goal_meta, smart_goal_meta, status, cycle_number")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data;
}

/** Header-level only: session count/status, no per-set detail (workout_set_log isn't synced yet). */
export async function getWorkoutHistorySummary(userId: string) {
  const { data } = await serviceClient()
    .from("workout_session")
    .select("id, status, started_at, completed_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

export interface ChatHistoryRow {
  role: string;
  text: string;
  status: string;
  created_at: string;
}

/** [since] is the client's "New Chat" cutoff (ISO instant) -- messages from before a reset are
 * excluded from context so the model doesn't keep "remembering" a conversation the user already
 * started fresh from, even though the rows themselves are never deleted (dev-requested design,
 * 2026-11-18). Undefined/null means no cutoff -- normal full-history behavior. */
export async function getRecentChatHistory(userId: string, limit: number, since?: string | null): Promise<ChatHistoryRow[]> {
  let query = serviceClient()
    .from("chat_message")
    .select("role, text, status, created_at")
    .eq("user_id", userId)
    .eq("status", "SENT");
  if (since) query = query.gte("created_at", since);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).reverse();
}
