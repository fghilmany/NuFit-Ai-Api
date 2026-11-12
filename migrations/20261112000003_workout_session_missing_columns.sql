-- Same root cause as 20261112000001 (monthly_plan.plan_name): 20261109000003's
-- `create table if not exists public.workout_session` assumed the table didn't exist in the
-- cloud project yet. It already did (pre-dating tracked migrations), so the statement was a
-- no-op and the columns it listed -- completed_at, status, current_exercise_index,
-- current_set_number, rest_end_at -- never got added. Client sync push then failed with
-- PGRST204 "Could not find the 'completed_at' column of 'workout_session' in the schema cache".
alter table if exists public.workout_session
    add column if not exists plan_day_id text,
    add column if not exists started_at bigint,
    add column if not exists completed_at bigint,
    add column if not exists status text,
    add column if not exists current_exercise_index bigint,
    add column if not exists current_set_number bigint,
    add column if not exists rest_end_at bigint;
