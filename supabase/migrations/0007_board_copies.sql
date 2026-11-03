-- =============================================================================
-- 0007 · Bulk board copies
--
-- The office builds a week by repeating work: Wednesday usually mirrors Monday,
-- and a new section usually starts from a sibling's timetable. Doing that cell by
-- cell is how double-bookings get created, so the copy runs server-side and every
-- period goes through upsert_timetable_slot — the same conflict check, the same
-- row lock and the same audit trail as a single edit made in the builder.
--
-- Nothing here is a demo shortcut: rows that clash come back in `blocked` with
-- the reason, and are never written.
-- =============================================================================

create or replace function public.copy_timetable_board(
  p_mode text,
  p_source text,
  p_target text,
  p_class text default null,
  p_overwrite boolean default false,
  p_carry_notes boolean default false,
  p_with_staff boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   uuid := public.active_session_id();
  v_from      uuid;
  v_to        uuid;
  v_to_name   text;
  v_to_room   text;
  v_day       text;
  v_src       record;
  v_existing  uuid;
  v_result    jsonb;
  v_written   int := 0;
  v_replaced  int := 0;
  v_blocked   jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_mode not in ('day', 'class') then
    raise exception 'p_mode must be day or class';
  end if;
  if v_session is null then
    raise exception 'no active academic session';
  end if;
  if coalesce(btrim(p_source), '') = '' or coalesce(btrim(p_target), '') = '' then
    raise exception 'a source and a destination are both required';
  end if;

  if p_mode = 'day' then
    select id, name into v_from, v_to_name from public.class_sections where name = p_class;
    if v_from is null then raise exception 'unknown class section'; end if;
    if p_source = p_target then raise exception 'the source and destination days are the same'; end if;
    v_to := v_from;
    v_day := p_target;
  else
    select id into v_from from public.class_sections where name = p_source;
    select id, name into v_to, v_to_name from public.class_sections where name = p_target;
    if v_from is null or v_to is null then raise exception 'unknown class section'; end if;
    if v_from = v_to then raise exception 'the source and destination classes are the same'; end if;
    select default_room into v_to_room from public.class_sections where id = v_to;
  end if;

  -- One writer at a time on the sections involved, exactly as the single-cell
  -- upsert does, so a copy cannot race a builder edit.
  perform 1 from public.class_sections where id in (v_from, v_to) for update;

  for v_src in
    select *
    from public.timetable_slots
    where academic_session_id = v_session
      and class_section_id = v_from
      and (p_mode = 'class' or day = p_source)
    order by period
  loop
    v_day := case when p_mode = 'day' then p_target else v_src.day end;

    select id into v_existing
    from public.timetable_slots
    where academic_session_id = v_session
      and class_section_id = v_to
      and day = v_day
      and period = v_src.period;

    if v_existing is not null and not p_overwrite then
      v_blocked := v_blocked || jsonb_build_object(
        'day', v_day, 'period', v_src.period, 'subject', v_src.subject,
        'reason', format('%s P%s in %s already holds another period.', v_day, v_src.period, v_to_name));
      continue;
    end if;

    v_result := public.upsert_timetable_slot(jsonb_build_object(
      'academic_session_id', v_session,
      'class_section_id', v_to,
      'day', v_day,
      'period', v_src.period,
      'subject', v_src.subject,
      'teacher_id', case when p_with_staff then v_src.teacher_id else null end,
      'room', case when p_mode = 'class' and coalesce(v_to_room, '') <> '' then v_to_room else v_src.room end,
      'homework_note', case when p_carry_notes then coalesce(v_src.homework_note, '') else '' end,
      'topic_note', case when p_carry_notes then coalesce(v_src.topic_note, '') else '' end
    ));

    if v_result->>'ok' = 'true' then
      v_written := v_written + 1;
      if v_existing is not null then v_replaced := v_replaced + 1; end if;
    else
      v_blocked := v_blocked || jsonb_build_object(
        'day', v_day, 'period', v_src.period, 'subject', v_src.subject,
        'reason', coalesce(v_result->'conflicts'->0->>'message', 'That bell conflicts with another class.'));
    end if;
  end loop;

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (
    auth.uid(),
    public.current_role_name(),
    'timetable.copy',
    format('%s %s -> %s', p_mode, coalesce(p_class, p_source), case when p_mode = 'day' then v_day else p_target end),
    jsonb_build_object('written', v_written, 'replaced', v_replaced, 'blocked', jsonb_array_length(v_blocked), 'carry_notes', p_carry_notes, 'with_staff', p_with_staff)
  );

  return jsonb_build_object('written', v_written, 'replaced', v_replaced, 'blocked', v_blocked);
end;
$$;

comment on function public.copy_timetable_board(text, text, text, text, boolean, boolean, boolean) is
  'Bulk copy of a class day or a whole week. Delegates every period to upsert_timetable_slot so conflicts are checked in the same transaction.';

revoke execute on function public.copy_timetable_board(text, text, text, text, boolean, boolean, boolean) from anon;
revoke execute on function public.copy_timetable_board(text, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.copy_timetable_board(text, text, text, text, boolean, boolean, boolean) to authenticated;
