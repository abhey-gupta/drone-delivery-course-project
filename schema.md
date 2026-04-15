# Drone Delivery Schema Reference

This is the current Phase 1 reference for the cloud Supabase schema.

## Core model

- Seller zone still comes from `sellers -> store_location_zone -> zones`
- Each `order` belongs to one seller and can join one batch through `orders.batch_id`
- Each `delivery_batch` belongs to one zone and can later be assigned one drone through `delivery_batches.drone_id`
- `batch_stops` stores the stop order for future dispatch/simulation work
- `drone_assignments` is legacy from the old flow and is no longer the primary model for Phase 1

## Tables

### `models`
- `model_id`
- `model_name`
- `max_capacity`

### `drones`
- `drone_id`
- `model_id`
- `current_hub_id`
- `status`
- `updated_at`

### `zones`
- `zone_id`
- `boundary_coordinates_ref`

### `hubs`
- `hub_id`
- `hub_location_id`

### `hub_location_zone`
- `hub_location_id`
- `hub_location`
- `zone_id`

### `sellers`
- `seller_id`
- `name`
- `email`
- `store_location_id`
- `created_at`

### `store_location_zone`
- `store_location_id`
- `store_location`
- `zone_id`

### `orders`
- `order_id`
- `seller_id`
- `batch_id`
- `package_weight`
- `drop_location`
- `status`
- `created_at`
- `updated_at`

### `delivery_batches`
- `batch_id`
- `zone_id`
- `drone_id`
- `status`
- `collection_window_start`
- `collection_window_end`
- `created_at`
- `updated_at`

### `batch_stops`
- `stop_id`
- `batch_id`
- `order_id`
- `sequence_no`
- `status`

### `drone_assignments` (legacy)
- still present in Supabase from the old flow
- not used as the main relationship in Phase 1
- batch ownership now comes from `delivery_batches.drone_id`

## Phase 1 behavior

- new seller requests create an `orders` row immediately
- each new order joins the current 10-minute collecting batch for the seller zone
- if no open batch exists for that zone/window, a new `delivery_batches` row is created
- each new order also gets a `batch_stops` row with the next stop sequence number
- seller pages now read batch state from `orders + delivery_batches (+ drones when assigned)`
