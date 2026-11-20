-- Service-only request ledger: serialize each user's chat, reserve quota, and commit both
-- messages with the replayable response. Existing chat_message IDs remain compatible with sync.
create table public.chat_request (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  message text not null,
  history_limit integer not null,
  capability text not null check (capability in ('CHAT_AI_BASIC', 'CHAT_AI_PRO')),
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'COMPLETED', 'FAILED')),
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.chat_request enable row level security;

create or replace function public.begin_chat_request(
  p_user_id uuid, p_request_id text, p_message text, p_history_limit integer,
  p_capability text, p_max integer, p_start timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare previous public.chat_request; used_count integer; unlimited boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into previous from public.chat_request where user_id = p_user_id and request_id = p_request_id;
  if found then
    if previous.message <> p_message or previous.history_limit <> p_history_limit then
      return jsonb_build_object('status', 'CONFLICT');
    end if;
    return jsonb_build_object('status', previous.status, 'response', previous.response);
  end if;
  -- A crashed request is terminal; never silently start its model work a second time.
  update public.chat_request set status = 'FAILED'
    where user_id = p_user_id and status = 'PROCESSING' and created_at < now() - interval '120 seconds';
  if exists(select 1 from public.chat_request where user_id = p_user_id and status = 'PROCESSING') then
    return jsonb_build_object('status', 'BUSY');
  end if;
  if (select count(*) from public.chat_request where user_id = p_user_id and created_at >= now() - interval '1 minute') >= 10 then
    return jsonb_build_object('status', 'RATE_LIMIT');
  end if;
  select coalesce(unlimited_quota, false) into unlimited from public.user_entitlement where user_id = p_user_id;
  select count(*) into used_count from public.ai_usage
    where user_id = p_user_id and capability = p_capability and is_quota_unit and created_at >= p_start;
  if not coalesce(unlimited, false) and used_count >= p_max then
    return jsonb_build_object('status', 'QUOTA', 'used', used_count);
  end if;
  insert into public.chat_request(user_id, request_id, message, history_limit, capability)
    values(p_user_id, p_request_id, p_message, p_history_limit, p_capability);
  return jsonb_build_object('status', 'STARTED');
end $$;

create or replace function public.complete_chat_request(
  p_user_id uuid, p_request_id text, p_response jsonb, p_charge boolean
) returns void language plpgsql security definer set search_path = public as $$
declare job public.chat_request; stamp bigint; reply_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into job from public.chat_request where user_id = p_user_id and request_id = p_request_id for update;
  if not found or job.status <> 'PROCESSING' or job.created_at < now() - interval '120 seconds' then
    raise exception 'Chat request is not active';
  end if;
  stamp := (extract(epoch from job.created_at) * 1000)::bigint;
  reply_id := p_response #>> '{reply,id}';
  if reply_id is null or exists(select 1 from public.chat_message where id in (p_request_id, reply_id) and user_id is distinct from p_user_id) then
    raise exception 'Chat message ID conflict';
  end if;
  insert into public.chat_message(id, role, text, status, created_at, user_id, updated_at)
    values(p_request_id, 'USER', job.message, 'SENT', stamp, p_user_id, stamp)
    on conflict(id) do update set text = excluded.text, status = 'SENT', updated_at = excluded.updated_at;
  insert into public.chat_message(id, role, text, suggestion_exercise_id, suggestion_replaces_exercise_id,
    suggested_replies, status, created_at, user_id, updated_at)
    values(reply_id, 'ASSISTANT', p_response #>> '{reply,text}',
      p_response #>> '{reply,exerciseSuggestion,exerciseId}', p_response #>> '{reply,exerciseSuggestion,replacesExerciseId}',
      (p_response #> '{reply,suggestedReplies}')::text, 'SENT',
      coalesce((extract(epoch from (p_response #>> '{reply,createdAt}')::timestamptz) * 1000)::bigint, stamp + 1),
      p_user_id, (extract(epoch from clock_timestamp()) * 1000)::bigint)
    on conflict(id) do nothing;
  if p_charge then
    insert into public.ai_usage(user_id, capability, model, is_quota_unit) values(p_user_id, job.capability, 'chat-quota', true);
  end if;
  update public.chat_request set status = 'COMPLETED', response = p_response where user_id = p_user_id and request_id = p_request_id;
end $$;

revoke all on function public.begin_chat_request(uuid,text,text,integer,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_chat_request(uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.begin_chat_request(uuid,text,text,integer,text,integer,timestamptz) to service_role;
grant execute on function public.complete_chat_request(uuid,text,jsonb,boolean) to service_role;

create or replace function public.clear_chat_history(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare stamp bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists(select 1 from public.chat_request where user_id = p_user_id and status = 'PROCESSING' and created_at >= now() - interval '120 seconds') then
    return false;
  end if;
  update public.chat_message set status = 'DELETED', text = '', suggestion_exercise_id = null,
    suggestion_replaces_exercise_id = null, suggested_replies = null, updated_at = stamp where user_id = p_user_id;
  update public.chat_request set status = 'FAILED', message = '', response = null where user_id = p_user_id;
  return true;
end $$;

revoke all on function public.clear_chat_history(uuid) from public, anon, authenticated;
grant execute on function public.clear_chat_history(uuid) to service_role;

-- Accepted messages can only be written by chat-send. Old clients must not resurrect cleared rows.
revoke insert, update, delete on public.chat_message from public, authenticated, anon;
