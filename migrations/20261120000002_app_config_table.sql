-- Dev request (20 Nov 2026): force-update gate shown on Home when the installed app is older
-- than `min_android_version_code`. Public read-only key/value config -- no auth required so the
-- check works even before/without login. Writes stay admin-only (dashboard/service_role); no
-- app code ever writes this table.
create table if not exists public.app_config (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

create policy "anyone can read app_config" on public.app_config for select using (true);
grant select on public.app_config to anon, authenticated;

insert into public.app_config (key, value) values
    ('min_android_version_code', '1'),
    ('android_store_url', 'https://play.google.com/store/apps/details?id=com.fghilmany.nufitai')
on conflict (key) do nothing;
