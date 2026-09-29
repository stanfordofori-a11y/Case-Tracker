-- =====================================================================
-- First-admin setup (run once in SQL Editor, after 1_supabase_setup.sql)
-- Makes "claim the first admin" atomic: it only ever succeeds while the
-- staff list is empty, even if two requests arrive at the same moment.
-- Only the manage-staff Edge Function (service role) can call it.
-- =====================================================================
create or replace function public.claim_first_admin(p_email text, p_display_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('pat_first_admin'));
  if exists (select 1 from public.staff) then
    return false;
  end if;
  insert into public.staff(email, display_name, role, active)
  values (lower(trim(p_email)), nullif(trim(p_display_name), ''), 'admin', true);
  insert into public.activity_log(by_email, action, detail)
  values (lower(trim(p_email)), 'first_admin_created', '{}'::jsonb);
  return true;
end $$;

create or replace function public.staff_is_empty()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.staff);
$$;

revoke execute on function public.claim_first_admin(text, text) from public, anon, authenticated;
revoke execute on function public.staff_is_empty() from public, anon, authenticated;
grant execute on function public.claim_first_admin(text, text) to service_role;
grant execute on function public.staff_is_empty() to service_role;

select 'first-admin setup installed' as result;
