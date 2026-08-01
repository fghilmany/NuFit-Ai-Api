// OpenRouter wrapper (OpenAI-compatible chat completions API) -- matches pricing.md §7's
// production recommendation (route dev through OpenRouter too, same provider as prod). Kept
// behind this single small interface (generateStructured/generateWithTools) so swapping the exact
// model later is a one-file, one-constant change. See ADR-008.
//
// TODO(dev): "inclusionai/ling-3.0-flash:free" is a free OpenRouter model -- confirm it's still
// available/has quota before relying on it; free models on OpenRouter can be rate-limited or
// deprecated without much notice, same as Gemini's 2.0 generation was.
// Switched from "nvidia/nemotron-3-ultra-550b-a55b:free" (550B params) -- too slow/heavy, caused
// Edge Function invocations to hit Supabase's WORKER_RESOURCE_LIMIT before the model finished
// responding. Ling-3.0-flash is a 124B MoE model with only ~5.1B active params/token (much
// faster), which fits the Edge Function's compute budget.
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "inclusionai/ling-3.0-flash:free";

interface OpenRouterUsage {
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

async function callOpenRouter(body: Record<string, unknown>): Promise<{ json: Record<string, unknown>; usage: OpenRouterUsage }> {
  const res = await fetch(OPENROUTER_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      // OpenRouter asks for these on free-tier requests (used for their public leaderboard, not required but recommended).
      "HTTP-Referer": "https://nufit.ai",
      "X-Title": "NuFit AI",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { json, usage: (json.usage as OpenRouterUsage) ?? {} };
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
}): Promise<LlmResult<T>> {
  const model = params.model ?? DEFAULT_MODEL;
  const { json, usage } = await callOpenRouter({
    model,
    messages: [
      {
        role: "system",
        content: `${params.systemInstruction}\n\nBalas HANYA dengan JSON valid yang sesuai schema berikut, tanpa markdown/code fence, tanpa teks lain di luar JSON:\n${JSON.stringify(params.schema)}`,
      },
      { role: "user", content: params.userPrompt },
    ],
    max_tokens: 8000, // pricing.md §2 output ceiling
  });

  const choices = json.choices as Array<{ message?: { content?: string } } > | undefined;
  const content = choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content");

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

interface OpenRouterToolCall {
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
    const { json, usage } = await callOpenRouter({
      model,
      messages,
      ...(isFinalAttempt ? {} : { tools }),
      max_tokens: 800, // pricing.md §2 chat output ceiling
    });

    tokenIn += usage.prompt_tokens ?? 0;
    tokenOut += usage.completion_tokens ?? 0;

    const choices = json.choices as Array<{ message?: { content?: string | null; tool_calls?: OpenRouterToolCall[] } }> | undefined;
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
