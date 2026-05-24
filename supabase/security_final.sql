-- Dronna production security baseline.
-- Run this after the schema files, then deploy the Edge Functions.
--
-- Important:
-- - Admin access is controlled from public.admin_users.
-- - Add/remove admins by editing public.admin_users, not Edge Function secrets or frontend env.
-- - Paid question text/answers are only selectable by admins and Pro students.
-- - Admin writes and payment upgrades must go through Edge Functions with the service role key.

create or replace function public.request_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now(),
  check (email = lower(btrim(email)) and email <> '')
);

-- Initial admin. After running this baseline, manage admins only in public.admin_users.
insert into public.admin_users (email)
values ('saklaniankit552@gmail.com')
on conflict (email) do nothing;

alter table public.admin_users enable row level security;

revoke all on public.admin_users from anon;
revoke all on public.admin_users from authenticated;
grant select on public.admin_users to service_role;

create or replace function public.is_admin_email()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.email = public.request_email()
  );
$$;

create or replace function public.is_pro_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_email()
    or exists (
      select 1
      from public.students s
      where lower(s.email) = public.request_email()
        and coalesce(s.subscription_plan, 'free') = 'pro'
    );
$$;

create table if not exists public.course_purchases (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  folder_id uuid not null references public.folders(id) on delete cascade,
  status text not null default 'active',
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  unique (student_email, folder_id)
);

create table if not exists public.coupon_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text,
  discount_type text not null default 'percent',
  discount_value integer not null default 0,
  max_discount_inr integer not null default 0,
  min_order_inr integer not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit integer not null default 0,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = upper(btrim(code)) and code <> ''),
  check (discount_type in ('percent', 'fixed')),
  check (discount_value >= 0),
  check (max_discount_inr >= 0),
  check (min_order_inr >= 0),
  check (usage_limit >= 0),
  check (used_count >= 0)
);

create table if not exists public.coupon_course_folders (
  coupon_id uuid not null references public.coupon_codes(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coupon_id, folder_id)
);

create index if not exists coupon_course_folders_folder_id_idx
on public.coupon_course_folders (folder_id);

create index if not exists coupon_codes_code_idx
on public.coupon_codes (code);

alter table public.payment_transactions
add column if not exists folder_id uuid references public.folders(id) on delete set null;

alter table public.payment_transactions
add column if not exists coupon_id uuid references public.coupon_codes(id) on delete set null;

alter table public.payment_transactions
add column if not exists coupon_code text;

alter table public.payment_transactions
add column if not exists original_amount_inr integer;

alter table public.payment_transactions
add column if not exists discount_inr integer default 0;

create index if not exists payment_transactions_coupon_id_idx
on public.payment_transactions (coupon_id);

create index if not exists payment_transactions_folder_id_idx
on public.payment_transactions (folder_id);

alter table public.folders
add column if not exists price_inr integer default 0;

alter table public.folders
add column if not exists discount_percent integer default 0;

alter table public.folders
add column if not exists sale_price_inr integer default 0;

create or replace function public.is_paid_material_folder(folder_id_value uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive folder_path as (
    select f.id, f.parent_id, f.is_paid
    from public.folders f
    where f.id = folder_id_value

    union all

    select parent.id, parent.parent_id, parent.is_paid
    from public.folders parent
    join folder_path child on child.parent_id = parent.id
  )
  select exists (
    select 1
    from folder_path
    where parent_id is not null
      and coalesce(is_paid, false) = true
  );
$$;

create or replace function public.has_course_access(folder_id_value uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive folder_path as (
    select f.id, f.parent_id
    from public.folders f
    where f.id = folder_id_value

    union all

    select parent.id, parent.parent_id
    from public.folders parent
    join folder_path child on child.parent_id = parent.id
  )
  select
    public.is_admin_email()
    or exists (
      select 1
      from public.course_purchases cp
      join folder_path fp on fp.id = cp.folder_id
      where lower(cp.student_email) = public.request_email()
        and coalesce(cp.status, 'active') = 'active'
    )
    or exists (
      select 1
      from public.payment_transactions pt
      join folder_path fp on fp.id = pt.folder_id
      where lower(pt.student_email) = public.request_email()
        and pt.status = 'paid'
    );
$$;

create or replace function public.can_read_question(question_id_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_email()
    or exists (
      select 1
      from public.set_questions sq
      join public.practice_sets ps on ps.id = sq.set_id
      where sq.question_id::text = question_id_value
        and (
          (
            coalesce(ps.is_paid, false) = false
            and not public.is_paid_material_folder(ps.folder_id)
          )
          or public.has_course_access(ps.folder_id)
        )
    )
    or exists (
      select 1
      from public.daily_challenges dc
      where dc.question_id::text = question_id_value
        and dc.challenge_date = current_date
    );
$$;

-- User-owned student data.
alter table public.students
add column if not exists ai_coach_language text not null default 'hindi';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'students_ai_coach_language_check'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
    add constraint students_ai_coach_language_check
    check (ai_coach_language in ('hindi', 'english'));
  end if;
end $$;

alter table public.students enable row level security;

drop policy if exists "students_self_select" on public.students;
drop policy if exists "students_self_insert" on public.students;
drop policy if exists "students_self_update" on public.students;
drop policy if exists "students_admin_select" on public.students;

revoke all on public.students from anon;
revoke all on public.students from authenticated;
grant select on public.students to authenticated;
grant insert on public.students to authenticated;
grant update (auth_user_id, full_name, exam_target, ai_coach_language, last_daily_date, streak) on public.students to authenticated;

create policy "students_self_select"
on public.students
for select
to authenticated
using (
  public.is_admin_email()
  or auth.uid() = auth_user_id
  or lower(email) = public.request_email()
);

create policy "students_self_insert"
on public.students
for insert
to authenticated
with check (
  public.is_admin_email()
  or (
    lower(email) = public.request_email()
    and (auth_user_id = auth.uid() or auth_user_id is null)
    and coalesce(subscription_plan, 'free') = 'free'
  )
);

create policy "students_self_update"
on public.students
for update
to authenticated
using (
  public.is_admin_email()
  or auth.uid() = auth_user_id
  or lower(email) = public.request_email()
)
with check (
  public.is_admin_email()
  or (
    lower(email) = public.request_email()
    and (auth_user_id = auth.uid() or auth_user_id is null)
  )
);

-- Attempts: students can write/read only their own; admin can read all.
alter table public.attempts enable row level security;

drop policy if exists "attempts_owner_select" on public.attempts;
drop policy if exists "attempts_owner_insert" on public.attempts;
drop policy if exists "attempts_admin_select" on public.attempts;

revoke all on public.attempts from anon;
revoke all on public.attempts from authenticated;
grant select, insert on public.attempts to authenticated;

create policy "attempts_owner_select"
on public.attempts
for select
to authenticated
using (
  public.is_admin_email()
  or lower(student_email) = public.request_email()
);

create policy "attempts_owner_insert"
on public.attempts
for insert
to authenticated
with check (
  public.is_admin_email()
  or lower(student_email) = public.request_email()
);

-- Public catalog metadata, admin-managed content writes.
alter table public.practice_sets enable row level security;
alter table public.folders enable row level security;
alter table public.set_questions enable row level security;
alter table public.questions enable row level security;
alter table public.daily_challenges enable row level security;

drop policy if exists "practice_sets_public_read" on public.practice_sets;
drop policy if exists "folders_public_read" on public.folders;
drop policy if exists "set_questions_public_read" on public.set_questions;
drop policy if exists "questions_public_read" on public.questions;
drop policy if exists "questions_read_access" on public.questions;
drop policy if exists "daily_challenges_public_read" on public.daily_challenges;

revoke insert, update, delete on public.practice_sets from anon, authenticated;
revoke insert, update, delete on public.folders from anon, authenticated;
revoke insert, update, delete on public.set_questions from anon, authenticated;
revoke insert, update, delete on public.questions from anon, authenticated;
revoke insert, update, delete on public.daily_challenges from anon, authenticated;

grant select on public.practice_sets to anon, authenticated;
grant select on public.folders to anon, authenticated;
grant select on public.set_questions to anon, authenticated;
grant select on public.questions to anon, authenticated;
grant select on public.daily_challenges to anon, authenticated;

create policy "practice_sets_public_read"
on public.practice_sets
for select
using (true);

create policy "folders_public_read"
on public.folders
for select
using (true);

create policy "set_questions_public_read"
on public.set_questions
for select
using (true);

create policy "questions_read_access"
on public.questions
for select
using (public.can_read_question(id::text));

create policy "daily_challenges_public_read"
on public.daily_challenges
for select
using (true);

-- Daily leaderboard: public read, authenticated self writes only.
alter table public.daily_leaderboard enable row level security;

drop policy if exists "daily_leaderboard_public_read" on public.daily_leaderboard;
drop policy if exists "daily_leaderboard_owner_insert" on public.daily_leaderboard;
drop policy if exists "daily_leaderboard_owner_update" on public.daily_leaderboard;

revoke all on public.daily_leaderboard from anon;
revoke all on public.daily_leaderboard from authenticated;
grant select on public.daily_leaderboard to anon, authenticated;
grant insert, update on public.daily_leaderboard to authenticated;

create policy "daily_leaderboard_public_read"
on public.daily_leaderboard
for select
using (true);

create policy "daily_leaderboard_owner_insert"
on public.daily_leaderboard
for insert
to authenticated
with check (
  public.is_admin_email()
  or lower(email) = public.request_email()
);

create policy "daily_leaderboard_owner_update"
on public.daily_leaderboard
for update
to authenticated
using (
  public.is_admin_email()
  or lower(email) = public.request_email()
)
with check (
  public.is_admin_email()
  or lower(email) = public.request_email()
);

-- Question reports: students can submit; only admins can read/resolve through Edge Function.
alter table public.question_reports enable row level security;

drop policy if exists "reports_read" on public.question_reports;
drop policy if exists "reports_write" on public.question_reports;
drop policy if exists "reports_public_insert" on public.question_reports;
drop policy if exists "reports_insert" on public.question_reports;

revoke all on public.question_reports from anon;
revoke all on public.question_reports from authenticated;
grant insert on public.question_reports to anon, authenticated;
grant select on public.question_reports to authenticated;

create policy "reports_insert"
on public.question_reports
for insert
with check (true);

create policy "reports_admin_read"
on public.question_reports
for select
to authenticated
using (public.is_admin_email());

-- Payment transactions: Edge Function writes, students can read their own rows.
alter table public.payment_transactions enable row level security;
alter table public.course_purchases enable row level security;
alter table public.coupon_codes enable row level security;
alter table public.coupon_course_folders enable row level security;

drop policy if exists "payment_transactions_own_read" on public.payment_transactions;
drop policy if exists "payment_transactions_admin_read" on public.payment_transactions;
drop policy if exists "course_purchases_own_read" on public.course_purchases;
drop policy if exists "coupon_codes_admin_read" on public.coupon_codes;
drop policy if exists "coupon_course_folders_admin_read" on public.coupon_course_folders;

revoke all on public.payment_transactions from anon;
revoke all on public.payment_transactions from authenticated;
grant select on public.payment_transactions to authenticated;

revoke all on public.course_purchases from anon;
revoke all on public.course_purchases from authenticated;
grant select on public.course_purchases to authenticated;

revoke all on public.coupon_codes from anon;
revoke all on public.coupon_codes from authenticated;
grant select on public.coupon_codes to authenticated;

revoke all on public.coupon_course_folders from anon;
revoke all on public.coupon_course_folders from authenticated;
grant select on public.coupon_course_folders to authenticated;

create policy "payment_transactions_own_read"
on public.payment_transactions
for select
to authenticated
using (
  public.is_admin_email()
  or lower(student_email) = public.request_email()
);

create policy "course_purchases_own_read"
on public.course_purchases
for select
to authenticated
using (
  public.is_admin_email()
  or lower(student_email) = public.request_email()
);

create policy "coupon_codes_admin_read"
on public.coupon_codes
for select
to authenticated
using (public.is_admin_email());

create policy "coupon_course_folders_admin_read"
on public.coupon_course_folders
for select
to authenticated
using (public.is_admin_email());

grant usage on schema public to service_role;
grant select, insert, update, delete on public.questions to service_role;
grant select, insert, update, delete on public.practice_sets to service_role;
grant select, insert, update, delete on public.set_questions to service_role;
grant select, insert, update, delete on public.folders to service_role;
grant select, insert, update, delete on public.daily_challenges to service_role;
grant select, insert, update, delete on public.question_reports to service_role;
grant select, insert, update on public.payment_transactions to service_role;
grant select, insert, update on public.course_purchases to service_role;
grant select, insert, update, delete on public.coupon_codes to service_role;
grant select, insert, update, delete on public.coupon_course_folders to service_role;
grant select, update on public.students to service_role;
grant select, delete on public.attempts to service_role;
