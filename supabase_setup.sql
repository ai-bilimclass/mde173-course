-- ============================================================
-- MDE 173 course site — Supabase database setup
-- Run this ONCE in your Supabase project:
-- Dashboard -> SQL Editor -> New query -> paste all -> Run
-- ============================================================

-- 1. User profiles (auto-created on registration)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  role text not null default 'learner' check (role in ('learner','teacher')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- Auto-create a profile row whenever someone registers
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: is the current user a teacher?
create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'teacher');
$$;

-- 2. Learner progress (one row per user, whole progress object as JSON)
create table if not exists public.progress (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.progress enable row level security;

drop policy if exists "own progress select" on public.progress;
create policy "own progress select" on public.progress
  for select using (auth.uid() = user_id);

drop policy if exists "own progress insert" on public.progress;
create policy "own progress insert" on public.progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "own progress update" on public.progress;
create policy "own progress update" on public.progress
  for update using (auth.uid() = user_id);

-- 3. Teacher content edits (overrides applied on top of course_data.json)
create table if not exists public.content_overrides (
  activity_id text primary key,
  title text,
  intro text,
  content text,
  updated_by uuid references auth.users,
  updated_at timestamptz default now()
);

alter table public.content_overrides enable row level security;

drop policy if exists "logged-in users read overrides" on public.content_overrides;
create policy "logged-in users read overrides" on public.content_overrides
  for select using (auth.role() = 'authenticated');

drop policy if exists "teachers insert overrides" on public.content_overrides;
create policy "teachers insert overrides" on public.content_overrides
  for insert with check (public.is_teacher());

drop policy if exists "teachers update overrides" on public.content_overrides;
create policy "teachers update overrides" on public.content_overrides
  for update using (public.is_teacher());

drop policy if exists "teachers delete overrides" on public.content_overrides;
create policy "teachers delete overrides" on public.content_overrides
  for delete using (public.is_teacher());

-- ============================================================
-- 4. MAKE YOURSELF THE TEACHER
-- First register on the site with this email, THEN run:
-- ============================================================
-- update public.profiles set role = 'teacher'
--   where email = 'abdulkarim9315@gmail.com';
