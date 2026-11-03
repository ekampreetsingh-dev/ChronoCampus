-- =============================================================================
-- ChronoCampus 0001 — core schema
-- Versioned so an existing school database can be upgraded without a rewrite.
-- Idempotent: safe to re-run.
-- =============================================================================
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ enums ---
do $$ begin
  create type public.user_role as enum ('admin', 'teacher', 'student', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.session_status as enum ('upcoming', 'active', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrollment_status as enum ('active', 'superseded', 'completed', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.code_status as enum ('active', 'rotated', 'deactivated', 'expired');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- profiles ---
-- A profile exists only for an address present in an approved directory.
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text not null unique,
  full_name        text not null default '',
  role             public.user_role not null default 'pending',
  subject          text,
  designation      text,
  admission_number text,
  employee_id      text,
  class_section    text,          -- denormalised convenience for the current session
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);

-- ------------------------------------------------- the three directories ----
-- Source of truth for authorization. Deactivating a row withdraws access
-- without destroying the person's academic history.
create table if not exists public.allowed_admins (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  full_name    text not null,
  designation  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.allowed_teachers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  full_name   text not null,
  subject     text,
  phone       text,
  employee_id text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.allowed_students (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  full_name           text not null,
  admission_number    text unique,
  current_enrollment_id uuid,      -- set after student_enrollments exists
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- --------------------------------------------------------- academic terms ---
create table if not exists public.academic_sessions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,           -- '2026–27'
  start_date date not null,
  end_date   date not null,
  status     public.session_status not null default 'upcoming',
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);
-- Exactly one session may be open at a time.
create unique index if not exists one_active_session
  on public.academic_sessions (is_active) where is_active;

create table if not exists public.class_sections (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,    -- '11-A Science'
  grade             int  not null check (grade between 1 and 12),
  section           text not null,
  stream            text,
  mentor_teacher_id uuid references public.allowed_teachers (id) on delete set null,
  default_room      text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index if not exists section_grade_stream
  on public.class_sections (grade, section, coalesce(stream, ''));

create table if not exists public.student_enrollments (
  id                          uuid primary key default gen_random_uuid(),
  student_id                  uuid not null references public.allowed_students (id) on delete cascade,
  academic_session_id         uuid not null references public.academic_sessions (id),
  class_section_id            uuid not null references public.class_sections (id),
  enrollment_status           public.enrollment_status not null default 'active',
  enrolled_at                 timestamptz not null default now(),
  promoted_from_enrollment_id uuid references public.student_enrollments (id),
  -- history is never overwritten: one active enrollment per student per session
  unique (student_id, academic_session_id) deferrable initially deferred
);
create unique index if not exists one_active_enrollment
  on public.student_enrollments (student_id) where enrollment_status = 'active';
create index if not exists enrollment_session_idx on public.student_enrollments (academic_session_id, class_section_id);

do $$ begin
  alter table public.allowed_students
    add constraint allowed_students_current_enrollment_fk
    foreign key (current_enrollment_id) references public.student_enrollments (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ class codes ---
-- bcrypt hash only. The plaintext exists in the response of generate_class_code
-- exactly once and is never stored or selectable.
create table if not exists public.class_codes (
  id                   uuid primary key default gen_random_uuid(),
  class_section_id     uuid not null references public.class_sections (id) on delete cascade,
  academic_session_id  uuid not null references public.academic_sessions (id),
  code_hash            text not null,
  code_hint            text not null,        -- 'SCI••••-2026-•••' for the admin table
  status               public.code_status not null default 'active',
  generated_at         timestamptz not null default now(),
  last_regenerated_at  timestamptz,
  expires_at           timestamptz,
  unique (class_section_id, academic_session_id)
);

-- Failed-attempt ledger backing the rate limit inside verify_and_enroll.
create table if not exists public.class_code_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded   boolean not null default false
);
create index if not exists attempt_window_idx on public.class_code_attempts (user_id, attempted_at desc);

-- Verification history without ever recording a code.
create table if not exists public.class_code_verifications (
  id                bigint generated always as identity primary key,
  user_id           uuid not null,
  class_section_id  uuid not null,
  academic_session_id uuid not null,
  outcome           text not null,           -- 'enrolled' | 'promoted' | 'rejected'
  reason            text,
  at                timestamptz not null default now()
);

-- ------------------------------------------------------------- timetable ----
create table if not exists public.timetable_slots (
  id                      uuid primary key default gen_random_uuid(),
  academic_session_id     uuid not null references public.academic_sessions (id),
  class_section_id        uuid not null references public.class_sections (id) on delete cascade,
  day                     text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  period                  int  not null check (period between 1 and 16),
  subject                 text not null,
  teacher_id              uuid references public.allowed_teachers (id) on delete set null,
  room                    text,
  homework_note           text default '',
  topic_note              text default '',
  updated_at              timestamptz not null default now(),
  unique (academic_session_id, class_section_id, day, period)
);
create index if not exists slot_teacher_idx on public.timetable_slots (teacher_id, day, period);
create index if not exists slot_room_idx    on public.timetable_slots (lower(room), day, period);

-- Substitution is its own record so history survives slot edits.
create table if not exists public.timetable_substitutions (
  id                    uuid primary key default gen_random_uuid(),
  slot_id               uuid not null references public.timetable_slots (id) on delete cascade,
  absent_teacher_id     uuid not null references public.allowed_teachers (id) on delete cascade,
  substitute_teacher_id uuid not null references public.allowed_teachers (id) on delete cascade,
  assigned_by           uuid references public.profiles (id) on delete set null,
  reason                text,
  status                text not null default 'assigned' check (status in ('assigned', 'cancelled', 'completed')),
  assigned_at           timestamptz not null default now(),
  check (absent_teacher_id <> substitute_teacher_id)
);

create table if not exists public.teacher_absences (
  teacher_id uuid not null references public.allowed_teachers (id) on delete cascade,
  on_date    date not null,
  reason     text,
  marked_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (teacher_id, on_date)
);

-- --------------------------------------------------- school configuration ---
-- Timings live here, not in frontend constants.
create table if not exists public.school_settings (
  id                     int primary key default 1 check (id = 1),
  school_name            text not null default 'School',
  address                text,
  logo_url               text,
  timezone               text not null default 'Asia/Kolkata',
  working_days           text[] not null default array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  break_after_period     int not null default 2,
  lunch_after_period     int not null default 4,
  approved_domain        text,
  email_password_enabled boolean not null default false,
  updated_at             timestamptz not null default now()
);
insert into public.school_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.school_periods (
  id            uuid primary key default gen_random_uuid(),
  period_number int not null unique check (period_number between 1 and 16),
  label         text not null,
  start_time    time not null,
  end_time      time not null,
  check (end_time > start_time)
);

create table if not exists public.school_holidays (
  id   uuid primary key default gen_random_uuid(),
  date date not null unique,
  name text not null,
  kind text not null default 'holiday' check (kind in ('holiday', 'exam', 'event', 'vacation'))
);

-- ----------------------------------------------- notifications and audit ----
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  audience   public.user_role,
  user_id    uuid references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  check (audience is not null or user_id is not null)
);
create index if not exists notify_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  actor_role text,
  action     text not null,
  target     text,
  metadata   jsonb not null default '{}'::jsonb,   -- never holds a code or token
  at         timestamptz not null default now()
);
create index if not exists audit_recent_idx on public.audit_logs (at desc);
