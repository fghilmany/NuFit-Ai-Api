-- full_assessment_result was never created via a tracked migration in this repo (manually set up
-- during Auth & Sync work) and has drifted from the client's FullAssessmentResult.sq schema --
-- chat-send's getFullAssessmentSummary() failed with "column full_assessment_result.age does not
-- exist". This creates the table if it's somehow entirely missing, then adds every column the
-- sync participant (FullAssessmentSyncParticipant.kt) and chat grounding (userContext.ts) need,
-- idempotently -- safe to run whether the table pre-existed with a partial schema or not at all.
-- Columns are nullable here even where the client's local schema has NOT NULL: Postgres is a sync
-- mirror, not the source of truth, and ADD COLUMN ... NOT NULL would fail against existing rows.
create table if not exists public.full_assessment_result (
    id text primary key,
    user_id uuid references auth.users(id) on delete cascade,
    updated_at bigint not null default 0
);

alter table public.full_assessment_result
    add column if not exists completed_at bigint,
    add column if not exists age bigint,
    add column if not exists gender text,
    add column if not exists par_q_answers text,
    add column if not exists hard_stop_flagged bigint,
    add column if not exists hard_stop_acknowledged_at bigint,
    add column if not exists equipment_preference text,
    add column if not exists injury_history text,
    add column if not exists injury_history_note text,
    add column if not exists capacity_test text,
    add column if not exists goal text,
    add column if not exists sessions_per_week bigint,
    add column if not exists selected_weekdays text,
    add column if not exists session_duration_minutes bigint,
    add column if not exists activity_level text;

alter table public.full_assessment_result enable row level security;

-- Mirrors monthly_plan/chat_message's existing self-access pattern (client syncs via its own
-- JWT, not service role) -- only add if no policy already covers this, since the table may
-- already have one from however it was originally set up.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'full_assessment_result'
    ) then
        create policy "users can read their own full assessment result"
            on public.full_assessment_result for select using (auth.uid() = user_id);
        create policy "users can upsert their own full assessment result"
            on public.full_assessment_result for insert with check (auth.uid() = user_id);
        create policy "users can update their own full assessment result"
            on public.full_assessment_result for update using (auth.uid() = user_id);
    end if;
end $$;
