-- =============================================================================
-- ChronoCampus 0006 — what a class is made of
--
-- A section is not a static label: classes are renamed, streams are re-split,
-- and the senior syllabus changes with them. This migration gives each section
-- its own weekly subject load and makes a rename safe by carrying the
-- denormalised copies along with it.
-- =============================================================================

create table if not exists public.section_subjects (
  class_section_id uuid not null references public.class_sections (id) on delete cascade,
  subject          text not null,
  weekly_periods   int  not null check (weekly_periods between 1 and 20),
  updated_at       timestamptz not null default now(),
  primary key (class_section_id, subject)
);
create index if not exists section_subjects_section_idx on public.section_subjects (class_section_id);

alter table public.section_subjects enable row level security;

-- Students and teachers may read the syllabus their classes run; only an
-- administrator may change how many periods a subject gets.
drop policy if exists section_subjects_read on public.section_subjects;
create policy section_subjects_read on public.section_subjects for select to authenticated using (true);
drop policy if exists section_subjects_admin on public.section_subjects;
create policy section_subjects_admin on public.section_subjects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No subject list is inserted here on purpose: the syllabus belongs to the
-- school, and a migration is not the place to invent one. A class with no rows
-- simply falls back to the whole-school subject list in the builder until the
-- office publishes its own.

-- -----------------------------------------------------------------------------
-- Renaming a section
--
-- timetable_slots and student_enrollments join through the id, so they follow a
-- rename on their own. profiles.class_section is denormalised text, so it is
-- refreshed here rather than left pointing at a name that no longer exists.
-- -----------------------------------------------------------------------------
create or replace function public.sync_section_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.profiles
       set class_section = new.name
     where class_section = old.name;

    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (auth.uid(), coalesce(public.current_role_name(), 'system'), 'class.rename', new.name,
            jsonb_build_object('from', old.name, 'grade', new.grade, 'section', new.section, 'stream', new.stream));
  end if;
  return new;
end;
$$;

drop trigger if exists class_sections_rename on public.class_sections;
create trigger class_sections_rename
  before update of name on public.class_sections
  for each row execute function public.sync_section_name();

-- A section that has ever enrolled a student is part of someone's academic
-- record, so it can be archived but never deleted.
create or replace function public.guard_section_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled int;
begin
  select count(*) into v_enrolled from public.student_enrollments where class_section_id = old.id;
  if v_enrolled > 0 then
    raise exception 'class % has % enrollment record(s); archive it instead of deleting', old.name, v_enrolled
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists class_sections_removal_guard on public.class_sections;
create trigger class_sections_removal_guard
  before delete on public.class_sections
  for each row execute function public.guard_section_removal();

-- Trigger functions are never called by a role directly; keeping them
-- non-executable stops a client from invoking the definer path itself.
revoke execute on function public.sync_section_name() from public;
revoke execute on function public.guard_section_removal() from public;
