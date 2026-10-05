-- =====================================================================
-- Report delivery: digital version of GHA-POSTF001
-- "Proof of delivery of clients' medical reports"
-- Run in Supabase -> SQL Editor after 01-04. Safe to run again.
-- =====================================================================

-- One delivery sheet = one paper form: courier, location, department, pick-up
create table if not exists public.delivery_sheets (
  id                  bigint generated always as identity primary key,
  courier_email       text not null,
  courier_name        text,
  courier_signature   text,               -- SVG path drawn on the phone at pick-up
  location            text not null,
  department          text,
  started_at          timestamptz not null default now(),
  closed_at           timestamptz,
  reviewed_by         text,
  reviewed_at         timestamptz,
  review_note         text
);
create index if not exists delivery_sheets_started_idx on public.delivery_sheets(started_at);

-- One row per report on the sheet
create table if not exists public.report_deliveries (
  id                  bigint generated always as identity primary key,
  sheet_id            bigint not null references public.delivery_sheets(id) on delete cascade,
  r_number            text not null,
  barcode_raw         text,
  client_name         text,
  picked_up_at        timestamptz not null default now(),
  status              text not null default 'pending' check (status in ('pending','D','ND','CU','C')),
  receiver_name       text,
  receiver_signature  text,               -- SVG path drawn by the receiver
  recorded_at         timestamptz,        -- date/time delivered (or attempted)
  reason              text
);
create index if not exists report_deliveries_sheet_idx on public.report_deliveries(sheet_id);
create index if not exists report_deliveries_r_idx on public.report_deliveries(r_number);
-- A report can only be "out for delivery" once at a time
create unique index if not exists report_deliveries_one_pending on public.report_deliveries(r_number) where status = 'pending';

-- ---------- Courier (or lab staff acting as courier) ----------
create or replace function public.delivery_start_sheet(p_location text, p_department text, p_courier_signature text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_name text; v_id bigint;
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if trim(coalesce(p_location,'')) = '' then raise exception 'Enter the delivery location'; end if;
  if length(coalesce(p_courier_signature,'')) > 60000 then raise exception 'Signature too large'; end if;
  select display_name into v_name from public.staff where email = v_email;
  insert into public.delivery_sheets(courier_email, courier_name, courier_signature, location, department)
  values (v_email, coalesce(v_name, v_email), nullif(p_courier_signature,''), trim(p_location), nullif(trim(coalesce(p_department,'')),''))
  returning id into v_id;
  return v_id;
end $$;

-- Adds reports (by barcode/R#) to an open sheet. Client name comes from the tracker when the R# is known.
create or replace function public.delivery_add_reports(p_sheet_id bigint, p_codes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_sheet public.delivery_sheets; v_raw text; v_r text; v_client text; v_existing public.report_deliveries;
  v_out jsonb := '[]'::jsonb;
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into v_sheet from public.delivery_sheets where id = p_sheet_id;
  if not found then raise exception 'Delivery sheet not found'; end if;
  if v_sheet.courier_email <> v_email and not public.is_admin() then raise exception 'This delivery sheet belongs to someone else'; end if;
  if v_sheet.closed_at is not null then raise exception 'This delivery sheet is closed'; end if;

  foreach v_raw in array coalesce(p_codes, '{}') loop
    v_r := public.barcode_r_number(v_raw);
    if v_r is null then
      v_out := v_out || jsonb_build_object('code', v_raw, 'result', 'no_r_number'); continue;
    end if;
    select * into v_existing from public.report_deliveries where r_number = v_r and status = 'pending';
    if found then
      v_out := v_out || jsonb_build_object('code', v_raw, 'r_number', v_r,
        'result', case when v_existing.sheet_id = p_sheet_id then 'already_on_this_sheet' else 'already_out_for_delivery' end);
      continue;
    end if;
    select client_raw into v_client from public.requisitions where r_number = v_r;
    insert into public.report_deliveries(sheet_id, r_number, barcode_raw, client_name)
    values (p_sheet_id, v_r, v_raw, nullif(v_client,''));
    v_out := v_out || jsonb_build_object('code', v_raw, 'r_number', v_r, 'result', 'added', 'client_name', v_client);
  end loop;
  return v_out;
end $$;

create or replace function public.delivery_set_client(p_id bigint, p_client_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.report_deliveries d set client_name = nullif(trim(coalesce(p_client_name,'')),'')
    from public.delivery_sheets s
   where d.id = p_id and s.id = d.sheet_id and s.closed_at is null and (s.courier_email = v_email or public.is_admin());
  if not found then raise exception 'Row not found, not yours, or the sheet is closed'; end if;
end $$;

-- Records the outcome at the client: D needs receiver name + signature; ND/CU/C need a reason
create or replace function public.delivery_record(p_id bigint, p_status text, p_receiver_name text, p_receiver_signature text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_row public.report_deliveries; v_sheet public.delivery_sheets;
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status not in ('D','ND','CU','C') then raise exception 'Choose D, ND, CU or C'; end if;
  select * into v_row from public.report_deliveries where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  select * into v_sheet from public.delivery_sheets where id = v_row.sheet_id;
  if v_sheet.courier_email <> v_email and not public.is_admin() then raise exception 'This delivery sheet belongs to someone else'; end if;
  if v_sheet.closed_at is not null then raise exception 'This delivery sheet is closed'; end if;
  if p_status = 'D' and (trim(coalesce(p_receiver_name,'')) = '' or coalesce(p_receiver_signature,'') = '') then
    raise exception 'A delivered report needs the receiver''s name and signature';
  end if;
  if p_status <> 'D' and trim(coalesce(p_reason,'')) = '' then raise exception 'Give the reason it was not delivered'; end if;
  if length(coalesce(p_receiver_signature,'')) > 60000 then raise exception 'Signature too large'; end if;
  update public.report_deliveries set
    status = p_status,
    receiver_name = case when p_status = 'D' then trim(p_receiver_name) else nullif(trim(coalesce(p_receiver_name,'')),'') end,
    receiver_signature = case when p_status = 'D' then p_receiver_signature else null end,
    reason = case when p_status = 'D' then nullif(trim(coalesce(p_reason,'')),'') else trim(p_reason) end,
    recorded_at = now()
  where id = p_id;
end $$;

create or replace function public.delivery_remove(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  delete from public.report_deliveries d using public.delivery_sheets s
   where d.id = p_id and s.id = d.sheet_id and d.status = 'pending' and s.closed_at is null
     and (s.courier_email = v_email or public.is_admin());
  if not found then raise exception 'Only reports not yet recorded, on your open sheet, can be removed'; end if;
end $$;

create or replace function public.delivery_close_sheet(p_sheet_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if exists (select 1 from public.report_deliveries where sheet_id = p_sheet_id and status = 'pending') then
    raise exception 'Record a status (D, ND, CU or C) for every report before closing the sheet';
  end if;
  update public.delivery_sheets set closed_at = now()
   where id = p_sheet_id and closed_at is null and (courier_email = v_email or public.is_admin());
  if not found then raise exception 'Sheet not found, not yours, or already closed'; end if;
end $$;

-- "Reviewed by / Date" on the form
create or replace function public.delivery_review(p_sheet_id bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_name text;
begin
  if not public.is_staff() then raise exception 'Only lab staff can review delivery sheets' using errcode = '42501'; end if;
  select coalesce(display_name, email) into v_name from public.staff where email = v_email;
  update public.delivery_sheets set reviewed_by = v_name, reviewed_at = now(), review_note = nullif(trim(coalesce(p_note,'')),'')
   where id = p_sheet_id and closed_at is not null;
  if not found then raise exception 'Only closed sheets can be reviewed'; end if;
end $$;

-- ---------- Row Level Security ----------
alter table public.delivery_sheets   enable row level security;
alter table public.report_deliveries enable row level security;

drop policy if exists "staff read sheets, couriers own" on public.delivery_sheets;
create policy "staff read sheets, couriers own" on public.delivery_sheets for select to authenticated
  using ((select public.is_staff()) or courier_email = lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists "staff read deliveries, couriers own" on public.report_deliveries;
create policy "staff read deliveries, couriers own" on public.report_deliveries for select to authenticated
  using ((select public.is_staff()) or exists (select 1 from public.delivery_sheets s
          where s.id = sheet_id and s.courier_email = lower(coalesce(auth.jwt()->>'email',''))));

revoke all on public.delivery_sheets, public.report_deliveries from anon;
grant select on public.delivery_sheets, public.report_deliveries to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.delivery_start_sheet(text, text, text)', 'public.delivery_add_reports(bigint, text[])',
    'public.delivery_set_client(bigint, text)', 'public.delivery_record(bigint, text, text, text, text)',
    'public.delivery_remove(bigint)', 'public.delivery_close_sheet(bigint)', 'public.delivery_review(bigint, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table public.delivery_sheets; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.report_deliveries; exception when duplicate_object then null; end $$;

select 'report delivery installed' as result;
