-- user_profile ("Lengkapi Profil" age/gender) never existed server-side -- the client had no
-- sync participant for it at all, so logout's local wipe (privacy, by design) permanently lost
-- this row with nothing to restore on re-login. Columns mirror ProfileBasicsSyncParticipant.kt /
-- the local UserProfile.sq schema; user_id/updated_at/RLS follow the same self-access pattern as
-- every other synced table (20261109000003).
create table if not exists public.user_profile (
    user_id uuid primary key references auth.users(id) on delete cascade,
    age bigint not null,
    gender text not null,
    updated_at bigint not null default 0
);

alter table public.user_profile enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'user_profile'
          and policyname = 'users can read their own user_profile'
    ) then
        create policy "users can read their own user_profile"
            on public.user_profile for select using (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'user_profile'
          and policyname = 'users can upsert their own user_profile'
    ) then
        create policy "users can upsert their own user_profile"
            on public.user_profile for insert with check (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'user_profile'
          and policyname = 'users can update their own user_profile'
    ) then
        create policy "users can update their own user_profile"
            on public.user_profile for update using (auth.uid() = user_id);
    end if;
end $$;
