// techspec meal-plan.md §7 -- POST /v1/meal-plan/generate
// Mirrors MealPlanRemoteDataSource.kt's contract exactly. SUBSCRIBED-only capability.
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUserId, UnauthorizedError } from "../_shared/auth.ts";
import { requireTier, ForbiddenError } from "../_shared/entitlement.ts";
import { assertQuotaAvailable, recordUsage, QuotaExceededError } from "../_shared/quota.ts";
import { generateStructured } from "../_shared/llmClient.ts";
import type { MealPlanRequestDto, MealPlanResponseDto } from "../_shared/types.ts";

const MACRO_SCHEMA = {
  type: "object",
  properties: {
    calories: { type: "integer" },
    proteinG: { type: "integer" },
    carbG: { type: "integer" },
    fatG: { type: "integer" },
  },
  required: ["calories", "proteinG", "carbG", "fatG"],
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dayNumber: { type: "integer" },
          meals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slot: { type: "string", enum: ["BREAKFAST", "LUNCH", "DINNER"] },
                name: { type: "string" },
                description: { type: "string" },
                ingredients: { type: "array", items: { type: "string" } },
                macros: MACRO_SCHEMA,
                prepMinutes: { type: "integer" },
                tag: { type: "string" },
              },
              required: ["slot", "name", "description", "ingredients", "macros", "prepMinutes", "tag"],
            },
          },
        },
        required: ["dayNumber", "meals"],
      },
    },
  },
  required: ["days"],
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const userId = await requireUserId(req);
    await requireTier(userId, "SUBSCRIBED");
    await assertQuotaAvailable(userId, "MEAL_PLAN");

    const request = (await req.json()) as MealPlanRequestDto;

    const systemInstruction =
      "Kamu adalah ahli gizi yang membuat rencana makan 7 hari dalam Bahasa Indonesia, sesuai " +
      "target makro dan preferensi user. Balas HANYA dengan JSON sesuai schema. Setiap hari punya " +
      "tepat 3 meals: BREAKFAST, LUNCH, DINNER. Total kalori tiap hari harus mendekati target.";

    const userPrompt = JSON.stringify({
      target: request.target,
      goal: request.goal,
      preference: request.preference,
    });

    const result = await generateStructured<MealPlanResponseDto>({
      systemInstruction,
      userPrompt,
      schema: RESPONSE_SCHEMA,
    });

    // Light sanity checks only (techspec: no exerciseId-style validation needed for meals) --
    // drop days that come back with zero meals or a meal with no ingredients rather than
    // rendering something broken. OpenRouter's `json_object` mode doesn't guarantee every array
    // field is present (may omit instead of returning `[]`) -- default defensively.
    const rawDays = Array.isArray(result.data.days) ? result.data.days : [];
    const cleanedDays = rawDays
      .map((day) => ({ ...day, meals: (Array.isArray(day.meals) ? day.meals : []).filter((m) => Array.isArray(m.ingredients) && m.ingredients.length > 0) }))
      .filter((day) => day.meals.length > 0);

    await recordUsage(userId, "MEAL_PLAN", result.model, result.tokenIn, result.tokenOut);

    const responseBody: MealPlanResponseDto = { days: cleanedDays };
    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return new Response(null, { status: 401, headers: corsHeaders });
    }
    if (e instanceof ForbiddenError) {
      return new Response(JSON.stringify({ reason: "requires_subscription" }), { status: 403, headers: corsHeaders });
    }
    if (e instanceof QuotaExceededError) {
      return new Response(
        JSON.stringify({ reason: "quota_exceeded", used: e.used, max: e.max, resetsAt: e.resetsAt }),
        { status: 403, headers: corsHeaders },
      );
    }
    console.error("meal-plan-generate failed", e);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: corsHeaders });
  }
});
