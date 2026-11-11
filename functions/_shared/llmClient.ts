// Surplus Intelligence wrapper (OpenAI-compatible chat completions API). Kept behind this single
// small interface (generateStructured/generateWithTools) so swapping the exact model/provider
// later is a one-file, one-constant change. See ADR-008 (provider history predates the Surplus
// Intelligence switch -- not documented there; this file is the source of truth for "what's live
// today").
//
// DEFAULT_MODEL picked 2026-11-09 after a live A/B test against real chat-send/meal-plan-generate
// calls: glm-5.2 caused WORKER_RESOURCE_LIMIT (hit Supabase's ~150s Edge Function wall-clock cap
// generating the 7-day/21-meal Meal Plan JSON -- too slow/heavy for this workload). deepseek-v4.1-flash
// was dropped: its "Trusted"-seller discount was too unreliable in practice (repeatedly failed
// `minimum_discount_not_met` even after lowering the account's discount-threshold setting) --
// landing it would've meant random production failures. glm-4.7-flash was dropped without testing
// -- absent from the trust=trusted&caps=tools&sellers=5 filtered marketplace view, so it fails at
// least one of those three requirements (most likely: no tool-calling support, which chat-send
// needs). glm-5.3-flash passed chat-send's tests cleanly (B.Indo tone, TDEE math accuracy,
// tool-calling). meal-plan-generate is NOT clean -- inconsistent queueing latency on this
// marketplace means its sequential multi-batch calls sometimes finish fine, sometimes hit
// Supabase's ~150s cap. Shipped anyway as an accepted risk (dev decision, 2026-11-09) rather than
// blocking on a real fix -- see docs/tech-debt-88-pricing-sync.md's 2026-11-09 addendum for the
// evidence and the options that were NOT taken (raise the Edge Function timeout, make Meal Plan
// generation async, or use a non-marketplace provider for just that endpoint).
const LLM_API_KEY = Deno.env.get("LLM_API_KEY")!;
const LLM_BASE_URL = "https://api.surplusintelligence.ai/v1/chat/completions";
export const DEFAULT_MODEL = "glm-5.3-flash";

interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface LlmResult<T> {
  data: T;
  model: string;
  tokenIn: number;
  tokenOut: number;
}

/** Never render a literally-empty chat bubble -- shown only if the model still returns no text
 * after we've forced a tools-free final round-trip (should be rare after that fix). */
const FALLBACK_REPLY = "Maaf, aku belum bisa jawab itu sekarang. Coba tanya lagi dengan kata lain ya.";

async function callLlm(body: Record<string, unknown>): Promise<{ json: Record<string, unknown>; usage: LlmUsage }> {
  const startedAt = performance.now();
  const res = await fetch(LLM_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const durationMs = Math.round(performance.now() - startedAt);

  if (!res.ok) {
    console.log(`[llmClient] model=${body.model} FAILED status=${res.status} duration_ms=${durationMs}`);
    throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const usage = (json.usage as LlmUsage) ?? {};
  // TEMP (model A/B test, see dev request): one line per call for quick comparison across
  // candidates -- remove once deepseek-v4.1-flash / glm-5.3-flash / gemini-3.8-flash are compared.
  console.log(
    `[llmClient] model=${body.model} duration_ms=${durationMs} tokenIn=${usage.prompt_tokens ?? 0} tokenOut=${usage.completion_tokens ?? 0}`,
  );
  return { json, usage };
}

/** For AI Custom Plan + Meal Plan generation: asks for JSON-only output matching `schema`, via
 * prompt instruction only. NOT via `response_format: json_object` -- some free OpenRouter models
 * (e.g. inclusionai/ling-3.0-flash via the Novita provider) reject the request entirely with
 * "does not support feature: structured-outputs" if that's set. Prompt-only is less strict but
 * works across more free models; `stripCodeFence` below defends against markdown-wrapped JSON. */
export async function generateStructured<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  schema: unknown;
  model?: string;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  const model = params.model ?? DEFAULT_MODEL;
  const { json, usage } = await callLlm({
    model,
    messages: [
      {
        role: "system",
        content: `${params.systemInstruction}\n\nBalas HANYA dengan JSON valid yang sesuai schema berikut, tanpa markdown/code fence, tanpa teks lain di luar JSON:\n${JSON.stringify(params.schema)}`,
      },
      { role: "user", content: params.userPrompt },
    ],
    // 16000 default (raised from pricing.md §2's original 8000, 2026-11-09): glm-5.3-flash hit the
    // 8000 cap generating the full 7-day/21-meal JSON with content still empty -- likely spending
    // part of the budget on internal reasoning before the final answer. Callers doing smaller,
    // batched requests (meal-plan-generate's per-day-range batches) pass a smaller `maxTokens`.
    max_tokens: params.maxTokens ?? 16000,
  });

  const choices = json.choices as Array<{ message?: { content?: string } } > | undefined;
  const content = choices?.[0]?.message?.content;
  if (!content) {
    // TEMP (debugging empty-content-at-max_tokens): dump the raw message object so we can see
    // whether the output landed in a differently-named field (e.g. reasoning_content).
    console.log(`[llmClient] EMPTY CONTENT raw message: ${JSON.stringify(choices?.[0]?.message)}`);
    console.log(`[llmClient] EMPTY CONTENT finish_reason: ${(choices?.[0] as Record<string, unknown>)?.finish_reason}`);
    throw new Error("LLM returned no content");
  }

  return {
    data: JSON.parse(stripCodeFence(content)) as T,
    model,
    tokenIn: usage.prompt_tokens ?? 0,
    tokenOut: usage.completion_tokens ?? 0,
  };
}

/** Some models wrap JSON output in ```json fences despite instructions -- strip defensively. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: unknown; // JSON schema
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** For Chat: OpenAI-style function-calling loop -- the model may request a tool call, we execute
 * it server-side (against Postgres, via exerciseCatalog.ts / userContext.ts) and feed the result
 * back, up to one round-trip (chat-ai.md's basic-tier guardrail: "maks 1 tool call per turn",
 * pricing.md §5). Returns the final text reply. */
export async function generateWithTools(params: {
  systemInstruction: string;
  history: ChatTurn[];
  message: string;
  tools: FunctionDeclaration[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  model?: string;
}): Promise<LlmResult<{ text: string }>> {
  const model = params.model ?? DEFAULT_MODEL;
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [
    { role: "system", content: params.systemInstruction },
    ...params.history.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
    { role: "user", content: params.message },
  ];
  const tools = params.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let tokenIn = 0;
  let tokenOut = 0;
  let toolCallsUsed = 0;

  // At most 2 round-trips: 1 possible tool call, then the final text answer. On the 2nd
  // round-trip `tools` is OMITTED from the request (not just ignored) -- some models (observed
  // on nvidia/nemotron-3-ultra-550b-a55b:free) will emit ANOTHER tool_calls response instead of
  // a text answer if `tools` is still present, leaving `message.content` empty with nothing left
  // to execute it (tracked as the root cause of the empty `reply.text` bug, fixed here).
  for (let attempt = 0; attempt < 2; attempt++) {
    const isFinalAttempt = toolCallsUsed > 0;
    const { json, usage } = await callLlm({
      model,
      messages,
      ...(isFinalAttempt ? {} : { tools }),
      max_tokens: 800, // pricing.md §2 chat output ceiling
    });

    tokenIn += usage.prompt_tokens ?? 0;
    tokenOut += usage.completion_tokens ?? 0;

    const choices = json.choices as Array<{ message?: { content?: string | null; tool_calls?: LlmToolCall[] } }> | undefined;
    const message = choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (toolCalls.length > 0 && !isFinalAttempt) {
      toolCallsUsed++;
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: toolCalls });

      for (const [index, call] of toolCalls.entries()) {
        const args = safeJsonParse(call.function.arguments);
        // pricing.md's "max 1 tool call per turn" guardrail -- execute only the first, stub the rest.
        const result = index === 0 ? await params.executeTool(call.function.name, args) : { error: "Hanya 1 tool call diizinkan per giliran." };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue; // one more round-trip to get the final text
    }

    const text = message?.content?.trim();
    return { data: { text: text || FALLBACK_REPLY }, model, tokenIn, tokenOut };
  }

  return { data: { text: FALLBACK_REPLY }, model, tokenIn, tokenOut };
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
