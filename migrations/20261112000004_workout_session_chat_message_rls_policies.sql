-- Same root cause as 20261112000002 (full_assessment_result RLS): 20261109000003's policy loop
-- for chat_message/monthly_plan/workout_session guards on "does ANY policy already exist for
-- this table", not "does THIS SPECIFIC policy exist". monthly_plan already had its own policies
-- from an earlier migration, so it was fine. workout_session (confirmed via a live 403 "new row
-- violates row-level security policy") and chat_message (same migration, not yet exercised, but
-- the same pre-existing-table-with-partial-setup situation applies) both pre-dated this migration
-- with at least one leftover policy, so the loop's "any policy exists" guard skipped creating
-- insert/update for them too. Checks each named policy individually so the missing ones get
-- created regardless of what already existed. monthly_plan is deliberately left alone -- it's not
-- broken, so there's nothing to add.
do $$
declare
    t text;
begin
    foreach t in array array['chat_message', 'workout_session']
    loop
        if not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = t
              and policyname = format('users can read their own %s', t)
        ) then
            execute format('create policy "users can read their own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
        end if;

        if not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = t
              and policyname = format('users can upsert their own %s', t)
        ) then
            execute format('create policy "users can upsert their own %I" on public.%I for insert with check (auth.uid() = user_id)', t, t);
        end if;

        if not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = t
              and policyname = format('users can update their own %s', t)
        ) then
            execute format('create policy "users can update their own %I" on public.%I for update using (auth.uid() = user_id)', t, t);
        end if;
    end loop;
end $$;
