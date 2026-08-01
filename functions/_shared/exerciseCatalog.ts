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
