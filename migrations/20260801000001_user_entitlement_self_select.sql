-- Lets a logged-in user read their OWN entitlement row via the client (PostgREST + their JWT),
-- mirroring how monthly_plan/chat_message etc. are already read (SyncRemoteDataSource pattern).
-- Previously user_entitlement was service-role-only (Edge Functions), unreadable by the client --
-- the client needs this now to reflect real Subscribe status in-app instead of a debug toggle.
create policy "users can read their own entitlement" on public.user_entitlement
    for select using (auth.uid() = user_id);
