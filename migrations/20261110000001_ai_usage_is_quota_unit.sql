-- meal-plan-generate moved from backend-internal day-batching to client-orchestrated per-day HTTP
-- calls (7 calls/week instead of 1-4) -- without this column, each call's recordUsage insert
-- would count as its own quota unit, burning MEAL_PLAN's 5/month cap 7x too fast. Default true
-- preserves existing behavior for CHAT_AI_BASIC/CHAT_AI_PRO/AI_CUSTOM_PLAN, where each ai_usage
-- row already is one quota unit.
alter table public.ai_usage
    add column if not exists is_quota_unit boolean not null default true;
