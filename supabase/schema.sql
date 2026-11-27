-- Mindboard cloud sync schema.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Projects: one row per mind map, owned by the signed-in user.
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id          uuid    not null,
  name        text    not null default 'Untitled mind map',
  created_at  bigint  not null,            -- ms since epoch (client clock)
  updated_at  bigint  not null,            -- ms since epoch (client clock)
  tabs        jsonb   not null default '[]'::jsonb, -- [{id, name, order, version, elements, appState, ...}]
  elements    jsonb   not null default '[]'::jsonb, -- legacy (pre-tabs) single canvas
  app_state   jsonb   not null default '{}'::jsonb, -- legacy (pre-tabs) single canvas
  revision    bigint  not null default 1,  -- bumped on every write; used for optimistic concurrency
  deleted     boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Added with tabs; harmless if the column already exists.
alter table public.projects add column if not exists tabs jsonb not null default '[]'::jsonb;

create or replace function public.mindboard_touch_server_updated_at()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.mindboard_touch_server_updated_at();

-- Row level security: a user can only ever see and change their own rows.
alter table public.projects enable row level security;

drop policy if exists "projects: owner can read" on public.projects;
create policy "projects: owner can read" on public.projects
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "projects: owner can insert" on public.projects;
create policy "projects: owner can insert" on public.projects
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "projects: owner can update" on public.projects;
create policy "projects: owner can update" on public.projects
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "projects: owner can delete" on public.projects;
create policy "projects: owner can delete" on public.projects
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-in users reach the table through the API (RLS above limits them to their rows);
-- signed-out visitors get nothing.
grant select, insert, update, delete on table public.projects to authenticated;
revoke all on table public.projects from anon;

-- Live updates between devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Images: private storage bucket, files stored under "<user id>/<project id>/<file id>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('mindboard-files', 'mindboard-files', false)
on conflict (id) do update set public = false;

drop policy if exists "mindboard files: owner can read" on storage.objects;
create policy "mindboard files: owner can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'mindboard-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mindboard files: owner can upload" on storage.objects;
create policy "mindboard files: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mindboard-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mindboard files: owner can update" on storage.objects;
create policy "mindboard files: owner can update" on storage.objects
  for update to authenticated
  using (bucket_id = 'mindboard-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mindboard files: owner can delete" on storage.objects;
create policy "mindboard files: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mindboard-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Make the API see any new columns (e.g. tabs) right away.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
