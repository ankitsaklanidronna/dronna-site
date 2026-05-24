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
