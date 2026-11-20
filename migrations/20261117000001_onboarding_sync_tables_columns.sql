-- Follow-up to 20261116000001_onboarding_sync_tables.sql: that migration used `create table if
-- not exists`, which no-ops entirely (columns included) when the table already existed from an
-- earlier manual/partial attempt -- exactly what happened here (body_measurement existed with
-- none of the expected columns, causing PostgREST PGRST204 on push). Mirrors
-- 20261109000002_full_assessment_result_columns.sql's safer `alter table ... add column if not
-- exists` pattern, idempotent regardless of the table's prior state.

alter table public.body_measurement
    add column if not exists recorded_at bigint,
    add column if not exists height_cm double precision,
    add column if not exists weight_kg double precision,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists updated_at bigint not null default 0;

alter table public.quick_assessment_result
    add column if not exists answered_at bigint,
    add column if not exists experience text,
    add column if not exists goal text,
    add column if not exists equipment text,
    add column if not exists frequency text,
    add column if not exists split_preference text,
    add column if not exists resolved_split text,
    add column if not exists level text,
    add column if not exists template_id text,
    add column if not exists split_educational_note text,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists updated_at bigint not null default 0;

alter table public.par_q_result
    add column if not exists answered_at bigint,
    add column if not exists requires_doctor_consult bigint,
    add column if not exists consult_acknowledged_at bigint,
    add column if not exists answers_json text,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists updated_at bigint not null default 0;

notify pgrst, 'reload schema';
