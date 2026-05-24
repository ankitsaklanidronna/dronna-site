create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  plan text not null default 'pro',
  amount_inr integer not null,
  currency text not null default 'INR',
  status text not null default 'created',
  razorpay_order_id text unique,
  razorpay_payment_id text,
  razorpay_signature text,
  set_id text,
  error_message text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
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

alter table public.payment_transactions
add column if not exists folder_id uuid references public.folders(id) on delete set null;

alter table public.payment_transactions enable row level security;
alter table public.coupon_codes enable row level security;
alter table public.coupon_course_folders enable row level security;

drop policy if exists "payment_transactions_own_read" on public.payment_transactions;
create policy "payment_transactions_own_read"
on public.payment_transactions
for select
to authenticated
using (lower(student_email) = lower(auth.jwt() ->> 'email'));

revoke insert, update, delete on public.payment_transactions from anon, authenticated;
grant select on public.payment_transactions to authenticated;

revoke all on public.coupon_codes from anon;
revoke all on public.coupon_codes from authenticated;
grant select on public.coupon_codes to authenticated;

revoke all on public.coupon_course_folders from anon;
revoke all on public.coupon_course_folders from authenticated;
grant select on public.coupon_course_folders to authenticated;

grant usage on schema public to service_role;
grant select, insert, update on public.payment_transactions to service_role;
grant select, insert, update, delete on public.coupon_codes to service_role;
grant select, insert, update, delete on public.coupon_course_folders to service_role;
grant select, update on public.students to service_role;

-- Edge Function uses the service role key for inserts/updates and for upgrading students.subscription_plan.
-- Deploy after running this SQL:
--   supabase functions deploy razorpay-payment
-- Required secrets:
--   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=xxx RAZORPAY_PLAN_AMOUNT_INR=99
-- RAZORPAY_PLAN_AMOUNT_INR is now only a fallback. Paid folders use folders.sale_price_inr
-- first, then discount_percent applied to price_inr, then price_inr. Coupon codes are
-- validated inside the Edge Function and stored on payment_transactions for auditing.
