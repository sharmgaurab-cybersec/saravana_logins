-- Upgrade an existing Saravanaa staff-clock database from phone OTP to email OTP.
-- Run once in Supabase SQL Editor after uploading the email-login app files.
-- Existing phone contacts are retained; staff emails must be assigned by an admin.

begin;

alter table public.staff_contacts add column if not exists email text;
alter table public.staff_contacts alter column phone_e164 drop not null;
create unique index if not exists staff_contacts_email_lower_uidx
  on public.staff_contacts (lower(email))
  where email is not null;

drop trigger if exists link_phone_user_after_auth_insert on auth.users;
drop function if exists private.link_phone_user();

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

drop function if exists public.admin_add_employee(text, text, text);
create function public.admin_add_employee(
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
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter an employee name (1 to 80 characters)';
  end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid employee email address';
  end if;

  insert into public.staff_members (name, role)
  values (trim(p_name), nullif(trim(coalesce(p_role, '')), ''))
  returning id into v_staff_id;

  insert into public.staff_contacts (staff_id, email)
  values (v_staff_id, v_email);

  select u.id into v_user_id from auth.users u where lower(u.email) = v_email limit 1;
  if v_user_id is not null then
    insert into public.user_profiles (user_id, staff_id, role)
    values (v_user_id, v_staff_id, 'employee')
    on conflict (user_id) do update set staff_id = excluded.staff_id;
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
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid employee email address';
  end if;
  if not exists (
    select 1 from public.staff_members where id = p_staff_id and is_active
  ) then
    raise exception 'Active employee not found';
  end if;

  insert into public.staff_contacts (staff_id, email)
  values (p_staff_id, v_email)
  on conflict (staff_id) do update set email = excluded.email;

  select u.id into v_user_id from auth.users u where lower(u.email) = v_email limit 1;
  if v_user_id is not null then
    insert into public.user_profiles (user_id, staff_id, role)
    values (v_user_id, p_staff_id, 'employee')
    on conflict (user_id) do update set staff_id = excluded.staff_id;
  end if;
  return true;
end;
$$;

revoke all on function public.admin_add_employee(text, text, text) from public, anon;
revoke all on function public.admin_set_employee_email(uuid, text) from public, anon;
grant execute on function public.admin_add_employee(text, text, text) to authenticated;
grant execute on function public.admin_set_employee_email(uuid, text) to authenticated;

commit;
