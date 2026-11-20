-- Follow-up to 20261116000001: that migration's RLS block only created policies when NONE
-- existed yet for the table ("if not exists (select 1 from pg_policies ...)"). These 3 tables
-- pre-existed from an earlier experiment with incompatible/incomplete policies, so the guard
-- silently skipped creating the correct ones -- push failed with 42501 (RLS violation) even
-- though the row's user_id matched auth.uid(). Drop-and-recreate by exact policy name instead
-- of guarding on "any policy exists", so this is safe to re-run regardless of prior state.

do $$
declare
    t text;
begin
    foreach t in array array['body_measurement', 'quick_assessment_result', 'par_q_result']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists "users can read their own %I" on public.%I', t, t);
        execute format('drop policy if exists "users can upsert their own %I" on public.%I', t, t);
        execute format('drop policy if exists "users can update their own %I" on public.%I', t, t);
        execute format('create policy "users can read their own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
        execute format('create policy "users can upsert their own %I" on public.%I for insert with check (auth.uid() = user_id)', t, t);
        execute format('create policy "users can update their own %I" on public.%I for update using (auth.uid() = user_id)', t, t);
    end loop;
end $$;
