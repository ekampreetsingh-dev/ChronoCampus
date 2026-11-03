-- =============================================================================
-- ChronoCampus 0004 — triggers
-- The important one: a profile is created only when the address already sits in
-- an approved directory. An unapproved Google account gets no foothold at all.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(btrim(new.email));
  v_match   record;
  v_matches int  := 0;
  v_role    text;
begin
  select * into v_match from public.allowed_admins   where lower(email) = v_email and is_active;
  if found then v_matches := v_matches + 1; v_role := 'admin'; end if;

  select * into v_match from public.allowed_teachers where lower(email) = v_email and is_active;
  if found then v_matches := v_matches + 1; v_role := coalesce(v_role, 'teacher'); end if;

  select * into v_match from public.allowed_students where lower(email) = v_email and is_active;
  if found then v_matches := v_matches + 1; v_role := coalesce(v_role, 'student'); end if;

  -- Ambiguity is recorded as pending so an administrator can see and resolve it,
  -- rather than silently granting the higher-privileged role.
  if v_matches > 1 then
    insert into public.profiles (id, email, full_name, role, is_active)
    values (new.id, v_email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'pending', false)
    on conflict (id) do update set role = 'pending', is_active = false;

    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (new.id, 'pending', 'authorization.conflict', v_email, jsonb_build_object('directories', v_matches));
    return new;
  end if;

  -- No directory match: create nothing. resolve_authorization() reports the denial.
  if v_matches = 0 then
    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (new.id, 'anonymous', 'authorization.denied', v_email, jsonb_build_object('reason', 'unregistered'));
    return new;
  end if;

  insert into public.profiles (id, email, full_name, role, subject, designation, employee_id, admission_number)
  values (
    new.id, v_email,
    coalesce(nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), v_match.full_name, split_part(v_email, '@', 1)),
    v_role::public.user_role,
    case when v_role = 'teacher' then v_match.subject end,
    case when v_role = 'admin'   then v_match.designation end,
    case when v_role = 'teacher' then v_match.employee_id end,
    case when v_role = 'student' then v_match.admission_number end
  )
  on conflict (id) do update
    set role = excluded.role, full_name = excluded.full_name, is_active = true, updated_at = now();

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (new.id, v_role, 'authorization.granted', v_email, jsonb_build_object('source', 'directory_trigger'));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ stamps ---
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','allowed_admins','allowed_teachers','allowed_students','class_codes','timetable_slots','school_settings'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------- operational notifications --
-- Substitution and homework changes reach the people affected without the
-- frontend having to remember to ask.
create or replace function public.notify_substitution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_section text; v_name text;
begin
  if new.status <> 'assigned' then return new; end if;
  select cs.name into v_section from public.class_sections cs
    join public.timetable_slots s on s.class_section_id = cs.id where s.id = new.slot_id;
  select full_name into v_name from public.allowed_teachers where id = new.substitute_teacher_id;

  insert into public.notifications (audience, user_id, kind, title, body)
  values ('teacher', (select id from public.profiles where email = (select lower(email) from public.allowed_teachers where id = new.substitute_teacher_id)),
          'substitution',
          format('You are covering %s', coalesce(v_section, 'a class')),
          format('%s — report to the room at the scheduled bell.', coalesce(v_name, '')));

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), public.current_role_name(), 'substitution.assign', new.slot_id::text,
          jsonb_build_object('substitute', new.substitute_teacher_id));
  return new;
end $$;

drop trigger if exists on_substitution on public.timetable_substitutions;
create trigger on_substitution after insert on public.timetable_substitutions
  for each row execute function public.notify_substitution();

create or replace function public.notify_homework_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_section text;
begin
  if new.homework_note is not distinct from old.homework_note then return new; end if;
  select name into v_section from public.class_sections where id = new.class_section_id;

  insert into public.notifications (audience, kind, title, body, payload)
  values ('student', 'homework',
          format('Homework updated for %s', v_section),
          left(new.homework_note, 180),
          jsonb_build_object('class_section_id', new.class_section_id, 'day', new.day, 'period', new.period));
  return new;
end $$;

drop trigger if exists on_homework on public.timetable_slots;
create trigger on_homework after update of homework_note on public.timetable_slots
  for each row execute function public.notify_homework_change();
