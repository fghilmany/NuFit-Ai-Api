-- chat-send's grounding tools (userContext.ts: getActivePlanSummary, getWorkoutHistorySummary,
-- getRecentChatHistory) query monthly_plan/workout_session/chat_message directly via PostgREST,
-- but none of the three has a tracked migration in this repo -- chat_message turned out to be
-- completely missing in the cloud project (PGRST205 "table not found in schema cache"). Creating
-- all three idempotently here rather than guessing which ones already exist correctly.
-- Columns mirror each feature's SQLDelight .sq schema (ChatMessage.sq/MonthlyPlan.sq/
-- WorkoutSession.sq) but relaxed to nullable in Postgres -- this is a sync mirror, not the
-- source of truth, so NOT NULL here would reject rows the client already considers valid locally
-- for fields it may legitimately omit.

create table if not exists public.chat_message (
    id text primary key,
    role text,
    text text,
    suggestion_exercise_id text,
    suggestion_replaces_exercise_id text,
    suggested_replies text,
    status text,
    created_at bigint,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

create table if not exists public.monthly_plan (
    id text primary key,
    started_at bigint,
    cycle_number bigint,
    source text,
    status text,
    plan_name text,
    level_meta text,
    goal_meta text,
    smart_goal_meta text,
    active_flags text,
    starting_level_per_pattern text,
    mode text,
    checkpoint_days text,
    deleted_at bigint,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

-- plan_day_id intentionally has no FK -- plan_day itself isn't synced to cloud (header-only sync,
-- ADR-008 §3), so the referenced row would never exist here.
create table if not exists public.workout_session (
    id text primary key,
    plan_day_id text,
    started_at bigint,
    completed_at bigint,
    status text,
    current_exercise_index bigint,
    current_set_number bigint,
    rest_end_at bigint,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

do $$
declare
    t text;
begin
    foreach t in array array['chat_message', 'monthly_plan', 'workout_session']
    loop
        execute format('alter table public.%I enable row level security', t);
        if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
            execute format('create policy "users can read their own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
            execute format('create policy "users can upsert their own %I" on public.%I for insert with check (auth.uid() = user_id)', t, t);
            execute format('create policy "users can update their own %I" on public.%I for update using (auth.uid() = user_id)', t, t);
        end if;
    end loop;
end $$;
