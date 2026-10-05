-- =====================================================================
-- Post-Analytical Case Tracker — Supabase setup (run once, in order)
-- Paste this WHOLE file into Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- ============ STAFF ALLOW-LIST ============
create table public.staff (
  email        text primary key check (email = lower(email)),
  display_name text,
  role         text not null default 'staff' check (role in ('staff','admin')),
  active       boolean not null default true,
  added_at     timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.email = lower(coalesce(auth.jwt()->>'email','')) and s.active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.email = lower(coalesce(auth.jwt()->>'email','')) and s.active and s.role = 'admin');
$$;

-- ============ TRACKED DATA ============
create table public.requisitions (
  r_number    text primary key,
  patient_id  text not null,
  client_raw  text not null default '',
  report_date text,
  report_at   timestamptz not null,
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.requisition_tests (
  id           bigint generated always as identity primary key,
  r_number     text not null references public.requisitions(r_number) on delete cascade,
  name         text not null,
  name_norm    text not null,
  seq          int  not null default 0,
  status       text not null default 'Pending' check (status in ('Pending','Completed')),
  first_seen   timestamptz not null,
  last_seen    timestamptz not null,
  completed_at timestamptz,
  unique (r_number, name_norm)
);
create index requisition_tests_status_idx on public.requisition_tests(status);
create index requisition_tests_completed_idx on public.requisition_tests(completed_at);

create table public.pastes (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  mode       text not null check (mode in ('full','partial')),
  by_email   text not null,
  items      int  not null default 0,
  stats      jsonb,
  locked     boolean not null default false,  -- set after archive/import/clear: can no longer be undone
  undone_at  timestamptz,
  undone_by  text
);
create index pastes_at_idx on public.pastes(at);

create table public.paste_changes (
  id        bigint generated always as identity primary key,
  paste_id  bigint not null references public.pastes(id) on delete cascade,
  kind      text not null check (kind in ('req','test')),
  r_number  text not null,
  name_norm text,
  prev      jsonb            -- null = row was created by this paste
);
create index paste_changes_paste_idx on public.paste_changes(paste_id);

-- ============ DICTIONARIES & SETTINGS ============
create table public.alist_keywords (
  id           bigint generated always as identity primary key,
  keyword      text not null,
  display_name text not null default '',
  sort         int  not null default 0
);

create table public.dept_keywords (
  id         bigint generated always as identity primary key,
  keyword    text not null,
  department text not null check (department in ('Hematology','Microbiology','Chemistry','Immunology')),
  sort       int  not null default 0
);

create table public.ignored_tokens (
  name_norm text primary key,
  added_by  text,
  added_at  timestamptz not null default now()
);

create table public.unmatched_tokens (
  name_norm   text primary key,
  name        text not null,
  count       int  not null default 0,
  attached_to text,
  last_seen   timestamptz not null default now()
);

create table public.app_settings (
  id           int primary key default 1 check (id = 1),
  grace_std    int not null default 0 check (grace_std >= 0),
  grace_alist  int not null default 0 check (grace_alist >= 0),
  archive_days int not null default 30 check (archive_days >= 1),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
insert into public.app_settings(id) values (1);

create table public.activity_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  by_email text not null,
  action   text not null,
  detail   jsonb
);
create index activity_log_at_idx on public.activity_log(at);

-- ============ ROW LEVEL SECURITY ============
-- Everything is readable by active staff only. All writes go through the
-- functions below, which check permissions themselves.
alter table public.staff             enable row level security;
alter table public.requisitions      enable row level security;
alter table public.requisition_tests enable row level security;
alter table public.pastes            enable row level security;
alter table public.paste_changes     enable row level security;
alter table public.alist_keywords    enable row level security;
alter table public.dept_keywords     enable row level security;
alter table public.ignored_tokens    enable row level security;
alter table public.unmatched_tokens  enable row level security;
alter table public.app_settings      enable row level security;
alter table public.activity_log      enable row level security;

create policy "staff read own row or admin reads all" on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt()->>'email','')) or (select public.is_admin()));
create policy "admin manages staff" on public.staff for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "staff read" on public.requisitions      for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.requisition_tests for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.pastes            for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.alist_keywords    for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.dept_keywords     for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.ignored_tokens    for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.unmatched_tokens  for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.app_settings      for select to authenticated using ((select public.is_staff()));
create policy "admin read" on public.paste_changes     for select to authenticated using ((select public.is_admin()));
create policy "admin read" on public.activity_log      for select to authenticated using ((select public.is_admin()));

revoke all on all tables in schema public from anon;
-- Read access for signed-in users (rows still limited by the policies above)
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Live updates between benches
alter publication supabase_realtime add table public.requisitions, public.requisition_tests, public.pastes;

-- =====================================================================
-- FUNCTIONS: paste, undo, dictionaries, settings, admin tools
-- =====================================================================
create or replace function public.norm_name(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(trim(coalesce(p,'')), '\s+', ' ', 'g'));
$$;

-- Flattens a paste payload into one row per (requisition, test)
create or replace function public._paste_tests(p_items jsonb)
returns table (r text, name text, nn text, seq int)
language sql immutable set search_path = '' as $$
  select distinct on (x->>'r_number', public.norm_name(t.name))
         x->>'r_number', trim(t.name), public.norm_name(t.name), t.ord::int
  from jsonb_array_elements(p_items) x,
       jsonb_array_elements_text(x->'tests') with ordinality t(name, ord)
  where trim(t.name) <> ''
  order by x->>'r_number', public.norm_name(t.name), t.ord;
$$;

-- ============ APPLY A PASTE ============
-- p_mode 'full'    : the paste is the whole outstanding list; any pending test not in it is completed
-- p_mode 'partial' : only add/update what is in the paste
-- p_items: [{r_number, patient_id, client_raw, report_date, report_at, tests:[name,...]}]
create or replace function public.apply_paste(p_mode text, p_items jsonb, p_unmatched jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now   timestamptz := now();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_paste bigint;
  v_new_reqs int; v_new_tests int; v_reopened int; v_completed int := 0;
  v_stats jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_mode not in ('full','partial') then raise exception 'Invalid mode %', p_mode; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Paste contains no cases'; end if;

  perform pg_advisory_xact_lock(hashtext('pat_apply_paste'));

  insert into public.pastes(at, mode, by_email, items) values (v_now, p_mode, v_email, jsonb_array_length(p_items))
  returning id into v_paste;

  -- remember how things were, for undo
  insert into public.paste_changes(paste_id, kind, r_number, prev)
  select v_paste, 'req', i.r, case when q.r_number is null then null else to_jsonb(q) end
  from (select distinct x->>'r_number' r from jsonb_array_elements(p_items) x) i
  left join public.requisitions q on q.r_number = i.r;

  insert into public.paste_changes(paste_id, kind, r_number, name_norm, prev)
  select v_paste, 'test', i.r, i.nn, case when t.id is null then null else to_jsonb(t) end
  from public._paste_tests(p_items) i
  left join public.requisition_tests t on t.r_number = i.r and t.name_norm = i.nn;

  select count(*) filter (where prev is null and kind = 'req'),
         count(*) filter (where prev is null and kind = 'test'),
         count(*) filter (where kind = 'test' and prev->>'status' = 'Completed')
    into v_new_reqs, v_new_tests, v_reopened
  from public.paste_changes where paste_id = v_paste;

  -- requisitions
  insert into public.requisitions(r_number, patient_id, client_raw, report_date, report_at, first_seen, updated_at)
  select distinct on (x->>'r_number')
         x->>'r_number', coalesce(x->>'patient_id', 'R#' || (x->>'r_number')), coalesce(x->>'client_raw',''),
         x->>'report_date', (x->>'report_at')::timestamptz, v_now, v_now
  from jsonb_array_elements(p_items) x
  order by x->>'r_number', (x->>'report_at')::timestamptz
  on conflict (r_number) do update set
    patient_id  = excluded.patient_id,
    client_raw  = case when excluded.client_raw <> '' then excluded.client_raw else public.requisitions.client_raw end,
    report_date = excluded.report_date,
    report_at   = excluded.report_at,
    updated_at  = v_now;

  -- tests: still pending -> refresh last_seen; new -> insert after existing ones
  insert into public.requisition_tests(r_number, name, name_norm, seq, status, first_seen, last_seen, completed_at)
  select i.r, i.name, i.nn,
         coalesce((select max(t.seq) from public.requisition_tests t where t.r_number = i.r), 0) + i.seq,
         'Pending', v_now, v_now, null
  from public._paste_tests(p_items) i
  on conflict (r_number, name_norm) do update set
    status = 'Pending', last_seen = v_now, completed_at = null;

  -- full list: anything still pending that wasn't in this paste has finished
  if p_mode = 'full' then
    insert into public.paste_changes(paste_id, kind, r_number, name_norm, prev)
    select v_paste, 'test', t.r_number, t.name_norm, to_jsonb(t)
    from public.requisition_tests t
    where t.status = 'Pending' and t.last_seen < v_now;

    update public.requisition_tests
       set status = 'Completed', completed_at = v_now
     where status = 'Pending' and last_seen < v_now;
    get diagnostics v_completed = row_count;
  end if;

  -- unrecognised test names
  insert into public.unmatched_tokens(name_norm, name, count, attached_to, last_seen)
  select distinct on (public.norm_name(u->>'name'))
         public.norm_name(u->>'name'), trim(u->>'name'), greatest(coalesce((u->>'count')::int, 1), 1), u->>'attached_to', v_now
  from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) u
  where trim(coalesce(u->>'name','')) <> ''
    and not exists (select 1 from public.ignored_tokens g where g.name_norm = public.norm_name(u->>'name'))
  on conflict (name_norm) do update set
    count = public.unmatched_tokens.count + excluded.count,
    attached_to = excluded.attached_to,
    last_seen = v_now;

  v_stats := jsonb_build_object('paste_id', v_paste, 'mode', p_mode, 'new_requisitions', v_new_reqs,
                                'new_tests', v_new_tests, 'reopened_tests', v_reopened, 'completed_tests', v_completed);
  update public.pastes set stats = v_stats where id = v_paste;
  return v_stats;
end $$;

-- ============ UNDO THE MOST RECENT PASTE (repeatable, newest first) ============
create or replace function public.undo_last_paste()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_p public.pastes;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pat_apply_paste'));

  select * into v_p from public.pastes where undone_at is null order by id desc limit 1;
  if not found then raise exception 'There is no paste to undo'; end if;
  if v_p.locked then raise exception 'This paste can no longer be undone (data was archived, imported or cleared after it)'; end if;

  delete from public.requisition_tests t
   using public.paste_changes c
   where c.paste_id = v_p.id and c.kind = 'test' and c.prev is null
     and t.r_number = c.r_number and t.name_norm = c.name_norm;

  update public.requisition_tests t set
    name         = c.prev->>'name',
    seq          = (c.prev->>'seq')::int,
    status       = c.prev->>'status',
    first_seen   = (c.prev->>'first_seen')::timestamptz,
    last_seen    = (c.prev->>'last_seen')::timestamptz,
    completed_at = (c.prev->>'completed_at')::timestamptz
  from public.paste_changes c
  where c.paste_id = v_p.id and c.kind = 'test' and c.prev is not null
    and t.r_number = c.r_number and t.name_norm = c.name_norm;

  update public.requisitions q set
    patient_id  = c.prev->>'patient_id',
    client_raw  = c.prev->>'client_raw',
    report_date = c.prev->>'report_date',
    report_at   = (c.prev->>'report_at')::timestamptz,
    updated_at  = (c.prev->>'updated_at')::timestamptz
  from public.paste_changes c
  where c.paste_id = v_p.id and c.kind = 'req' and c.prev is not null and q.r_number = c.r_number;

  delete from public.requisitions q
   using public.paste_changes c
   where c.paste_id = v_p.id and c.kind = 'req' and c.prev is null and q.r_number = c.r_number;

  update public.pastes set undone_at = now(), undone_by = v_email where id = v_p.id;
  insert into public.activity_log(by_email, action, detail) values (v_email, 'undo_paste', jsonb_build_object('paste_id', v_p.id, 'pasted_by', v_p.by_email, 'pasted_at', v_p.at));
  return jsonb_build_object('undone_paste_id', v_p.id, 'pasted_at', v_p.at, 'pasted_by', v_p.by_email);
end $$;

-- ============ DICTIONARIES ============
create or replace function public.replace_keywords(p_kind text, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_kind = 'alist' then
    insert into public.activity_log(by_email, action, detail)
    select v_email, 'replace_alist_keywords', jsonb_build_object('previous', coalesce(jsonb_agg(to_jsonb(a) order by a.sort), '[]'::jsonb))
    from public.alist_keywords a;
    delete from public.alist_keywords where true;
    insert into public.alist_keywords(keyword, display_name, sort)
    select trim(r->>'keyword'), coalesce(r->>'display_name',''), ord
    from jsonb_array_elements(p_rows) with ordinality x(r, ord)
    where trim(coalesce(r->>'keyword','')) <> '';
  elsif p_kind = 'dept' then
    insert into public.activity_log(by_email, action, detail)
    select v_email, 'replace_dept_keywords', jsonb_build_object('previous', coalesce(jsonb_agg(to_jsonb(d) order by d.sort), '[]'::jsonb))
    from public.dept_keywords d;
    delete from public.dept_keywords where true;
    insert into public.dept_keywords(keyword, department, sort)
    select trim(r->>'keyword'), r->>'department', ord
    from jsonb_array_elements(p_rows) with ordinality x(r, ord)
    where trim(coalesce(r->>'keyword','')) <> '';
  else
    raise exception 'Unknown dictionary %', p_kind;
  end if;
end $$;

create or replace function public.add_token_to_dept(p_name text, p_department text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.dept_keywords where public.norm_name(keyword) = public.norm_name(p_name)) then
    insert into public.dept_keywords(keyword, department, sort)
    values (trim(p_name), p_department, coalesce((select max(sort) from public.dept_keywords), 0) + 1);
  end if;
  delete from public.unmatched_tokens where name_norm = public.norm_name(p_name);
  insert into public.activity_log(by_email, action, detail) values (v_email, 'add_dept_keyword', jsonb_build_object('keyword', trim(p_name), 'department', p_department));
end $$;

create or replace function public.ignore_token(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  insert into public.ignored_tokens(name_norm, added_by) values (public.norm_name(p_name), v_email) on conflict do nothing;
  delete from public.unmatched_tokens where name_norm = public.norm_name(p_name);
end $$;

create or replace function public.save_settings(p_grace_std int, p_grace_alist int, p_archive_days int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.app_settings set
    grace_std = greatest(coalesce(p_grace_std, 0), 0),
    grace_alist = greatest(coalesce(p_grace_alist, 0), 0),
    archive_days = greatest(coalesce(p_archive_days, 30), 1),
    updated_at = now(), updated_by = lower(coalesce(auth.jwt()->>'email',''))
  where id = 1;
end $$;

-- ============ ADMIN: ARCHIVE / CLEAR / IMPORT ============
-- Removes requisitions whose every test finished more than p_days ago and returns them for download.
create or replace function public.archive_completed(p_days int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_rs text[]; v_data jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can archive' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pat_apply_paste'));

  select array_agg(q.r_number) into v_rs
  from public.requisitions q
  where not exists (select 1 from public.requisition_tests t where t.r_number = q.r_number and t.status = 'Pending')
    and (select max(t.completed_at) from public.requisition_tests t where t.r_number = q.r_number) < now() - make_interval(days => greatest(p_days, 1));

  if v_rs is null then return jsonb_build_object('count', 0, 'requisitions', '[]'::jsonb); end if;

  select jsonb_agg(to_jsonb(q) || jsonb_build_object('tests',
           (select jsonb_agg(to_jsonb(t) order by t.seq) from public.requisition_tests t where t.r_number = q.r_number)))
    into v_data
  from public.requisitions q where q.r_number = any(v_rs);

  delete from public.requisitions where r_number = any(v_rs);
  update public.pastes set locked = true where not locked;
  insert into public.activity_log(by_email, action, detail) values (v_email, 'archive', jsonb_build_object('days', p_days, 'count', cardinality(v_rs)));
  return jsonb_build_object('count', cardinality(v_rs), 'requisitions', v_data);
end $$;

create or replace function public.clear_all_cases()
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_n int;
begin
  if not public.is_admin() then raise exception 'Only admins can clear all cases' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pat_apply_paste'));
  select count(*) into v_n from public.requisitions;
  delete from public.requisitions where true;
  update public.pastes set locked = true where not locked;
  insert into public.activity_log(by_email, action, detail) values (v_email, 'clear_all', jsonb_build_object('requisitions_removed', v_n));
end $$;

-- One-off import of existing data (e.g. the rev 12 browser backup, converted by the page)
create or replace function public.import_requisitions(p_reqs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_r int; v_t int;
begin
  if not public.is_admin() then raise exception 'Only admins can import' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pat_apply_paste'));

  insert into public.requisitions(r_number, patient_id, client_raw, report_date, report_at, first_seen, updated_at)
  select distinct on (x->>'r_number')
         x->>'r_number', coalesce(x->>'patient_id', 'R#' || (x->>'r_number')), coalesce(x->>'client_raw',''),
         x->>'report_date', (x->>'report_at')::timestamptz,
         coalesce((x->>'first_seen')::timestamptz, now()), now()
  from jsonb_array_elements(p_reqs) x
  on conflict (r_number) do nothing;
  get diagnostics v_r = row_count;

  insert into public.requisition_tests(r_number, name, name_norm, seq, status, first_seen, last_seen, completed_at)
  select distinct on (x->>'r_number', public.norm_name(t->>'name'))
         x->>'r_number', trim(t->>'name'), public.norm_name(t->>'name'), coalesce((t->>'seq')::int, 0),
         case when t->>'status' = 'Completed' then 'Completed' else 'Pending' end,
         (t->>'first_seen')::timestamptz, (t->>'last_seen')::timestamptz,
         case when t->>'status' = 'Completed' then (t->>'completed_at')::timestamptz end
  from jsonb_array_elements(p_reqs) x, jsonb_array_elements(x->'tests') t
  where trim(coalesce(t->>'name','')) <> ''
  on conflict (r_number, name_norm) do nothing;
  get diagnostics v_t = row_count;

  update public.pastes set locked = true where not locked;
  insert into public.activity_log(by_email, action, detail) values (v_email, 'import', jsonb_build_object('requisitions', v_r, 'tests', v_t));
  return jsonb_build_object('requisitions', v_r, 'tests', v_t);
end $$;

-- ============ FUNCTION PERMISSIONS ============
revoke execute on function public._paste_tests(jsonb) from public, anon, authenticated;
revoke execute on function public.norm_name(text) from public, anon;
grant  execute on function public.norm_name(text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.apply_paste(text, jsonb, jsonb)', 'public.undo_last_paste()',
    'public.replace_keywords(text, jsonb)', 'public.add_token_to_dept(text, text)',
    'public.ignore_token(text)', 'public.save_settings(int, int, int)',
    'public.archive_completed(int)', 'public.clear_all_cases()', 'public.import_requisitions(jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- DEFAULT DICTIONARIES (from rev 12)
-- =====================================================================
insert into public.alist_keywords(keyword, display_name, sort) values
('ST MICHAEL','St Michael''s Specialist Hospital (#1 A-List)',1),
('LUCCA','LuccaHealth Med. Specialist Ct (#2 A-List)',2),
('UNIV. OF GHANA','Univ. of Ghana Medical Center (#3 A-List)',3),
('POLICE HOSPITAL','Police Hospital (#4 A-List)',4),
('TARKWA OCCUP','Goldfields Tarkwa Occup Health (#5 A-List)',5),
('EURACARE','Euracare-Goldfields Hospital (#6 A-List)',6),
('BANK HOSPITAL','The Bank Hospital (#7 A-List)',7),
('NATIONWIDE MUTUAL','Nationwide Mutual Healthcare (#8 A-List)',8),
('GEMINI','Gemini Healthcare (#9 A-List)',9),
('SWEDEN GHANA','Sweden Ghana Medical Center Ltd (#10 A-List)',10),
('NORTH RIDGE','North Ridge Clinic (#11 A-List)',11),
('ACACIA','Acacia Health Insurance (#12 A-List)',12),
('NEWMONT','Newmont Ghana Limited (#13 A-List)',13),
('TARKWA DEPEND','Goldfields Tarkwa Dependants (#14 A-List)',14),
('ANGLOGOLD','AngloGold Ashanti-Obuasi Mine (#15 A-List)',15),
('LISTER','Lister Medical Services (#16 A-List)',16),
('GAB HEALTH','GAB Health Insurance Company (#17 A-List)',17),
('LANCET','MDS-Lancet Lab - SPProjects (#18 A-List)',18),
('APEX MUTUAL','Apex Mutual Health Insurance (#19 A-List)',19),
('IMPACT MEDICAL','Impact Medical & Diagnostic Ct (#20 A-List)',20);
insert into public.dept_keywords(keyword, department, sort) values
('RBC','Hematology',1),
('Hb','Hematology',2),
('Hct','Hematology',3),
('MCV','Hematology',4),
('MCH','Hematology',5),
('MCHC','Hematology',6),
('PLATELETS AUTO','Hematology',7),
('WBC','Hematology',8),
('NEUTROPHILS','Hematology',9),
('LYMPHOCYTES','Hematology',10),
('MONOCYTE','Hematology',11),
('EOSINOPHILS','Hematology',12),
('BASOPHIL','Hematology',13),
('DIFF COUNT','Hematology',14),
('MORPH','Hematology',15),
('HB GENOTYPE','Hematology',16),
('Rh (D)','Hematology',17),
('BLOOD GROUP','Hematology',18),
('ESR','Hematology',19),
('H.PYLORI Ab','Microbiology',20),
('H.PYLORI Ag FAE','Microbiology',21),
('FAEC-APP','Microbiology',22),
('FAECES - MICRO','Microbiology',23),
('PARA','Microbiology',24),
('U-APP','Microbiology',25),
('U-CHEM/MACR/MIC','Microbiology',26),
('U-MIC','Microbiology',27),
('TOTYPHOID IGG','Microbiology',28),
('TYPHOID IGM','Microbiology',29),
('SEMEN','Microbiology',30),
('SPERM','Microbiology',31),
('TH','Microbiology',32),
('G6PD','Chemistry',33),
('S-SOD','Chemistry',34),
('S-POT','Chemistry',35),
('S-CL','Chemistry',36),
('S-CO2','Chemistry',37),
('S-UREA','Chemistry',38),
('S-CREAT','Chemistry',39),
('ANION GAP','Chemistry',40),
('eGFR','Chemistry',41),
('S-TBIL','Chemistry',42),
('S-DBIL','Chemistry',43),
('S-ALK PHOS','Chemistry',44),
('S-GGT','Chemistry',45),
('SGPT','Chemistry',46),
('ALT','Chemistry',47),
('SGOT','Chemistry',48),
('AST','Chemistry',49),
('S-CHOL','Chemistry',50),
('CALC-LDL','Chemistry',51),
('S-HDL','Chemistry',52),
('S-NON HDL CHOL','Chemistry',53),
('S-CHOL/HDL','Chemistry',54),
('S-TRIG','Chemistry',55),
('S-TOT PROT','Chemistry',56),
('S-ALB','Chemistry',57),
('HBA1C','Chemistry',58),
('eAVG','Chemistry',59),
('RUALB','Chemistry',60),
('CREAT [U]','Chemistry',61),
('U-ALBUMIN/CREAT','Chemistry',62),
('CRP','Chemistry',63),
('S-CAL','Chemistry',64),
('S-ion.CALCIUM','Chemistry',65),
('S-MAG','Chemistry',66),
('P-GLU','Chemistry',67),
('P-GLUCOSE','Chemistry',68),
('GLUCOSE DOSAGE','Chemistry',69),
('GTT','Chemistry',70),
('TSH','Immunology',71),
('FT3','Immunology',72),
('FT4','Immunology',73),
('COMMENT THYROID','Immunology',74),
('PSA','Immunology',75),
('VITAMIN D','Immunology',76),
('HBsAg','Immunology',77),
('HBsAb','Immunology',78),
('HEPATITIS B SAb','Immunology',79),
('HEP B','Immunology',80),
('HIV','Immunology',81),
('AMH','Immunology',82),
('AFP','Immunology',83),
('proBNP','Immunology',84),
('FSH','Immunology',85),
('LH','Immunology',86),
('PROL','Immunology',87),
('TUMOUR MARKE','Immunology',88),
('QHCG','Immunology',89),
('bHCG','Immunology',90),
('CA125','Immunology',91),
('CA19-9','Immunology',92),
('ZCA19-9','Immunology',93),
('CEA','Immunology',94),
('C-TROP I','Immunology',95),
('TROPONIN T','Immunology',96),
('D-DIMER','Immunology',97);

-- =====================================================================
-- Done. Check: this should list 11 tables, all with rls_enabled = true
-- =====================================================================
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname = 'public' order by tablename;
