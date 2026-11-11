// techspec ai-custom-plan.md -- POST /v1/ai-custom-plan/generate
// Mirrors AiCustomPlanRemoteDataSource.kt's contract exactly. LOGGED_IN minimum (ADR-009, free showcase).
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUserId, UnauthorizedError } from "../_shared/auth.ts";
import { requireAiAccess, ForbiddenError, AiAccessBlockedError } from "../_shared/entitlement.ts";
import { assertQuotaAvailable, recordUsage, QuotaExceededError } from "../_shared/quota.ts";
import { generateStructured } from "../_shared/llmClient.ts";
import { validateExerciseIds } from "../_shared/exerciseCatalog.ts";
import type { AiPlanRequestDto, AiPlanResponseDto } from "../_shared/types.ts";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    smartGoalSummary: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dayNumber: { type: "integer" },
          type: { type: "string", enum: ["SESSION", "REST", "LIGHT_ACTIVITY"] },
          templateLetter: { type: "string", nullable: true },
          mainExercises: {
            type: "array",
            items: {
              type: "object",
              properties: {
                exerciseId: { type: "string" },
                sets: { type: "integer" },
                repRangeOrDuration: { type: "string" },
                rpeTargetMin: { type: "integer" },
                rpeTargetMax: { type: "integer" },
                restSeconds: { type: "integer", nullable: true },
              },
              required: ["exerciseId", "sets", "repRangeOrDuration", "rpeTargetMin", "rpeTargetMax"],
            },
          },
        },
        required: ["dayNumber", "type", "mainExercises"],
      },
    },
  },
  required: ["smartGoalSummary", "days"],
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const userId = await requireUserId(req);
    await requireAiAccess(userId, "LOGGED_IN");
    await assertQuotaAvailable(userId, "AI_CUSTOM_PLAN");

    const request = (await req.json()) as AiPlanRequestDto;

    const systemInstruction =
      "Kamu adalah pelatih fitness yang membuat program latihan personal dalam Bahasa Indonesia. " +
      "Balas HANYA dengan JSON sesuai schema yang diberikan. `exerciseId` HARUS berupa id yang nyata " +
      "dari katalog Exercise Library NuFit AI (format numerik seperti \"0007\") -- jangan mengarang id.";

    const userPrompt = JSON.stringify({
      formInput: request.formInput,
      fullAssessment: request.fullAssessment,
      workoutHistorySummary: request.workoutHistorySummary,
    });

    const result = await generateStructured<AiPlanResponseDto>({
      systemInstruction,
      userPrompt,
      schema: RESPONSE_SCHEMA,
    });

    // AC (ai-custom-plan.md): "100% exercise ada di library; yang tidak valid diganti padanan
    // otomatis" -- this pass drops invalid ids and reports via `conflicts[]` (client already
    // renders this field) rather than inventing a substitute, since a safe substitute requires
    // matching movement pattern/equipment, which is a bigger follow-up than "functional first".
    // The LLM provider's `json_object` mode (unlike Gemini's strict `responseSchema`) doesn't guarantee
    // every schema field is present -- the model may omit an empty/optional array entirely
    // instead of returning `[]`. Default defensively rather than assuming shape.
    const days = Array.isArray(result.data.days) ? result.data.days : [];
    for (const day of days) {
      if (!Array.isArray(day.mainExercises)) day.mainExercises = [];
    }
    const allIds = days.flatMap((d) => d.mainExercises.map((e) => e.exerciseId));
    const validIds = await validateExerciseIds(allIds);
    const conflicts = Array.isArray(result.data.conflicts) ? [...result.data.conflicts] : [];
    for (const day of days) {
      const before = day.mainExercises.length;
      day.mainExercises = day.mainExercises.filter((e) => validIds.has(e.exerciseId));
      const dropped = before - day.mainExercises.length;
      if (dropped > 0) {
        conflicts.push({ field: `days[${day.dayNumber}].mainExercises`, note: `${dropped} exerciseId tidak ditemukan di library dan dihapus dari rencana.` });
      }
    }

    await recordUsage(userId, "AI_CUSTOM_PLAN", result.model, result.tokenIn, result.tokenOut);

    const responseBody: AiPlanResponseDto = { ...result.data, days, conflicts };
    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return new Response(null, { status: 401, headers: corsHeaders });
    }
    if (e instanceof ForbiddenError) {
      // ADR-009: unreachable while min tier is LOGGED_IN -- kept for when the paywall returns.
      return new Response(JSON.stringify({ reason: "requires_subscription" }), { status: 403, headers: corsHeaders });
    }
    if (e instanceof AiAccessBlockedError) {
      return new Response(JSON.stringify({ reason: "ai_access_blocked", message: e.reason }), { status: 403, headers: corsHeaders });
    }
    if (e instanceof QuotaExceededError) {
      return new Response(
        JSON.stringify({ reason: "quota_exceeded", used: e.used, max: e.max, resetsAt: e.resetsAt }),
        { status: 403, headers: corsHeaders },
      );
    }
    console.error("ai-custom-plan-generate failed", e);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: corsHeaders });
  }
});
