# AGENT.md — drone-delivery-management

> This file is the source of truth for this project for an AI agent working on it.
> The agent reads this on every run and must update the Log and relevant sections whenever the agreed plan or implementation state changes.

---

## Description

A college-level drone delivery management system for coordinating seller delivery requests, zone-based batching, drone assignment, admin monitoring, hub/zone management, and simulated real-time drone movement.

---

## Project Context

Current stage: in active development

Key details the agent needs to know:
- This project is intended to manage the full drone delivery lifecycle from order readiness to batch collection, dispatch, delivery progression, and drone return to hub
- The system includes a seller-facing application, an admin monitoring/management view, and a drone worker/simulator component
- Supabase is used for authentication and backend data
- The intended schema reference is documented in `schema.md`, but the real project may evolve beyond that file as batching/admin/simulation features are added
- Main domain entities include sellers/users, orders, drones, hubs, zones/service areas, delivery batches, assignments, and route/stop tracking
- The system is expected to support multiple simultaneous deliveries and drone state transitions over time
- This is a course project to be presented at a college level; prefer simple, understandable, demonstrable implementations over ambitious or production-grade complexity

---

## Agreed Product Direction

This section reflects the current agreed target with the user and should be treated as active product guidance.

### Core product scope
- Seller-facing app for registration/login, order creation, delivery status tracking, and live drone visibility
- Admin panel for monitoring all operations and managing zones, hubs, drones, batches, and active deliveries
- Worker/simulator that dispatches drones, updates movement periodically, and progresses delivery state in near real time

### Current zone/hub direction
- Replace vague placeholder zone references with 5 explicit demo zones
- Each demo zone should be a hexagon with a 5 km radius
- Each zone must have one corresponding hub
- Current sellers should be moved into one of the explicit demo zones so the demo data stops looking random
- Signup should use a map picker instead of raw latitude/longitude entry and should warn when the chosen point falls outside every zone
- Admin should be able to view and edit zone geometry and corresponding hub placement

### Delivery model
- The system will support batched delivery
- Batching is zone-based
- Each zone has a batch collection window, e.g. 10 minutes
- Orders created during the active window for a zone are grouped into the same delivery batch
- At dispatch time, one available drone for that zone/hub is assigned to the batch
- The drone serves the collected drop points for that batch, then returns to hub
- When the drone finishes the last delivery stop, it should return to the nearest hub to that last stop, not necessarily the starting hub
- Map views should stay role-specific and uncluttered: seller maps should focus on the current seller/order context, while admin overview maps should emphasize only live operational entities instead of closed deliveries
- Delivery maps should use recognizable icons and route overlays rather than generic colored dots whenever the entity type matters
- The simulator should now move drones continuously in short steps suitable for live map playback instead of jumping one full stop per tick

### Simplifications that are not just temporary v1 hacks
These are intentional project choices unless the user later changes direction.
- Keep the project simple and course-project friendly, not overly creative
- Use one Next.js app with seller and admin routes instead of splitting into multiple frontend projects unless explicitly needed
- Use hub-based dispatch for batched deliveries
- For now, treat the dispatch route as hub -> delivery stops -> hub
- Do not model complex multi-pickup seller collection logic unless explicitly requested later
- Prefer understandable heuristics over advanced optimization early on
- Real-time behavior can be implemented with periodic worker updates plus frontend polling; websockets are optional, not mandatory
- Push notifications are optional and can be left to the end
- Route optimization should be postponed until the rest of the system is working; use straightforward running order first

### Route planning guidance
- Do not prioritize TSP or advanced route optimization right now
- Initial implementation should use a simple running order for stops
- Proper route optimization can be added at the end if time permits

---

## Current Reality

What is already present:
- Seller auth/profile flows exist and use Supabase
- Seller dashboard/current/past/profile/transactions/new-delivery flows exist in the frontend
- Basic reads/writes exist for orders, drone assignments, drones, and delivery batches

What is still missing or incomplete:
- Advanced admin operations beyond the initial batch/drone control view
- Proper zone/hub operational management
- Automated batch closure and drone assignment
- Richer movement simulation with persisted breadcrumbs/coordinates
- Real live location tracking
- Real transaction/payment backend behavior
- Clean status lifecycle across orders, batches, and drones
- Route planning and richer route/stop execution behavior for batched deliveries

Known mismatch:
- `README.md` is currently misleading about what is already live
- `AGENT.md` is the authoritative project-state file and should be trusted over `README.md` unless explicitly updated

---

## Rules

<!-- Project-specific rules. Override global agent behaviour for this project only. -->

- Read `schema.md` before making backend or schema-related changes
- Do not change the existing auth architecture unless explicitly requested
- Prefer small, reviewable changes unless a larger coordinated change is clearly required
- Preserve compatibility with the current frontend flows unless the task explicitly requires coordinated UI changes
- Track meaningful project state, scope changes, and implementation decisions in this file, not just in chat
- Before starting major implementation, update this file so the agreed plan is written down clearly
- When the user and agent agree on scope simplifications, record them here so later work does not drift into unnecessary complexity

---

## Implementation Plan

The implementation should follow this rough order unless the user reprioritizes.

### Phase 1 — Data model and backend cleanup
- Refine the data model for zones, hubs, drones, orders, delivery batches, assignments, and route/stop tracking
- Remove or reduce frontend-only fake behavior where it blocks real functionality
- Make sure the schema supports batched dispatch and drone simulation cleanly
- Phase 1 scope is limited to backend/data-model foundations plus seller-flow cleanup needed to stop assuming one-order-one-batch
- Phase 1 does not include the admin panel, dispatch worker, advanced route optimization, or real live-tracking implementation

### Phase 2 — Admin panel
- Build an initial admin operations page first instead of waiting for automation
- Admin can inspect batches, their orders, and the current drone pool
- Admin can manually assign/release drones and push basic batch status transitions for demo/testing
- Admin monitoring should be sufficient for a project demo, not enterprise-grade

### Phase 3 — Seller flow aligned to richer batch states
- Seller creates an order/delivery request
- Order is associated with its zone and active batch window
- Seller can see whether the order is pending collection, batched, assigned, dispatched/in progress, or completed

### Phase 3.5 — Optional seller polish
- Add richer status timeline visuals or lightweight polling refinements if the current seller pages still feel too flat in demo mode

### Phase 4 — Worker / simulator
- Periodically process ready batches
- Assign drones
- Generate stop order using simple running order first
- Simulate movement by updating coordinates/status every few seconds
- Mark stops/orders delivered and return the drone to the nearest hub from the last stop

### Phase 4 current simplification
- The simulator now targets simple continuous movement rather than advanced route optimization: move each drone a fixed short distance toward its next stop on each tick, complete stops only when reached, and keep the nearest-hub return decision

### Phase 5 — Live tracking UI
- Show current drone location and batch progress to sellers/admins
- Polling is acceptable if it keeps implementation simple and reliable

### Phase 6 — Endgame polish
- Optional push notifications
- Optional route optimization improvement near the end
- Presentation/demo cleanup
- Documentation cleanup

---

## Suggested Domain/Status Direction

These are the intended simple operational states unless implementation reveals a better minimal alternative.

### Order status
- `pending`
- `batched`
- `assigned`
- `out_for_delivery`
- `delivered`
- `failed`
- `cancelled`

### Batch status
- `collecting`
- `ready`
- `in_progress`
- `completed`
- `failed`

### Drone status
- `available`
- `charging`
- `assigned`
- `en_route`
- `returning`
- `offline`

---

## Tracking Expectations For Future Agents

When working on this project:
- Update this file before or alongside major implementation changes
- Keep the plan aligned with the user’s latest decisions
- Record important simplifications explicitly so the project stays scoped correctly
- Update the Log section with concrete completed work, not vague intentions

---

## Log

<!-- Update these as you do changes in the project -->

- Integrated Supabase backend v1 so major seller pages load real data and basic create/update flows work, using `schema.md` as the schema reference while keeping auth unchanged and deferring route-tracking simulation. Connected dashboard/new-delivery/current/past/transactions/profile flows to Supabase tables (orders, drone_assignments, drones, delivery_batches) with live reads plus create delivery.
- Reviewed the project proposal PDF and aligned the project plan around a simple college-project implementation: zone-based batched delivery, one Next.js app with seller/admin routes, admin panel + worker/simulator still to be built, periodic simulated movement, push notifications deferred, and route optimization explicitly postponed until the end in favor of simple running-order dispatch first.
- Completed Phase 1 on the real cloud Supabase project using the agreed minimal batch-first model. Added `orders.batch_id`, `delivery_batches.zone_id`, `delivery_batches.drone_id`, `delivery_batches.collection_window_start`, `delivery_batches.collection_window_end`, and a simple `batch_stops` table; backfilled old rows; updated seller delivery creation and reads to use orders->batch->drone instead of per-order `drone_assignments`; verified with a real cloud DB create/read test and a successful Next.js production build.
- Completed Phase 2 admin-first operations work in `app/admin/page.tsx` with server-side Supabase access via a new admin client. Added a working admin page to inspect batches, orders, and drones; manual actions to assign/release drones and move batches through `collecting`, `ready`, `assigned`, `in_progress`, `completed`, and `failed`; and verified the UI against the live cloud data plus a successful Next.js production build. Also verified one live admin transition by moving Batch #2 from `collecting` to `ready` through the new UI.
- Completed Phase 3 seller-state alignment. The seller dashboard/current/history/billing pages now use richer derived statuses from the batch-first model (`Collecting orders`, `Ready for dispatch`, `Drone assigned`, `Out for delivery`, `Delivered`, etc.) instead of just dumping raw order status strings. Added auto-refresh on current requests so admin-side batch changes show up for sellers without a manual reload, and verified with a successful Next.js production build.
- Completed a minimal Phase 4 simulator implementation in `scripts/simulator-worker.mjs`. The worker now closes expired collecting batches, auto-assigns available drones, launches batches, completes one stop per tick in simple running order, marks orders delivered, and returns the drone to the nearest hub from the final stop. Added `npm run sim:once` and `npm run sim:worker`, started the worker loop for demo use, and verified behavior against the live cloud DB plus a successful Next.js production build.
- Fixed the admin-page lint failure and replaced vague zone placeholders with a concrete 5-zone demo model. Added shared hex-zone geometry parsing/generation, seeded 5 explicit 5 km Delhi-area hex zones plus 5 matching hubs into the live Supabase project, moved the current sellers into a valid zone, and repaired the obviously broken demo order coordinates so the maps stop teleporting to nonsense.
- Added admin zone/hub management and map-first signup validation. The admin page now shows editable zone geometry/hub forms and renders the real hex zones on the map; signup now uses a zone-aware map picker instead of raw coordinate entry and blocks placements outside all service zones. Also updated seller/profile and seller-map reads to consume stored zone geometry instead of relying only on vague derived circles.
- Added `docs/drone-worker.md`, a plain-English implementation note explaining how `scripts/simulator-worker.mjs` works: env loading, tick flow, batch state transitions, drone assignment, one-stop-per-tick progression, nearest-hub return logic, and current simplifications.
- Fixed the batch-window timezone bug that was making fresh orders look like they belonged to a past 2:30 AM window and get delivered immediately. Added canonical timestamp parsing/formatting so naive DB timestamps are treated as UTC before local display/comparison, updated seller/admin UI formatting, and updated the simulator worker to compare collection windows through the same canonical parsing. Also verified the real Supabase schema is behind the migration file: columns like `orders.assigned_at`, `orders.delivered_at`, `delivery_batches.dispatched_at`, and `delivery_batches.completed_at` are not present live yet, so the current implementation still has to rely on `updated_at` for event-ish timestamps until a real migration is applied.
- **Major seller UI/UX overhaul & mock payment gateway.** Redesigned the entire seller dashboard with a professional sidebar navigation layout, gradient accent stat cards, and premium dark-themed card components using Tailwind-only styling (removed ~960 lines of custom dashboard CSS). Replaced all unprofessional copy ("add to current batch", "current seller flow", "course-project flow") with polished, industry-standard terminology. Added a mock payment gateway component (`components/PaymentGateway.tsx`) with card/UPI/wallet tabs, animated processing states, and success confirmation — integrated into the new-delivery flow as a required payment step. Transactions page now shows real payment records derived from order data with generated transaction IDs, payment methods, and status badges (Completed/Processing/Held/Refunded). All 6 seller pages rewritten: layout.tsx, page.tsx, new-delivery, current-deliveries, past-deliveries, transactions, profile. Verified with a clean Next.js production build.
- **Integrated Resend push notifications (email).** Added email notifications to the simulator worker for three events: (1) drone takeoff — sellers receive an email when their batch drone departs, (2) order delivered — sellers get notified per-order when delivery completes, (3) no drone available — admin receives an alert when a batch is ready but no drones can be assigned. Created `lib/email.ts` (reusable Next.js-side module) and embedded equivalent email functions directly in `scripts/simulator-worker.mjs` (standalone `.mjs` that cannot import TS). Uses Resend SDK with premium dark-themed HTML templates. Added `RESEND_API_KEY` to `.env.local` / `.env.example`. Includes a `noDroneAlertedBatches` dedup set to avoid spamming the admin. Also added the `sellers` table fetch to the simulator tick so seller name/email are available for notifications. Verified with a clean Next.js production build.
- Improved the live map experience across seller and admin flows. The new-delivery screen now connects the seller shop to the selected drop point with a labeled meter-distance overlay; seller active-delivery maps are scoped to the selected seller/order instead of every seller in the batch; admin overview maps now exclude delivered/closed orders; and admin batch maps now focus on the selected batch only. Replaced generic dot markers with semantic map icons including a directional drone arrow. Reworked `scripts/simulator-worker.mjs` so ticks default to 3 seconds and drones move 100 meters per tick toward their next stop or return hub, only delivering when the destination is actually reached and animating the return leg instead of teleporting. Added lightweight 3-second polling/refresh on the live seller/admin map pages, updated `docs/drone-worker.md`, and verified with a clean Next.js production build.
- Inspected a deeper live-tracking regression instead of treating it as a map-only issue. Verified against the live Supabase data that PostGIS geography columns are currently coming back as EWKB hex strings, which made both the frontend and simulator worker fall back to hub coordinates when parsing `last_known_location`. Updated shared/location parsing to understand EWKB points, hardened the worker loop so ticks run sequentially instead of overlapping, and documented that the worker must be restarted after code changes because a long-running `npm run sim:worker` process keeps the old tick settings in memory.
- Implemented Brute-Force Traveling Salesman Problem (TSP) routing for optimal drone delivery sequences. Updated `lib/delivery-data.ts` to enforce a hard maximum of 5 deliveries per batch, ensuring permutation routing remains strictly sub-millisecond (N<=5 -> 120 max permutations). Injected `optimizeBatchRoute()` execution into `scripts/simulator-worker.mjs` directly before dispatch, which sorts real `batch_stops` sequence values into the absolute lowest-distance sequence (Start Hub -> Stops -> Return Hub). Finally, upgraded map rendering inside `lib/delivery-data.ts` (`fetchSellerBatchMap`) so sellers now see the properly connected delivery sequence instead of solitary point-to-point lines.
