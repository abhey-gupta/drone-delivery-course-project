-- Phase 1 batched-delivery foundation for the Drone Delivery Management System
-- This keeps auth as-is and extends the schema for zone-based batch collection.
-- Run in Supabase SQL editor after the existing auth/setup SQL.

create extension if not exists postgis;

-- Zones ----------------------------------------------------------------------
alter table if exists public.zones
  add column if not exists zone_name text,
  add column if not exists collection_window_minutes integer not null default 10,
  add column if not exists is_active boolean not null default true;

-- Hubs -----------------------------------------------------------------------
alter table if exists public.hubs
  add column if not exists hub_name text,
  add column if not exists zone_id integer,
  add column if not exists hub_location geography(point, 4326),
  add column if not exists is_active boolean not null default true;

alter table if exists public.hubs
  drop constraint if exists fk_hubs_zone;

alter table if exists public.hubs
  add constraint fk_hubs_zone foreign key (zone_id) references public.zones(zone_id);

-- Drones ---------------------------------------------------------------------
alter table if exists public.drones
  add column if not exists home_hub_id integer,
  add column if not exists zone_id integer,
  add column if not exists last_known_location geography(point, 4326),
  add column if not exists last_seen_at timestamp with time zone;

alter table if exists public.drones
  drop constraint if exists fk_drone_home_hub;

alter table if exists public.drones
  drop constraint if exists fk_drone_zone;

alter table if exists public.drones
  add constraint fk_drone_home_hub foreign key (home_hub_id) references public.hubs(hub_id),
  add constraint fk_drone_zone foreign key (zone_id) references public.zones(zone_id);

alter table if exists public.drones
  drop constraint if exists drones_status_check;

alter table if exists public.drones
  add constraint drones_status_check check (
    status is null or status in ('available', 'assigned', 'en_route', 'returning', 'offline')
  );

-- Delivery batches -----------------------------------------------------------
alter table if exists public.delivery_batches
  add column if not exists zone_id integer,
  add column if not exists hub_id integer,
  add column if not exists batch_label text,
  add column if not exists collection_window_start timestamp with time zone,
  add column if not exists collection_window_end timestamp with time zone,
  add column if not exists dispatched_at timestamp with time zone,
  add column if not exists completed_at timestamp with time zone;

alter table if exists public.delivery_batches
  drop constraint if exists fk_batch_zone;

alter table if exists public.delivery_batches
  drop constraint if exists fk_batch_hub;

alter table if exists public.delivery_batches
  add constraint fk_batch_zone foreign key (zone_id) references public.zones(zone_id),
  add constraint fk_batch_hub foreign key (hub_id) references public.hubs(hub_id);

alter table if exists public.delivery_batches
  drop constraint if exists delivery_batches_status_check;

alter table if exists public.delivery_batches
  add constraint delivery_batches_status_check check (
    status is null or status in ('collecting', 'ready', 'assigned', 'in_progress', 'completed', 'failed')
  );

create unique index if not exists delivery_batches_zone_window_collecting_idx
  on public.delivery_batches (zone_id, collection_window_start, collection_window_end)
  where status = 'collecting';

-- Orders ---------------------------------------------------------------------
alter table if exists public.orders
  add column if not exists zone_id integer,
  add column if not exists batch_id integer,
  add column if not exists assigned_at timestamp with time zone,
  add column if not exists delivered_at timestamp with time zone,
  add column if not exists failure_reason text;

alter table if exists public.orders
  drop constraint if exists fk_order_zone;

alter table if exists public.orders
  drop constraint if exists fk_order_batch;

alter table if exists public.orders
  add constraint fk_order_zone foreign key (zone_id) references public.zones(zone_id),
  add constraint fk_order_batch foreign key (batch_id) references public.delivery_batches(batch_id);

alter table if exists public.orders
  drop constraint if exists orders_status_check;

alter table if exists public.orders
  add constraint orders_status_check check (
    status is null or status in ('pending', 'batched', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'cancelled')
  );

create index if not exists orders_batch_id_idx on public.orders(batch_id);
create index if not exists orders_zone_id_idx on public.orders(zone_id);

-- Drone assignments ----------------------------------------------------------
alter table if exists public.drone_assignments
  alter column order_id drop not null;

alter table if exists public.drone_assignments
  add column if not exists zone_id integer,
  add column if not exists hub_id integer,
  add column if not exists started_at timestamp with time zone,
  add column if not exists returned_at timestamp with time zone,
  add column if not exists last_known_location geography(point, 4326),
  add column if not exists total_stops integer not null default 0,
  add column if not exists completed_stops integer not null default 0;

alter table if exists public.drone_assignments
  drop constraint if exists fk_assignment_zone;

alter table if exists public.drone_assignments
  drop constraint if exists fk_assignment_hub;

alter table if exists public.drone_assignments
  add constraint fk_assignment_zone foreign key (zone_id) references public.zones(zone_id),
  add constraint fk_assignment_hub foreign key (hub_id) references public.hubs(hub_id);

alter table if exists public.drone_assignments
  drop constraint if exists drone_assignments_status_check;

alter table if exists public.drone_assignments
  add constraint drone_assignments_status_check check (
    status is null or status in ('assigned', 'in_progress', 'completed', 'failed', 'returning')
  );

create index if not exists drone_assignments_batch_id_idx on public.drone_assignments(batch_id);

-- Batch stops ----------------------------------------------------------------
create table if not exists public.batch_stops (
  stop_id integer generated by default as identity primary key,
  batch_id integer not null references public.delivery_batches(batch_id) on delete cascade,
  order_id integer references public.orders(order_id) on delete set null,
  stop_type text not null default 'delivery',
  sequence_no integer not null,
  location geography(point, 4326) not null,
  status text not null default 'pending',
  eta_at timestamp with time zone,
  arrived_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc', now())
);

alter table if exists public.batch_stops
  drop constraint if exists batch_stops_stop_type_check;

alter table if exists public.batch_stops
  add constraint batch_stops_stop_type_check check (stop_type in ('hub_departure', 'delivery', 'hub_return'));

alter table if exists public.batch_stops
  drop constraint if exists batch_stops_status_check;

alter table if exists public.batch_stops
  add constraint batch_stops_status_check check (status in ('pending', 'ready', 'en_route', 'arrived', 'completed', 'failed'));

create unique index if not exists batch_stops_batch_sequence_idx
  on public.batch_stops(batch_id, sequence_no);

-- Tracking breadcrumbs -------------------------------------------------------
create table if not exists public.batch_tracking_points (
  tracking_point_id integer generated by default as identity primary key,
  batch_id integer not null references public.delivery_batches(batch_id) on delete cascade,
  assignment_id integer references public.drone_assignments(assignment_id) on delete set null,
  stop_id integer references public.batch_stops(stop_id) on delete set null,
  position geography(point, 4326) not null,
  recorded_at timestamp with time zone not null default timezone('utc', now()),
  speed_kmh double precision,
  heading_degrees double precision,
  note text
);

create index if not exists batch_tracking_points_batch_recorded_idx
  on public.batch_tracking_points(batch_id, recorded_at desc);

-- Helpful defaults for existing data ----------------------------------------
update public.zones
set zone_name = coalesce(nullif(zone_name, ''), 'Zone ' || zone_id)
where zone_name is null or zone_name = '';

update public.orders
set zone_id = slz.zone_id
from public.sellers s
join public.store_location_zone slz on slz.store_location_id = s.store_location_id
where orders.seller_id = s.seller_id
  and orders.zone_id is null;

update public.delivery_batches
set zone_id = orders_for_batch.zone_id
from (
  select batch_id, min(zone_id) as zone_id
  from public.orders
  where batch_id is not null and zone_id is not null
  group by batch_id
) as orders_for_batch
where delivery_batches.batch_id = orders_for_batch.batch_id
  and delivery_batches.zone_id is null;
