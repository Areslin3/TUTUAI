-- Run once in Supabase SQL Editor for this project.
-- The app uses one collaborative JSON row: public.app_state.id = 'main'.

create table if not exists public.app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Keep the browser client limited to the single app row. The anon key can still
-- read/update that row, so production deployments should move to Supabase Auth
-- before exposing this outside the trusted internal team.
drop policy if exists "allow anon select app_state" on public.app_state;
create policy "allow anon select app_state"
  on public.app_state for select
  using (id = 'main');

drop policy if exists "allow anon insert app_state" on public.app_state;
create policy "allow anon insert app_state"
  on public.app_state for insert
  with check (id = 'main');

drop policy if exists "allow anon update app_state" on public.app_state;
create policy "allow anon update app_state"
  on public.app_state for update
  using (id = 'main')
  with check (id = 'main');

insert into public.app_state (id, state, updated_at)
values ('main', '{}'::jsonb, now())
on conflict (id) do nothing;

-- Enable Realtime notifications for the app_state row. Supabase projects usually
-- have this publication; the block is safe to rerun.
do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
