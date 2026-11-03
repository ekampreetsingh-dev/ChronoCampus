-- =============================================================================
-- ChronoCampus — Supabase schema
-- Run in the Supabase SQL editor, then copy .env.example to .env.
--
-- Tables   : profiles, allowed_admins, allowed_teachers, class_codes,
--            timetable_slots, teacher_absences
-- Trigger  : role is assigned from the whitelists, never chosen by the user
-- Guard    : teacher/room double-bookings are rejected by the database too
-- RPC      : verify_student_class_code(p_class_section, p_access_code)
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text unique not null,
  full_name    text not null default '',
  role         text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  subject      text,
  class_section text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------- whitelists ---
create table if not exists public.allowed_admins (
  email        text primary key,
  full_name    text not null,
  designation  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.allowed_teachers (
  email        text primary key,
  full_name    text not null,
  subject      text,
  phone        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.class_codes (
  class_section text primary key,
  access_code   text not null unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- timetable --
create table if not exists public.timetable_slots (
  id                       uuid primary key default gen_random_uuid(),
  day                      text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  period                   int  not null check (period between 1 and 12),
  class_section            text not null,
  subject                  text not null,
  teacher_id               uuid references auth.users (id) on delete set null,
  teacher_name             text not null default '',
  room                     text,
  homework_note            text default '',
  is_substitution          boolean not null default false,
  substitute_teacher_id    uuid references auth.users (id) on delete set null,
  substitute_teacher_name  text,
  sub_notes                text,
  updated_at               timestamptz not null default now(),
  -- one row per class per bell: the builder upserts against this
  unique (day, period, class_section)
);

create index if not exists slot_teacher_idx on public.timetable_slots (teacher_id, day, period);
create index if not exists slot_class_idx    on public.timetable_slots (class_section, day, period);
create index if not exists slot_room_idx     on public.timetable_slots (room, day, period);

create table if not exists public.teacher_absences (
  teacher_id  uuid not null references auth.users (id) on delete cascade,
  on_date     date not null,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (teacher_id, on_date)
);

-- =============================================================================
-- Role assignment on signup
-- The client never sends a role. Admins and teachers must already appear on a
-- spreadsheet the principal uploaded; everyone else starts as a student and has
-- to verify a class code.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    record;
  v_teacher  record;
begin
  select * into v_admin   from public.allowed_admins   where lower(email) = lower(new.email) limit 1;
  if found then
    insert into public.profiles (id, email, full_name, role, subject, class_section)
    values (new.id, new.email, coalesce(nullif(v_admin.full_name, ''), coalesce(new.raw_user_meta_data->>'full_name', '')), 'admin', null, null)
    on conflict (id) do update
      set role = 'admin', full_name = excluded.full_name, updated_at = now();
    return new;
  end if;

  select * into v_teacher from public.allowed_teachers where lower(email) = lower(new.email) limit 1;
  if found then
    insert into public.profiles (id, email, full_name, role, subject, class_section)
    values (new.id, new.email, coalesce(nullif(v_teacher.full_name, ''), coalesce(new.raw_user_meta_data->>'full_name', '')), 'teacher', v_teacher.subject, null)
    on conflict (id) do update
      set role = 'teacher', subject = excluded.subject, full_name = excluded.full_name, updated_at = now();
    return new;
  end if;

  insert into public.profiles (id, email, full_name, role, subject, class_section)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 'student', null, null)
  on conflict (id) do update set updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Conflict guard
-- Same bell, different class: a teacher or a room may only be in one place.
-- Mirrors the browser engine so a bad write can never land in the table.
-- =============================================================================
create or replace function public.assert_no_slot_conflict()
returns trigger
language plpgsql
as $$
declare
  v_teacher uuid;
  v_clash   record;
begin
  -- whoever actually stands in front of the class this period
  v_teacher := coalesce(new.substitute_teacher_id, new.teacher_id);

  if v_teacher is not null then
    select class_section, room into v_clash
    from public.timetable_slots
    where day = new.day and period = new.period
      and class_section is distinct from new.class_section
      and coalesce(substitute_teacher_id, teacher_id) = v_teacher
    limit 1;
    if found then
      raise exception 'CONFLICT_TEACHER: that teacher is already teaching % at % period %',
        v_clash.class_section, new.day, new.period
        using hint = 'Pick another teacher or move the period.';
    end if;
  end if;

  if new.room is not null and btrim(new.room) <> '' then
    select class_section, teacher_name into v_clash
    from public.timetable_slots
    where day = new.day and period = new.period
      and class_section is distinct from new.class_section
      and lower(btrim(room)) = lower(btrim(new.room))
    limit 1;
    if found then
      raise exception 'CONFLICT_ROOM: % is occupied by % at % period %',
        new.room, v_clash.class_section, new.day, new.period
        using hint = 'Choose another room or lab.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists slot_conflict_guard on public.timetable_slots;
create trigger slot_conflict_guard
  before insert or update on public.timetable_slots
  for each row execute function public.assert_no_slot_conflict();

-- =============================================================================
-- Student class verification (called by the app's RPC)
-- =============================================================================
create or replace function public.verify_student_class_code(
  p_class_section text,
  p_access_code   text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  select exists(
    select 1 from public.class_codes
    where class_section = p_class_section
      and upper(btrim(access_code)) = upper(btrim(p_access_code))
  ) into v_ok;

  if v_ok then
    update public.profiles
       set class_section = p_class_section, updated_at = now()
     where id = auth.uid() and role = 'student';
  end if;

  return coalesce(v_ok, false);
end;
$$;

revoke execute on function public.verify_student_class_code(text, text) from anon;
grant execute on function public.verify_student_class_code(text, text) to authenticated;

-- =============================================================================
-- Row level security
-- =============================================================================
alter table public.profiles          enable row level security;
alter table public.allowed_admins    enable row level security;
alter table public.allowed_teachers  enable row level security;
alter table public.class_codes       enable row level security;
alter table public.timetable_slots   enable row level security;
alter table public.teacher_absences  enable row level security;

-- anyone signed in may read their own profile; admins read all
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- a student may only ever change which section they belong to, never their role
    and (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
         or role = (select p.role from public.profiles p where p.id = auth.uid()))
  );

-- whitelists are admin-managed; teachers may see the staff list
drop policy if exists "admins manage allowed_admins" on public.allowed_admins;
create policy "admins manage allowed_admins" on public.allowed_admins
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "staff directory readable" on public.allowed_teachers;
create policy "staff directory readable" on public.allowed_teachers
  for select to authenticated using (true);

drop policy if exists "admins manage allowed_teachers" on public.allowed_teachers;
create policy "admins manage allowed_teachers" on public.allowed_teachers
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- codes are never readable by students; the RPC compares them server-side
drop policy if exists "admins manage class_codes" on public.class_codes;
create policy "admins manage class_codes" on public.class_codes
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- students: read only their verified section. teachers: read all, write their own notes.
drop policy if exists "read timetable" on public.timetable_slots;
create policy "read timetable" on public.timetable_slots
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'teacher'))
    or class_section = (select p.class_section from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "admins write timetable" on public.timetable_slots;
create policy "admins write timetable" on public.timetable_slots
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "teachers write own homework" on public.timetable_slots;
create policy "teachers write own homework" on public.timetable_slots
  for update to authenticated
  using (
    teacher_id = auth.uid()
    or substitute_teacher_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    teacher_id = auth.uid()
    or substitute_teacher_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "read absences" on public.teacher_absences;
create policy "read absences" on public.teacher_absences
  for select to authenticated using (true);

drop policy if exists "admins manage absences" on public.teacher_absences;
create policy "admins manage absences" on public.teacher_absences
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Optional: seed a starting set of class sections
-- =============================================================================
-- insert into public.class_codes (class_section, access_code) values
--   ('11-A Science',  'SCI11A-2026'),
--   ('11-B Commerce', 'COM11B-2026'),
--   ('12-A Science',  'SCI12A-2026');
