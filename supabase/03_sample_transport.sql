-- =====================================================================
-- Sample transport: courier collection -> pre-analytical reception
-- Run once in Supabase -> SQL Editor, after 01 and 02.
-- =====================================================================

-- ---------- Roles: add 'courier' ----------
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('staff','admin','courier'));

-- Lab staff = staff or admin. Couriers can sign in but must NOT see the tracker,
-- so is_staff() now excludes them.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.email = lower(coalesce(auth.jwt()->>'email','')) and s.active and s.role in ('staff','admin'));
$$;

create or replace function public.is_courier() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.email = lower(coalesce(auth.jwt()->>'email','')) and s.active and s.role = 'courier');
$$;

-- Anyone active: lab staff, admins or couriers
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.email = lower(coalesce(auth.jwt()->>'email','')) and s.active);
$$;

-- ---------- Tables ----------
create table public.centres (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.courier_runs (
  id             bigint generated always as identity primary key,
  courier_email  text not null,
  centre_id      bigint not null references public.centres(id),
  started_at     timestamptz not null default now(),
  handed_over_at timestamptz
);
create index courier_runs_started_idx on public.courier_runs(started_at);

create table public.samples (
  id               bigint generated always as identity primary key,
  barcode          text not null,        -- normalised: upper case, letters and digits only
  barcode_raw      text,                 -- as read from the label
  r_number         text,                 -- digits, links to the MT tracker
  run_id           bigint references public.courier_runs(id) on delete set null,
  centre_id        bigint references public.centres(id),
  collected_by     text,
  collected_at     timestamptz,
  photo_path       text,
  photo_deleted_at timestamptz,
  received_by      text,
  received_at      timestamptz,
  source           text not null default 'courier' check (source in ('courier','reception'))
    -- 'reception' = scanned at the lab without any courier record
);
-- A barcode can only be "in transit" once at a time
create unique index samples_one_open_per_barcode on public.samples(barcode) where received_at is null;
create index samples_r_number_idx on public.samples(r_number);
create index samples_collected_idx on public.samples(collected_at);
create index samples_received_idx on public.samples(received_at);
create index samples_run_idx on public.samples(run_id);

alter table public.app_settings add column if not exists photo_retention_days int not null default 14 check (photo_retention_days between 1 and 365);
alter table public.app_settings add column if not exists transit_alert_minutes int not null default 180 check (transit_alert_minutes >= 15);

-- ---------- Helpers ----------
create or replace function public.norm_barcode(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- First run of 4+ digits in the label = the R# number used by MT
create or replace function public.barcode_r_number(p text) returns text
language sql immutable set search_path = '' as $$
  select (regexp_match(coalesce(p,''), '([0-9]{4,})'))[1];
$$;

-- ---------- Courier functions ----------
create or replace function public.courier_start_run(p_centre_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_id bigint;
begin
  if not (public.is_courier() or public.is_staff()) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.centres where id = p_centre_id and active) then raise exception 'Unknown or inactive centre'; end if;
  insert into public.courier_runs(courier_email, centre_id) values (v_email, p_centre_id) returning id into v_id;
  return v_id;
end $$;

-- Logs every barcode found in one photo. Returns one result per barcode.
create or replace function public.courier_log_samples(p_run_id bigint, p_barcodes text[], p_photo_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_run public.courier_runs;
  v_raw text; v_code text; v_existing public.samples;
  v_out jsonb := '[]'::jsonb;
begin
  if not (public.is_courier() or public.is_staff()) then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into v_run from public.courier_runs where id = p_run_id;
  if not found then raise exception 'Collection run not found'; end if;
  if v_run.courier_email <> v_email and not public.is_admin() then raise exception 'This collection run belongs to someone else'; end if;
  if v_run.handed_over_at is not null then raise exception 'This collection run has already been handed over'; end if;

  foreach v_raw in array coalesce(p_barcodes, '{}') loop
    v_code := public.norm_barcode(v_raw);
    continue when v_code = '';
    select * into v_existing from public.samples where barcode = v_code and received_at is null;
    if found then
      v_out := v_out || jsonb_build_object('barcode', v_code, 'r_number', v_existing.r_number,
        'result', case when v_existing.run_id = p_run_id then 'already_in_this_run' else 'already_in_transit' end,
        'sample_id', v_existing.id);
    else
      insert into public.samples(barcode, barcode_raw, r_number, run_id, centre_id, collected_by, collected_at, photo_path)
      values (v_code, v_raw, public.barcode_r_number(v_raw), p_run_id, v_run.centre_id, v_email, now(), p_photo_path)
      returning * into v_existing;
      v_out := v_out || jsonb_build_object('barcode', v_code, 'r_number', v_existing.r_number, 'result', 'logged', 'sample_id', v_existing.id);
    end if;
  end loop;
  return v_out;
end $$;

-- Courier removes a wrongly logged sample (only their own, only before the lab receives it)
create or replace function public.courier_remove_sample(p_sample_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not (public.is_courier() or public.is_staff()) then raise exception 'Not authorised' using errcode = '42501'; end if;
  delete from public.samples
   where id = p_sample_id and received_at is null and source = 'courier'
     and (collected_by = v_email or public.is_admin());
  if not found then raise exception 'That sample can no longer be removed (already received, or not yours)'; end if;
end $$;

create or replace function public.courier_hand_over(p_run_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not (public.is_courier() or public.is_staff()) then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.courier_runs set handed_over_at = now()
   where id = p_run_id and handed_over_at is null and (courier_email = v_email or public.is_admin());
  if not found then raise exception 'Run not found, not yours, or already handed over'; end if;
end $$;

-- ---------- Pre-analytical reception ----------
create or replace function public.receive_sample(p_barcode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_code text := public.norm_barcode(p_barcode);
  v_s public.samples; v_centre text;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_code = '' then raise exception 'Empty barcode'; end if;

  select * into v_s from public.samples where barcode = v_code and received_at is null for update;
  if found then
    update public.samples set received_at = now(), received_by = v_email where id = v_s.id returning * into v_s;
    select name into v_centre from public.centres where id = v_s.centre_id;
    return jsonb_build_object('result', 'received', 'sample_id', v_s.id, 'barcode', v_code, 'r_number', v_s.r_number,
      'centre', v_centre, 'collected_by', v_s.collected_by, 'collected_at', v_s.collected_at, 'received_at', v_s.received_at,
      'transit_minutes', round(extract(epoch from (v_s.received_at - v_s.collected_at)) / 60));
  end if;

  -- Scanned twice?
  select * into v_s from public.samples where barcode = v_code and received_at > now() - interval '24 hours'
   order by received_at desc limit 1;
  if found then
    return jsonb_build_object('result', 'already_received', 'sample_id', v_s.id, 'barcode', v_code, 'r_number', v_s.r_number,
      'received_at', v_s.received_at, 'received_by', v_s.received_by);
  end if;

  -- Arrived without a courier record
  insert into public.samples(barcode, barcode_raw, r_number, received_by, received_at, source)
  values (v_code, p_barcode, public.barcode_r_number(p_barcode), v_email, now(), 'reception')
  returning * into v_s;
  return jsonb_build_object('result', 'not_logged_by_courier', 'sample_id', v_s.id, 'barcode', v_code,
    'r_number', v_s.r_number, 'received_at', v_s.received_at);
end $$;

create or replace function public.undo_receive(p_sample_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.samples;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into v_s from public.samples where id = p_sample_id for update;
  if not found or v_s.received_at is null then raise exception 'Sample not found or not received'; end if;
  if v_s.source = 'reception' then
    delete from public.samples where id = p_sample_id;
  else
    if exists (select 1 from public.samples where barcode = v_s.barcode and received_at is null) then
      raise exception 'The same barcode is already in transit again; cannot undo';
    end if;
    update public.samples set received_at = null, received_by = null where id = p_sample_id;
  end if;
end $$;

-- ---------- Admin: centres and settings ----------
create or replace function public.save_centre(p_id bigint, p_name text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can manage centres' using errcode = '42501'; end if;
  if trim(coalesce(p_name,'')) = '' then raise exception 'Enter a centre name'; end if;
  if p_id is null then
    insert into public.centres(name, active) values (trim(p_name), coalesce(p_active, true));
  else
    update public.centres set name = trim(p_name), active = coalesce(p_active, true) where id = p_id;
  end if;
end $$;

create or replace function public.save_transport_settings(p_photo_retention_days int, p_transit_alert_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change these settings' using errcode = '42501'; end if;
  update public.app_settings set
    photo_retention_days = greatest(1, least(365, coalesce(p_photo_retention_days, 14))),
    transit_alert_minutes = greatest(15, coalesce(p_transit_alert_minutes, 180)),
    updated_at = now(), updated_by = lower(coalesce(auth.jwt()->>'email',''))
  where id = 1;
end $$;

-- ---------- Row Level Security ----------
alter table public.centres      enable row level security;
alter table public.courier_runs enable row level security;
alter table public.samples      enable row level security;

create policy "members read centres" on public.centres for select to authenticated using ((select public.is_member()));
create policy "staff read runs, couriers read own" on public.courier_runs for select to authenticated
  using ((select public.is_staff()) or courier_email = lower(coalesce(auth.jwt()->>'email','')));
create policy "staff read samples, couriers read own" on public.samples for select to authenticated
  using ((select public.is_staff()) or collected_by = lower(coalesce(auth.jwt()->>'email','')));
-- Couriers also need to read settings (photo retention shown on their screen)
drop policy if exists "staff read" on public.app_settings;
create policy "members read settings" on public.app_settings for select to authenticated using ((select public.is_member()));

revoke all on public.centres, public.courier_runs, public.samples from anon;

-- ---------- Photo storage (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sample-photos', 'sample-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "members upload sample photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sample-photos' and (select public.is_member()));
create policy "lab staff view sample photos" on storage.objects for select to authenticated
  using (bucket_id = 'sample-photos' and (select public.is_staff()));

-- ---------- Permissions ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.is_courier()', 'public.is_member()',
    'public.courier_start_run(bigint)', 'public.courier_log_samples(bigint, text[], text)',
    'public.courier_remove_sample(bigint)', 'public.courier_hand_over(bigint)',
    'public.receive_sample(text)', 'public.undo_receive(bigint)',
    'public.save_centre(bigint, text, boolean)', 'public.save_transport_settings(int, int)',
    'public.norm_barcode(text)', 'public.barcode_r_number(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Live updates for the reception screen
alter publication supabase_realtime add table public.samples, public.courier_runs;

select 'sample transport installed' as result;
