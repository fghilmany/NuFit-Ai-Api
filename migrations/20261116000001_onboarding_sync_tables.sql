-- BodyMeasurement/QuickAssessmentResult/ParQResult were the remaining "local-only" gap --
-- their sync participants were stubs (no table existed remotely at all), so height/weight,
-- Quick Assessment level, and PAR-Q answers never survived an uninstall/new-device login.
-- Columns mirror each table's SQLDelight .sq schema, relaxed to nullable here -- this is a sync
-- mirror, not the source of truth. par_q_answer_detail (child table) has no remote table of its
-- own; its content travels inside par_q_result.answers_json and is rebuilt locally on pull.

create table if not exists public.body_measurement (
    id text primary key,
    recorded_at bigint,
    height_cm double precision,
    weight_kg double precision,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

create table if not exists public.quick_assessment_result (
    id text primary key,
    answered_at bigint,
    experience text,
    goal text,
    equipment text,
    frequency text,
    split_preference text,
    resolved_split text,
    level text,
    template_id text,
    split_educational_note text,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

create table if not exists public.par_q_result (
    id text primary key,
    answered_at bigint,
    requires_doctor_consult bigint,
    consult_acknowledged_at bigint,
    answers_json text,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

do $$
declare
    t text;
begin
    foreach t in array array['body_measurement', 'quick_assessment_result', 'par_q_result']
    loop
        execute format('alter table public.%I enable row level security', t);
        if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
            execute format('create policy "users can read their own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
            execute format('create policy "users can upsert their own %I" on public.%I for insert with check (auth.uid() = user_id)', t, t);
            execute format('create policy "users can update their own %I" on public.%I for update using (auth.uid() = user_id)', t, t);
        end if;
    end loop;
end $$;
