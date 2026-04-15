# Drone Worker Implementation

This document explains the current drone worker in the project: what it does, how it is wired, and where the simplifications are.

## Where it lives

Worker script:
- `drone-delivery-frontend/scripts/simulator-worker.mjs`

NPM commands:
- `npm run sim:once` — run one simulator tick and exit
- `npm run sim:worker` — run continuously on an interval

These commands are defined in:
- `drone-delivery-frontend/package.json`

## Why this worker exists

The project needs something that can move delivery batches forward without requiring the admin to manually click every state transition.

Instead of building a full real-time fleet backend, the worker uses a simple periodic loop that:
1. closes expired collection windows
2. assigns an available drone
3. launches the batch
4. moves each active drone forward in short distance steps
5. marks orders delivered only when the drone actually reaches that stop
6. keeps animating the return-to-hub leg after the final delivery

That keeps it demo-friendly and understandable, which is the right call for this course project.

## Startup and configuration

The worker is a plain Node script using Supabase directly.

### Environment loading
At startup it:
- reads `.env.local`
- pulls `NEXT_PUBLIC_SUPABASE_URL`
- pulls `SUPABASE_SERVICE_ROLE_KEY`
- exits immediately if either is missing

### Tick interval
The loop interval is controlled by:
- `SIMULATOR_TICK_MS`

Default:
- `3000` ms (3 seconds)

The worker reads `.env.local` on startup, so any later code change to the worker loop does nothing until you restart the running `npm run sim:worker` process.

### Movement step size
The travel distance per tick is controlled by:
- `SIMULATOR_STEP_METERS`

Default:
- `100` meters per tick

### Supabase client
The script creates a service-role Supabase client with session persistence disabled because this is a backend worker, not a user session.

## Data the worker reads

On each tick it fetches:
- `delivery_batches`
  - active statuses only: `collecting`, `ready`, `assigned`, `in_progress`
- `orders`
  - orders that belong to a batch
- `batch_stops`
- `drones`
- `hubs`
- `hub_location_zone`

It then builds in-memory lookup maps for:
- orders by ID
- stops by batch
- hubs by zone
- hub -> zone mapping

## Core flow per tick

The worker runs in a fixed order.

### 1. Close collection windows
If a batch is:
- `collecting`
- and `collection_window_end <= now`

then the worker marks it as:
- `ready`

This is handled by `markBatchReady(batch)`.

## 2. Launch already-assigned ready batches
If a batch is:
- `ready` or `assigned`
- and already has `drone_id`

then the worker starts it immediately by:
- setting batch status to `in_progress`
- setting drone status to `en_route`
- setting non-delivered orders in the batch to `out_for_delivery`

This is handled by `startBatch(batch)`.

## 3. Reserve already-busy drones
Before assigning anything new, the worker builds a set of drone IDs that are already tied to active batches.

That prevents the same drone from being assigned twice in one tick.

## 4. Assign drones to ready batches
For batches that are:
- `ready`
- and have no `drone_id`

it picks an available drone.

### Assignment rule
The current selection rule is intentionally simple:
- prefer a drone whose `current_hub_id` belongs to the same zone as the batch
- otherwise fall back to the first available drone

Once assigned, the worker updates:
- batch: `drone_id`, status -> `assigned`
- drone: status -> `assigned`
- all batch orders: status -> `assigned`

Then it immediately launches the batch with `startBatch(batch)`, so the batch becomes:
- `in_progress`

This is handled by `assignDrone(batch, drones, hubZones)` followed by `startBatch(batch)`.

## 5. Progress active deliveries
For every batch in:
- `in_progress`

the worker moves the drone up to 100 meters along its current route on each tick.

### Movement behavior
It sorts batch stops by `sequence_no`, finds the first pending stop, and moves the drone toward that stop.

If the next 100 meter step would overshoot the stop:
- the drone snaps to that stop
- the stop is marked `completed`
- the related order is marked `delivered`
- any remaining distance from that same tick is immediately applied to the next leg

That means a short stop can be reached and delivered in the middle of a tick, and the drone can continue moving toward the next stop or the return hub without waiting for another whole cycle.

## End-of-batch return logic
When the final stop is completed, the worker does not teleport the drone home anymore.

Instead it:
- keeps the batch in `in_progress`
- changes the drone to `returning`
- moves the drone 100 meters per tick toward the nearest hub in that zone

Only when the drone actually reaches that hub does it do two final things:

### 1. Complete the batch
Batch status becomes:
- `completed`

### 2. Return the drone to a hub
The return hub is chosen by looking at the last delivered order’s drop point and finding the nearest hub in that batch’s zone.

Current nearest-hub calculation:
- parse coordinates from stored point data
- compare squared distance to each hub in the zone
- pick the smallest one

If a nearest hub is found and the drone is no longer needed by another active batch, the worker updates the drone to:
- `available`
- `current_hub_id = nearest hub`

If the same drone is somehow still busy on another active batch, it stays effectively busy.

This matches the agreed project rule:
- after the last delivery, return to the nearest hub, not necessarily the starting hub

## Coordinate handling

The worker includes `parsePoint()` so it can deal with multiple point formats:
- WKT like `POINT(lng lat)`
- GeoJSON-like objects
- plain `{ lat, lng }`
- plain `{ x, y }`

That makes the worker less brittle against the project’s not-perfectly-clean location data.

## Important simplifications

This worker is deliberately simple. That is not a bug; it is scope control.

### What it does not do yet
- no advanced route optimization / TSP
- no battery simulation
- no failure/retry handling beyond basic script errors
- no websocket push layer

### What it does do now
- continuous short-step movement suitable for live polling maps
- per-tick persisted drone positions through `drones.last_known_location`
- tracking-point inserts while the drone moves
- animated return-to-hub movement instead of instant return

### What is still simplified
- no ETA calculation
- movement is still straight-line and fixed-step, not a real routing engine
- stops still use simple running order
- there is no physics, weather, or battery model

## Error handling

There are two levels:

### Fatal startup errors
If required Supabase env vars are missing, the worker exits immediately.

### Tick-time errors
In continuous mode, each interval runs `tick()` inside a catch block so one failed tick does not kill the whole loop silently.

It logs messages like:
- ready
- assign
- launch
- progress
- complete
- simulator tick failure
- startup configuration (`tick` / `step`) so the active runtime is visible in the terminal

## Runtime notes

- Supabase/PostGIS may return geography points as EWKB hex strings instead of `POINT(lng lat)` text. The worker and frontend both need to parse that format correctly or the drone appears stuck on the fallback hub marker even while deliveries progress in the database.
- The worker loop now runs sequentially instead of using raw `setInterval`, so one slow tick cannot overlap the next and accidentally advance the same batch twice.

## Typical lifecycle example

A normal batch flows like this:

1. seller orders are added to a zone batch
2. batch remains `collecting` until collection window ends
3. worker marks batch `ready`
4. worker assigns an available drone
5. worker starts batch -> `in_progress`
6. every 3 seconds the drone advances 100 meters toward the next stop
7. when a stop is reached, that order becomes `delivered`
8. after the final delivery, the drone starts the return leg toward the nearest hub
9. every 3 seconds the return leg also advances 100 meters
10. once the hub is reached, the batch becomes `completed`
11. the drone becomes `available`

## How to run it

From `drone-delivery-frontend/`:

```bash
npm run sim:once
```

For continuous mode:

```bash
npm run sim:worker
```

Optional custom interval:

```bash
SIMULATOR_TICK_MS=5000 npm run sim:worker
```

## What to improve next

If we continue evolving the worker, the most useful next steps are:

1. persist current drone coordinates per tick
2. expose current leg/next stop more explicitly for the UI
3. add basic failure/offline handling
4. separate assignment from dispatch if you want a visible waiting state
5. add lightweight ETA estimation

## Bottom line

The current worker is a **minimal state-progression simulator**, not a full fleet engine.

That’s fine. It already does the job that matters for this project:
- batches can auto-close
- drones can auto-assign
- deliveries can progress without manual babysitting
- orders can finish
- drones can return to hubs in a believable way

It’s simple, inspectable, and demoable — which beats fake complexity every time.
