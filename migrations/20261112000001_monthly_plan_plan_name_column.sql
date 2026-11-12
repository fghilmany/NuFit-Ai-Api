-- 20261109000003_chat_grounding_sync_tables.sql created public.monthly_plan with
-- `create table if not exists`, assuming the table didn't exist in the cloud project yet. It
-- already did (pre-dating tracked migrations, per that file's own comment), so the statement was a
-- no-op and never added `plan_name` -- client sync push started failing with PGRST204 "Could not
-- find the 'plan_name' column of 'monthly_plan' in the schema cache" once the editable-plan-name
-- feature started sending it. `add column if not exists` is required instead of a plain `add
-- column` so this migration stays safe to re-run against a project where the table genuinely was
-- created fresh by that earlier migration (column already present there).
alter table if exists public.monthly_plan add column if not exists plan_name text;
