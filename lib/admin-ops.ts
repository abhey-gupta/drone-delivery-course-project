import 'server-only';

import { bearingBetweenDegrees, deriveZoneShape, parseHexZoneBoundary, parsePoint, type LatLngPoint } from '@/lib/geo';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

interface BatchRow {
  batch_id: number;
  zone_id: number | null;
  drone_id: number | null;
  status: string | null;
  collection_window_start: string | null;
  collection_window_end: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface OrderRow {
  order_id: number;
  seller_id: number;
  batch_id: number | null;
  package_weight: number;
  drop_location: unknown;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SellerRow {
  seller_id: number;
  name: string | null;
  email: string | null;
  store_location_id: number;
}

interface StoreLocationRow {
  store_location_id: number;
  zone_id: number;
  store_location: unknown;
}

interface DroneRow {
  drone_id: number;
  model_id: number;
  current_hub_id: number | null;
  current_charge: number | null;
  status: string | null;
  updated_at: string | null;
  last_known_location: unknown;
  last_seen_at: string | null;
}

interface ModelRow {
  model_id: number;
  model_name: string | null;
  max_capacity: number | null;
  max_charge_duration: number | null;
}

interface BatchStopRow {
  stop_id: number;
  batch_id: number;
  order_id: number | null;
  sequence_no: number;
  status: string | null;
}

interface HubRow {
  hub_id: number;
  hub_location_id: number;
}

interface HubLocationRow {
  hub_location_id: number;
  hub_location: unknown;
  zone_id: number;
}

interface ZoneRow {
  zone_id: number;
  boundary_coordinates_ref: string;
}

export interface AdminMapMarker {
  id: string;
  label: string;
  kind: 'hub' | 'drone' | 'seller' | 'order';
  position: LatLngPoint;
  color: string;
  detail?: string;
  rotationDegrees?: number;
}

export interface AdminMapSegment {
  id: string;
  points: LatLngPoint[];
  color?: string;
  weight?: number;
  dashed?: boolean;
  label?: string;
  detail?: string;
}

export interface AdminMapZone {
  zoneId: number;
  label: string;
  boundaryRef: string;
  center: LatLngPoint;
  radiusMeters: number;
  vertices: LatLngPoint[];
  hubId: number | null;
  hubPosition: LatLngPoint | null;
}

export interface AdminBatchOrder {
  orderId: number;
  sellerId: number;
  sellerName: string;
  sellerEmail: string;
  weight: number;
  status: string;
  stopSequence: number | null;
  stopStatus: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  createdAt: string | null;
}

export interface AdminBatchSummary {
  batchId: number;
  zoneId: number | null;
  status: string;
  droneId: number | null;
  droneLabel: string | null;
  droneStatus: string | null;
  collectionWindowStart: string | null;
  collectionWindowEnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  orderCount: number;
  totalWeight: number;
  activeOrderCount: number;
  route: LatLngPoint[];
  mapMarkers: AdminMapMarker[];
  segments: AdminMapSegment[];
  orders: AdminBatchOrder[];
}

export interface AdminDroneSummary {
  droneId: number;
  label: string;
  status: string;
  currentHubId: number | null;
  currentCharge: number | null;
  maxCapacity: number | null;
  maxChargeDuration: number | null;
  assignedBatchId: number | null;
  assignedZoneId: number | null;
  position: LatLngPoint | null;
}

export interface AdminOverview {
  batches: AdminBatchSummary[];
  drones: AdminDroneSummary[];
  hubs: Array<{ hubId: number; zoneId: number; position: LatLngPoint; label: string }>;
  sellers: Array<{ sellerId: number; zoneId: number | null; name: string; email: string; position: LatLngPoint | null }>;
  zones: AdminMapZone[];
  mapMarkers: AdminMapMarker[];
  stats: {
    totalBatches: number;
    collectingBatches: number;
    readyBatches: number;
    assignedBatches: number;
    inProgressBatches: number;
    totalOrders: number;
    availableDrones: number;
  };
}

function normalizeStatus(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function isClosedOrderStatus(status: string | null | undefined) {
  return ['delivered', 'completed', 'failed', 'cancelled'].includes(normalizeStatus(status, '').toLowerCase());
}

function droneLabel(droneId: number, model?: ModelRow | null) {
  return model?.model_name?.trim() || `Drone #${droneId}`;
}

function positionFromOrder(order: AdminBatchOrder): LatLngPoint | null {
  if (order.destinationLat === null || order.destinationLng === null) return null;
  return { lat: order.destinationLat, lng: order.destinationLng };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const supabase = getSupabaseAdminClient();

  const [
    batchesResult,
    ordersResult,
    sellersResult,
    storeLocationsResult,
    dronesResult,
    modelsResult,
    stopsResult,
    hubsResult,
    hubLocationsResult,
    zonesResult,
  ] = await Promise.all([
    supabase.from('delivery_batches').select('batch_id, zone_id, drone_id, status, collection_window_start, collection_window_end, created_at, updated_at').order('created_at', { ascending: false }),
    supabase.from('orders').select('order_id, seller_id, batch_id, package_weight, drop_location, status, created_at, updated_at').order('created_at', { ascending: false }),
    supabase.from('sellers').select('seller_id, name, email, store_location_id'),
    supabase.from('store_location_zone').select('store_location_id, zone_id, store_location'),
    supabase.from('drones').select('drone_id, model_id, current_hub_id, current_charge, status, updated_at, last_known_location, last_seen_at').order('drone_id', { ascending: true }),
    supabase.from('models').select('model_id, model_name, max_capacity, max_charge_duration'),
    supabase.from('batch_stops').select('stop_id, batch_id, order_id, sequence_no, status').order('sequence_no', { ascending: true }),
    supabase.from('hubs').select('hub_id, hub_location_id'),
    supabase.from('hub_location_zone').select('hub_location_id, hub_location, zone_id'),
    supabase.from('zones').select('zone_id, boundary_coordinates_ref').order('zone_id', { ascending: true }),
  ]);

  for (const result of [batchesResult, ordersResult, sellersResult, storeLocationsResult, dronesResult, modelsResult, stopsResult, hubsResult, hubLocationsResult, zonesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const batches = (batchesResult.data ?? []) as BatchRow[];
  const orders = (ordersResult.data ?? []) as OrderRow[];
  const sellers = (sellersResult.data ?? []) as SellerRow[];
  const storeLocations = (storeLocationsResult.data ?? []) as StoreLocationRow[];
  const drones = (dronesResult.data ?? []) as DroneRow[];
  const models = (modelsResult.data ?? []) as ModelRow[];
  const stops = (stopsResult.data ?? []) as BatchStopRow[];
  const hubs = (hubsResult.data ?? []) as HubRow[];
  const hubLocations = (hubLocationsResult.data ?? []) as HubLocationRow[];
  const zones = (zonesResult.data ?? []) as ZoneRow[];

  const sellerMap = new Map(sellers.map((seller) => [seller.seller_id, seller]));
  const modelMap = new Map(models.map((model) => [model.model_id, model]));
  const stopMap = new Map(stops.filter((stop) => stop.order_id !== null).map((stop) => [stop.order_id as number, stop]));
  const storeLocationMap = new Map(storeLocations.map((location) => [location.store_location_id, location]));
  const hubLocationMap = new Map(hubLocations.map((location) => [location.hub_location_id, location]));

  const sellerSummaries = sellers.map((seller) => {
    const storeLocation = storeLocationMap.get(seller.store_location_id) ?? null;
    return {
      sellerId: seller.seller_id,
      zoneId: storeLocation?.zone_id ?? null,
      name: seller.name?.trim() || `Seller #${seller.seller_id}`,
      email: seller.email?.trim() || 'unknown',
      position: storeLocation ? parsePoint(storeLocation.store_location) : null,
    };
  });

  const hubSummaries = hubs
    .map((hub) => {
      const location = hubLocationMap.get(hub.hub_location_id) ?? null;
      const position = location ? parsePoint(location.hub_location) : null;
      if (!location || !position) return null;
      return {
        hubId: hub.hub_id,
        zoneId: location.zone_id,
        position,
        label: `Hub #${hub.hub_id}`,
      };
    })
    .filter((hub): hub is NonNullable<typeof hub> => Boolean(hub));
  const sellerSummaryMap = new Map(sellerSummaries.map((seller) => [seller.sellerId, seller]));
  const hubByZone = new Map(hubSummaries.map((hub) => [hub.zoneId, hub]));
  const stopsByBatch = new Map<number, BatchStopRow[]>();
  for (const stop of stops) {
    const stopList = stopsByBatch.get(stop.batch_id) ?? [];
    stopList.push(stop);
    stopsByBatch.set(stop.batch_id, stopList);
  }

  const batchOrdersMap = new Map<number, AdminBatchOrder[]>();
  for (const order of orders) {
    if (!order.batch_id) continue;

    const seller = sellerMap.get(order.seller_id);
    const stop = stopMap.get(order.order_id);
    const destination = parsePoint(order.drop_location);
    const batchOrders = batchOrdersMap.get(order.batch_id) ?? [];

    batchOrders.push({
      orderId: order.order_id,
      sellerId: order.seller_id,
      sellerName: seller?.name?.trim() || `Seller #${order.seller_id}`,
      sellerEmail: seller?.email?.trim() || 'unknown',
      weight: order.package_weight,
      status: normalizeStatus(order.status, 'pending'),
      stopSequence: stop?.sequence_no ?? null,
      stopStatus: stop?.status ?? null,
      destinationLat: destination?.lat ?? null,
      destinationLng: destination?.lng ?? null,
      createdAt: order.created_at,
    });

    batchOrders.sort((a, b) => {
      if (a.stopSequence === null && b.stopSequence === null) return a.orderId - b.orderId;
      if (a.stopSequence === null) return 1;
      if (b.stopSequence === null) return -1;
      return a.stopSequence - b.stopSequence;
    });

    batchOrdersMap.set(order.batch_id, batchOrders);
  }

  const zonePointMap = new Map<number, LatLngPoint[]>();
  const pushZonePoint = (zoneId: number | null | undefined, point: LatLngPoint | null) => {
    if (!zoneId || !point) return;
    const points = zonePointMap.get(zoneId) ?? [];
    points.push(point);
    zonePointMap.set(zoneId, points);
  };

  const sellerZoneMap = new Map(sellerSummaries.map((seller) => [seller.sellerId, seller.zoneId]));
  for (const hub of hubSummaries) pushZonePoint(hub.zoneId, hub.position);
  for (const seller of sellerSummaries) pushZonePoint(seller.zoneId, seller.position);
  for (const batchOrders of batchOrdersMap.values()) {
    for (const order of batchOrders) {
      pushZonePoint(sellerZoneMap.get(order.sellerId) ?? null, positionFromOrder(order));
    }
  }

  const zoneSummaries: AdminMapZone[] = zones
    .map((zone) => {
      const parsed = parseHexZoneBoundary(zone.boundary_coordinates_ref);
      const zoneHub = hubSummaries.find((hub) => hub.zoneId === zone.zone_id) ?? null;
      if (parsed) {
        return {
          zoneId: zone.zone_id,
          label: parsed.label,
          boundaryRef: zone.boundary_coordinates_ref,
          center: parsed.center,
          radiusMeters: parsed.radiusMeters,
          vertices: parsed.vertices,
          hubId: zoneHub?.hubId ?? null,
          hubPosition: zoneHub?.position ?? null,
        };
      }

      const shape = deriveZoneShape(zonePointMap.get(zone.zone_id) ?? [], zoneHub?.position ?? null);
      if (!shape) return null;
      return {
        zoneId: zone.zone_id,
        label: `Zone ${zone.zone_id}`,
        boundaryRef: zone.boundary_coordinates_ref,
        center: shape.center,
        radiusMeters: shape.radiusMeters,
        vertices: [],
        hubId: zoneHub?.hubId ?? null,
        hubPosition: zoneHub?.position ?? null,
      };
    })
    .filter((zone): zone is AdminMapZone => Boolean(zone));

  const droneSummaries: AdminDroneSummary[] = drones.map((drone) => {
    const model = modelMap.get(drone.model_id) ?? null;
    const assignedBatch = batches.find((batch) => batch.drone_id === drone.drone_id && !['completed', 'failed'].includes(normalizeStatus(batch.status, 'collecting').toLowerCase())) ?? null;
    const currentHub = drone.current_hub_id ? hubSummaries.find((hub) => hub.hubId === drone.current_hub_id) ?? null : null;
    const routeOrders = assignedBatch ? batchOrdersMap.get(assignedBatch.batch_id) ?? [] : [];
    const firstPendingRoutePoint = routeOrders
      .filter((order) => !isClosedOrderStatus(order.status))
      .map(positionFromOrder)
      .find((point): point is LatLngPoint => Boolean(point)) ?? null;

    const trackedPosition = parsePoint(drone.last_known_location);
    let position = trackedPosition ?? currentHub?.position ?? null;
    if (!position && firstPendingRoutePoint) {
      position = firstPendingRoutePoint;
    }

    const rawStatus = normalizeStatus(drone.status, 'unknown');
    const effectiveStatus = assignedBatch && rawStatus === 'available' ? 'assigned' : rawStatus;

    return {
      droneId: drone.drone_id,
      label: droneLabel(drone.drone_id, model),
      status: effectiveStatus,
      currentHubId: drone.current_hub_id,
      currentCharge: drone.current_charge,
      maxCapacity: model?.max_capacity ?? null,
      maxChargeDuration: model?.max_charge_duration ?? null,
      assignedBatchId: assignedBatch?.batch_id ?? null,
      assignedZoneId: assignedBatch?.zone_id ?? null,
      position,
    };
  });

  const droneMap = new Map(droneSummaries.map((drone) => [drone.droneId, drone]));

  const batchSummaries: AdminBatchSummary[] = batches.map((batch) => {
    const ordersForBatch = batchOrdersMap.get(batch.batch_id) ?? [];
    const drone = batch.drone_id ? droneMap.get(batch.drone_id) ?? null : null;
    const zoneHub = batch.zone_id ? hubByZone.get(batch.zone_id) ?? null : null;
    const activeOrders = ordersForBatch.filter((order) => !isClosedOrderStatus(order.status));
    const activeRoute = activeOrders
      .map(positionFromOrder)
      .filter((point): point is LatLngPoint => Boolean(point));
    const route = [
      ...(drone?.position ? [drone.position] : zoneHub?.position ? [zoneHub.position] : []),
      ...activeRoute,
    ];
    const nextRoutePoint = activeRoute[0] ?? zoneHub?.position ?? null;
    const droneHeading = drone?.position && nextRoutePoint ? bearingBetweenDegrees(drone.position, nextRoutePoint) : undefined;
    const liveSellerMarkers = Array.from(
      new Map(
        activeOrders
          .map((order) => {
            const seller = sellerSummaryMap.get(order.sellerId);
            if (!seller?.position) return null;
            return {
              id: `batch-${batch.batch_id}-seller-${seller.sellerId}`,
              label: seller.name,
              kind: 'seller' as const,
              position: seller.position,
              color: '#f59e0b',
              detail: seller.email,
            };
          })
          .filter((marker): marker is NonNullable<typeof marker> => Boolean(marker))
          .map(marker => [marker.id, marker])
      ).values()
    );
    const liveOrderMarkers = activeOrders
      .map((order) => {
        const point = positionFromOrder(order);
        if (!point) return null;
        return {
          id: `batch-${batch.batch_id}-order-${order.orderId}`,
          label: `ORD-${order.orderId}`,
          kind: 'order' as const,
          position: point,
          color: '#22c55e',
          detail: order.status,
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => Boolean(marker));
    const batchMarkers: AdminMapMarker[] = [
      ...(zoneHub ? [{
        id: `batch-${batch.batch_id}-hub-${zoneHub.hubId}`,
        label: zoneHub.label,
        kind: 'hub' as const,
        position: zoneHub.position,
        color: '#38bdf8',
        detail: `Zone ${zoneHub.zoneId}`,
      }] : []),
      ...liveSellerMarkers,
      ...liveOrderMarkers,
      ...(drone?.position ? [{
        id: `batch-${batch.batch_id}-drone-${drone.droneId}`,
        label: drone.label,
        kind: 'drone' as const,
        position: drone.position,
        color: '#2563eb',
        detail: drone.assignedBatchId ? `Batch #${drone.assignedBatchId} · ${drone.status}` : drone.status,
        rotationDegrees: droneHeading,
      }] : []),
    ];
    const segments: AdminMapSegment[] = route.length > 1 ? [{
      id: `batch-${batch.batch_id}-route`,
      points: route,
      color: '#60a5fa',
      weight: 4,
      detail: activeOrders.length > 0 ? 'Remaining live route' : 'Drone returning to hub',
    }] : [];

    return {
      batchId: batch.batch_id,
      zoneId: batch.zone_id,
      status: normalizeStatus(batch.status, 'collecting'),
      droneId: batch.drone_id,
      droneLabel: drone?.label ?? null,
      droneStatus: drone?.status ?? null,
      collectionWindowStart: batch.collection_window_start,
      collectionWindowEnd: batch.collection_window_end,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      orderCount: ordersForBatch.length,
      totalWeight: Math.round(ordersForBatch.reduce((sum, order) => sum + order.weight, 0) * 100) / 100,
      activeOrderCount: activeOrders.length,
      route,
      mapMarkers: batchMarkers,
      segments,
      orders: ordersForBatch,
    };
  });

  const hubMarkers: AdminMapMarker[] = hubSummaries.map((hub) => ({
    id: `hub-${hub.hubId}`,
    label: hub.label,
    kind: 'hub',
    position: hub.position,
    color: '#38bdf8',
    detail: `Zone ${hub.zoneId}`,
  }));

  const sellerMarkers: AdminMapMarker[] = sellerSummaries
    .filter((seller) => seller.position)
    .map((seller) => ({
      id: `seller-${seller.sellerId}`,
      label: seller.name,
      kind: 'seller',
      position: seller.position as LatLngPoint,
      color: '#f59e0b',
      detail: seller.email,
    }));

  const orderMarkers: AdminMapMarker[] = orders.reduce<AdminMapMarker[]>((acc, order) => {
    if (isClosedOrderStatus(order.status)) return acc;
    const point = parsePoint(order.drop_location);
    if (!point) return acc;

    acc.push({
      id: `order-${order.order_id}`,
      label: `ORD-${order.order_id}`,
      kind: 'order',
      position: point,
      color: '#22c55e',
      detail: normalizeStatus(order.status, 'pending'),
    });

    return acc;
  }, []);

  const batchSummaryMap = new Map(batchSummaries.map((batch) => [batch.batchId, batch]));

  const droneMarkers: AdminMapMarker[] = droneSummaries
    .filter((drone) => drone.position)
    .map((drone) => {
      const batch = drone.assignedBatchId ? batchSummaryMap.get(drone.assignedBatchId) ?? null : null;
      const nextPoint = batch?.route.length && drone.position
        ? batch.route.find((point, index) => index > 0 && (point.lat !== drone.position?.lat || point.lng !== drone.position?.lng)) ?? null
        : null;
      const heading = drone.position && nextPoint ? bearingBetweenDegrees(drone.position, nextPoint) : undefined;

      return {
        id: `drone-${drone.droneId}`,
        label: drone.label,
        kind: 'drone' as const,
        position: drone.position as LatLngPoint,
        color: '#2563eb',
        detail: drone.assignedBatchId ? `Batch #${drone.assignedBatchId} · ${drone.status}` : drone.status,
        rotationDegrees: heading,
      };
    });

  const mapMarkers: AdminMapMarker[] = [...hubMarkers, ...sellerMarkers, ...orderMarkers, ...droneMarkers];

  const statusCounts = batchSummaries.reduce(
    (acc, batch) => {
      const status = batch.status.toLowerCase();
      if (status === 'collecting') acc.collectingBatches += 1;
      if (status === 'ready') acc.readyBatches += 1;
      if (status === 'assigned') acc.assignedBatches += 1;
      if (status === 'in_progress') acc.inProgressBatches += 1;
      return acc;
    },
    {
      collectingBatches: 0,
      readyBatches: 0,
      assignedBatches: 0,
      inProgressBatches: 0,
    }
  );

  return {
    batches: batchSummaries,
    drones: droneSummaries,
    hubs: hubSummaries,
    sellers: sellerSummaries,
    zones: zoneSummaries,
    mapMarkers,
    stats: {
      totalBatches: batchSummaries.length,
      collectingBatches: statusCounts.collectingBatches,
      readyBatches: statusCounts.readyBatches,
      assignedBatches: statusCounts.assignedBatches,
      inProgressBatches: statusCounts.inProgressBatches,
      totalOrders: orders.length,
      availableDrones: droneSummaries.filter((drone) => drone.status.toLowerCase() === 'available').length,
    },
  };
}
