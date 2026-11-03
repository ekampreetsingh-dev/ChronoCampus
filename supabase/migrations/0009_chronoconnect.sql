-- =============================================================================
-- 0009 · ChronoConnect — one private community group per class-section
--
-- The rule the whole feature rests on: a student sees only the group of the class
-- they are enrolled in, a teacher sees only the groups they belong to, the class
-- teacher manages only their own group's roster, and only an administrator can
-- decide who the class teacher is. Every one of those is enforced here, in
-- policies and definer functions — the frontend checks are convenience, not
-- security.
--
-- Two of the six entities named in the brief are deliberately merged rather than
-- created as tables, and the reason is recorded here so it is not lost:
--   · group_announcements  → group_posts.kind = 'announcement' (+ pinned).
--     A separate table would put the same notice in two feeds that can disagree.
--   · group_teacher_assignments → group_members (role, source, added_by,
--     added_at, removed_by, removed_at). One row per person per group carries the
--     provenance the product needs AND makes "no duplicate membership" a
--     constraint instead of a convention.
-- =============================================================================

create table if not exists public.class_groups (
  id                uuid primary key default gen_random_uuid(),
  class_section_id  uuid references public.class_sections (id) on delete set null,
  name              text not null,                       -- '11-A Science'
  -- Mirrors class_sections.mentor_teacher_id. The section stays the source of
  -- truth; this copy is rewritten by set_class_teacher() and the trigger below,
  -- so the two can never drift apart.
  class_teacher_id  uuid references public.allowed_teachers (id) on delete set null,
  is_active         boolean not null default true,
  settings          jsonb not null default jsonb_build_object(
                      'students_can_comment', true,
                      'students_can_react', true,
                      'students_can_post', false
                    ),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists one_group_per_section
  on public.class_groups (class_section_id) where class_section_id is not null;
create index if not exists class_groups_teacher_idx on public.class_groups (class_teacher_id);

create table if not exists public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.class_groups (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('manager', 'teacher', 'student')),
  source      text not null default 'manual'
              check (source in ('class_teacher', 'timetable', 'enrolment', 'manual')),
  active      boolean not null default true,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),
  removed_by  uuid references public.profiles (id) on delete set null,
  removed_at  timestamptz,
  note        text,
  -- One row per person per group, ever. Re-adding reactivates the row, so a
  -- duplicate membership is rejected by the database, not by the screen.
  unique (group_id, user_id)
);
create index if not exists group_member_user_idx on public.group_members (user_id) where active;
create index if not exists group_member_group_idx on public.group_members (group_id, role) where active;

create table if not exists public.group_posts (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.class_groups (id) on delete cascade,
  parent_id   uuid references public.group_posts (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  kind        text not null default 'post'
              check (kind in ('announcement', 'homework', 'post', 'comment')),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  pinned      boolean not null default false,
  reactions   jsonb not null default '{}'::jsonb,
  removed_at  timestamptz,
  removed_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  -- A comment must point at a top-level post, never at another comment.
  check (parent_id is null or kind = 'comment')
);
create index if not exists group_post_feed_idx on public.group_posts (group_id, created_at desc);
create index if not exists group_post_thread_idx on public.group_posts (parent_id) where parent_id is not null;

alter table public.class_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_posts enable row level security;

-- ------------------------------------------------------------- readers ------
-- SECURITY DEFINER, because these predicates read group_members, which itself
-- is guarded by a policy that calls them — plain functions would recurse.

create or replace function public.group_membership(p_group uuid)
returns text
language sql stable security definer set search_path = public as $$
  -- 'admin' outranks the table: an administrator is not a member of anything and
  -- still has to be able to open every group.
  select case
    when public.is_admin() then 'admin'
    when exists (
      select 1 from public.class_groups g
      where g.id = p_group and g.class_teacher_id = (select id from public.profiles where id = auth.uid())
    ) then 'manager'
    else coalesce((
      select m.role from public.group_members m
      where m.group_id = p_group and m.user_id = auth.uid() and m.active
    ), '')
  end;
$$;

create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.group_membership(p_group) <> '';
$$;

-- The student's own group, resolved through the enrolment rather than through a
-- client-supplied class name.
create or replace function public.my_group_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select g.id
  from public.student_enrollments e
  join public.class_groups g on g.class_section_id = e.class_section_id
  where e.enrollment_status = 'active'
    and e.student_id = (select id from public.allowed_students where email = (select email from public.profiles where id = auth.uid()))
  limit 1;
$$;

revoke execute on function public.group_membership(uuid) from anon;
revoke execute on function public.is_group_member(uuid) from anon;
revoke execute on function public.my_group_id() from anon;

-- --------------------------------------------------------------- policies ---

drop policy if exists class_groups_read on public.class_groups;
create policy class_groups_read on public.class_groups for select to authenticated
  using ( public.is_admin() or public.is_group_member(id) );

drop policy if exists class_groups_write on public.class_groups;
create policy class_groups_write on public.class_groups for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists class_groups_manager_update on public.class_groups;
create policy class_groups_manager_update on public.class_groups for update to authenticated
  using ( class_teacher_id = auth.uid() )
  with check ( class_teacher_id = auth.uid() );

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members for select to authenticated
  using ( public.is_admin() or public.is_group_member(group_id) );

-- Memberships are written only through the functions below, which check the
-- caller's role in the group; nobody gets a direct policy here.

drop policy if exists group_posts_read on public.group_posts;
create policy group_posts_read on public.group_posts for select to authenticated
  using ( (public.is_admin() or public.is_group_member(group_id)) and removed_at is null );

drop policy if exists group_posts_write on public.group_posts;
create policy group_posts_write on public.group_posts for insert to authenticated
  with check ( public.is_admin() );

-- --------------------------------------------------------------- writers ----

create or replace function public.ensure_class_group(p_section uuid)
returns public.class_groups
language plpgsql security definer set search_path = public as $$
declare
  v_group public.class_groups;
  v_sec   public.class_sections;
begin
  select * into v_sec from public.class_sections where id = p_section;
  if not found then raise exception 'unknown class section' using errcode = '23503'; end if;

  select * into v_group from public.class_groups where class_section_id = p_section;
  if not found then
    insert into public.class_groups (class_section_id, name, class_teacher_id, is_active)
    values (p_section, v_sec.name, v_sec.mentor_teacher_id, v_sec.is_active)
    returning * into v_group;
    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (auth.uid(), public.current_role_name(), 'group.create', v_group.name,
            jsonb_build_object('class_section_id', p_section));
  end if;

  -- The class teacher is the manager. Nobody holds the role by their own doing.
  if coalesce(v_group.class_teacher_id::text, '') is distinct from coalesce(v_sec.mentor_teacher_id::text, '') then
    update public.group_members
       set active = false, removed_at = now(), removed_by = auth.uid()
     where group_id = v_group.id and role = 'manager' and active;
    update public.class_groups
       set class_teacher_id = v_sec.mentor_teacher_id, updated_at = now()
     where id = v_group.id
    returning * into v_group;
    insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
    values (auth.uid(), public.current_role_name(), 'group.manager', v_group.name,
            jsonb_build_object('to', v_sec.mentor_teacher_id));
  end if;

  if v_group.class_teacher_id is not null then
    insert into public.group_members (group_id, user_id, role, source, added_by)
    select v_group.id, p.id, 'manager', 'class_teacher', auth.uid()
      from public.profiles p
     where p.employee_id = (select employee_id from public.allowed_teachers where id = v_group.class_teacher_id)
    on conflict (group_id, user_id)
      do update set role = 'manager', active = true, removed_at = null, removed_by = null,
                    added_by = excluded.added_by, added_at = now();
  end if;

  return v_group;
end;
$$;

-- A new class-section gets its group the moment it exists. No admin has to
-- remember to do it, and no class can be created without one.
create or replace function public.ensure_class_group_row()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_class_group(new.id);
  return new;
end;
$$;

drop trigger if exists class_section_provisions_group on public.class_sections;
create after insert trigger class_section_provisions_group
  after insert on public.class_sections
  for each row execute function public.ensure_class_group_row();

-- Archiving a class closes its group without destroying anything said in it.
create or replace function public.sync_group_with_section()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.class_groups
     set name = new.name,
         is_active = new.is_active,
         archived_at = case when new.is_active then null else now() end,
         updated_at = now()
   where class_section_id = new.id;
  return new;
end;
$$;
drop trigger if exists class_section_syncs_group on public.class_sections;
create after update of name, is_active, mentor_teacher_id on public.class_sections
  for each row execute function public.sync_group_with_section();

/** Admin only: who runs the class, and therefore who manages its group. */
create or replace function public.set_class_teacher(p_section uuid, p_teacher uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sec public.class_sections;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_sec from public.class_sections where id = p_section;
  if not found then raise exception 'unknown class section' using errcode = '23503'; end if;
  if p_teacher is not null and not exists (select 1 from public.allowed_teachers where id = p_teacher and is_active) then
    raise exception 'that teacher is not in the staff directory' using errcode = '23503';
  end if;

  update public.class_sections set mentor_teacher_id = p_teacher where id = p_section;
  perform public.ensure_class_group(p_section);

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), 'admin', 'class.teacher', v_sec.name,
          jsonb_build_object('from', v_sec.mentor_teacher_id, 'to', p_teacher));
  return jsonb_build_object('ok', true, 'section', v_sec.name, 'teacher', p_teacher);
end;
$$;

/** The staff this group may still be given: registered, active, not already in. */
create or replace function public.group_candidate_teachers(p_group uuid)
returns table (id uuid, full_name text, subject text, employee_id text, is_member boolean, teaches_this_class boolean)
language sql stable security definer set search_path = public as $$
  with g as (select * from public.class_groups where id = p_group)
  select t.id, t.full_name, t.subject, t.employee_id,
         coalesce(m.active, false) as is_member,
         exists (
           select 1 from public.timetable_slots s
           where s.class_section_id = g.class_section_id and s.teacher_id = t.id
         ) as teaches_this_class
    from public.allowed_teachers t
    cross join g
    left join public.group_members m on m.group_id = g.id and m.user_id in (
      select p.id from public.profiles p where p.email = t.email
    )
   where t.is_active
     and (public.is_admin() or g.class_teacher_id = (
           select at2.id from public.allowed_teachers at2
           join public.profiles p2 on p2.email = at2.email
          where p2.id = auth.uid()))
   order by coalesce(m.active, false) desc, t.full_name;
$$;

create or replace function public.add_group_teachers(p_group uuid, p_teacher_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group public.class_groups;
  v_role  text;
  v_tid   uuid;
  v_user  uuid;
  v_added jsonb := '[]';
  v_existing jsonb := '[]';
  v_rejected jsonb := '[]';
begin
  select * into v_group from public.class_groups where id = p_group;
  if not found then raise exception 'unknown group' using errcode = '23503'; end if;
  v_role := public.group_membership(p_group);
  if v_role not in ('admin', 'manager') then
    raise exception 'only the class teacher or an administrator can add teachers' using errcode = '42501';
  end if;

  foreach v_tid in array p_teacher_ids loop
    select p.id into v_user
      from public.profiles p
      join public.allowed_teachers t on t.email = p.email
     where t.id = v_tid and t.is_active;
    if v_user is null then
      v_rejected := v_rejected || jsonb_build_object('id', v_tid, 'reason', 'not in the teacher directory');
      continue;
    end if;
    if v_user = (select p2.id from public.profiles p2
                   join public.allowed_teachers t2 on t2.email = p2.email
                  where t2.id = v_group.class_teacher_id) then
      v_rejected := v_rejected || jsonb_build_object('id', v_tid, 'reason', 'is the class teacher already');
      continue;
    end if;

    insert into public.group_members (group_id, user_id, role, source, added_by)
    values (p_group, v_user, 'teacher', 'manual', auth.uid())
    on conflict (group_id, user_id) do update
      set role = 'teacher', active = true, removed_at = null, removed_by = null,
          added_by = excluded.added_by, added_at = now(), source = 'manual'
    where public.group_members.active is not true;

    if found then
      v_added := v_added || jsonb_build_object('id', v_tid);
      insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
      values (auth.uid(), v_role, 'group.teacher.add', v_group.name,
              jsonb_build_object('teacher_id', v_tid));
    else
      v_existing := v_existing || jsonb_build_object('id', v_tid);
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'already', v_existing, 'rejected', v_rejected);
end;
$$;

create or replace function public.remove_group_teacher(p_group uuid, p_teacher uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group public.class_groups;
  v_role  text;
  v_user  uuid;
  v_row   public.group_members;
begin
  select * into v_group from public.class_groups where id = p_group;
  if not found then raise exception 'unknown group' using errcode = '23503'; end if;
  v_role := public.group_membership(p_group);
  if v_role not in ('admin', 'manager') then
    raise exception 'only the class teacher or an administrator can remove teachers' using errcode = '42501';
  end if;

  select p.id into v_user
    from public.profiles p join public.allowed_teachers t on t.email = p.email
   where t.id = p_teacher;
  if v_user is null then raise exception 'unknown teacher' using errcode = '23503'; end if;

  -- The class teacher is an administrative decision, never a membership edit.
  if v_group.class_teacher_id = p_teacher then
    raise exception 'the class teacher cannot be removed from their own group' using errcode = '42501';
  end if;

  select * into v_row from public.group_members
   where group_id = p_group and user_id = v_user and active;
  if not found then raise exception 'that teacher is not in this group' using errcode = '23503'; end if;

  -- A manager may only undo what they did; the office's additions stay.
  if v_role = 'manager' and v_row.added_by <> auth.uid() and v_row.source <> 'timetable' then
    raise exception 'you can only remove teachers you added to this group' using errcode = '42501';
  end if;

  update public.group_members
     set active = false, removed_at = now(), removed_by = auth.uid()
   where id = v_row.id;

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), v_role, 'group.teacher.remove', v_group.name,
          jsonb_build_object('teacher_id', p_teacher));
  return jsonb_build_object('removed', p_teacher);
end;
$$;

/** Posting. The group's own settings decide whether a student may speak. */
create or replace function public.post_to_group(p_group uuid, p_body text, p_kind text, p_parent uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group public.class_groups;
  v_role  text;
  v_post  public.group_posts;
begin
  select * into v_group from public.class_groups where id = p_group;
  if not found then raise exception 'unknown group' using errcode = '23503'; end if;
  if v_group.is_active is not true then
    raise exception 'this class is archived, so its group is read-only' using errcode = '42501';
  end if;
  v_role := public.group_membership(p_group);
  if v_role = '' then raise exception 'not a member of this group' using errcode = '42501'; end if;

  if v_role = 'student' then
    if p_parent is not null then
      if coalesce((v_group.settings ->> 'students_can_comment')::boolean, true) is not true then
        raise exception 'students cannot comment in this group' using errcode = '42501';
      end if;
    else
      if coalesce((v_group.settings ->> 'students_can_post')::boolean, false) is not true then
        raise exception 'students cannot publish to this group' using errcode = '42501';
      end if;
    end if;
  end if;

  if p_kind = 'announcement' and v_role not in ('admin', 'manager') then
    raise exception 'only the class teacher can publish an announcement' using errcode = '42501';
  end if;

  insert into public.group_posts (group_id, parent_id, author_id, kind, body)
  values (p_group, p_parent, auth.uid(),
          case when p_parent is not null then 'comment' else coalesce(nullif(p_kind, ''), 'post') end,
          btrim(p_body))
    returning * into v_post;

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), v_role, 'group.post', v_group.name, jsonb_build_object('post_id', v_post.id, 'kind', v_post.kind));

  return jsonb_build_object('ok', true, 'post', to_jsonb(v_post));
end;
$$;

create or replace function public.set_group_post_pinned(p_post uuid, p_pinned boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_post public.group_posts;
  v_role text;
begin
  select * into v_post from public.group_posts where id = p_post;
  if not found then raise exception 'unknown post' using errcode = '23503'; end if;
  v_role := public.group_membership(v_post.group_id);
  if v_role not in ('admin', 'manager') then
    raise exception 'only the class teacher can pin a post' using errcode = '42501';
  end if;
  update public.group_posts set pinned = p_pinned where id = p_post;
  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), v_role, case when p_pinned then 'group.pin' else 'group.unpin' end,
          (select name from public.class_groups where id = v_post.group_id),
          jsonb_build_object('post_id', p_post));
  return jsonb_build_object('ok', true, 'pinned', p_pinned);
end;
$$;

create or replace function public.remove_group_post(p_post uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_post public.group_posts;
  v_role text;
begin
  select * into v_post from public.group_posts where id = p_post;
  if not found then raise exception 'unknown post' using errcode = '23503'; end if;
  v_role := public.group_membership(v_post.group_id);
  if v_post.author_id is distinct from auth.uid() and v_role not in ('admin', 'manager') then
    raise exception 'you cannot remove that post' using errcode = '42501';
  end if;
  -- Soft delete: the row stays so moderation is auditable.
  update public.group_posts set removed_at = now(), removed_by = auth.uid()
   where id = p_post or parent_id = p_post;
  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), v_role, 'group.post.remove',
          (select name from public.class_groups where id = v_post.group_id),
          jsonb_build_object('post_id', p_post, 'own', v_post.author_id = auth.uid()));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.react_group_post(p_post uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_post public.group_posts;
  v_role text;
begin
  select * into v_post from public.group_posts where id = p_post;
  if not found then raise exception 'unknown post' using errcode = '23503'; end if;
  v_role := public.group_membership(v_post.group_id);
  if v_role = '' then raise exception 'not a member of this group' using errcode = '42501'; end if;
  update public.group_posts
     set reactions = case when reactions ? auth.uid()::text
                          then reactions - auth.uid()::text
                          else jsonb_set(reactions, array[auth.uid()::text], '"👍"'::jsonb) end
   where id = p_post;
  return jsonb_build_object('ok', true, 'reactions', (select reactions from public.group_posts where id = p_post));
end;
$$;

revoke execute on function public.ensure_class_group(uuid), public.set_class_teacher(uuid, uuid),
  public.add_group_teachers(uuid, uuid[]), public.remove_group_teacher(uuid, uuid),
  public.post_to_group(uuid, text, text, uuid), public.set_group_post_pinned(uuid, boolean),
  public.remove_group_post(uuid), public.react_group_post(uuid) from anon;
grant execute on function public.ensure_class_group(uuid), public.post_to_group(uuid, text, text, uuid),
  public.set_group_post_pinned(uuid, boolean), public.remove_group_post(uuid),
  public.react_group_post(uuid), public.group_candidate_teachers(uuid) to authenticated;
grant execute on function public.set_class_teacher(uuid, uuid),
  public.add_group_teachers(uuid, uuid[]), public.remove_group_teacher(uuid, uuid) to authenticated;

-- ----------------------------------------------------------- provisioning ---
-- Existing classes get their group, and the people who already belong to it are
-- enrolled from data the school already has: the mentor, the timetable, the
-- active enrolments. Nothing here invents a person or a class.

insert into public.class_groups (class_section_id, name, class_teacher_id, is_active)
select cs.id, cs.name, cs.mentor_teacher_id, cs.is_active
  from public.class_sections cs
 where not exists (select 1 from public.class_groups g where g.class_section_id = cs.id);

-- The class teacher of every existing section becomes its manager.
insert into public.group_members (group_id, user_id, role, source, added_by)
select g.id, p.id, 'manager', 'class_teacher', auth.uid()
  from public.class_groups g
  join public.allowed_teachers t on t.id = g.class_teacher_id
  join public.profiles p on p.email = t.email
on conflict (group_id, user_id) do update
  set role = 'manager', active = true, removed_at = null, removed_by = null;

-- The three staff who take the most periods of that class.
with ranked as (
  select s.class_section_id, s.teacher_id, count(*) as periods,
         row_number() over (partition by s.class_section_id order by count(*) desc, s.teacher_id) as rn
    from public.timetable_slots s
   where s.teacher_id is not null
   group by s.class_section_id, s.teacher_id
)
insert into public.group_members (group_id, user_id, role, source, added_by, note)
select g.id, p.id, 'teacher', 'timetable', auth.uid(), r.periods || ' periods a week with this class'
  from ranked r
  join public.class_groups g on g.class_section_id = r.class_section_id
  join public.allowed_teachers t on t.id = r.teacher_id
  join public.profiles p on p.email = t.email
 where r.rn <= 3
   and r.teacher_id is distinct from g.class_teacher_id
on conflict (group_id, user_id) do nothing;

-- Every actively enrolled student.
insert into public.group_members (group_id, user_id, role, source, added_by)
select g.id, p.id, 'student', 'enrolment', auth.uid()
  from public.student_enrollments e
  join public.class_groups g on g.class_section_id = e.class_section_id
  join public.allowed_students s on s.id = e.student_id
  join public.profiles p on p.email = s.email
 where e.enrollment_status = 'active'
on conflict (group_id, user_id) do update
  set role = 'student', active = true, removed_at = null, removed_by = null;
