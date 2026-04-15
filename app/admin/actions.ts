'use server';

import { revalidatePath } from 'next/cache';
import { createHexZoneBoundary, serializeHexZoneBoundary } from '@/lib/geo';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status: string | null | undefined, fallback: string) {
  return status?.trim().toLowerCase() || fallback;
}

async function loadBatch(batchId: number) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('delivery_batches')
    .select('batch_id, zone_id, drone_id, status')
    .eq('batch_id', batchId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Batch #${batchId} does not exist.`);
  return data as { batch_id: number; zone_id: number | null; drone_id: number | null; status: string | null };
}

async function loadDrone(droneId: number) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('drones')
    .select('drone_id, status, current_hub_id, home_hub_id')
    .eq('drone_id', droneId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Drone #${droneId} does not exist.`);
  return data as { drone_id: number; status: string | null; current_hub_id: number | null; home_hub_id: number | null };
}

async function loadHubStation(hubId: number) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('hubs')
    .select('hub_id, hub_location_id, zone_id, hub_location')
    .eq('hub_id', hubId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Hub #${hubId} does not exist.`);
  const hub = data as {
    hub_id: number;
    hub_location_id: number | null;
    zone_id: number | null;
    hub_location: unknown;
  };

  if (!hub.hub_location_id) {
    return {
      hub_id: hub.hub_id,
      zone_id: hub.zone_id,
      hub_location: hub.hub_location ?? null,
    };
  }

  const { data: hubLocationData, error: hubLocationError } = await supabase
    .from('hub_location_zone')
    .select('hub_location_id, zone_id, hub_location')
    .eq('hub_location_id', hub.hub_location_id)
    .maybeSingle();

  if (hubLocationError) throw new Error(hubLocationError.message);

  const hubLocation = hubLocationData as {
    hub_location_id: number;
    zone_id: number | null;
    hub_location: unknown;
  } | null;

  return {
    hub_id: hub.hub_id,
    zone_id: hubLocation?.zone_id ?? hub.zone_id,
    hub_location: hubLocation?.hub_location ?? hub.hub_location ?? null,
  };
}

async function getDockedDroneUpdate(droneId: number, timestamp: string) {
  const drone = await loadDrone(droneId);
  const hubId = drone.current_hub_id ?? drone.home_hub_id;
  if (!hubId) {
    return {
      status: 'available',
      updated_at: timestamp,
      last_seen_at: timestamp,
    };
  }

  const hub = await loadHubStation(hubId);
  return {
    status: 'available',
    current_hub_id: hub.hub_id,
    updated_at: timestamp,
    last_seen_at: timestamp,
    last_known_location: hub.hub_location ?? null,
  };
}

async function updateOrdersForBatch(batchId: number, status: string) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from('orders')
    .update({
      status,
      updated_at: nowIso(),
    })
    .eq('batch_id', batchId)
    .not('status', 'in', '(delivered,completed,cancelled)');

  if (error) throw new Error(error.message);
}

async function updateBatchStopsForBatch(batchId: number, status: string) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from('batch_stops')
    .update({ status })
    .eq('batch_id', batchId);

  if (error) throw new Error(error.message);
}

async function nextIntegerId(
  table: 'drones' | 'hubs' | 'hub_location_zone',
  column: 'drone_id' | 'hub_id' | 'hub_location_id',
) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from(table).select(column).order(column, { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as Record<string, number> | null;
  return Number(row?.[column] ?? 0) + 1;
}

export async function assignDroneToBatch(formData: FormData) {
  const batchId = Number(formData.get('batchId'));
  const droneId = Number(formData.get('droneId'));

  if (!Number.isFinite(batchId) || !Number.isFinite(droneId)) {
    throw new Error('Batch and drone are required.');
  }

  const supabase = getSupabaseAdminClient();
  const [batch, drone] = await Promise.all([loadBatch(batchId), loadDrone(droneId)]);

  if (batch.drone_id && batch.drone_id !== droneId) {
    throw new Error(`Batch #${batchId} already has Drone #${batch.drone_id}. Release it first if you want to swap.`);
  }

  const droneStatus = normalizeStatus(drone.status, 'unknown');
  if (!['available', 'assigned'].includes(droneStatus)) {
    throw new Error(`Drone #${droneId} is ${droneStatus}, so assigning it now would be bullshit.`);
  }

  const { data: conflictingBatch, error: conflictingError } = await supabase
    .from('delivery_batches')
    .select('batch_id')
    .eq('drone_id', droneId)
    .neq('batch_id', batchId)
    .not('status', 'in', '(completed,failed)')
    .maybeSingle();

  if (conflictingError) throw new Error(conflictingError.message);
  if (conflictingBatch) throw new Error(`Drone #${droneId} is already tied to Batch #${conflictingBatch.batch_id}.`);

  const timestamp = nowIso();

  const { error: batchError } = await supabase
    .from('delivery_batches')
    .update({
      drone_id: droneId,
      status: 'assigned',
      updated_at: timestamp,
    })
    .eq('batch_id', batchId);

  if (batchError) throw new Error(batchError.message);

  const { error: droneError } = await supabase
    .from('drones')
    .update({
      status: 'assigned',
      updated_at: timestamp,
    })
    .eq('drone_id', droneId);

  if (droneError) throw new Error(droneError.message);

  await updateOrdersForBatch(batchId, 'assigned');
  await updateBatchStopsForBatch(batchId, 'pending');

  revalidatePath('/admin');
}

export async function releaseDroneFromBatch(formData: FormData) {
  const batchId = Number(formData.get('batchId'));

  if (!Number.isFinite(batchId)) {
    throw new Error('Batch is required.');
  }

  const supabase = getSupabaseAdminClient();
  const batch = await loadBatch(batchId);
  const timestamp = nowIso();

  if (batch.drone_id) {
    const dockedDroneUpdate = await getDockedDroneUpdate(batch.drone_id, timestamp);
    const { error: droneError } = await supabase
      .from('drones')
      .update(dockedDroneUpdate)
      .eq('drone_id', batch.drone_id);

    if (droneError) throw new Error(droneError.message);
  }

  const { error: batchError } = await supabase
    .from('delivery_batches')
    .update({
      drone_id: null,
      status: 'ready',
      updated_at: timestamp,
    })
    .eq('batch_id', batchId);

  if (batchError) throw new Error(batchError.message);

  await updateOrdersForBatch(batchId, 'batched');
  await updateBatchStopsForBatch(batchId, 'pending');

  revalidatePath('/admin');
}

export async function updateBatchStatus(formData: FormData) {
  const batchId = Number(formData.get('batchId'));
  const requestedStatus = String(formData.get('status') || '').trim().toLowerCase();

  if (!Number.isFinite(batchId) || !requestedStatus) {
    throw new Error('Batch and status are required.');
  }

  const allowedStatuses = new Set(['collecting', 'ready', 'assigned', 'in_progress', 'completed', 'failed']);
  if (!allowedStatuses.has(requestedStatus)) {
    throw new Error(`Unsupported batch status: ${requestedStatus}`);
  }

  const supabase = getSupabaseAdminClient();
  const batch = await loadBatch(batchId);
  const timestamp = nowIso();

  if (['assigned', 'in_progress'].includes(requestedStatus) && !batch.drone_id) {
    throw new Error(`Batch #${batchId} needs a drone before it can be ${requestedStatus}.`);
  }

  if ((requestedStatus === 'collecting' || requestedStatus === 'ready') && batch.drone_id) {
    throw new Error(`Batch #${batchId} still has Drone #${batch.drone_id}. Release it before sending the batch backward.`);
  }

  let orderStatus = 'batched';
  let stopStatus = 'pending';
  let droneStatus: string | null = null;

  switch (requestedStatus) {
    case 'collecting':
    case 'ready':
      orderStatus = 'batched';
      stopStatus = 'pending';
      break;
    case 'assigned':
      orderStatus = 'assigned';
      stopStatus = 'pending';
      droneStatus = 'assigned';
      break;
    case 'in_progress':
      orderStatus = 'out_for_delivery';
      stopStatus = 'in_progress';
      droneStatus = 'en_route';
      break;
    case 'completed':
      orderStatus = 'delivered';
      stopStatus = 'delivered';
      droneStatus = 'available';
      break;
    case 'failed':
      orderStatus = 'failed';
      stopStatus = 'failed';
      droneStatus = 'available';
      break;
  }

  const { error: batchError } = await supabase
    .from('delivery_batches')
    .update({
      status: requestedStatus,
      updated_at: timestamp,
    })
    .eq('batch_id', batchId);

  if (batchError) throw new Error(batchError.message);

  await updateOrdersForBatch(batchId, orderStatus);
  await updateBatchStopsForBatch(batchId, stopStatus);

  if (batch.drone_id && droneStatus) {
    const droneUpdate = droneStatus === 'available'
      ? await getDockedDroneUpdate(batch.drone_id, timestamp)
      : {
          status: droneStatus,
          updated_at: timestamp,
        };
    const { error: droneError } = await supabase
      .from('drones')
      .update(droneUpdate)
      .eq('drone_id', batch.drone_id);

    if (droneError) throw new Error(droneError.message);
  }

  revalidatePath('/admin');
}

export async function updateZoneGeometry(formData: FormData) {
  const zoneId = Number(formData.get('zoneId'));
  const label = String(formData.get('label') || '').trim();
  const centerLat = Number(formData.get('centerLat'));
  const centerLng = Number(formData.get('centerLng'));
  const radiusKm = Number(formData.get('radiusKm'));
  const hubLat = Number(formData.get('hubLat'));
  const hubLng = Number(formData.get('hubLng'));

  if (!Number.isFinite(zoneId) || !label || !Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm) || !Number.isFinite(hubLat) || !Number.isFinite(hubLng)) {
    throw new Error('Zone label, center, radius, and hub coordinates are all required.');
  }

  if (radiusKm <= 0 || radiusKm > 25) {
    throw new Error('Radius must be between 0 and 25 km.');
  }

  const supabase = getSupabaseAdminClient();
  const boundary = serializeHexZoneBoundary(createHexZoneBoundary(label, { lat: centerLat, lng: centerLng }, radiusKm * 1000));

  const { error: zoneError } = await supabase
    .from('zones')
    .update({ boundary_coordinates_ref: boundary })
    .eq('zone_id', zoneId);
  if (zoneError) throw new Error(zoneError.message);

  const { data: existingHubLocation, error: hubLocationLookupError } = await supabase
    .from('hub_location_zone')
    .select('hub_location_id')
    .eq('zone_id', zoneId)
    .maybeSingle();
  if (hubLocationLookupError) throw new Error(hubLocationLookupError.message);

  let hubLocationId = existingHubLocation?.hub_location_id ?? null;
  const hubPoint = `SRID=4326;POINT(${hubLng} ${hubLat})`;
  if (hubLocationId) {
    const { error: hubLocationError } = await supabase
      .from('hub_location_zone')
      .update({
        zone_id: zoneId,
        hub_location: hubPoint,
      })
      .eq('hub_location_id', hubLocationId);
    if (hubLocationError) throw new Error(hubLocationError.message);
  } else {
    const nextHubLocationId = await nextIntegerId('hub_location_zone', 'hub_location_id');
    const { data: createdHubLocation, error: createHubLocationError } = await supabase
      .from('hub_location_zone')
      .insert({
        hub_location_id: nextHubLocationId,
        zone_id: zoneId,
        hub_location: hubPoint,
      })
      .select('hub_location_id')
      .single();
    if (createHubLocationError) throw new Error(createHubLocationError.message);
    hubLocationId = createdHubLocation.hub_location_id;
  }

  const { error: hubSyncError } = await supabase
    .from('hubs')
    .update({
      zone_id: zoneId,
      hub_location: hubPoint,
    })
    .eq('hub_location_id', hubLocationId);
  if (hubSyncError) throw new Error(hubSyncError.message);

  const { data: existingHub, error: hubLookupError } = await supabase
    .from('hubs')
    .select('hub_id')
    .eq('hub_location_id', hubLocationId)
    .maybeSingle();
  if (hubLookupError) throw new Error(hubLookupError.message);

  if (!existingHub) {
    const hubId = await nextIntegerId('hubs', 'hub_id');
    const { error: hubInsertError } = await supabase.from('hubs').insert({
      hub_id: hubId,
      hub_location_id: hubLocationId,
    });
    if (hubInsertError) throw new Error(hubInsertError.message);
  }

  const { data: affectedHubs, error: affectedHubsError } = await supabase
    .from('hubs')
    .select('hub_id')
    .eq('hub_location_id', hubLocationId);
  if (affectedHubsError) throw new Error(affectedHubsError.message);

  const affectedHubIds = (affectedHubs ?? [])
    .map((hub) => hub.hub_id)
    .filter((hubId): hubId is number => Number.isFinite(hubId));

  if (affectedHubIds.length > 0) {
    const timestamp = nowIso();
    const { error: droneSyncError } = await supabase
      .from('drones')
      .update({
        zone_id: zoneId,
        last_known_location: hubPoint,
        updated_at: timestamp,
        last_seen_at: timestamp,
      })
      .in('current_hub_id', affectedHubIds)
      .eq('status', 'available');
    if (droneSyncError) throw new Error(droneSyncError.message);
  }

  revalidatePath('/admin');
  revalidatePath('/admin/infrastructure');
  revalidatePath('/auth/register');
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard/current-deliveries');
}

export async function createDrone(formData: FormData) {
  const modelId = Number(formData.get('modelId'));
  const hubId = Number(formData.get('hubId'));

  if (!Number.isFinite(modelId) || !Number.isFinite(hubId)) {
    throw new Error('Model and hub are required to create a drone.');
  }

  const supabase = getSupabaseAdminClient();

  const { data: modelData, error: modelError } = await supabase
    .from('models')
    .select('model_id')
    .eq('model_id', modelId)
    .maybeSingle();

  if (modelError) throw new Error(modelError.message);
  if (!modelData) throw new Error(`Model #${modelId} does not exist.`);

  // Lookup the authoritative hub location to set last_known_location.
  const hubData = await loadHubStation(hubId);
  if (!hubData.zone_id) throw new Error(`Hub #${hubId} is not linked to a zone.`);

  const droneId = await nextIntegerId('drones', 'drone_id');
  const timestamp = nowIso();

  const { error: insertError } = await supabase.from('drones').insert({
    drone_id: droneId,
    model_id: modelId,
    current_hub_id: hubId,
    home_hub_id: hubId,
    // A drone inherits its operating zone from the hub it is stationed at.
    zone_id: hubData.zone_id,
    status: 'available',
    updated_at: timestamp,
    last_known_location: hubData.hub_location ?? null,
    last_seen_at: timestamp,
  });

  if (insertError) throw new Error(insertError.message);

  revalidatePath('/admin');
  revalidatePath('/admin/fleet');
}

export async function createZoneWithHub(formData: FormData) {
  const label = String(formData.get('label') || '').trim();
  const centerLat = Number(formData.get('centerLat'));
  const centerLng = Number(formData.get('centerLng'));
  const radiusKm = Number(formData.get('radiusKm'));
  const hubLat = Number(formData.get('hubLat'));
  const hubLng = Number(formData.get('hubLng'));

  if (!label || !Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm)) {
    throw new Error('Label, center coordinates, and radius are required.');
  }

  if (radiusKm <= 0 || radiusKm > 25) {
    throw new Error('Radius must be between 0 and 25 km.');
  }

  const effectiveHubLat = Number.isFinite(hubLat) ? hubLat : centerLat;
  const effectiveHubLng = Number.isFinite(hubLng) ? hubLng : centerLng;

  const supabase = getSupabaseAdminClient();
  const boundary = serializeHexZoneBoundary(createHexZoneBoundary(label, { lat: centerLat, lng: centerLng }, radiusKm * 1000));

  // Create zone
  const { data: zoneData, error: zoneError } = await supabase
    .from('zones')
    .insert({
      boundary_coordinates_ref: boundary,
      zone_name: label,
      collection_window_minutes: 10,
      is_active: true,
    })
    .select('zone_id')
    .single();

  if (zoneError) throw new Error(zoneError.message);
  const newZoneId = zoneData.zone_id;

  // Create hub_location_zone
  const nextHubLocationId = await nextIntegerId('hub_location_zone', 'hub_location_id');
  const { error: hubLocError } = await supabase
    .from('hub_location_zone')
    .insert({
      hub_location_id: nextHubLocationId,
      zone_id: newZoneId,
      hub_location: `SRID=4326;POINT(${effectiveHubLng} ${effectiveHubLat})`,
    });

  if (hubLocError) throw new Error(hubLocError.message);

  // Create hub
  const nextHubId = await nextIntegerId('hubs', 'hub_id');
  const { error: hubError } = await supabase
    .from('hubs')
    .insert({
      hub_id: nextHubId,
      hub_location_id: nextHubLocationId,
      hub_name: `Hub ${nextHubId}`,
      zone_id: newZoneId,
      hub_location: `SRID=4326;POINT(${effectiveHubLng} ${effectiveHubLat})`,
      is_active: true,
    });

  if (hubError) throw new Error(hubError.message);

  revalidatePath('/admin');
  revalidatePath('/admin/infrastructure');
  revalidatePath('/auth/register');
  revalidatePath('/dashboard/profile');
}
