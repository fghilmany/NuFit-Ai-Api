-- ADR-009: manual kill switch for AI-calling Edge Functions during the free MVP showcase phase.
-- Toggled by hand (Supabase dashboard/SQL) -- no admin UI this pass.
alter table public.user_entitlement
    add column if not exists ai_access_blocked boolean not null default false,
    add column if not exists blocked_reason text;
