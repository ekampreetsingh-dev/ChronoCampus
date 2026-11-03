-- =============================================================================
-- 0008 · The early-years wing
--
-- Playway, Nursery, LKG and UKG are classes the school runs but they have no
-- number, so `grade` stops being an integer and becomes a label with a shape
-- check. The wing also keeps its own day: four short bells, a snack gap, out at
-- 11:25 — which is a third bell group rather than a special case in the frontend.
--
-- Existing rows are untouched: 1–12 simply become the labels '1'…'12'.
-- =============================================================================

-- 1 · a third bell group -------------------------------------------------------
alter table public.bell_schedules drop constraint if exists bell_schedules_applies_to_check;
alter table public.bell_schedules
  add constraint bell_schedules_applies_to_check
  check (applies_to in ('all', 'senior', 'junior', 'early'));

-- 2 · grade as a label --------------------------------------------------------
alter table public.class_sections alter column grade type text using grade::text;

alter table public.class_sections drop constraint if exists class_sections_grade_check;
alter table public.class_sections
  add constraint class_sections_grade_check
  check (grade in (
    'Playway', 'Nursery', 'LKG', 'UKG',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
  ));

comment on column public.class_sections.grade is
  'Class label: 1–12, or one of the four early-years classes. Sorted in code by band, never numerically.';

-- 3 · the wing's own day ------------------------------------------------------
insert into public.bell_schedules (name, applies_to, season, is_active, status, effective_from, departure_time)
select 'Early years · Regular', 'early', 'regular', true, 'active', date '2026-04-01', time '11:30'
where not exists (
  select 1 from public.bell_schedules where applies_to = 'early' and is_active
);

insert into public.bell_periods (schedule_id, period_number, label, start_time, end_time)
select s.id, v.n, v.label, v.start_time, v.end_time
from (select id from public.bell_schedules where applies_to = 'early' and is_active limit 1) s,
  (values
    (1, 'P1', time '08:45', time '09:20'),
    (2, 'P2', time '09:20', time '09:55'),
    (3, 'P3', time '10:15', time '10:50'),
    (4, 'P4', time '10:50', time '11:25')
  ) as v(n, label, start_time, end_time)
on conflict (schedule_id, period_number) do nothing;

-- 4 · point every section at the active schedule for its group ----------------
-- The numeric test is guarded because `grade` now holds names as well as numbers.
update public.class_sections cs
set bell_schedule_id = bs.id
from public.bell_schedules bs
where bs.is_active
  and bs.applies_to = case
    when cs.grade in ('Playway', 'Nursery', 'LKG', 'UKG') then 'early'
    when (case when cs.grade ~ '^[0-9]+$' then cs.grade::int else 0 end) >= 11 then 'senior'
    else 'junior'
  end
  and cs.bell_schedule_id is distinct from bs.id;
