-- =====================================================================
-- Add people to the tracker's staff list.
-- Run AFTER you have created their logins in Authentication → Users.
-- Emails must match the login email exactly (lowercase).
-- role: 'admin' can also archive, clear all and import; 'staff' can do everything else.
-- =====================================================================
insert into public.staff (email, display_name, role) values
  ('your.email@example.com', 'Your Name',  'admin')
  -- , ('colleague1@example.com', 'Colleague One', 'staff')
  -- , ('colleague2@example.com', 'Colleague Two', 'staff')
on conflict (email) do update set display_name = excluded.display_name, role = excluded.role, active = true;

-- To remove someone later without deleting history:
-- update public.staff set active = false where email = 'someone@example.com';

select * from public.staff order by role, email;
