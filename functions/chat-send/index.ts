// techspec chat-ai.md -- POST /v1/chat/send
// Mirrors ChatRemoteDataSource.kt's contract exactly. LOGGED_IN minimum; quota differs by tier.
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { requireUserId, UnauthorizedError } from "../_shared/auth.ts";
import { requireAiAccess, ForbiddenError, AiAccessBlockedError } from "../_shared/entitlement.ts";
import { assertQuotaAvailable, getQuotaStatus, recordUsage, QuotaExceededError } from "../_shared/quota.ts";
import { generateWithTools, type ChatTurn, type FunctionDeclaration } from "../_shared/llmClient.ts";
import { guardInput, guardOutput, GuardUnavailableError } from "../_shared/chatGuard.ts";
import { getExercise, searchExercises } from "../_shared/exerciseCatalog.ts";
import {
  getActivePlanSummary,
  getFullAssessmentSummary,
  getRecentChatHistory,
  getWorkoutHistorySummary,
} from "../_shared/userContext.ts";
import type { Capability, ChatSendRequestDto, ChatSendResponseDto } from "../_shared/types.ts";

// Chat-only model override (2026-11-18 live test): deepseek-v4.1-flash-1017 answered in ~2.5-5s
// with correct tool-calling vs glm-5.3-flash's 22-46s for the same prompts -- the
// minimum_discount_not_met failures that dropped DeepSeek on 2026-11-09 are no longer occurring.
// Scoped to chat-send only; meal-plan-generate/ai-custom-plan-generate keep llmClient.ts's
// DEFAULT_MODEL (glm-5.3-flash) untouched, pending their own evaluation.
const CHAT_MODEL = "deepseek-v4.1-flash-1017";

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

  const requestStartedAt = performance.now();
  try {
    const userId = await requireUserId(req);
    const tier = await requireAiAccess(userId, "LOGGED_IN");
    const capability: Capability = tier === "SUBSCRIBED" ? "CHAT_AI_PRO" : "CHAT_AI_BASIC";

    await assertQuotaAvailable(userId, capability);

    const request = (await req.json()) as ChatSendRequestDto;

    // Guard input needs recent history to read a short follow-up ("ya carikan") as a
    // continuation instead of a cold, ambiguous message (live false positive, 2026-11-18) --
    // so history must resolve before guardInput runs. assessment/plan don't feed the guard, so
    // they still run concurrently with it.
    const historyPromise = getRecentChatHistory(userId, request.conversationHistoryLimit || 20);
    const contextPromise = Promise.all([getFullAssessmentSummary(userId), getActivePlanSummary(userId)]);

    const history = await historyPromise;
    const recentHistoryText = history
      .slice(-4)
      .map((h) => `${h.role === "ASSISTANT" ? "AI" : "User"}: ${h.text}`)
      .join("\n");
    const inputGuard = await guardInput(request.message, recentHistoryText);
    const [assessment, plan] = await contextPromise;

    if (inputGuard.decision !== "ALLOW") {
      console.log(
        `[chatGuard] input blocked decision=${inputGuard.decision} reason=${inputGuard.reason} ` +
          `duration_ms=${Math.round(performance.now() - requestStartedAt)}`,
      );
      const quota = await getQuotaStatus(userId, capability);
      const responseBody: ChatSendResponseDto = {
        reply: { text: inputGuard.message!, exerciseSuggestion: null, suggestedReplies: [], isPolicyResponse: true },
        quota,
      };
      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const generate = () =>
      generateWithTools({
        systemInstruction,
        history: chatHistory,
        message: request.message,
        tools: TOOLS,
        executeTool: (name, args) => executeTool(userId, name, args),
        model: CHAT_MODEL,
      });

    let result = await generate();
    let outputGuard = await guardOutput(request.message, result.data.text, systemInstruction);
    // One regenerate-and-recheck retry on a block (2026-11-18: 2 live false-positive-looking
    // blocks seen on an unambiguously on-topic message, neither reproducible on repeat calls --
    // Jev/model output is non-deterministic enough that a single block isn't reliable evidence
    // the reply was actually unsafe). Still fails closed if the retry also gets blocked -- this
    // softens one-off noise, it doesn't bypass the guard.
    if (outputGuard.decision !== "ALLOW") {
      console.log(`[chatGuard] output blocked decision=${outputGuard.decision} reason=${outputGuard.reason} -- retrying once`);
      const retryResult = await generate();
      const retryGuard = await guardOutput(request.message, retryResult.data.text, systemInstruction);
      result = {
        ...retryResult,
        tokenIn: result.tokenIn + retryResult.tokenIn,
        tokenOut: result.tokenOut + retryResult.tokenOut,
      };
      outputGuard = retryGuard;
    }
    const replyText = outputGuard.decision === "ALLOW" ? result.data.text : outputGuard.message!;
    if (outputGuard.decision !== "ALLOW") {
      console.log(`[chatGuard] output blocked decision=${outputGuard.decision} reason=${outputGuard.reason} -- retry also blocked`);
    }
    // Policy decisions (input or output guard not ALLOW) don't consume the user's chat quota --
    // only a generative answer that passed both guards counts as a quota unit. The model call(s)
    // that produced a blocked output still happened (real provider cost, summed across the
    // retry above), so it's still recorded, just not as a quota unit, so that cost isn't
    // silently lost from usage accounting.
    await recordUsage(userId, capability, result.model, result.tokenIn, result.tokenOut, outputGuard.decision === "ALLOW");
    const quota = await getQuotaStatus(userId, capability);

    // No exercise-suggestion/suggested-replies extraction from free text this pass (would need a
    // second structured-output call) -- server always returns text-only replies for now; the
    // client already renders exerciseSuggestion/suggestedReplies as optional/absent gracefully.
    const responseBody: ChatSendResponseDto = {
      reply: {
        text: replyText,
        exerciseSuggestion: null,
        suggestedReplies: [],
        isPolicyResponse: outputGuard.decision !== "ALLOW",
      },
      quota,
    };

    console.log(`[chat-send] total duration_ms=${Math.round(performance.now() - requestStartedAt)}`);
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
    if (e instanceof GuardUnavailableError) {
      // Fail closed -- never let a candidate answer through when the guard itself is unreachable
      // or returns something unparseable (plan.md "Guard input dan output Chat AI dengan Jev" step 4).
      console.error("chatGuard unavailable", e);
      return new Response(JSON.stringify({ reason: "guard_unavailable" }), { status: 503, headers: corsHeaders });
    }
    console.error("chat-send failed", e);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: corsHeaders });
  }
});
