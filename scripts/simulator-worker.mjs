import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');
const TICK_MS = Number(process.env.SIMULATOR_TICK_MS || 3000);
const STEP_DISTANCE_METERS = Number(process.env.SIMULATOR_STEP_METERS || 100);
const RUN_ONCE = process.argv.includes('--once');

function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
  }
}

if (fs.existsSync(ENV_PATH)) loadEnvFile(ENV_PATH);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase env for simulator worker.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ── Resend email client ──────────────────────────────────────────────── */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const FROM_ADDRESS = 'DroneDeliver <onboarding@resend.dev>';

// Track batches we already sent a "no drone" admin alert for so we don't spam
const noDroneAlertedBatches = new Set();

function emailBaseHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
        <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px 32px;">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">🚁 DroneDeliver</h1>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h2 style="margin:0;color:#f1f5f9;font-size:18px;font-weight:600;">${title}</h2>
        </td></tr>
        <tr><td style="padding:12px 32px 28px;color:#94a3b8;font-size:14px;line-height:1.6;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;color:#64748b;font-size:12px;">
          This is an automated notification from DroneDeliver.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function detailsTableHtml(rows) {
  const cells = rows.map(([label, value]) => `<tr>
    <td style="padding:6px 12px;color:#94a3b8;font-size:13px;font-weight:600;white-space:nowrap;">${label}</td>
    <td style="padding:6px 12px;color:#e2e8f0;font-size:13px;">${value}</td>
  </tr>`).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:12px 0;border:1px solid #334155;border-radius:8px;overflow:hidden;width:100%;background:#0f172a;">${cells}</table>`;
}

function pill(text, bg) {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:9999px;background:${bg};color:#fff;font-size:12px;font-weight:600;">${text}</span>`;
}

async function sendEmail(to, subject, html) {
  if (!resend) { console.log(`[email] skipped (no RESEND_API_KEY): ${subject}`); return; }
  try {
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
    if (error) console.error(`[email] failed for ${to}:`, error.message);
    else console.log(`[email] sent to ${to}: ${subject}`);
  } catch (err) {
    console.error(`[email] exception for ${to}:`, err.message);
  }
}

async function notifyDroneTakeoff(sellerEmail, sellerName, orderId, batchId, droneId) {
  const html = emailBaseHtml(
    `Your drone is on its way! ${pill('Out for Delivery', '#6366f1')}`,
    `<p style="color:#e2e8f0;">Hi <strong>${sellerName}</strong>,</p>
     <p>Great news! <strong>Drone #${droneId}</strong> has taken off and is now en route to deliver your package.</p>
     ${detailsTableHtml([['Order ID', `#${orderId}`], ['Batch', `#${batchId}`], ['Drone', `#${droneId}`], ['Status', 'Out for Delivery']])}
     <p>You can track the delivery in real time from your seller dashboard.</p>`
  );
  await sendEmail(sellerEmail, `🚁 Drone #${droneId} has taken off — Order #${orderId}`, html);
}

async function notifyDeliveryComplete(sellerEmail, sellerName, orderId, batchId, droneId) {
  const html = emailBaseHtml(
    `Delivery complete! ${pill('Delivered', '#22c55e')}`,
    `<p style="color:#e2e8f0;">Hi <strong>${sellerName}</strong>,</p>
     <p>Your package has been successfully delivered by <strong>Drone #${droneId}</strong>. ✅</p>
     ${detailsTableHtml([['Order ID', `#${orderId}`], ['Batch', `#${batchId}`], ['Drone', `#${droneId}`], ['Status', 'Delivered']])}
     <p>Thank you for using DroneDeliver!</p>`
  );
  await sendEmail(sellerEmail, `✅ Order #${orderId} delivered successfully`, html);
}

async function notifyNoDroneAvailable(batchId, zoneId, orderCount) {
  if (!ADMIN_EMAIL) { console.log('[email] no ADMIN_EMAIL configured, skipping no-drone alert.'); return; }
  if (noDroneAlertedBatches.has(batchId)) return; // only alert once per batch
  noDroneAlertedBatches.add(batchId);
  const html = emailBaseHtml(
    `⚠️ No drone available ${pill('Action Required', '#ef4444')}`,
    `<p style="color:#e2e8f0;">Hi Admin,</p>
     <p>A batch is ready for dispatch but <strong>no drone is currently available</strong> for assignment.</p>
     ${detailsTableHtml([['Batch ID', `#${batchId}`], ['Zone', zoneId ? `#${zoneId}` : 'Unknown'], ['Orders', `${orderCount}`], ['Status', 'Waiting for drone']])}
     <p style="color:#fbbf24;"><strong>Please allocate a drone manually or ensure drones are returned to available status.</strong></p>`
  );
  await sendEmail(ADMIN_EMAIL, `⚠️ No drone available for Batch #${batchId}`, html);
}

function nowIso() {
  return new Date().toISOString();
}

function parseServerTimestamp(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePoint(point) {
  if (!point) return null;

  if (typeof point === 'string') {
    const match = point.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      return { lng: Number(match[1]), lat: Number(match[2]) };
    }

    if (/^[\da-f]+$/i.test(point.trim()) && point.trim().length >= 42 && point.trim().length % 2 === 0) {
      const trimmed = point.trim();
      const bytes = new Uint8Array(trimmed.length / 2);
      for (let index = 0; index < trimmed.length; index += 2) {
        const value = Number.parseInt(trimmed.slice(index, index + 2), 16);
        if (Number.isNaN(value)) return null;
        bytes[index / 2] = value;
      }

      const view = new DataView(bytes.buffer);
      const littleEndian = view.getUint8(0) === 1;
      let offset = 1;
      let geometryType = view.getUint32(offset, littleEndian);
      offset += 4;

      if ((geometryType & 0x20000000) !== 0) {
        if (bytes.byteLength < offset + 4) return null;
        offset += 4;
        geometryType &= ~0x20000000;
      }

      if (geometryType % 1000 !== 1 || bytes.byteLength < offset + 16) return null;

      const lng = view.getFloat64(offset, littleEndian);
      const lat = view.getFloat64(offset + 8, littleEndian);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return { lng, lat };
    }

    return null;
  }

  if (typeof point === 'object') {
    if (point.type === 'Point' && Array.isArray(point.coordinates) && point.coordinates.length >= 2) {
      return { lng: Number(point.coordinates[0]), lat: Number(point.coordinates[1]) };
    }
    if (typeof point.lng === 'number' && typeof point.lat === 'number') {
      return { lng: point.lng, lat: point.lat };
    }
    if (typeof point.x === 'number' && typeof point.y === 'number') {
      return { lng: point.x, lat: point.y };
    }
  }

  return null;
}

function toPointValue(point) {
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

function distanceBetweenMeters(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const startLat = toRadians(a.lat);
  const endLat = toRadians(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function bearingBetweenDegrees(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destinationPoint(origin, bearingDegrees, distanceMeters) {
  const earthRadius = 6371000;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadius;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

function moveTowardsPoint(from, to, distanceMeters) {
  const totalDistance = distanceBetweenMeters(from, to);
  if (totalDistance <= Number.EPSILON) {
    return {
      point: to,
      traveledMeters: 0,
      reached: true,
    };
  }

  if (distanceMeters >= totalDistance) {
    return {
      point: to,
      traveledMeters: totalDistance,
      reached: true,
    };
  }

  return {
    point: destinationPoint(from, bearingBetweenDegrees(from, to), distanceMeters),
    traveledMeters: distanceMeters,
    reached: false,
  };
}

async function fetchTable(table, select, filters = (query) => query) {
  const result = await filters(supabase.from(table).select(select));
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data ?? [];
}

function getSortedStops(batchId, stopsByBatch) {
  return (stopsByBatch.get(batchId) ?? []).slice().sort((a, b) => a.sequence_no - b.sequence_no);
}

function getPendingStops(batchId, stopsByBatch) {
  return getSortedStops(batchId, stopsByBatch).filter((stop) => !['completed', 'delivered', 'failed'].includes((stop.status ?? '').toLowerCase()));
}

function getHubPoint(hub) {
  return parsePoint(hub?.hub_location ?? null);
}

function getBatchHub(batch, hubsByZone) {
  return (hubsByZone.get(batch.zone_id) ?? [])[0] ?? null;
}

function getBatchOrders(batchId, ordersByBatch) {
  return ordersByBatch.get(batchId) ?? [];
}

function findNearestHub(point, hubs) {
  if (!point || hubs.length === 0) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hub of hubs) {
    const hubPoint = parsePoint(hub.hub_location);
    if (!hubPoint) continue;
    const d = distanceBetweenMeters(point, hubPoint);
    if (d < bestDistance) {
      bestDistance = d;
      best = hub;
    }
  }
  return best;
}

async function updateDroneState(droneId, updates) {
  if (!droneId) return;
  const payload = { ...updates, updated_at: updates.updated_at ?? nowIso() };
  if (payload.last_known_location && typeof payload.last_known_location !== 'string') {
    payload.last_known_location = toPointValue(payload.last_known_location);
  }
  const { error } = await supabase.from('drones').update(payload).eq('drone_id', droneId);
  if (error) throw error;
}

async function recordTrackingPoint(batchId, stopId, position, note) {
  if (!batchId || !position) return;
  const { error } = await supabase.from('batch_tracking_points').insert({
    batch_id: batchId,
    stop_id: stopId ?? null,
    position: toPointValue(position),
    note,
  });
  if (error) throw error;
}

async function ensureBatchStops(batch, ordersByBatch, stopsByBatch) {
  const orders = getBatchOrders(batch.batch_id, ordersByBatch)
    .filter((order) => !['cancelled', 'failed'].includes((order.status ?? '').toLowerCase()))
    .sort((a, b) => a.order_id - b.order_id);
  if (orders.length === 0) return;

  const existingStops = getSortedStops(batch.batch_id, stopsByBatch);
  const existingOrderIds = new Set(existingStops.map((stop) => stop.order_id).filter(Boolean));
  let nextSequence = existingStops.reduce((max, stop) => Math.max(max, Number(stop.sequence_no) || 0), 0) + 1;

  for (const order of orders) {
    if (existingOrderIds.has(order.order_id)) continue;
    const point = parsePoint(order.drop_location);
    if (!point) continue;

    const { data, error } = await supabase.from('batch_stops').insert({
      batch_id: batch.batch_id,
      order_id: order.order_id,
      stop_type: 'delivery',
      sequence_no: nextSequence,
      location: toPointValue(point),
      status: 'pending',
      created_at: nowIso(),
    }).select('stop_id, batch_id, order_id, sequence_no, status, location').single();
    if (error) throw error;

    const stopList = stopsByBatch.get(batch.batch_id) ?? [];
    stopList.push(data);
    stopsByBatch.set(batch.batch_id, stopList);
    existingOrderIds.add(order.order_id);
    nextSequence += 1;
    console.log(`[repair] Added missing stop for Order #${order.order_id} in Batch #${batch.batch_id}.`);
  }
}

async function deleteEmptyBatch(batch, ordersByBatch, stopsByBatch) {
  const orderCount = getBatchOrders(batch.batch_id, ordersByBatch).length;
  const stopCount = getSortedStops(batch.batch_id, stopsByBatch).length;
  if (orderCount > 0 || stopCount > 0) return false;

  const { error } = await supabase.from('delivery_batches').delete().eq('batch_id', batch.batch_id);
  if (error) throw error;
  console.log(`[cleanup] Deleted empty Batch #${batch.batch_id}.`);
  return true;
}

async function markBatchReady(batch) {
  const timestamp = nowIso();
  const { error } = await supabase.from('delivery_batches').update({ status: 'ready', updated_at: timestamp }).eq('batch_id', batch.batch_id);
  if (error) throw error;
  batch.status = 'ready';
  console.log(`[ready] Batch #${batch.batch_id} is now ready.`);
}

async function optimizeBatchRoute(batch, stopsByBatch, ordersById, hubsByZone) {
  const stops = (stopsByBatch.get(batch.batch_id) ?? []).filter(s => (s.status ?? '').toLowerCase() === 'pending');
  if (stops.length <= 1) return;

  const zoneHubs = hubsByZone.get(batch.zone_id) ?? [];
  const startHub = getBatchHub(batch, hubsByZone) ?? zoneHubs[0];
  const startPoint = getHubPoint(startHub);
  if (!startPoint) return;

  const stopPoints = stops.map(stop => {
    return {
      stop,
      point: getStopTargetPoint(stop, ordersById)
    };
  }).filter(s => Boolean(s.point));

  if (stopPoints.length <= 1) return;

  const n = stopPoints.length;
  
  const dist = Array(n).fill(0).map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      dist[i][j] = distanceBetweenMeters(stopPoints[i].point, stopPoints[j].point);
    }
  }

  const startDist = new Float64Array(n);
  for (let i = 0; i < n; i++) startDist[i] = distanceBetweenMeters(startPoint, stopPoints[i].point);

  const returnDist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nearestReturn = findNearestHub(stopPoints[i].point, zoneHubs) ?? zoneHubs[0];
    const returnPoint = nearestReturn ? getHubPoint(nearestReturn) : null;
    returnDist[i] = returnPoint ? distanceBetweenMeters(stopPoints[i].point, returnPoint) : 0;
  }

  const memo = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(-1));
  const nextNode = Array.from({ length: 1 << n }, () => new Int32Array(n).fill(-1));

  function solve(mask, u) {
    if (mask === (1 << n) - 1) return returnDist[u];
    if (memo[mask][u] !== -1) return memo[mask][u];

    let ans = Number.POSITIVE_INFINITY;
    let bestNext = -1;

    for (let v = 0; v < n; v++) {
      if ((mask & (1 << v)) === 0) {
        const cost = dist[u][v] + solve(mask | (1 << v), v);
        if (cost < ans) {
          ans = cost;
          bestNext = v;
        }
      }
    }
    nextNode[mask][u] = bestNext;
    return memo[mask][u] = ans;
  }

  let bestCost = Number.POSITIVE_INFINITY;
  let firstNode = -1;

  for (let i = 0; i < n; i++) {
    const cost = startDist[i] + solve(1 << i, i);
    if (cost < bestCost) {
      bestCost = cost;
      firstNode = i;
    }
  }

  const bestOrder = [];
  let currMask = 1 << firstNode;
  let currNode = firstNode;

  while(currNode !== -1) {
    bestOrder.push(stopPoints[currNode]);
    const nxt = nextNode[currMask][currNode];
    if (nxt === -1) break;
    currMask |= (1 << nxt);
    currNode = nxt;
  }

  if (bestOrder.length > 0) {
    for (let i = 0; i < bestOrder.length; i++) {
      const stop = bestOrder[i].stop;
      const newSequenceNo = i + 1;
      if (stop.sequence_no !== newSequenceNo) {
        await supabase.from('batch_stops').update({ sequence_no: newSequenceNo + 1000 }).eq('stop_id', stop.stop_id);
      }
    }
    for (let i = 0; i < bestOrder.length; i++) {
      const stop = bestOrder[i].stop;
      const newSequenceNo = i + 1;
      if (stop.sequence_no !== newSequenceNo) {
        stop.sequence_no = newSequenceNo;
        const { error } = await supabase.from('batch_stops').update({ sequence_no: newSequenceNo }).eq('stop_id', stop.stop_id);
        if (error) console.error(`[optimize] Error: ${error.message}`);
      }
    }
    console.log(`[optimize] Batch #${batch.batch_id} TSP route optimized (${stops.length} stops).`);
  }
}

async function assignDrone(batch, drones, hubZones, hubsByZone, modelsById, ordersByBatch, stopsByBatch, allBatches, ordersById) {
  const timestamp = nowIso();
  const preferred = drones.find((drone) => hubZones.get(drone.current_hub_id) === batch.zone_id) ?? drones[0] ?? null;
  if (!preferred) return null;

  const maxCapacity = modelsById.get(preferred.model_id)?.max_capacity ?? Number.POSITIVE_INFINITY;
  const batchOrders = (ordersByBatch.get(batch.batch_id) ?? []).slice().sort((a, b) => a.order_id - b.order_id);
  
  let currentWeight = 0;
  const keptOrders = [];
  const overflowOrders = [];
  
  for (const order of batchOrders) {
    if (currentWeight + (order.package_weight ?? 0) <= maxCapacity || keptOrders.length === 0) {
      currentWeight += (order.package_weight ?? 0);
      keptOrders.push(order);
    } else {
      overflowOrders.push(order);
    }
  }

  if (overflowOrders.length > 0) {
    const { data: latestBatch } = await supabase.from('delivery_batches').select('batch_id').order('batch_id', { ascending: false }).limit(1);
    const newBatchId = (latestBatch?.[0]?.batch_id ?? 0) + 1;
    
    // Slight offset to bypass indexing limits for cloned collect batches if they still retained them
    const newStart = new Date(new Date(batch.collection_window_start).getTime() + 1).toISOString();
    const newEnd = new Date(new Date(batch.collection_window_end).getTime() + 1).toISOString();

    const { error: cloneError } = await supabase.from('delivery_batches').insert({
      batch_id: newBatchId,
      zone_id: batch.zone_id,
      status: 'ready',
      drone_id: null,
      collection_window_start: newStart,
      collection_window_end: newEnd,
      created_at: timestamp,
      updated_at: timestamp,
    });
    if (cloneError) console.error(`[capacity] Error creating overflow batch:`, cloneError.message);
    
    const overflowIds = overflowOrders.map(o => o.order_id);
    await supabase.from('orders').update({ batch_id: newBatchId }).in('order_id', overflowIds);
    await supabase.from('batch_stops').update({ batch_id: newBatchId }).in('order_id', overflowIds);
    
    ordersByBatch.set(batch.batch_id, keptOrders);
    ordersByBatch.set(newBatchId, overflowOrders);
    
    const batchStops = stopsByBatch.get(batch.batch_id) ?? [];
    const keptStops = batchStops.filter(s => s.order_id === null || !overflowIds.includes(s.order_id));
    const overflowStops = batchStops.filter(s => s.order_id && overflowIds.includes(s.order_id));
    stopsByBatch.set(batch.batch_id, keptStops);
    stopsByBatch.set(newBatchId, overflowStops);
    
    allBatches.push({
      ...batch,
      batch_id: newBatchId,
      status: 'ready',
      drone_id: null,
      hub_id: null
    });
    
    console.log(`[capacity] Split Batch #${batch.batch_id}. ${keptOrders.length} kept (${currentWeight}kg), ${overflowOrders.length} overflowed to Batch #${newBatchId}`);
  }

  const currentHub = (hubsByZone.get(batch.zone_id) ?? []).find((hub) => hub.hub_id === preferred.current_hub_id) ?? getBatchHub(batch, hubsByZone);
  const currentPoint = parsePoint(preferred.last_known_location) ?? getHubPoint(currentHub);

  const { error: batchError } = await supabase.from('delivery_batches').update({
    drone_id: preferred.drone_id,
    hub_id: currentHub?.hub_id ?? batch.hub_id ?? null,
    status: 'assigned',
    updated_at: timestamp,
  }).eq('batch_id', batch.batch_id);
  if (batchError) throw batchError;

  await updateDroneState(preferred.drone_id, {
    status: 'assigned',
    last_known_location: currentPoint,
    last_seen_at: timestamp,
    ...(currentHub ? { current_hub_id: currentHub.hub_id } : {}),
  });

  const { error: orderError } = await supabase.from('orders').update({ status: 'assigned', assigned_at: timestamp, updated_at: timestamp }).eq('batch_id', batch.batch_id);
  if (orderError) throw orderError;

  batch.drone_id = preferred.drone_id;
  batch.hub_id = currentHub?.hub_id ?? batch.hub_id ?? null;
  batch.hub_id = currentHub?.hub_id ?? batch.hub_id ?? null;
  batch.status = 'assigned';
  preferred.status = 'assigned';
  preferred.last_known_location = currentPoint ? toPointValue(currentPoint) : preferred.last_known_location;
  console.log(`[assign] Drone #${preferred.drone_id} -> Batch #${batch.batch_id}`);

  // TSP routing mathematically executed after load is finalized
  await optimizeBatchRoute(batch, stopsByBatch, ordersById, hubsByZone);

  return preferred.drone_id;
}

async function startBatch(batch, dronesById, ordersByBatch, sellersById) {
  if (!batch.drone_id) return false;
  const timestamp = nowIso();
  const { error: batchError } = await supabase.from('delivery_batches').update({ status: 'in_progress', dispatched_at: timestamp, updated_at: timestamp }).eq('batch_id', batch.batch_id);
  if (batchError) throw batchError;

  const drone = dronesById.get(batch.drone_id) ?? null;
  await updateDroneState(batch.drone_id, {
    status: 'en_route',
    last_known_location: parsePoint(drone?.last_known_location) ?? null,
    last_seen_at: timestamp,
  });

  const { error: orderError } = await supabase.from('orders').update({ status: 'out_for_delivery', updated_at: timestamp }).eq('batch_id', batch.batch_id).neq('status', 'delivered');
  if (orderError) throw orderError;

  batch.status = 'in_progress';
  batch.dispatched_at = timestamp;
  console.log(`[launch] Batch #${batch.batch_id} is now in progress.`);

  // ── Email sellers: drone has taken off ──
  const batchOrders = ordersByBatch?.get(batch.batch_id) ?? [];
  for (const order of batchOrders) {
    const seller = sellersById?.get(order.seller_id);
    if (seller?.email) {
      notifyDroneTakeoff(seller.email, seller.name || `Seller #${seller.seller_id}`, order.order_id, batch.batch_id, batch.drone_id)
        .catch((e) => console.error('[email] takeoff bg error:', e.message));
    }
  }

  return true;
}

function getStopTargetPoint(stop, ordersById) {
  const order = stop.order_id ? ordersById.get(stop.order_id) ?? null : null;
  return parsePoint(stop.location) ?? parsePoint(order?.drop_location ?? null);
}

function getDronePointForBatch(batch, dronesById, hubsByZone) {
  if (!batch.drone_id) return getHubPoint(getBatchHub(batch, hubsByZone));
  const drone = dronesById.get(batch.drone_id) ?? null;
  return parsePoint(drone?.last_known_location) ?? getHubPoint(getBatchHub(batch, hubsByZone));
}

function syncDroneCache(drone, position, status, timestamp, currentHubId) {
  if (!drone) return;
  if (position) drone.last_known_location = toPointValue(position);
  if (status) drone.status = status;
  if (timestamp) drone.last_seen_at = timestamp;
  if (currentHubId) drone.current_hub_id = currentHubId;
}

async function updateDroneProgress(batch, dronesById, position, status, note, stopId = null, currentHubId = null) {
  if (!batch.drone_id || !position) return;
  const timestamp = nowIso();
  await updateDroneState(batch.drone_id, {
    status,
    last_known_location: position,
    last_seen_at: timestamp,
    ...(currentHubId ? { current_hub_id: currentHubId } : {}),
  });
  if (note) await recordTrackingPoint(batch.batch_id, stopId, position, note);
  syncDroneCache(dronesById.get(batch.drone_id) ?? null, position, status, timestamp, currentHubId);
}

async function setStopEnRoute(stop, batch) {
  if ((stop.status ?? '').toLowerCase() === 'en_route') return;
  const timestamp = nowIso();
  const { error: stopError } = await supabase.from('batch_stops').update({ status: 'en_route', eta_at: timestamp }).eq('stop_id', stop.stop_id);
  if (stopError) throw stopError;
  stop.status = 'en_route';
  stop.eta_at = timestamp;
  console.log(`[travel] Batch #${batch.batch_id} heading to stop ${stop.sequence_no}.`);
}

async function finalizeBatch(batch, finalPoint, hubsByZone, allBatches, dronesById) {
  const timestamp = nowIso();
  const zoneHubs = hubsByZone.get(batch.zone_id) ?? [];
  const returnHub = findNearestHub(finalPoint, zoneHubs) ?? zoneHubs[0] ?? null;

  const { error: batchError } = await supabase.from('delivery_batches').update({ status: 'completed', completed_at: timestamp, updated_at: timestamp }).eq('batch_id', batch.batch_id);
  if (batchError) throw batchError;

  if (batch.drone_id) {
    const droneStillBusy = allBatches.some((otherBatch) =>
      otherBatch.batch_id !== batch.batch_id
      && otherBatch.drone_id === batch.drone_id
      && ['collecting', 'ready', 'assigned', 'in_progress'].includes(otherBatch.status)
    );

    const returnPoint = getHubPoint(returnHub) ?? finalPoint ?? parsePoint(dronesById.get(batch.drone_id)?.last_known_location ?? null);
    await updateDroneState(batch.drone_id, {
      status: droneStillBusy ? 'en_route' : 'available',
      last_known_location: returnPoint,
      last_seen_at: timestamp,
      ...(returnHub && !droneStillBusy ? { current_hub_id: returnHub.hub_id } : {}),
    });
    if (returnPoint) await recordTrackingPoint(batch.batch_id, null, returnPoint, returnHub ? `Returned to Hub #${returnHub.hub_id}` : 'Returned');

    const drone = dronesById.get(batch.drone_id);
    if (drone) {
      syncDroneCache(drone, returnPoint, droneStillBusy ? 'en_route' : 'available', timestamp, returnHub && !droneStillBusy ? returnHub.hub_id : null);
    }
  }

  batch.status = 'completed';
  batch.completed_at = timestamp;
  console.log(`[complete] Batch #${batch.batch_id} finished.${returnHub ? ` Drone reached Hub #${returnHub.hub_id}.` : ''}`);
}

async function completeStop(batch, stop, destinationPoint, sellersById, dronesById, ordersById) {
  const timestamp = nowIso();
  const deliveredOrder = stop.order_id ? ordersById.get(stop.order_id) ?? null : null;

  const { error: stopError } = await supabase.from('batch_stops').update({ status: 'completed', arrived_at: timestamp, completed_at: timestamp }).eq('stop_id', stop.stop_id);
  if (stopError) throw stopError;

  if (stop.order_id) {
    const { error: orderError } = await supabase.from('orders').update({ status: 'delivered', delivered_at: timestamp, updated_at: timestamp }).eq('order_id', stop.order_id);
    if (orderError) throw orderError;
    if (deliveredOrder) {
      deliveredOrder.status = 'delivered';
      deliveredOrder.delivered_at = timestamp;
      deliveredOrder.updated_at = timestamp;
    }

    // ── Email seller: order delivered ──
    if (deliveredOrder && sellersById) {
      const seller = sellersById.get(deliveredOrder.seller_id);
      if (seller?.email) {
        notifyDeliveryComplete(seller.email, seller.name || `Seller #${seller.seller_id}`, stop.order_id, batch.batch_id, batch.drone_id || 0)
          .catch((e) => console.error('[email] delivery-complete bg error:', e.message));
      }
    }
  }

  if (destinationPoint) {
    await updateDroneProgress(batch, dronesById, destinationPoint, 'en_route', `Completed stop ${stop.sequence_no}`, stop.stop_id);
  }

  stop.status = 'completed';
  stop.arrived_at = timestamp;
  stop.completed_at = timestamp;
  console.log(`[delivery] Batch #${batch.batch_id} completed stop ${stop.sequence_no}.`);
}

async function advanceBatchAlongRoute(batch, stopsByBatch, ordersById, ordersByBatch, hubsByZone, allBatches, dronesById, sellersById) {
  let currentPoint = getDronePointForBatch(batch, dronesById, hubsByZone);
  if (!currentPoint) {
    const lastDeliveredPoint = getBatchOrders(batch.batch_id, ordersByBatch)
      .map((order) => parsePoint(order.drop_location))
      .filter(Boolean)
      .at(-1) ?? null;
    await finalizeBatch(batch, lastDeliveredPoint, hubsByZone, allBatches, dronesById);
    return;
  }

  let remainingMeters = STEP_DISTANCE_METERS;
  while (remainingMeters > 0.01) {
    const pendingStops = getPendingStops(batch.batch_id, stopsByBatch);
    if (pendingStops.length === 0) {
      const zoneHubs = hubsByZone.get(batch.zone_id) ?? [];
      const returnHub = findNearestHub(currentPoint, zoneHubs) ?? zoneHubs[0] ?? null;
      const returnPoint = getHubPoint(returnHub);
      if (!returnPoint) {
        await finalizeBatch(batch, currentPoint, hubsByZone, allBatches, dronesById);
        return;
      }

      const step = moveTowardsPoint(currentPoint, returnPoint, remainingMeters);
      currentPoint = step.point;
      remainingMeters = Math.max(0, remainingMeters - step.traveledMeters);

      if (step.reached) {
        await finalizeBatch(batch, returnPoint, hubsByZone, allBatches, dronesById);
        return;
      }

      const remainingToHub = Math.max(0, Math.round(distanceBetweenMeters(currentPoint, returnPoint)));
      await updateDroneProgress(
        batch,
        dronesById,
        currentPoint,
        'returning',
        `Returning to Hub #${returnHub?.hub_id ?? '—'} · ${remainingToHub}m left`
      );
      break;
    }

    const activeStop = pendingStops.find((stop) => (stop.status ?? '').toLowerCase() === 'en_route') ?? pendingStops[0];
    const targetPoint = getStopTargetPoint(activeStop, ordersById);
    if (!targetPoint) {
      console.warn(`[travel] Missing coordinates for stop ${activeStop.stop_id} in Batch #${batch.batch_id}.`);
      break;
    }

    await setStopEnRoute(activeStop, batch);

    const step = moveTowardsPoint(currentPoint, targetPoint, remainingMeters);
    currentPoint = step.point;
    remainingMeters = Math.max(0, remainingMeters - step.traveledMeters);

    if (step.reached) {
      await completeStop(batch, activeStop, targetPoint, sellersById, dronesById, ordersById);
      continue;
    }

    const remainingToStop = Math.max(0, Math.round(distanceBetweenMeters(currentPoint, targetPoint)));
    await updateDroneProgress(
      batch,
      dronesById,
      currentPoint,
      'en_route',
      `Heading to stop ${activeStop.sequence_no} · ${remainingToStop}m left`,
      activeStop.stop_id
    );
    break;
  }
}

async function tick() {
  const timestamp = new Date();
  console.log(`\n[tick] ${timestamp.toISOString()}`);

  const [batches, orders, stops, drones, hubs, hubLocations, sellers, models] = await Promise.all([
    fetchTable('delivery_batches', 'batch_id, zone_id, hub_id, drone_id, status, collection_window_start, collection_window_end, dispatched_at, completed_at, updated_at', (query) => query.in('status', ['collecting', 'ready', 'assigned', 'in_progress'])),
    fetchTable('orders', 'order_id, seller_id, batch_id, zone_id, drop_location, package_weight, status, updated_at, assigned_at, delivered_at', (query) => query.not('batch_id', 'is', null)),
    fetchTable('batch_stops', 'stop_id, batch_id, order_id, sequence_no, status, location, eta_at, arrived_at, completed_at'),
    fetchTable('drones', 'drone_id, model_id, current_hub_id, home_hub_id, zone_id, status, last_known_location, last_seen_at'),
    fetchTable('hubs', 'hub_id, hub_location_id, zone_id, hub_location'),
    fetchTable('hub_location_zone', 'hub_location_id, hub_location, zone_id'),
    fetchTable('sellers', 'seller_id, name, email'),
    fetchTable('models', 'model_id, max_capacity'),
  ]);

  const hubLocationsById = new Map(hubLocations.map((row) => [row.hub_location_id, row]));
  const hydratedHubs = hubs
    .map((hub) => ({ ...hub, ...(hubLocationsById.get(hub.hub_location_id) ?? {}) }))
    .filter((hub) => hub.zone_id || hub.hub_location);
  const hubsByZone = new Map();
  for (const hub of hydratedHubs) {
    const list = hubsByZone.get(hub.zone_id) ?? [];
    list.push(hub);
    hubsByZone.set(hub.zone_id, list);
  }

  const hubZones = new Map(hydratedHubs.map((hub) => [hub.hub_id, hub.zone_id]));
  const modelsById = new Map(models.map((m) => [m.model_id, m]));
  const ordersById = new Map(orders.map((order) => [order.order_id, order]));
  const ordersByBatch = new Map();
  for (const order of orders) {
    const list = ordersByBatch.get(order.batch_id) ?? [];
    list.push(order);
    ordersByBatch.set(order.batch_id, list);
  }

  const stopsByBatch = new Map();
  for (const stop of stops) {
    const list = stopsByBatch.get(stop.batch_id) ?? [];
    list.push(stop);
    stopsByBatch.set(stop.batch_id, list);
  }

  const dronesById = new Map(drones.map((drone) => [drone.drone_id, drone]));
  const sellersById = new Map(sellers.map((seller) => [seller.seller_id, seller]));

  for (const batch of batches) {
    await ensureBatchStops(batch, ordersByBatch, stopsByBatch);
  }

  for (const batch of [...batches]) {
    if (await deleteEmptyBatch(batch, ordersByBatch, stopsByBatch)) {
      const index = batches.findIndex((item) => item.batch_id === batch.batch_id);
      if (index >= 0) batches.splice(index, 1);
    }
  }

  for (const batch of batches) {
    const collectionWindowEnd = parseServerTimestamp(batch.collection_window_end);
    if (batch.status === 'collecting' && collectionWindowEnd && collectionWindowEnd <= timestamp) {
      if (getBatchOrders(batch.batch_id, ordersByBatch).length === 0) {
        if (await deleteEmptyBatch(batch, ordersByBatch, stopsByBatch)) continue;
      }
      await markBatchReady(batch);
    }
  }

  const reservedDroneIds = new Set(
    batches
      .filter((item) => ['ready', 'assigned', 'in_progress'].includes(item.status) && item.drone_id)
      .map((item) => item.drone_id)
  );

  const availableDrones = drones.filter((drone) => drone.status === 'available' && !reservedDroneIds.has(drone.drone_id));
  for (const batch of batches.filter((item) => item.status === 'ready' && !item.drone_id)) {
    const assignedDroneId = await assignDrone(batch, availableDrones, hubZones, hubsByZone, modelsById, ordersByBatch, stopsByBatch, batches, ordersById);
    if (!assignedDroneId) {
      console.log(`[wait] Batch #${batch.batch_id} is ready but no drone is available.`);
      // ── Email admin: no drone available ──
      const batchOrderCount = getBatchOrders(batch.batch_id, ordersByBatch).length;
      notifyNoDroneAvailable(batch.batch_id, batch.zone_id, batchOrderCount)
        .catch((e) => console.error('[email] no-drone bg error:', e.message));
      continue;
    }
    const index = availableDrones.findIndex((drone) => drone.drone_id === assignedDroneId);
    if (index >= 0) availableDrones.splice(index, 1);
  }

  for (const batch of batches.filter((item) => (item.status === 'ready' || item.status === 'assigned') && item.drone_id)) {
    const pendingStops = getPendingStops(batch.batch_id, stopsByBatch);
    if (pendingStops.length === 0) {
      const lastPoint = getBatchOrders(batch.batch_id, ordersByBatch).map((order) => parsePoint(order.drop_location)).filter(Boolean).at(-1) ?? null;
      await finalizeBatch(batch, lastPoint, hubsByZone, batches, dronesById);
      continue;
    }
    await startBatch(batch, dronesById, ordersByBatch, sellersById);
  }

  for (const batch of batches.filter((item) => item.status === 'in_progress')) {
    await advanceBatchAlongRoute(batch, stopsByBatch, ordersById, ordersByBatch, hubsByZone, batches, dronesById, sellersById);
  }
}

async function main() {
  console.log(`[simulator] starting worker with ${TICK_MS}ms ticks and ${STEP_DISTANCE_METERS}m movement steps.`);

  if (RUN_ONCE) {
    await tick();
    return;
  }

  while (true) {
    const tickStartedAt = Date.now();

    await tick().catch((error) => {
      console.error('[simulator] tick failed:', error.message);
    });

    const elapsedMs = Date.now() - tickStartedAt;
    const delayMs = Math.max(0, TICK_MS - elapsedMs);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

main().catch((error) => {
  console.error('[simulator] fatal:', error.message);
  process.exit(1);
});
