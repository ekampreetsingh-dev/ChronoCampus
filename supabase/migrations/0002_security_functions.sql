-- =============================================================================
-- ChronoCampus 0002 — security-definer functions
-- Every function here fixes search_path, derives identity from auth.uid(), and
-- performs its own permission checks. Nothing trusts a browser-supplied id.
-- =============================================================================

-- ---------------------------------------------------------------- helpers ---
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'anonymous')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  )
$$;

create or replace function public.current_class_section()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select class_section from public.profiles where id = auth.uid()
$$;

create or replace function public.active_session_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.academic_sessions where is_active limit 1
$$;

-- =============================================================================
-- resolve_authorization
-- The single decision point for who may use the product, and in what role.
-- Priority is admin > teacher > student; two directories is a conflict; none
-- is a denial. Called after sign-in and again on revalidation.
-- =============================================================================
create or replace function public.resolve_authorization()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_name      text;
  v_admin     record;
  v_teacher   record;
  v_student   record;
  n_matches   int := 0;
  v_role      text;
  v_profile   record;
begin
  select lower(btrim(email)), raw_user_meta_data->>'full_name'
    into v_email, v_name
  from auth.users where id = auth.uid();

  if v_email is null then
    return jsonb_build_object('status', 'anonymous');
  end if;

  select * into v_admin   from public.allowed_admins   where lower(email) = v_email and is_active;
  if found then n_matches := n_matches + 1; v_role := 'admin'; end if;

  select * into v_teacher from public.allowed_teachers where lower(email) = v_email and is_active;
  if found then n_matches := n_matches + 1; v_role := coalesce(v_role, 'teacher'); end if;

  select * into v_student from public.allowed_students where lower(email) = v_email and is_active;
  if found then n_matches := n_matches + 1; v_role := coalesce(v_role, 'student'); end if;

  if n_matches = 0 then
    -- Present in a directory but switched off is a different message from absent.
    if exists (select 1 from public.allowed_admins   where lower(email) = v_email)
       or exists (select 1 from public.allowed_teachers where lower(email) = v_email)
       or exists (select 1 from public.allowed_students where lower(email) = v_email) then
      return jsonb_build_object(
        'status', 'denied', 'reason', 'inactive',
        'message', 'This school record has been deactivated, so access has been withdrawn. Please contact the administration.');
    end if;
    return jsonb_build_object(
      'status', 'denied', 'reason', 'unregistered',
      'message', 'Your email address is not registered with this school. Please contact the school administration.');
  end if;

  if n_matches > 1 then
    return jsonb_build_object(
      'status', 'conflict', 'reason', 'duplicate_identity',
      'message', 'This email appears in more than one school directory. An administrator must resolve it before you can sign in.');
  end if;

  -- Materialise or refresh the profile from the directory that matched.
  insert into public.profiles as p (id, email, full_name, role, subject, designation, employee_id, admission_number, is_active)
  values (
    auth.uid(), v_email,
    coalesce(nullif(btrim(v_name), ''), v_admin.full_name, v_teacher.full_name, v_student.full_name, split_part(v_email, '@', 1)),
    v_role::public.user_role,
    v_teacher.subject, v_admin.designation, v_teacher.employee_id, v_student.admission_number, true
  )
  on conflict (id) do update
    set role = excluded.role,
        subject = excluded.subject,
        designation = excluded.designation,
        employee_id = excluded.employee_id,
        admission_number = excluded.admission_number,
        full_name = coalesce(nullif(btrim(excluded.full_name), ''), p.full_name),
        is_active = true,
        updated_at = now()
  returning * into v_profile;

  -- A student's visible class always comes from their active enrollment.
  if v_role = 'student' then
    update public.profiles
       set class_section = (
             select cs.name from public.student_enrollments se
             join public.class_sections cs on cs.id = se.class_section_id
             where se.student_id = v_student.id and se.enrollment_status = 'active'
             limit 1
           )
     where id = auth.uid();
    select * into v_profile from public.profiles where id = auth.uid();
  end if;

  return jsonb_build_object('status', 'granted', 'role', v_role, 'profile', to_jsonb(v_profile));
end;
$$;

revoke execute on function public.resolve_authorization() from anon;
grant execute on function public.resolve_authorization() to authenticated;

-- =============================================================================
-- Class codes
-- =============================================================================
create or replace function public.generate_class_code(
  p_class_section_id uuid,
  p_session_id       uuid default null,
  p_expires_in_days  int  default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid := coalesce(p_session_id, public.active_session_id());
  v_section record;
  v_stream  text;
  v_grade   text;
  v_year    text;
  v_rand    text;
  v_plain   text;
  v_hash    text;
  v_existing record;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_session is null then
    raise exception 'no active academic session';
  end if;

  select * into v_section from public.class_sections where id = p_class_section_id;
  if not found then raise exception 'unknown class section'; end if;

  v_stream := case
    when v_section.name ~* 'science'   then 'SCI'
    when v_section.name ~* 'commerce'  then 'COM'
    when v_section.name ~* 'humanit'   then 'HUM'
    else 'GEN' end;
  v_grade := coalesce((regexp_match(v_section.name, '\d+'))[1], '00');
  v_year  := (select left(name, 4) from public.academic_sessions where id = v_session);

  -- Unambiguous alphabet: no I/O/0/1.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    into v_rand from generate_series(1, 3);

  v_plain := format('%s%s%s-%s-%s', v_stream, v_grade, upper(v_section.section), v_year, v_rand);
  v_hash  := crypt(v_plain, gen_salt('bf', 10));

  select * into v_existing from public.class_codes
   where class_section_id = p_class_section_id and academic_session_id = v_session;

  if found then
    update public.class_codes
       set code_hash = v_hash,
           code_hint = left(v_plain, 3) || '••••-' || v_year || '-•••',
           status = 'active',
           last_regenerated_at = now(),
           generated_at = now(),
           expires_at = now() + make_interval(days => p_expires_in_days)
     where id = v_existing.id;

    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (auth.uid(), public.current_role_name(), 'code.regenerate', v_section.name,
            jsonb_build_object('session_id', v_session, 'expires_in_days', p_expires_in_days));
  else
    insert into public.class_codes (class_section_id, academic_session_id, code_hash, code_hint, status, expires_at)
    values (p_class_section_id, v_session, v_hash,
            left(v_plain, 3) || '••••-' || v_year || '-•••', 'active',
            now() + make_interval(days => p_expires_in_days));

    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (auth.uid(), public.current_role_name(), 'code.generate', v_section.name,
            jsonb_build_object('session_id', v_session, 'expires_in_days', p_expires_in_days));
  end if;

  -- The plaintext is returned once and stored nowhere.
  return jsonb_build_object('plaintext', v_plain, 'class_section', v_section.name, 'expires_in_days', p_expires_in_days);
end;
$$;

revoke execute on function public.generate_class_code(uuid, uuid, int) from anon;
grant execute on function public.generate_class_code(uuid, uuid, int) to authenticated;

-- =============================================================================
-- verify_and_enroll
-- One transaction: identity, directory membership, active status, session,
-- code validity, rate limit, enrollment write, history preservation, audit.
-- =============================================================================
create or replace function public.verify_and_enroll(
  p_class_section text,
  p_access_code   text,
  p_session_name  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_me      record;
  v_dir     record;
  v_session record;
  v_section record;
  v_code    record;
  v_prev    record;
  v_new     uuid;
  v_fails   int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in.');
  end if;

  select * into v_me from public.profiles where id = v_uid;
  if not found or v_me.role <> 'student' or not v_me.is_active then
    return jsonb_build_object('ok', false, 'error', 'Only an approved, active student can verify a class.');
  end if;

  -- Directory membership is re-checked, not assumed from the profile.
  select * into v_dir from public.allowed_students
   where lower(email) = lower(v_me.email) and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Your student record is no longer active. Please see the office.');
  end if;

  select * into v_session from public.academic_sessions
   where (p_session_name is null and is_active) or (p_session_name is not null and name = p_session_name)
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No academic session is currently open for enrollment.');
  end if;

  select * into v_section from public.class_sections where name = p_class_section and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That class section is not available.');
  end if;

  -- Rate limit: 5 attempts per 10 minutes per account.
  select count(*) into v_fails from public.class_code_attempts
   where user_id = v_uid and not succeeded and attempted_at > now() - interval '10 minutes';
  if v_fails >= 5 then
    insert into public.class_code_attempts (user_id, succeeded) values (v_uid, false);
    return jsonb_build_object('ok', false, 'locked', true,
      'error', 'Too many failed attempts. Wait 10 minutes, then try again or see the school office.');
  end if;

  select * into v_code from public.class_codes
   where class_section_id = v_section.id and academic_session_id = v_session.id;

  if not found or v_code.status <> 'active' then
    insert into public.class_code_attempts (user_id, succeeded) values (v_uid, false);
    insert into public.class_code_verifications (user_id, class_section_id, academic_session_id, outcome, reason)
    values (v_uid, v_section.id, v_session.id, 'rejected', 'no active code');
    return jsonb_build_object('ok', false, 'error', 'This class code is not active. Ask the office for a new one.');
  end if;

  if v_code.expires_at is not null and v_code.expires_at < now() then
    update public.class_codes set status = 'expired' where id = v_code.id;
    insert into public.class_code_attempts (user_id, succeeded) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'This class code has expired. Ask the office for a new one.');
  end if;

  if not (v_code.code_hash = crypt(p_access_code, v_code.code_hash)) then
    insert into public.class_code_attempts (user_id, succeeded) values (v_uid, false);
    insert into public.class_code_verifications (user_id, class_section_id, academic_session_id, outcome, reason)
    values (v_uid, v_section.id, v_session.id, 'rejected', 'bad code');
    return jsonb_build_object('ok', false, 'error', 'Invalid class code for this section.');
  end if;

  insert into public.class_code_attempts (user_id, succeeded) values (v_uid, true);

  -- Preserve history: the previous enrollment is superseded, never deleted.
  select * into v_prev from public.student_enrollments
   where student_id = v_dir.id and enrollment_status = 'active';

  update public.student_enrollments
     set enrollment_status = 'superseded'
   where student_id = v_dir.id and enrollment_status = 'active';

  insert into public.student_enrollments
    (student_id, academic_session_id, class_section_id, enrollment_status, promoted_from_enrollment_id)
  values (v_dir.id, v_session.id, v_section.id, 'active', v_prev.id)
  returning id into v_new;

  update public.allowed_students set current_enrollment_id = v_new where id = v_dir.id;
  update public.profiles set class_section = v_section.name, updated_at = now() where id = v_uid;

  insert into public.class_code_verifications (user_id, class_section_id, academic_session_id, outcome, reason)
  values (v_uid, v_section.id, v_session.id, case when v_prev.id is null then 'enrolled' else 'promoted' end, null);

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (v_uid, 'student', case when v_prev.id is null then 'student.verify' else 'student.promote' end,
          v_section.name,
          jsonb_build_object('from', (select cs.name from public.student_enrollments se
                                       join public.class_sections cs on cs.id = se.class_section_id
                                       where se.id = v_prev.id), 'session', v_session.name));

  insert into public.notifications (audience, user_id, kind, title, body)
  values ('admin', null, 'enrollment',
          format('%s joined %s', v_me.full_name, v_section.name),
          format('Verified with a class code for session %s.', v_session.name));

  return jsonb_build_object('ok', true, 'class_section', v_section.name,
                            'session_name', v_session.name, 'promoted', v_prev.id is not null);
end;
$$;

revoke execute on function public.verify_and_enroll(text, text, text) from anon;
grant execute on function public.verify_and_enroll(text, text, text) to authenticated;

-- =============================================================================
-- upsert_timetable_slot
-- Conflict detection and the write share one transaction with a row lock on the
-- class section, so two admins editing the same bell cannot both succeed.
-- =============================================================================
create or replace function public.upsert_timetable_slot(p_slot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   uuid := coalesce((p_slot->>'academic_session_id')::uuid, public.active_session_id());
  v_section   uuid := (p_slot->>'class_section_id')::uuid;
  v_section_id_by_name uuid;
  v_day       text := p_slot->>'day';
  v_period    int  := (p_slot->>'period')::int;
  v_teacher   uuid := (p_slot->>'teacher_id')::uuid;
  v_room      text := nullif(btrim(coalesce(p_slot->>'room', '')), '');
  v_clash     record;
  v_slot      uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_session is null then raise exception 'no active academic session'; end if;

  if v_section is null and p_slot->>'class_section' is not null then
    select id into v_section_id_by_name from public.class_sections where name = p_slot->>'class_section';
    v_section := v_section_id_by_name;
  end if;
  if v_section is null then raise exception 'unknown class section'; end if;

  -- Serialize writers on this section for this bell.
  perform 1 from public.class_sections where id = v_section for update;

  if v_teacher is not null then
    select cs.name into v_clash
    from public.timetable_slots s
    join public.class_sections cs on cs.id = s.class_section_id
    where s.academic_session_id = v_session and s.day = v_day and s.period = v_period
      and s.class_section_id <> v_section
      and coalesce(
            (select t.substitute_teacher_id from public.timetable_substitutions t
              where t.slot_id = s.id and t.status = 'assigned' limit 1),
            s.teacher_id) = v_teacher
    limit 1;
    if v_clash is not null then
      return jsonb_build_object('ok', false, 'conflicts', jsonb_build_array(jsonb_build_object(
        'kind', 'teacher',
        'message', format('That teacher is already teaching %s during %s period %s.', v_clash, v_day, v_period))));
    end if;
  end if;

  if v_room is not null then
    select cs.name into v_clash
    from public.timetable_slots s
    join public.class_sections cs on cs.id = s.class_section_id
    where s.academic_session_id = v_session and s.day = v_day and s.period = v_period
      and s.class_section_id <> v_section
      and lower(btrim(s.room)) = lower(btrim(v_room))
    limit 1;
    if v_clash is not null then
      return jsonb_build_object('ok', false, 'conflicts', jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'message', format('%s is occupied by %s during this period.', v_room, v_clash))));
    end if;
  end if;

  insert into public.timetable_slots
      (academic_session_id, class_section_id, day, period, subject, teacher_id, room, homework_note, topic_note)
  values (v_session, v_section, v_day, v_period, p_slot->>'subject', v_teacher, v_room,
          coalesce(p_slot->>'homework_note', ''), coalesce(p_slot->>'topic_note', ''))
  on conflict (academic_session_id, class_section_id, day, period) do update
    set subject     = excluded.subject,
        teacher_id  = excluded.teacher_id,
        room        = excluded.room,
        homework_note = coalesce(nullif(excluded.homework_note, ''), public.timetable_slots.homework_note),
        topic_note  = coalesce(nullif(excluded.topic_note, ''), public.timetable_slots.topic_note),
        updated_at  = now()
  returning id into v_slot;

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), public.current_role_name(), 'timetable.upsert',
          format('%s %s P%s', (select name from public.class_sections where id = v_section), v_day, v_period),
          jsonb_build_object('subject', p_slot->>'subject', 'room', v_room));

  return jsonb_build_object('ok', true, 'slot', jsonb_build_object('id', v_slot));
end;
$$;

revoke execute on function public.upsert_timetable_slot(jsonb) from anon;
grant execute on function public.upsert_timetable_slot(jsonb) to authenticated;
