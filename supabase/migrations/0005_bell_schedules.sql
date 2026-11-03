-- =============================================================================
-- ChronoCampus 0005 — bell schedules (per class group, with seasonal variants)
--
-- The school runs two different days at once: classes 11–12 finish at 11:40,
-- classes 1–10 run to 14:20 with a break after period 3. Winter timings differ
-- again, so a schedule is a versioned object that can be cloned, edited and
-- activated — never hardcoded in the frontend.
-- =============================================================================

create table if not exists public.bell_schedules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                    -- 'Classes 1–10 · Winter'
  applies_to     text not null default 'all' check (applies_to in ('all','senior','junior')),
  season         text not null default 'regular' check (season in ('regular','summer','winter','exam')),
  is_active      boolean not null default false,
  status         text not null default 'active' check (status in ('draft','active','archived')),
  effective_from date not null default current_date,
  effective_to   date,
  departure_time time,                             -- when the school gate closes for this group
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- One active schedule per class group, enforced in the database.
create unique index if not exists one_active_bell_per_group
  on public.bell_schedules (applies_to) where is_active;

create table if not exists public.bell_periods (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references public.bell_schedules (id) on delete cascade,
  period_number int  not null,                     -- 0 is a genuine zero period
  label         text not null,
  start_time    time not null,
  end_time      time not null,
  unique (schedule_id, period_number),
  check (end_time > start_time)
);
create index if not exists bell_period_order on public.bell_periods (schedule_id, period_number);

alter table public.class_sections add column if not exists bell_schedule_id uuid references public.bell_schedules (id) on delete set null;

alter table public.bell_schedules enable row level security;
alter table public.bell_periods  enable row level security;

-- Everyone signed in can read the timings — a student must see when their bell rings.
drop policy if exists bell_schedules_read on public.bell_schedules;
create policy bell_schedules_read on public.bell_schedules for select to authenticated using (true);
drop policy if exists bell_schedules_admin on public.bell_schedules;
create policy bell_schedules_admin on public.bell_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists bell_periods_read on public.bell_periods;
create policy bell_periods_read on public.bell_periods for select to authenticated using (true);
drop policy if exists bell_periods_admin on public.bell_periods;
create policy bell_periods_admin on public.bell_periods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- Overlap guard: a schedule's periods must be ordered and must not overlap.
-- --------------------------------------------------------------------------
create or replace function public.guard_bell_period()
returns trigger language plpgsql as $$
declare v_clash text;
begin
  select label into v_clash from public.bell_periods
   where schedule_id = new.schedule_id
     and id is distinct from new.id
     and (new.start_time, new.end_time) overlaps (start_time, end_time)
   limit 1;
  if v_clash is not null then
    raise exception 'CONFLICT_PERIOD: % overlaps %', new.label, v_clash;
  end if;
  return new;
end $$;

drop trigger if exists bell_period_guard on public.bell_periods;
create trigger bell_period_guard before insert or update on public.bell_periods
  for each row execute function public.guard_bell_period();

-- --------------------------------------------------------------------------
-- activate_bell_schedule
-- Flips the season for a class group in one transaction, so there is never a
-- moment with two active schedules (or none) for the same group.
-- --------------------------------------------------------------------------
create or replace function public.activate_bell_schedule(p_id uuid, p_applies_to text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v record;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;

  select * into v from public.bell_schedules where id = p_id;
  if not found then raise exception 'unknown bell schedule'; end if;

  update public.bell_schedules
     set is_active = false, status = 'archived'
   where applies_to = v.applies_to and id <> v.id;

  update public.bell_schedules
     set is_active = true, status = 'active'
   where id = v.id;

  insert into public.audit_logs (actor_id, actor_role, action, target, metadata)
  values (auth.uid(), public.current_role_name(), 'schedule.activate', v.name,
          jsonb_build_object('group', v.applies_to, 'season', v.season, 'effective_from', v.effective_from));
end $$;

revoke execute on function public.activate_bell_schedule(uuid, text) from anon;
grant execute on function public.activate_bell_schedule(uuid, text) to authenticated;

-- --------------------------------------------------------------------------
-- Seed the school's real timings.
-- --------------------------------------------------------------------------
do $$
declare
  v_senior uuid;
  v_junior uuid;
begin
  if exists (select 1 from public.bell_schedules) then return; end if;

  insert into public.bell_schedules (name, applies_to, season, is_active, status, effective_from, departure_time)
  values ('Classes 11–12 · Regular', 'senior', 'regular', true, 'active', date '2026-04-01', time '11:40')
  returning id into v_senior;

  insert into public.bell_periods (schedule_id, period_number, label, start_time, end_time) values
    (v_senior, 0, '0',  '08:00', '09:00'),
    (v_senior, 1, 'P1', '09:00', '09:40'),
    (v_senior, 2, 'P2', '09:40', '10:20'),
    (v_senior, 3, 'P3', '10:20', '11:00'),
    (v_senior, 4, 'P4', '11:00', '11:40');

  insert into public.bell_schedules (name, applies_to, season, is_active, status, effective_from, departure_time)
  values ('Classes 1–10 · Regular', 'junior', 'regular', true, 'active', date '2026-04-01', time '14:20')
  returning id into v_junior;

  -- Break sits between period 3 and period 4: 11:00 → 11:20.
  insert into public.bell_periods (schedule_id, period_number, label, start_time, end_time) values
    (v_junior, 0, '0',  '08:00', '09:00'),
    (v_junior, 1, 'P1', '09:00', '09:40'),
    (v_junior, 2, 'P2', '09:40', '10:20'),
    (v_junior, 3, 'P3', '10:20', '11:00'),
    (v_junior, 4, 'P4', '11:20', '12:00'),
    (v_junior, 5, 'P5', '12:00', '12:40'),
    (v_junior, 6, 'P6', '12:40', '13:20'),
    (v_junior, 7, 'P7', '13:20', '14:00'),
    (v_junior, 8, 'P8', '14:00', '14:20');

  update public.class_sections
     set bell_schedule_id = case when grade >= 11 then v_senior else v_junior end
   where bell_schedule_id is null;
end $$;
