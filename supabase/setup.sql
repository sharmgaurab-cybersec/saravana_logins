-- Saravanaa Bhavan Staff Clock: Supabase schema and access rules.
-- Run once in Supabase Dashboard > SQL Editor after enabling Email Auth.
-- This file never stores a Supabase secret/service_role key.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  role text,
  is_active boolean not null default true,
  clock_status text not null default 'off'
    check (clock_status in ('off', 'working', 'break')),
  status_changed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Private email mapping. Staff can never read this table through the app.
create table if not exists public.staff_contacts (
  staff_id uuid primary key references public.staff_members(id) on delete cascade,
  email text not null unique check (
    email = lower(trim(email)) and
    email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
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
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function private.has_staff_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and (p.role = 'admin' or p.staff_id is not null)
  );
$$;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.has_staff_profile() from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.has_staff_profile() to authenticated;

create or replace function private.link_email_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select c.staff_id into v_staff_id
  from public.staff_contacts c
  join public.staff_members s on s.id = c.staff_id and s.is_active
  where lower(c.email) = lower(coalesce(new.email, ''))
  limit 1;

  insert into public.user_profiles (user_id, staff_id, role)
  values (new.id, v_staff_id, 'employee')
  on conflict (user_id) do update
    set staff_id = coalesce(public.user_profiles.staff_id, excluded.staff_id);
  return new;
end;
$$;
revoke all on function private.link_email_user() from public, anon, authenticated;

drop trigger if exists link_email_user_after_auth_change on auth.users;
create trigger link_email_user_after_auth_change
  after insert or update on auth.users
  for each row execute function private.link_email_user();

create or replace function public.admin_add_employee(
  p_name text,
  p_role text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_user_id uuid;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter an employee name (1 to 80 characters)';
  end if;
  if p_email is null or trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid employee email address';
  end if;

  insert into public.staff_members (name, role)
  values (trim(p_name), nullif(trim(coalesce(p_role, '')), ''))
  returning id into v_staff_id;

  insert into public.staff_contacts (staff_id, email)
  values (v_staff_id, lower(trim(p_email)));

  select u.id into v_user_id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user_id is not null then
    insert into public.user_profiles (user_id, staff_id, role)
    values (v_user_id, v_staff_id, 'employee')
    on conflict (user_id) do update
      set staff_id = excluded.staff_id;
  end if;
  return v_staff_id;
end;
$$;

create or replace function public.admin_set_employee_email(
  p_staff_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_email is null or trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid employee email address';
  end if;
  if not exists (
    select 1 from public.staff_members where id = p_staff_id and is_active
  ) then
    raise exception 'Active employee not found';
  end if;

  insert into public.staff_contacts (staff_id, email)
  values (p_staff_id, lower(trim(p_email)))
  on conflict (staff_id) do update set email = excluded.email;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
  if v_user_id is not null then
    insert into public.user_profiles (user_id, staff_id, role)
    values (v_user_id, p_staff_id, 'employee')
    on conflict (user_id) do update set staff_id = excluded.staff_id;
  end if;
  return true;
end;
$$;

create or replace function public.admin_deactivate_employee(p_staff_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.staff_members set is_active = false where id = p_staff_id and is_active = true;
  if not found then
    raise exception 'Active employee not found';
  end if;
  delete from public.staff_contacts where staff_id = p_staff_id;
  update public.user_profiles set staff_id = null
    where staff_id = p_staff_id;
  return true;
end;
$$;

create or replace function public.record_shift_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_staff_name text;
  v_current text;
  v_next text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before recording a shift' using errcode = '42501';
  end if;
  select p.staff_id into v_staff_id
  from public.user_profiles p
  where p.user_id = (select auth.uid());
  if v_staff_id is null then
    raise exception 'This account is not linked to an employee';
  end if;
  if p_action not in ('sign_in', 'break_start', 'break_end', 'sign_out') then
    raise exception 'Unknown shift action';
  end if;

  select s.name, s.clock_status into v_staff_name, v_current
  from public.staff_members s
  where s.id = v_staff_id and s.is_active = true
  for update;
  if not found then
    raise exception 'Employee is not active';
  end if;

  if p_action = 'sign_in' and v_current = 'off' then v_next := 'working';
  elsif p_action = 'break_start' and v_current = 'working' then v_next := 'break';
  elsif p_action = 'break_end' and v_current = 'break' then v_next := 'working';
  elsif p_action = 'sign_out' and v_current in ('working', 'break') then v_next := 'off';
  else raise exception 'That action is not available from the current shift status';
  end if;

  update public.staff_members set clock_status = v_next, status_changed_at = now()
  where id = v_staff_id;
  insert into public.shift_events (staff_id, staff_name, user_id, action)
  values (v_staff_id, v_staff_name, (select auth.uid()), p_action);
  return jsonb_build_object('staff_id', v_staff_id, 'status', v_next, 'action', p_action);
end;
$$;

-- New tables are not necessarily exposed through Supabase Data API by default.
-- These explicit grants are required in addition to the row-level policies below.
grant usage on schema public to authenticated;

alter table public.staff_members enable row level security;
alter table public.staff_contacts enable row level security;
alter table public.user_profiles enable row level security;
alter table public.shift_events enable row level security;

drop policy if exists "verified staff view active directory" on public.staff_members;
create policy "verified staff view active directory"
  on public.staff_members for select to authenticated
  using (is_active and private.has_staff_profile() or private.is_admin());

drop policy if exists "admins manage staff directory" on public.staff_members;
create policy "admins manage staff directory"
  on public.staff_members for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

drop policy if exists "admins manage private staff contacts" on public.staff_contacts;
create policy "admins manage private staff contacts"
  on public.staff_contacts for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

drop policy if exists "users view own profile and admins view all" on public.user_profiles;
create policy "users view own profile and admins view all"
  on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

drop policy if exists "staff view own events and admins view all" on public.shift_events;
create policy "staff view own events and admins view all"
  on public.shift_events for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- Never accept direct browser writes to event/status tables. Use the checked RPCs.
revoke all on public.staff_members, public.staff_contacts,
  public.user_profiles, public.shift_events from anon, authenticated;
grant select on public.staff_members, public.user_profiles, public.shift_events to authenticated;
revoke all on function public.admin_add_employee(text, text, text) from public, anon;
revoke all on function public.admin_set_employee_email(uuid, text) from public, anon;
revoke all on function public.admin_deactivate_employee(uuid) from public, anon;
revoke all on function public.record_shift_action(text) from public, anon;
grant execute on function public.admin_add_employee(text, text, text) to authenticated;
grant execute on function public.admin_set_employee_email(uuid, text) to authenticated;
grant execute on function public.admin_deactivate_employee(uuid) to authenticated;
grant execute on function public.record_shift_action(text) to authenticated;
