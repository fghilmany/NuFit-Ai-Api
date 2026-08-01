-- 20260731000001_ai_backend_tables.sql
-- ADR-008: Supabase Edge Functions backend for AI Custom Plan, Chat, Meal Plan (functional-first pass).

-- Simplified entitlement stand-in until RevenueCat is integrated (ADR-008).
-- Defaults every authenticated user to LOGGED_IN; flip a row to SUBSCRIBED manually for testing.
create table if not exists public.user_entitlement (
    user_id uuid primary key references auth.users(id) on delete cascade,
    tier text not null default 'LOGGED_IN' check (tier in ('LOGGED_IN', 'SUBSCRIBED')),
    updated_at timestamptz not null default now()
);

alter table public.user_entitlement enable row level security;
-- Service-role only (Edge Functions use the service key); no client-side policy needed/wanted.

-- Server-side usage ledger, also used to compute quota (chat 5/day, custom-plan/meal-plan monthly ceilings).
create table if not exists public.ai_usage (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    capability text not null check (capability in ('CHAT_AI_BASIC', 'CHAT_AI_PRO', 'AI_CUSTOM_PLAN', 'MEAL_PLAN')),
    model text not null,
    token_in integer not null default 0,
    token_out integer not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_capability_created_idx
    on public.ai_usage (user_id, capability, created_at desc);

alter table public.ai_usage enable row level security;
-- Service-role only.

-- Server-side copy of the bundled Exercise Library catalog (client keeps its own SQLDelight copy;
-- this is a read-only mirror for exerciseId validation + chat's get_exercise/search_exercises tools).
create table if not exists public.exercise (
    id text primary key,
    name text not null,
    equipment_category text not null,
    movement_pattern text not null,
    level text not null,
    primary_muscle_group text not null,
    target_muscles_primary jsonb not null default '[]'::jsonb,
    target_muscles_secondary jsonb not null default '[]'::jsonb,
    flag_exclusion jsonb not null default '[]'::jsonb,
    flag_priority jsonb not null default '[]'::jsonb,
    instructions_id text,
    common_mistakes_id text,
    safety_tips_id text
);

create index if not exists exercise_equipment_category_idx on public.exercise (equipment_category);
create index if not exists exercise_movement_pattern_idx on public.exercise (movement_pattern);
create index if not exists exercise_primary_muscle_group_idx on public.exercise (primary_muscle_group);

alter table public.exercise enable row level security;
create policy "exercise is publicly readable" on public.exercise
    for select using (true);
