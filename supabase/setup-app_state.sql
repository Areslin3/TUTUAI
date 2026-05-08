-- 在 Supabase → SQL Editor 中执行（新建项目时跑一次即可）
-- 同步与多人协作依赖：匿名可读写的 app_state 表 + 建议开启 Realtime

create table if not exists public.app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "allow anon select app_state" on public.app_state;
create policy "allow anon select app_state" on public.app_state for select using (true);

drop policy if exists "allow anon insert app_state" on public.app_state;
create policy "allow anon insert app_state" on public.app_state for insert with check (true);

drop policy if exists "allow anon update app_state" on public.app_state;
create policy "allow anon update app_state" on public.app_state for update using (true) with check (true);

-- Realtime：Dashboard → Database → Publications → supabase_realtime → 勾选 app_state
-- 或在 Database → Replication 中把 app_state 加入 publication
