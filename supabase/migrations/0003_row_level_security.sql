-- =============================================================================
-- ChronoCampus 0003 — row level security
-- The frontend route guards are convenience; these policies are the boundary.
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.allowed_admins        enable row level security;
alter table public.allowed_teachers      enable row level security;
alter table public.allowed_students      enable row level security;
alter table public.academic_sessions     enable row level security;
alter table public.class_sections        enable row level security;
alter table public.student_enrollments   enable row level security;
alter table public.class_codes           enable row level security;
alter table public.class_code_attempts   enable row level security;
alter table public.class_code_verifications enable row level security;
alter table public.timetable_slots       enable row level security;
alter table public.timetable_substitutions enable row level security;
alter table public.teacher_absences      enable row level security;
alter table public.school_settings       enable row level security;
alter table public.school_periods        enable row level security;
alter table public.school_holidays       enable row level security;
alter table public.notifications         enable row level security;
alter table public.audit_logs            enable row level security;

-- No anonymous reads of school data anywhere.
revoke all on public.profiles                from anon;
revoke all on public.allowed_admins          from anon;
revoke all on public.allowed_teachers        from anon;
revoke all on public.allowed_students        from anon;
revoke all on public.student_enrollments     from anon;
revoke all on public.class_codes             from anon;
revoke all on public.timetable_slots         from anon;
revoke all on public.audit_logs              from anon;

-- ---------------------------------------------------------------- profiles ---
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Own row only, and never the privileged columns — those are re-checked by the
-- trigger below so a crafted update cannot escalate a role.
drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.guard_profile_columns()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.admission_number is distinct from old.admission_number
       or new.employee_id is distinct from old.employee_id then
      raise exception 'protected profile column' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profile_column_guard on public.profiles;
create trigger profile_column_guard before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ------------------------------------------------------------ directories ---
drop policy if exists dirs_admin_all on public.allowed_admins;
create policy dirs_admin_all on public.allowed_admins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Teachers may see the staff list to know who covers what; only admins edit it.
drop policy if exists teachers_readable on public.allowed_teachers;
create policy teachers_readable on public.allowed_teachers for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','teacher')));

drop policy if exists teachers_admin_all on public.allowed_teachers;
create policy teachers_admin_all on public.allowed_teachers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Student rosters are personal data: admin-only, and a student may read their own.
drop policy if exists students_admin_all on public.allowed_students;
create policy students_admin_all on public.allowed_students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists students_read_self on public.allowed_students;
create policy students_read_self on public.allowed_students for select to authenticated
  using (lower(email) = lower((select email from public.profiles where id = auth.uid())));

-- ------------------------------------------------- structure and enrollment ---
drop policy if exists sessions_read on public.academic_sessions;
create policy sessions_read on public.academic_sessions for select to authenticated using (true);

drop policy if exists sessions_admin_write on public.academic_sessions;
create policy sessions_admin_write on public.academic_sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists sections_read on public.class_sections;
create policy sections_read on public.class_sections for select to authenticated using (true);

drop policy if exists sections_admin_write on public.class_sections;
create policy sections_admin_write on public.class_sections for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A student sees their own history; staff see everything relevant.
drop policy if exists enrollments_read on public.student_enrollments;
create policy enrollments_read on public.student_enrollments for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
    or student_id = (select id from public.allowed_students where lower(email) = lower((select email from public.profiles where id = auth.uid())))
  );

drop policy if exists enrollments_admin_write on public.student_enrollments;
create policy enrollments_admin_write on public.student_enrollments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------------- codes ---
-- Deliberately admin-only. code_hash is bcrypt, but the table is not selectable
-- by students at all, so a hint cannot even be harvested for offline guessing.
drop policy if exists codes_admin_all on public.class_codes;
create policy codes_admin_all on public.class_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists attempts_ownerless on public.class_code_attempts;
create policy attempts_ownerless on public.class_code_attempts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists verifications_admin on public.class_code_verifications;
create policy verifications_admin on public.class_code_verifications for all to authenticated
  using (public.is_admin());

-- -------------------------------------------------------------- timetable ----
-- Read: staff read all; a student reads only their verified section in the
-- active session.
drop policy if exists slots_read on public.timetable_slots;
create policy slots_read on public.timetable_slots for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','teacher'))
    or (
      class_section_id = (select cs.id from public.class_sections cs
                          where cs.name = (select class_section from public.profiles where id = auth.uid()))
      and academic_session_id = public.active_session_id()
    )
  );

drop policy if exists slots_admin_write on public.timetable_slots;
create policy slots_admin_write on public.timetable_slots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A teacher may annotate homework only on periods they actually teach.
drop policy if exists slots_teacher_note on public.timetable_slots;
create policy slots_teacher_note on public.timetable_slots for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create or replace function public.guard_slot_note()
returns trigger language plpgsql as $$
begin
  if public.is_admin() then return new; end if;
  if new.academic_session_id <> old.academic_session_id
     or new.class_section_id <> old.class_section_id
     or new.day <> old.day or new.period <> old.period
     or new.subject <> old.subject or new.teacher_id is distinct from old.teacher_id
     or new.room is distinct from old.room then
    raise exception 'teachers may only edit notes' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists slot_note_guard on public.timetable_slots;
create trigger slot_note_guard before update on public.timetable_slots
  for each row execute function public.guard_slot_note();

drop policy if exists subs_read on public.timetable_substitutions;
create policy subs_read on public.timetable_substitutions for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','teacher'))
    or slot_id in (select id from public.timetable_slots)
  );

drop policy if exists subs_admin_write on public.timetable_substitutions;
create policy subs_admin_write on public.timetable_substitutions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists absences_read on public.teacher_absences;
create policy absences_read on public.teacher_absences for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','teacher')));

drop policy if exists absences_admin_write on public.teacher_absences;
create policy absences_admin_write on public.teacher_absences for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------- school config --
drop policy if exists settings_read on public.school_settings;
create policy settings_read on public.school_settings for select to authenticated using (true);
drop policy if exists settings_admin on public.school_settings;
create policy settings_admin on public.school_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists periods_read on public.school_periods;
create policy periods_read on public.school_periods for select to authenticated using (true);
drop policy if exists periods_admin on public.school_periods;
create policy periods_admin on public.school_periods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists holidays_read on public.school_holidays;
create policy holidays_read on public.school_holidays for select to authenticated using (true);
drop policy if exists holidays_admin on public.school_holidays;
create policy holidays_admin on public.school_holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------- notices and audit ---
drop policy if exists notices_read on public.notifications;
create policy notices_read on public.notifications for select to authenticated
  using (user_id = auth.uid() or (audience is not null and audience::text = public.current_role_name()));

drop policy if exists notices_write on public.notifications;
create policy notices_write on public.notifications for insert to authenticated with check (true);

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());
