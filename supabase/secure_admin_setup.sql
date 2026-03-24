-- 1. Admin list table
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins_select_own" on public.admins;
create policy "admins_select_own"
on public.admins
for select
to authenticated
using (auth.email() = email);

-- Add your admin email
insert into public.admins (email)
values ('saklaniankit552@gmail.com')
on conflict (email) do nothing;

-- 2. Public reads for content tables used by the site
alter table public.questions enable row level security;
alter table public.practice_sets enable row level security;
alter table public.set_questions enable row level security;
alter table public.folders enable row level security;
alter table public.daily_challenges enable row level security;

drop policy if exists "questions_public_read" on public.questions;
drop policy if exists "practice_sets_public_read" on public.practice_sets;
drop policy if exists "set_questions_public_read" on public.set_questions;
drop policy if exists "folders_public_read" on public.folders;
drop policy if exists "daily_challenges_public_read" on public.daily_challenges;

create policy "questions_public_read"
on public.questions
for select
using (true);

create policy "practice_sets_public_read"
on public.practice_sets
for select
using (true);

create policy "set_questions_public_read"
on public.set_questions
for select
using (true);

create policy "folders_public_read"
on public.folders
for select
using (true);

create policy "daily_challenges_public_read"
on public.daily_challenges
for select
using (true);

-- 3. Remove direct browser writes for admin-managed tables
drop policy if exists "questions_write" on public.questions;
drop policy if exists "practice_sets_write" on public.practice_sets;
drop policy if exists "set_questions_write" on public.set_questions;
drop policy if exists "folders_write" on public.folders;
drop policy if exists "daily_challenges_write" on public.daily_challenges;
drop policy if exists "questions_update" on public.questions;
drop policy if exists "questions_delete" on public.questions;
drop policy if exists "practice_sets_update" on public.practice_sets;
drop policy if exists "practice_sets_delete" on public.practice_sets;

revoke insert, update, delete on public.questions from anon, authenticated;
revoke insert, update, delete on public.practice_sets from anon, authenticated;
revoke insert, update, delete on public.set_questions from anon, authenticated;
revoke insert, update, delete on public.folders from anon, authenticated;
revoke insert, update, delete on public.daily_challenges from anon, authenticated;

-- 4. Question reports: students can still create reports, admins resolve through Edge Function
alter table public.question_reports enable row level security;

drop policy if exists "reports_read" on public.question_reports;
drop policy if exists "reports_write" on public.question_reports;
drop policy if exists "reports_public_insert" on public.question_reports;

create policy "reports_read"
on public.question_reports
for select
using (true);

create policy "reports_public_insert"
on public.question_reports
for insert
with check (true);

revoke update, delete on public.question_reports from anon, authenticated;
grant select, insert on public.question_reports to anon, authenticated;

-- 5. Notes
-- Admin writes now go through Edge Functions using the service role key.
-- Deploy these functions after running this SQL:
--   supabase functions deploy admin-status
--   supabase functions deploy admin-write
