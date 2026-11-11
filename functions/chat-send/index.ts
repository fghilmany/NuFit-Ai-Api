// techspec chat-ai.md -- POST /v1/chat/send
// Mirrors ChatRemoteDataSource.kt's contract exactly. LOGGED_IN minimum; quota differs by tier.
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUserId, UnauthorizedError } from "../_shared/auth.ts";
import { requireAiAccess, ForbiddenError, AiAccessBlockedError } from "../_shared/entitlement.ts";
import { assertQuotaAvailable, getQuotaStatus, recordUsage, QuotaExceededError } from "../_shared/quota.ts";
import { generateWithTools, type ChatTurn, type FunctionDeclaration } from "../_shared/llmClient.ts";
import { getExercise, searchExercises } from "../_shared/exerciseCatalog.ts";
import {
  getActivePlanSummary,
  getFullAssessmentSummary,
  getRecentChatHistory,
  getWorkoutHistorySummary,
} from "../_shared/userContext.ts";
import type { Capability, ChatSendRequestDto, ChatSendResponseDto } from "../_shared/types.ts";

const TOOLS: FunctionDeclaration[] = [
  {
    name: "get_exercise",
    description: "Ambil detail satu gerakan dari katalog Exercise Library berdasarkan exerciseId.",
    parameters: { type: "object", properties: { exerciseId: { type: "string" } }, required: ["exerciseId"] },
  },
  {
    name: "search_exercises",
    description: "Cari gerakan di katalog Exercise Library berdasarkan alat/pola gerak/otot target.",
    parameters: {
      type: "object",
      properties: {
        equipmentCategory: { type: "string" },
        movementPattern: { type: "string" },
        primaryMuscleGroup: { type: "string" },
      },
    },
  },
  {
    name: "get_active_plan",
    description: "Ambil ringkasan plan latihan aktif user saat ini (level, goal, siklus).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_workout_history",
    description: "Ambil ringkasan 10 sesi latihan terakhir user (status, tanggal) -- belum termasuk detail set/rep.",
    parameters: { type: "object", properties: {} },
  },
];

async function executeTool(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_exercise":
      return await getExercise(String(args.exerciseId ?? ""));
    case "search_exercises":
      return await searchExercises({
        equipmentCategory: args.equipmentCategory as string | undefined,
        movementPattern: args.movementPattern as string | undefined,
        primaryMuscleGroup: args.primaryMuscleGroup as string | undefined,
      });
    case "get_active_plan":
      return await getActivePlanSummary(userId);
    case "get_workout_history":
      return await getWorkoutHistorySummary(userId);
    default:
      return { error: `unknown tool ${name}` };
  }
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const userId = await requireUserId(req);
    const tier = await requireAiAccess(userId, "LOGGED_IN");
    const capability: Capability = tier === "SUBSCRIBED" ? "CHAT_AI_PRO" : "CHAT_AI_BASIC";

    await assertQuotaAvailable(userId, capability);

    const request = (await req.json()) as ChatSendRequestDto;

    const [assessment, plan, history] = await Promise.all([
      getFullAssessmentSummary(userId),
      getActivePlanSummary(userId),
      getRecentChatHistory(userId, request.conversationHistoryLimit || 20),
    ]);

    const systemInstruction =
      "Kamu adalah NuFit AI, asisten gym & nutrisi dalam Bahasa Indonesia. Jawab singkat, ramah, " +
      "dan personal berdasarkan konteks user berikut. Untuk pertanyaan medis, arahkan ke profesional " +
      "-- jangan mendiagnosis. Maksimal 1 pemanggilan tool per giliran.\n\n" +
      `Profil: ${JSON.stringify(assessment ?? "belum ada full assessment")}\n` +
      `Plan aktif: ${JSON.stringify(plan ?? "belum ada plan aktif")}`;

    const chatHistory: ChatTurn[] = history.map((h) => ({
      role: h.role === "ASSISTANT" ? "model" : "user",
      text: h.text,
    }));

    const result = await generateWithTools({
      systemInstruction,
      history: chatHistory,
      message: request.message,
      tools: TOOLS,
      executeTool: (name, args) => executeTool(userId, name, args),
    });

    await recordUsage(userId, capability, result.model, result.tokenIn, result.tokenOut);
    const quota = await getQuotaStatus(userId, capability);

    // No exercise-suggestion/suggested-replies extraction from free text this pass (would need a
    // second structured-output call) -- server always returns text-only replies for now; the
    // client already renders exerciseSuggestion/suggestedReplies as optional/absent gracefully.
    const responseBody: ChatSendResponseDto = {
      reply: { text: result.data.text, exerciseSuggestion: null, suggestedReplies: [] },
      quota,
    };

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return new Response(null, { status: 401, headers: corsHeaders });
    }
    if (e instanceof ForbiddenError) {
      return new Response(JSON.stringify({ reason: "requires_login" }), { status: 403, headers: corsHeaders });
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
    console.error("chat-send failed", e);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: corsHeaders });
  }
});
