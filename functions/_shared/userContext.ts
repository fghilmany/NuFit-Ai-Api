import { serviceClient } from "./supabaseClient.ts";

/** Grounding data actually available server-side today (chat-ai.md's "context injection" half of
 * its no-vector-RAG design). Only header/parent rows are synced (see ADR-008) -- nested
 * plan_day/workout_set_log detail is a known follow-up, not fabricated here. */
export async function getFullAssessmentSummary(userId: string) {
  const { data } = await serviceClient()
    .from("full_assessment_result")
    .select("age, gender, goal, sessions_per_week, injury_history, equipment_preference")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
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

export async function getRecentChatHistory(userId: string, limit: number): Promise<ChatHistoryRow[]> {
  const { data } = await serviceClient()
    .from("chat_message")
    .select("role, text, status, created_at")
    .eq("user_id", userId)
    .eq("status", "SENT")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).reverse();
}
