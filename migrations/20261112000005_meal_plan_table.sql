-- meal_plan was never created in the cloud project at all (unlike monthly_plan/full_assessment_result/
-- workout_session, which existed with a partial/missing schema) -- client sync pull failed with
-- PGRST205 "Could not find the table 'public.meal_plan' in the schema cache". Columns mirror
-- MealPlanSyncParticipant.kt / the local MealPlan.sq schema; user_id/updated_at/RLS follow the
-- same self-access pattern as every other synced table (20261109000003).
create table if not exists public.meal_plan (
    id text primary key,
    week_start_date bigint,
    calories bigint,
    protein_g bigint,
    carb_g bigint,
    fat_g bigint,
    weight_kg_at_generation double precision,
    goal text,
    created_at bigint,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

alter table public.meal_plan enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'meal_plan'
          and policyname = 'users can read their own meal_plan'
    ) then
        create policy "users can read their own meal_plan"
            on public.meal_plan for select using (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'meal_plan'
          and policyname = 'users can upsert their own meal_plan'
    ) then
        create policy "users can upsert their own meal_plan"
            on public.meal_plan for insert with check (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'meal_plan'
          and policyname = 'users can update their own meal_plan'
    ) then
        create policy "users can update their own meal_plan"
            on public.meal_plan for update using (auth.uid() = user_id);
    end if;
end $$;
