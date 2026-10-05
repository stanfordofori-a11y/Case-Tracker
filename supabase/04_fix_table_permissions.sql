-- =====================================================================
-- Table permissions for signed-in users. Safe to run any time.
-- Fixes "permission denied for table ..." (e.g. unmatched_tokens) on
-- projects where Supabase does not grant new tables automatically.
-- Read access only; Row Level Security still limits rows to active
-- staff (couriers: only their own collections). All writes go through
-- the checked database functions.
-- =====================================================================
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
alter default privileges in schema public grant select on tables to authenticated;

select 'table permissions fixed' as result;
