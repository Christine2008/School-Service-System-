-- School Services Queue System — Postgres schema for Neon.
-- Safe to run more than once (idempotent), including on a database created by an earlier version.
-- Paste the whole file into the Neon SQL Editor and run it.

-- ---------- Settings ----------
create table if not exists app_settings (
  key text primary key,
  value text not null
);
-- The school's local timezone decides what "today's queue" means.
insert into app_settings (key, value) values ('timezone', 'Asia/Singapore')
on conflict (key) do nothing;

create or replace function app_today()
returns date
language sql stable
as $$
  select (now() at time zone coalesce(
    (select value from app_settings where key = 'timezone'), 'UTC'))::date;
$$;

-- The school's current local date and time.
create or replace function app_now()
returns timestamp
language sql stable
as $$
  select now() at time zone coalesce(
    (select value from app_settings where key = 'timezone'), 'UTC');
$$;

-- How many days ahead a student may book (change with:
--   update app_settings set value = '14' where key = 'booking_window_days';)
insert into app_settings (key, value) values ('booking_window_days', '30')
on conflict (key) do nothing;

create or replace function booking_window_days()
returns integer
language sql stable
as $$
  select coalesce((select value::integer from app_settings where key = 'booking_window_days'), 30);
$$;

-- ---------- Types ----------
do $$ begin
  create type ticket_status as enum ('waiting','called','being_served','completed','cancelled','skipped');
exception when duplicate_object then null; end $$;

-- ---------- Tables ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  student_id text check (student_id is null or char_length(student_id) <= 40),
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_unique on users (lower(email));

create table if not exists services (
  id text primary key,
  name text not null,
  prefix text not null unique,
  description text not null,
  active boolean not null default true
);

insert into services (id, name, prefix, description) values
 ('enrollment', 'Student Enrollment', 'EN', 'Enrollment documents and student registration'),
 ('tuition', 'Tuition Payment', 'TU', 'Tuition payment and account-related assistance'),
 ('uniform', 'Uniform Payment', 'UP', 'Uniform payment and related requests'),
 ('logo-printing', 'Logo Printing', 'LP', 'School logo printing requests')
on conflict (id) do nothing;

create table if not exists daily_counters (
  service_id text not null references services(id),
  queue_date date not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (service_id, queue_date)
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references users(id) on delete cascade,
  service_id text not null references services(id),
  queue_date date not null,
  ticket_number integer not null check (ticket_number > 0),
  ticket_code text not null,
  status ticket_status not null default 'waiting',
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  called_at timestamptz,
  completed_at timestamptz,
  unique (service_id, queue_date, ticket_number),
  unique (service_id, queue_date, ticket_code)
);
create index if not exists tickets_queue_order_idx on tickets (service_id, queue_date, status, ticket_number);
create index if not exists tickets_student_idx on tickets (student_user_id, issued_at desc);
create index if not exists tickets_date_idx on tickets (queue_date);

create table if not exists ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  old_status ticket_status,
  new_status ticket_status not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Queue functions (called by the API; it passes the signed-in user's id) ----------
create or replace function is_admin(p_user uuid)
returns boolean language sql stable as $$
  select exists (select 1 from users where id = p_user and role = 'admin');
$$;

-- ---------- Scheduled bookings ----------
-- Users: phone number collected at registration (Philippine mobile, 09XXXXXXXXX).
alter table users add column if not exists phone text;
do $$ begin
  alter table users add constraint users_phone_format check (phone is null or phone ~ '^09[0-9]{9}$');
exception when duplicate_object then null; end $$;

-- Tickets: the appointment time, the capacity position inside the slot, and an
-- idempotency key so a retried/double-clicked submit can never create a second ticket.
-- (tickets.queue_date is now the scheduled appointment date.)
alter table tickets add column if not exists scheduled_time time;
alter table tickets add column if not exists slot_index smallint;
alter table tickets add column if not exists client_request_id uuid;

-- Operating hours and capacity, per service and weekday (0 = Sunday ... 6 = Saturday).
-- One row = one bookable window. Slots are generated every slot_minutes inside the window,
-- and each slot accepts up to `capacity` students. Edit these rows to change the schedule.
create table if not exists service_schedules (
  service_id text not null references services(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  open_time time not null,
  close_time time not null,
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 240),
  capacity integer not null default 3 check (capacity between 1 and 100),
  active boolean not null default true,
  primary key (service_id, day_of_week, open_time),
  check (close_time > open_time)
);

-- Default schedule: Monday–Friday, 8:00–12:00 and 13:00–16:00, 30-minute slots, 3 students per slot.
-- Only seeded while the table is empty, so your later edits are never overwritten.
insert into service_schedules (service_id, day_of_week, open_time, close_time, slot_minutes, capacity)
select s.id, d.day, w.open_time, w.close_time, 30, 3
from services s
cross join generate_series(1, 5) as d(day)
cross join (values ('08:00'::time, '12:00'::time), ('13:00'::time, '16:00'::time)) as w(open_time, close_time)
where not exists (select 1 from service_schedules);

-- Constraints that hold even under simultaneous requests.
-- "Taken" means a slot position is used by a ticket that is not cancelled/skipped.
drop index if exists one_active_ticket_per_student;
create unique index if not exists tickets_slot_unique
  on tickets (service_id, queue_date, scheduled_time, slot_index)
  where slot_index is not null and status not in ('cancelled','skipped');
create unique index if not exists student_time_unique
  on tickets (student_user_id, queue_date, scheduled_time)
  where scheduled_time is not null and status in ('waiting','called','being_served');
create unique index if not exists student_service_day_unique
  on tickets (student_user_id, service_id, queue_date)
  where status in ('waiting','called','being_served');
create unique index if not exists tickets_request_id_unique
  on tickets (client_request_id) where client_request_id is not null;
create index if not exists tickets_schedule_idx on tickets (service_id, queue_date, scheduled_time);

-- The "Call Next Student" feature was removed from the admin dashboard.
drop function if exists call_next_ticket(uuid, text);
-- Replaced by the scheduled version below.
drop function if exists create_queue_ticket(uuid, text);

-- Bookable slots for one service on one date, with how many seats are taken.
create or replace function get_available_slots(p_service_id text, p_date date)
returns table (slot_time text, capacity integer, booked integer)
language plpgsql stable as $$
declare v_now timestamp := app_now();
begin
  if not exists (select 1 from services s where s.id = p_service_id and s.active) then
    raise exception 'This service is not available.';
  end if;
  if p_date is null or p_date < v_now::date then raise exception 'Please choose today or a later date.'; end if;
  if p_date > v_now::date + booking_window_days() then
    raise exception 'Bookings open up to % days ahead.', booking_window_days();
  end if;

  return query
  select to_char(g.t, 'HH24:MI'),
         sc.capacity,
         (select count(*)::integer from tickets tk
           where tk.service_id = p_service_id and tk.queue_date = p_date
             and tk.scheduled_time = g.t::time and tk.status not in ('cancelled','skipped'))
  from service_schedules sc
  cross join lateral generate_series(
    p_date + sc.open_time,
    (p_date + sc.close_time) - make_interval(mins => sc.slot_minutes),
    make_interval(mins => sc.slot_minutes)) as g(t)
  where sc.service_id = p_service_id and sc.active
    and sc.day_of_week = extract(dow from p_date)
    and (p_date > v_now::date or g.t > v_now)
  order by g.t;
end; $$;

-- Atomic booking. Everything below runs in one transaction; bookings for the same
-- service and date are serialised with an advisory lock, and the unique indexes above
-- are a second line of defence.
create or replace function create_queue_ticket(
  p_user uuid, p_service_id text, p_date date, p_time time, p_request_id uuid default null)
returns tickets language plpgsql as $$
declare
  v_service services%rowtype;
  v_sched service_schedules%rowtype;
  v_now timestamp := app_now();
  v_number integer;
  v_slot integer;
  v_ticket tickets%rowtype;
begin
  if p_user is null then raise exception 'Please log in first.'; end if;
  if p_date is null or p_time is null then raise exception 'Please choose a date and time.'; end if;

  select * into v_service from services where id = p_service_id and active = true;
  if not found then raise exception 'This service is not available.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_service_id || ':' || p_date::text, 0));

  -- Same submission sent twice (double click, network retry): return the ticket already created.
  if p_request_id is not null then
    select * into v_ticket from tickets where client_request_id = p_request_id and student_user_id = p_user;
    if found then return v_ticket; end if;
  end if;

  if p_date < v_now::date then raise exception 'You cannot book a past date.'; end if;
  if p_date > v_now::date + booking_window_days() then
    raise exception 'Bookings open up to % days ahead.', booking_window_days();
  end if;
  if p_date + p_time <= v_now then raise exception 'That time has already passed. Please choose a later time.'; end if;

  select * into v_sched from service_schedules sc
  where sc.service_id = p_service_id and sc.active
    and sc.day_of_week = extract(dow from p_date)
    and p_time >= sc.open_time
    and p_date + p_time + make_interval(mins => sc.slot_minutes) <= p_date + sc.close_time
    and (extract(epoch from (p_time - sc.open_time)))::integer % (sc.slot_minutes * 60) = 0
  limit 1;
  if not found then raise exception 'That time is outside the operating hours for this service.'; end if;

  if exists (select 1 from tickets t where t.student_user_id = p_user and t.queue_date = p_date
             and t.scheduled_time = p_time and t.status in ('waiting','called','being_served')) then
    raise exception 'You already have a queue ticket at that date and time.';
  end if;
  if exists (select 1 from tickets t where t.student_user_id = p_user and t.service_id = p_service_id
             and t.queue_date = p_date and t.status in ('waiting','called','being_served')) then
    raise exception 'You already have a queue ticket for this service on that date.';
  end if;

  select min(n) into v_slot from generate_series(1, v_sched.capacity) as n
  where not exists (
    select 1 from tickets t
    where t.service_id = p_service_id and t.queue_date = p_date and t.scheduled_time = p_time
      and t.slot_index = n and t.status not in ('cancelled','skipped'));
  if v_slot is null then raise exception 'That time slot is already full. Please choose another time.'; end if;

  insert into daily_counters (service_id, queue_date, last_number)
  values (p_service_id, p_date, 1)
  on conflict (service_id, queue_date)
  do update set last_number = daily_counters.last_number + 1
  returning last_number into v_number;

  insert into tickets (student_user_id, service_id, queue_date, scheduled_time, slot_index,
                       ticket_number, ticket_code, client_request_id)
  values (p_user, p_service_id, p_date, p_time, v_slot, v_number,
          v_service.prefix || '-' || lpad(v_number::text, 3, '0'), p_request_id)
  returning * into v_ticket;

  insert into ticket_events (ticket_id, actor_user_id, new_status, note)
  values (v_ticket.id, p_user, 'waiting', 'Ticket booked for ' || p_date::text || ' ' || to_char(p_time, 'HH24:MI'));
  return v_ticket;
end; $$;

create or replace function set_ticket_status(p_actor uuid, p_ticket_id uuid, p_new_status ticket_status, p_note text default null)
returns tickets language plpgsql as $$
declare
  v_ticket tickets%rowtype;
  v_old ticket_status;
begin
  if not is_admin(p_actor) then raise exception 'Admin access required.'; end if;
  select * into v_ticket from tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found.'; end if;

  v_old := v_ticket.status;
  if v_old in ('completed','cancelled','skipped') then raise exception 'This ticket is already closed.'; end if;
  if p_new_status not in ('being_served','completed','skipped','cancelled','called') then
    raise exception 'Invalid status change.';
  end if;
  if p_new_status = 'completed' and v_old not in ('called','being_served') then
    raise exception 'Only a called or active ticket can be completed.';
  end if;

  update tickets set status = p_new_status, updated_at = now(),
    completed_at = case when p_new_status = 'completed' then now() else completed_at end,
    called_at = case when p_new_status = 'called' then now() else called_at end
  where id = p_ticket_id returning * into v_ticket;

  insert into ticket_events (ticket_id, actor_user_id, old_status, new_status, note)
  values (p_ticket_id, p_actor, v_old, p_new_status, p_note);
  return v_ticket;
end; $$;

create or replace function get_ticket_position(p_user uuid, p_ticket_id uuid)
returns table (people_ahead bigint, currently_serving text)
language plpgsql stable as $$
declare v_ticket tickets%rowtype;
begin
  select * into v_ticket from tickets where id = p_ticket_id and student_user_id = p_user;
  if not found then raise exception 'Ticket not found.'; end if;
  return query select
    (select count(*) from tickets t where t.service_id = v_ticket.service_id
       and t.queue_date = v_ticket.queue_date and t.status = 'waiting'
       and (coalesce(t.scheduled_time, '00:00'::time), t.ticket_number)
         < (coalesce(v_ticket.scheduled_time, '00:00'::time), v_ticket.ticket_number)),
    (select t.ticket_code from tickets t where t.service_id = v_ticket.service_id
       and t.queue_date = v_ticket.queue_date and t.status in ('called','being_served')
     order by t.ticket_number limit 1);
end; $$;

create or replace function cancel_own_waiting_ticket(p_user uuid, p_ticket_id uuid)
returns tickets language plpgsql as $$
declare v_ticket tickets%rowtype;
begin
  select * into v_ticket from tickets where id = p_ticket_id and student_user_id = p_user for update;
  if not found then raise exception 'Ticket not found.'; end if;
  if v_ticket.status <> 'waiting' then raise exception 'Only a waiting ticket can be cancelled by a student.'; end if;
  update tickets set status = 'cancelled', updated_at = now() where id = p_ticket_id returning * into v_ticket;
  insert into ticket_events (ticket_id, actor_user_id, old_status, new_status, note)
  values (p_ticket_id, p_user, 'waiting', 'cancelled', 'Cancelled by student');
  return v_ticket;
end; $$;
