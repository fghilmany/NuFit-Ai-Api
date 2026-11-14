-- ADR-008 §3 follow-up: plan_day/planned_exercise/plan_day_session_log were the documented
-- "header-only sync" gap -- only monthly_plan itself synced, so a plan restored after
-- uninstall/new-device login came back with zero sessions (Home's "Sesi Minggu Ini" empty even
-- though Plans showed the plan as active). Creating all three now so the whole aggregate
-- round-trips, same self-access RLS pattern as every other synced table.
-- Columns mirror each table's SQLDelight .sq schema (PlanDay.sq/PlannedExercise.sq/
-- PlanDaySessionLog.sq), relaxed to nullable here -- this is a sync mirror, not the source of
-- truth.

create table if not exists public.plan_day (
    id text primary key,
    monthly_plan_id text references public.monthly_plan(id) on delete cascade,
    day_number bigint,
    type text,
    template_letter text,
    warmup_general text,
    cardio text,
    cooldown_heart_rate text,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

create table if not exists public.planned_exercise (
    id text primary key,
    plan_day_id text references public.plan_day(id) on delete cascade,
    slot text,
    exercise_id text,
    sets bigint,
    rep_range_or_duration text,
    rpe_target_min bigint,
    rpe_target_max bigint,
    reason_rule_ids text,
    rest_seconds bigint,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

create table if not exists public.plan_day_session_log (
    id text primary key,
    plan_day_id text references public.plan_day(id) on delete cascade,
    completed_at bigint,
    skipped_at bigint,
    rpe_reported bigint,
    pain_reported text,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

do $$
declare
    t text;
begin
    foreach t in array array['plan_day', 'planned_exercise', 'plan_day_session_log']
    loop
        execute format('alter table public.%I enable row level security', t);
        if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
            execute format('create policy "users can read their own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
            execute format('create policy "users can upsert their own %I" on public.%I for insert with check (auth.uid() = user_id)', t, t);
            execute format('create policy "users can update their own %I" on public.%I for update using (auth.uid() = user_id)', t, t);
        end if;
    end loop;
end $$;
