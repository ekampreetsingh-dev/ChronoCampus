-- =============================================================================
-- 0010 · The zero period is a real bell
--
-- ChronoCampus has always supported period 0 — the 08:00 pre-first-bell period
-- this school runs — in the builder, the board, the bell editor and the demo
-- seed. The original schema still checked `between 1 and 16` in the two tables
-- that predate the bell-schedule rewrite, so importing the school's own
-- timetable into Postgres would have been rejected on the very first row.
-- (bell_periods, added in 0005, already allows 0.)
-- =============================================================================

alter table public.timetable_slots drop constraint if exists timetable_slots_period_check;
alter table public.timetable_slots
  add constraint timetable_slots_period_check check (period between 0 and 16);

alter table public.school_periods drop constraint if exists school_periods_period_number_check;
alter table public.school_periods
  add constraint school_periods_period_number_check check (period_number between 0 and 16);

comment on constraint timetable_slots_period_check on public.timetable_slots is
  '0 is the zero period before the first bell, not a missing value.';
