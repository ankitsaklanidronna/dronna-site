-- Allow paid root folders to behave as purchasable courses.
-- Existing category roots remain free because they have is_paid = false.

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
    where coalesce(is_paid, false) = true
  );
$$;
