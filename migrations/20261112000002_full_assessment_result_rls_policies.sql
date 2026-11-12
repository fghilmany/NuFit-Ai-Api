-- 20261109000002_full_assessment_result_columns.sql guarded its 3 policy creations with
-- `if not exists (select 1 from pg_policies where tablename = 'full_assessment_result')` --
-- "does ANY policy already exist", not "does THIS SPECIFIC policy exist". Since this table was
-- manually set up before migrations were tracked (per that file's own comment) and apparently
-- already had at least one policy (likely just select) by the time that migration ran, the guard
-- saw "a policy exists" and skipped creating all three, insert included -- client sync push then
-- started failing with 42501 "new row violates row-level security policy" on every write. This
-- migration checks each named policy individually so insert/update get created even though
-- select apparently already existed.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'full_assessment_result'
          and policyname = 'users can read their own full assessment result'
    ) then
        create policy "users can read their own full assessment result"
            on public.full_assessment_result for select using (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'full_assessment_result'
          and policyname = 'users can upsert their own full assessment result'
    ) then
        create policy "users can upsert their own full assessment result"
            on public.full_assessment_result for insert with check (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'full_assessment_result'
          and policyname = 'users can update their own full assessment result'
    ) then
        create policy "users can update their own full assessment result"
            on public.full_assessment_result for update using (auth.uid() = user_id);
    end if;
end $$;
