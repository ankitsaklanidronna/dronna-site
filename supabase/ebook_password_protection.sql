-- Per-buyer password-protected ebook generation.
-- Original PDFs live in private Storage bucket ebook-originals.
-- Generated buyer-specific PDFs live in private Storage bucket ebook-protected.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ebook-originals', 'ebook-originals', false, 104857600, array['application/pdf']),
  ('ebook-protected', 'ebook-protected', false, 104857600, array['application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.ebooks
add column if not exists source_bucket text not null default 'ebook-originals';

alter table public.ebooks
add column if not exists source_file_path text;

alter table public.ebooks
add column if not exists protected_bucket text not null default 'ebook-protected';

alter table public.ebook_purchases
add column if not exists protected_file_path text;

alter table public.ebook_purchases
add column if not exists generation_status text not null default 'pending';

alter table public.ebook_purchases
add column if not exists generation_error text;

alter table public.ebook_purchases
add column if not exists generated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebook_purchases_generation_status_check'
      and conrelid = 'public.ebook_purchases'::regclass
  ) then
    alter table public.ebook_purchases
    add constraint ebook_purchases_generation_status_check
    check (generation_status in ('pending', 'processing', 'ready', 'failed'));
  end if;
end $$;

create index if not exists ebook_purchases_generation_status_idx
on public.ebook_purchases (generation_status);

drop function if exists public.get_my_ebook_library();

create function public.get_my_ebook_library()
returns table (
  id uuid,
  ebook_id uuid,
  title text,
  subtitle text,
  description text,
  cover_url text,
  price_inr integer,
  mrp_inr integer,
  pages integer,
  file_type text,
  tags text[],
  download_password text,
  generation_status text,
  has_source_pdf boolean,
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
    e.price_inr,
    e.mrp_inr,
    e.pages,
    e.file_type,
    e.tags,
    coalesce(ep.download_password, public.request_email()) as download_password,
    coalesce(ep.generation_status, 'pending') as generation_status,
    (coalesce(e.source_file_path, '') <> '' or coalesce(e.file_url, '') <> '') as has_source_pdf,
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

grant select, insert, update, delete on storage.objects to service_role;
grant select, insert, update, delete on storage.buckets to service_role;
