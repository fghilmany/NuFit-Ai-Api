-- ADR-009: manual superuser flag, mirrors ai_access_blocked. Toggled by hand (Supabase
-- dashboard/SQL). Bypasses AI quota checks (chat/meal-plan/ai-custom-plan) for the flagged user;
-- tier gating and the ai_access_blocked kill switch still apply.
alter table public.user_entitlement
    add column if not exists unlimited_quota boolean not null default false;
