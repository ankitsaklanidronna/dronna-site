-- Add a student-owned AI Coach language preference.
-- Run this before deploying the updated groq-coach Edge Function.

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

grant update (ai_coach_language) on public.students to authenticated;
