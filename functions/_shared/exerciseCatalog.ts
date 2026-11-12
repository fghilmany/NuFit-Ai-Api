import { serviceClient } from "./supabaseClient.ts";
import type { ExerciseRow } from "./types.ts";

/** Validates exerciseIds returned by the LLM against the real catalog (seeded in
 * 20260731000002_seed_exercise.sql). Returns only the ids that actually exist. */
export async function validateExerciseIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await serviceClient().from("exercise").select("id").in("id", [...new Set(ids)]);
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

export async function getExercise(exerciseId: string): Promise<ExerciseRow | null> {
  const { data } = await serviceClient().from("exercise").select("*").eq("id", exerciseId).maybeSingle();
  return data as ExerciseRow | null;
}

/** Narrow fields only -- just enough for the LLM to pick a real id by name/pattern/muscle, kept
 * out of the full `ExerciseRow` shape so this isn't mistaken for a complete row elsewhere. */
export interface ExerciseCandidate {
  id: string;
  name: string;
  equipment_category: string;
  movement_pattern: string;
  primary_muscle_group: string;
}

/** ai-custom-plan-generate grounding (issue: LLM was hallucinating exerciseIds -- the prompt only
 * told it "use a real id", never actually gave it one to pick from, unlike chat-send's tool-calling
 * grounding). Widens the filter in stages if the preferred combination comes back too thin, so the
 * model is never handed an empty list to choose from. */
export async function getExerciseCandidatesForPlan(
  equipmentPreference: string[],
  muscleFocus: string[],
  limit = 80,
): Promise<ExerciseCandidate[]> {
  const select = "id, name, equipment_category, movement_pattern, primary_muscle_group";
  const MIN_USEFUL_COUNT = 15;

  const fetch = async (withEquipment: boolean, withMuscle: boolean) => {
    let query = serviceClient().from("exercise").select(select).limit(limit);
    if (withEquipment && equipmentPreference.length > 0) query = query.in("equipment_category", equipmentPreference);
    if (withMuscle && muscleFocus.length > 0) query = query.in("primary_muscle_group", muscleFocus);
    const { data } = await query;
    return (data ?? []) as ExerciseCandidate[];
  };

  const precise = await fetch(true, true);
  if (precise.length >= MIN_USEFUL_COUNT) return precise;

  const equipmentOnly = await fetch(true, false);
  if (equipmentOnly.length >= MIN_USEFUL_COUNT) return equipmentOnly;

  return fetch(false, false);
}

export interface SearchExercisesParams {
  equipmentCategory?: string;
  movementPattern?: string;
  primaryMuscleGroup?: string;
  limit?: number;
}

/** Backs Chat's `search_exercises` tool (chat-ai.md's context-injection + tool-calling design --
 * no vector-RAG, deterministic field lookup against this same catalog the client bundles). */
export async function searchExercises(params: SearchExercisesParams): Promise<ExerciseRow[]> {
  let query = serviceClient().from("exercise").select("*").limit(params.limit ?? 10);
  if (params.equipmentCategory) query = query.eq("equipment_category", params.equipmentCategory);
  if (params.movementPattern) query = query.eq("movement_pattern", params.movementPattern);
  if (params.primaryMuscleGroup) query = query.eq("primary_muscle_group", params.primaryMuscleGroup);

  const { data } = await query;
  return (data ?? []) as ExerciseRow[];
}
