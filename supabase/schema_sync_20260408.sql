begin;

create extension if not exists postgis;

-- Normalize existing timestamps that were stored as naive UTC.
alter table if exists public.delivery_batches
  alter column created_at type timestamp with time zone using created_at at time zone 'UTC',
  alter column updated_at type timestamp with time zone using updated_at at time zone 'UTC',
  alter column collection_window_start type timestamp with time zone using collection_window_start at time zone 'UTC',
  alter column collection_window_end type timestamp with time zone using collection_window_end at time zone 'UTC';

alter table if exists public.orders
  alter column created_at type timestamp with time zone using created_at at time zone 'UTC',
  alter column updated_at type timestamp with time zone using updated_at at time zone 'UTC';

alter table if exists public.drones
  alter column updated_at type timestamp with time zone using updated_at at time zone 'UTC';

alter table if exists public.drone_assignments
  alter column assigned_at type timestamp with time zone using assigned_at at time zone 'UTC',
  alter column completed_at type timestamp with time zone using completed_at at time zone 'UTC';

-- Hubs -----------------------------------------------------------------------
alter table if exists public.hubs
  add column if not exists hub_name text,
  add column if not exists zone_id integer,
  add column if not exists hub_location geography(point, 4326),
  add column if not exists is_active boolean not null default true;

update public.hubs h
set zone_id = hlz.zone_id,
    hub_location = hlz.hub_location,
    hub_name = coalesce(nullif(h.hub_name, ''), 'Hub ' || h.hub_id)
from public.hub_location_zone hlz
where hlz.hub_location_id = h.hub_location_id
  and (h.zone_id is distinct from hlz.zone_id or h.hub_location is null or h.hub_name is null or h.hub_name = '');

alter table if exists public.hubs
  drop constraint if exists fk_hubs_zone;
alter table if exists public.hubs
  add constraint fk_hubs_zone foreign key (zone_id) references public.zones(zone_id);

-- Zones ----------------------------------------------------------------------
alter table if exists public.zones
  add column if not exists zone_name text,
  add column if not exists collection_window_minutes integer not null default 10,
  add column if not exists is_active boolean not null default true;

update public.zones
set zone_name = coalesce(nullif(zone_name, ''), 'Zone ' || zone_id)
where zone_name is null or zone_name = '';

-- Drones ---------------------------------------------------------------------
alter table if exists public.drones
  add column if not exists home_hub_id integer,
  add column if not exists zone_id integer,
  add column if not exists last_known_location geography(point, 4326),
  add column if not exists last_seen_at timestamp with time zone;

update public.drones d
set home_hub_id = coalesce(d.home_hub_id, d.current_hub_id),
    zone_id = coalesce(d.zone_id, h.zone_id),
    last_known_location = coalesce(d.last_known_location, h.hub_location),
    last_seen_at = coalesce(d.last_seen_at, d.updated_at, timezone('utc', now()))
from public.hubs h
where h.hub_id = d.current_hub_id
  and (
    d.home_hub_id is null
    or d.zone_id is null
    or d.last_known_location is null
    or d.last_seen_at is null
  );

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
  add column if not exists hub_id integer,
  add column if not exists batch_label text,
  add column if not exists dispatched_at timestamp with time zone,
  add column if not exists completed_at timestamp with time zone;

update public.delivery_batches db
set dispatched_at = coalesce(db.dispatched_at, case when db.status in ('in_progress', 'completed') then db.updated_at else null end),
    completed_at = coalesce(db.completed_at, case when db.status = 'completed' then db.updated_at else null end),
    batch_label = coalesce(nullif(db.batch_label, ''), 'Batch #' || db.batch_id)
where db.dispatched_at is null or db.completed_at is null or db.batch_label is null or db.batch_label = '';

alter table if exists public.delivery_batches
  drop constraint if exists fk_batch_hub;
alter table if exists public.delivery_batches
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
  add column if not exists assigned_at timestamp with time zone,
  add column if not exists delivered_at timestamp with time zone,
  add column if not exists failure_reason text;

update public.orders o
set zone_id = coalesce(
      o.zone_id,
      (select db.zone_id from public.delivery_batches db where db.batch_id = o.batch_id),
      (select slz.zone_id from public.sellers s join public.store_location_zone slz on slz.store_location_id = s.store_location_id where s.seller_id = o.seller_id)
    ),
    assigned_at = coalesce(o.assigned_at, case when o.status in ('assigned', 'out_for_delivery', 'delivered') then o.updated_at else null end),
    delivered_at = coalesce(o.delivered_at, case when o.status = 'delivered' then o.updated_at else null end)
where o.zone_id is null or o.assigned_at is null or o.delivered_at is null;

alter table if exists public.orders
  drop constraint if exists fk_order_zone;
alter table if exists public.orders
  add constraint fk_order_zone foreign key (zone_id) references public.zones(zone_id);

alter table if exists public.orders
  drop constraint if exists orders_status_check;
alter table if exists public.orders
  add constraint orders_status_check check (
    status is null or status in ('pending', 'batched', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'cancelled')
  );

create index if not exists orders_zone_id_idx on public.orders(zone_id);
create index if not exists orders_batch_id_idx on public.orders(batch_id);

-- Drone assignments ----------------------------------------------------------
alter table if exists public.drone_assignments
  add column if not exists zone_id integer,
  add column if not exists hub_id integer,
  add column if not exists started_at timestamp with time zone,
  add column if not exists returned_at timestamp with time zone,
  add column if not exists last_known_location geography(point, 4326),
  add column if not exists total_stops integer not null default 0,
  add column if not exists completed_stops integer not null default 0;

update public.drone_assignments da
set zone_id = coalesce(da.zone_id, (select db.zone_id from public.delivery_batches db where db.batch_id = da.batch_id)),
    hub_id = coalesce(da.hub_id, (select d.current_hub_id from public.drones d where d.drone_id = da.drone_id)),
    started_at = coalesce(da.started_at, case when da.status in ('in_progress', 'completed', 'returning') then da.assigned_at else null end),
    returned_at = coalesce(da.returned_at, case when da.status = 'completed' then da.completed_at else null end),
    total_stops = coalesce(nullif(da.total_stops, 0), (select count(*)::integer from public.batch_stops bs where bs.batch_id = da.batch_id), 0),
    completed_stops = coalesce(da.completed_stops, 0),
    last_known_location = coalesce(
      da.last_known_location,
      (select d.last_known_location from public.drones d where d.drone_id = da.drone_id),
      (select h.hub_location from public.drones d join public.hubs h on h.hub_id = d.current_hub_id where d.drone_id = da.drone_id)
    );

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
alter table if exists public.batch_stops
  add column if not exists stop_type text not null default 'delivery',
  add column if not exists location geography(point, 4326),
  add column if not exists eta_at timestamp with time zone,
  add column if not exists arrived_at timestamp with time zone,
  add column if not exists completed_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone not null default timezone('utc', now());

update public.batch_stops bs
set stop_type = coalesce(nullif(bs.stop_type, ''), 'delivery'),
    location = coalesce(bs.location, o.drop_location),
    completed_at = coalesce(bs.completed_at, case when bs.status in ('completed', 'delivered') then o.updated_at else null end)
from public.orders o
where o.order_id = bs.order_id
  and (bs.location is null or bs.completed_at is null or bs.stop_type is null or bs.stop_type = '');

alter table if exists public.batch_stops
  drop constraint if exists batch_stops_stop_type_check;
alter table if exists public.batch_stops
  add constraint batch_stops_stop_type_check check (stop_type in ('hub_departure', 'delivery', 'hub_return'));

alter table if exists public.batch_stops
  drop constraint if exists batch_stops_status_check;
alter table if exists public.batch_stops
  add constraint batch_stops_status_check check (status in ('pending', 'ready', 'in_progress', 'en_route', 'arrived', 'completed', 'delivered', 'failed'));

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

commit;
