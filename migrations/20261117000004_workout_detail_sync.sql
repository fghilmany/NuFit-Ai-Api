-- Preserve parent ownership through composite foreign keys, including on direct client sync.
create unique index if not exists workout_session_id_user_idx on public.workout_session(id, user_id);

create table public.workout_exercise_log (
  id text primary key,
  workout_session_id text not null,
  planned_exercise_index bigint not null,
  exercise_id text not null references public.exercise(id),
  skipped_at bigint,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at bigint not null,
  unique(id, user_id),
  foreign key(workout_session_id, user_id) references public.workout_session(id, user_id) on delete cascade
);

create table public.workout_set_log (
  id text primary key,
  workout_exercise_log_id text not null,
  set_number bigint not null check(set_number > 0),
  weight_kg double precision not null check(weight_kg >= 0),
  reps bigint not null check(reps >= 0),
  completed_at bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at bigint not null,
  foreign key(workout_exercise_log_id, user_id) references public.workout_exercise_log(id, user_id) on delete cascade
);

create index workout_exercise_log_user_updated_idx on public.workout_exercise_log(user_id, updated_at);
create index workout_set_log_user_updated_idx on public.workout_set_log(user_id, updated_at);

alter table public.workout_exercise_log enable row level security;
alter table public.workout_set_log enable row level security;

create policy own_workout_exercise_read on public.workout_exercise_log for select using(auth.uid() = user_id);
create policy own_workout_exercise_insert on public.workout_exercise_log for insert with check(auth.uid() = user_id);
create policy own_workout_exercise_update on public.workout_exercise_log for update using(auth.uid() = user_id) with check(auth.uid() = user_id);

create policy own_workout_set_read on public.workout_set_log for select using(auth.uid() = user_id);
create policy own_workout_set_insert on public.workout_set_log for insert with check(auth.uid() = user_id);
create policy own_workout_set_update on public.workout_set_log for update using(auth.uid() = user_id) with check(auth.uid() = user_id);
