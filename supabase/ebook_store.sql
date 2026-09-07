-- Dronna ebook store setup.
-- Run after supabase/security_final.sql, then deploy razorpay-payment and razorpay-webhook.
--
-- Public visitors can read catalog metadata only. The protected file_url is returned
-- by get_my_ebook_library() only for the buyer email or an admin.

create table if not exists public.ebooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  description text,
  cover_url text,
  preview_url text,
  file_url text,
  price_inr integer not null default 0,
  mrp_inr integer not null default 0,
  discount_percent integer not null default 0,
  pages integer,
  file_type text not null default 'PDF',
  tags text[] not null default '{}'::text[],
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (title <> ''),
  check (price_inr >= 0),
  check (mrp_inr >= 0),
  check (discount_percent >= 0 and discount_percent <= 100),
  check (pages is null or pages > 0)
);

create table if not exists public.ebook_purchases (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  ebook_id uuid not null references public.ebooks(id) on delete cascade,
  status text not null default 'active',
  download_password text not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_email, ebook_id),
  check (student_email = lower(btrim(student_email)) and student_email <> ''),
  check (download_password <> ''),
  check (status in ('active', 'refunded', 'cancelled'))
);

alter table public.payment_transactions
add column if not exists ebook_id uuid references public.ebooks(id) on delete set null;

create index if not exists ebooks_active_sort_idx
on public.ebooks (is_active, sort_order, title);

create index if not exists ebook_purchases_student_email_idx
on public.ebook_purchases (student_email);

create index if not exists ebook_purchases_ebook_id_idx
on public.ebook_purchases (ebook_id);

create index if not exists payment_transactions_ebook_id_idx
on public.payment_transactions (ebook_id);

alter table public.ebooks enable row level security;
alter table public.ebook_purchases enable row level security;

drop policy if exists "ebooks_public_catalog_read" on public.ebooks;
drop policy if exists "ebook_purchases_own_read" on public.ebook_purchases;

revoke all on public.ebooks from anon;
revoke all on public.ebooks from authenticated;
revoke all on public.ebook_purchases from anon;
revoke all on public.ebook_purchases from authenticated;

grant select (
  id,
  title,
  subtitle,
  description,
  cover_url,
  preview_url,
  price_inr,
  mrp_inr,
  discount_percent,
  pages,
  file_type,
  tags,
  is_active,
  sort_order,
  created_at,
  updated_at
) on public.ebooks to anon, authenticated;

grant select on public.ebook_purchases to authenticated;

create policy "ebooks_public_catalog_read"
on public.ebooks
for select
using (is_active = true or public.is_admin_email());

create policy "ebook_purchases_own_read"
on public.ebook_purchases
for select
to authenticated
using (
  public.is_admin_email()
  or lower(student_email) = public.request_email()
);

create or replace function public.get_my_ebook_library()
returns table (
  id uuid,
  ebook_id uuid,
  title text,
  subtitle text,
  description text,
  cover_url text,
  file_url text,
  price_inr integer,
  mrp_inr integer,
  pages integer,
  file_type text,
  tags text[],
  download_password text,
  purchased_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.id as ebook_id,
    e.title,
    e.subtitle,
    e.description,
    e.cover_url,
    e.file_url,
    e.price_inr,
    e.mrp_inr,
    e.pages,
    e.file_type,
    e.tags,
    coalesce(ep.download_password, public.request_email()) as download_password,
    ep.created_at as purchased_at
  from public.ebooks e
  left join public.ebook_purchases ep
    on ep.ebook_id = e.id
    and lower(ep.student_email) = public.request_email()
    and coalesce(ep.status, 'active') = 'active'
  where e.is_active = true
    and (
      public.is_admin_email()
      or ep.id is not null
      or exists (
        select 1
        from public.payment_transactions pt
        where pt.ebook_id = e.id
          and lower(pt.student_email) = public.request_email()
          and pt.status = 'paid'
      )
    )
  order by e.sort_order asc, e.title asc;
$$;

revoke execute on function public.get_my_ebook_library() from public;
revoke execute on function public.get_my_ebook_library() from anon;
grant execute on function public.get_my_ebook_library() to authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.ebooks to service_role;
grant select, insert, update, delete on public.ebook_purchases to service_role;
grant select, insert, update on public.payment_transactions to service_role;

-- Sample insert. Replace URLs with your cover and protected PDF URLs.
-- insert into public.ebooks (title, subtitle, description, cover_url, file_url, price_inr, mrp_inr, pages, tags, sort_order)
-- values (
--   'UKPSC PYQ Ebook',
--   'Previous year questions with explanations',
--   'A focused PDF ebook for fast revision and practice.',
--   'https://your-cover-url.jpg',
--   'https://your-protected-pdf-url.pdf',
--   99,
--   199,
--   120,
--   array['UKPSC', 'PYQ'],
--   10
-- );
