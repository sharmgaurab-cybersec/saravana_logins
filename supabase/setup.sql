-- Saravanaa Bhavan shared staff clock with private admin reports.
-- Run once for a new Supabase project. Existing projects should run
-- migrate_to_public_clock_admin.sql instead to preserve their current data.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

grant usage on schema public to anon, authenticated;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  role text,
  is_active boolean not null default true,
  clock_status text not null default 'off' check (clock_status in ('off', 'working', 'break')),
  status_changed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Legacy table retained for compatibility with earlier versions; the new clock does not use it.
create table if not exists public.staff_contacts (
  staff_id uuid primary key references public.staff_members(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  staff_id uuid references public.staff_members(id) on delete set null,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.shift_events (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff_members(id) on delete set null,
  staff_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('sign_in', 'break_start', 'break_end', 'sign_out')),
  created_at timestamptz not null default now()
);
create index if not exists shift_events_created_at_idx on public.shift_events(created_at desc);
create index if not exists shift_events_staff_id_idx on public.shift_events(staff_id, created_at desc);

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.role = 'admin');
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

alter table public.staff_members enable row level security;
alter table public.staff_contacts enable row level security;
alter table public.user_profiles enable row level security;
alter table public.shift_events enable row level security;

-- Remove older permissive policies before applying the private access model.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('staff_members', 'user_profiles', 'shift_events')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

drop policy if exists "verified staff view active directory" on public.staff_members;
drop policy if exists "admins manage staff directory" on public.staff_members;
drop policy if exists "Public can view active roster" on public.staff_members;
create policy "Public can view active roster" on public.staff_members
  for select to anon, authenticated using (is_active);

drop policy if exists "admins manage private staff contacts" on public.staff_contacts;
create policy "Admins manage private staff contacts" on public.staff_contacts
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists "users view own profile and admins view all" on public.user_profiles;
create policy "Users view own profile and admins view all" on public.user_profiles
  for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());

drop policy if exists "staff view own events and admins view all" on public.shift_events;
drop policy if exists "Admins view attendance events" on public.shift_events;
-- No direct client SELECT/INSERT/UPDATE/DELETE policy exists for attendance events.

revoke all on public.staff_members, public.staff_contacts, public.user_profiles, public.shift_events from public, anon, authenticated;
grant select (id, name, role, is_active) on public.staff_members to anon, authenticated;
grant select (user_id, role, staff_id) on public.user_profiles to authenticated;

create or replace function public.record_staff_clock_action(p_staff_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_current text;
  v_next text;
begin
  if p_action not in ('sign_in', 'break_start', 'break_end', 'sign_out') then
    raise exception 'Unknown clock action';
  end if;
  select s.name, s.clock_status into v_name, v_current
  from public.staff_members s where s.id = p_staff_id and s.is_active = true for update;
  if not found then raise exception 'Active staff member not found'; end if;

  if p_action = 'sign_in' and v_current = 'off' then v_next := 'working';
  elsif p_action = 'break_start' and v_current = 'working' then v_next := 'break';
  elsif p_action = 'break_end' and v_current = 'break' then v_next := 'working';
  elsif p_action = 'sign_out' and v_current in ('working', 'break') then v_next := 'off';
  else raise exception 'That action is not available from the current shift status';
  end if;

  update public.staff_members set clock_status = v_next, status_changed_at = now() where id = p_staff_id;
  insert into public.shift_events (staff_id, staff_name, user_id, action)
    values (p_staff_id, v_name, (select auth.uid()), p_action);
  return jsonb_build_object('staff_id', p_staff_id, 'status', v_next, 'action', p_action);
end;
$$;
revoke all on function public.record_staff_clock_action(uuid, text) from public;
grant execute on function public.record_staff_clock_action(uuid, text) to anon, authenticated;

create or replace function public.admin_add_staff(p_name text, p_role text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter a name between 1 and 80 characters';
  end if;
  insert into public.staff_members (name, role)
    values (trim(p_name), nullif(trim(coalesce(p_role, '')), '')) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_add_staff(text, text) from public, anon;
grant execute on function public.admin_add_staff(text, text) to authenticated;

create or replace function public.admin_deactivate_employee(p_staff_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.staff_members set is_active = false where id = p_staff_id and is_active = true;
  if not found then raise exception 'Active staff member not found'; end if;
  delete from public.staff_contacts where staff_id = p_staff_id;
  update public.user_profiles set staff_id = null where staff_id = p_staff_id;
  return true;
end;
$$;
revoke all on function public.admin_deactivate_employee(uuid) from public, anon;
grant execute on function public.admin_deactivate_employee(uuid) to authenticated;

create or replace function public.admin_daily_attendance(p_day date)
returns table (
  staff_id uuid, staff_name text, sign_in_times text,
  break_start_times text, break_end_times text, sign_out_times text,
  hours_worked numeric
)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_day is null then raise exception 'Choose a report date'; end if;
  return query
  with bounds as (
    select p_day::timestamp at time zone 'Australia/Sydney' as starts_at,
      (p_day + 1)::timestamp at time zone 'Australia/Sydney' as ends_at
  ), day_events as (
    select e.id, e.staff_id, e.staff_name, e.action, e.created_at
    from public.shift_events e cross join bounds b
    where e.created_at >= b.starts_at and e.created_at < b.ends_at
  ), ordered as (
    select de.*, lead(de.action) over (partition by de.staff_id order by de.created_at, de.id) as next_action,
      lead(de.created_at) over (partition by de.staff_id order by de.created_at, de.id) as next_at
    from day_events de
  ), punches as (
    select staff_id,
      string_agg(to_char(created_at at time zone 'Australia/Sydney', 'HH12:MI AM'), ', ' order by created_at, id) filter (where action = 'sign_in') as sign_ins,
      string_agg(to_char(created_at at time zone 'Australia/Sydney', 'HH12:MI AM'), ', ' order by created_at, id) filter (where action = 'break_start') as break_starts,
      string_agg(to_char(created_at at time zone 'Australia/Sydney', 'HH12:MI AM'), ', ' order by created_at, id) filter (where action = 'break_end') as break_ends,
      string_agg(to_char(created_at at time zone 'Australia/Sydney', 'HH12:MI AM'), ', ' order by created_at, id) filter (where action = 'sign_out') as sign_outs,
      max(staff_name) as event_staff_name
    from day_events group by staff_id
  ), durations as (
    select o.staff_id,
      sum(extract(epoch from (coalesce(o.next_at, least(now(), (select ends_at from bounds))) - o.created_at))) / 3600.0 as hours
    from ordered o
    where o.action in ('sign_in', 'break_end')
      and ((o.next_action in ('break_start', 'sign_out')) or (o.next_at is null and o.created_at <= now()))
    group by o.staff_id
  )
  select s.id, coalesce(p.event_staff_name, s.name), coalesce(p.sign_ins, ''),
    coalesce(p.break_starts, ''), coalesce(p.break_ends, ''), coalesce(p.sign_outs, ''),
    round(coalesce(d.hours, 0)::numeric, 2)
  from public.staff_members s
  left join punches p on p.staff_id = s.id
  left join durations d on d.staff_id = s.id
  where s.is_active or p.staff_id is not null
  order by lower(s.name);
end;
$$;
revoke all on function public.admin_daily_attendance(date) from public, anon;
grant execute on function public.admin_daily_attendance(date) to authenticated;

-- Disable old per-employee RPCs if they exist in this project.
do $$
begin
  if to_regprocedure('public.record_shift_action(text)') is not null then
    execute 'revoke all on function public.record_shift_action(text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.admin_add_employee(text,text,text)') is not null then
    execute 'revoke all on function public.admin_add_employee(text, text, text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.admin_set_employee_email(uuid,text)') is not null then
    execute 'revoke all on function public.admin_set_employee_email(uuid, text) from public, anon, authenticated';
  end if;
end;
$$;
