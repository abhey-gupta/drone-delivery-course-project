import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');

const DEFAULT_TARGET_EMAIL = 'b23391@students.iitmandi.ac.in';
const DEFAULT_PRIMARY_COUNT = 5;
const DEFAULT_SECONDARY_COUNT = 2;
const DEFAULT_SECONDARY_ZONES = 1;
const DEFAULT_WINDOW_MINUTES = 10;

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

function parseArgs(argv) {
  const options = {
    dryRun: false,
    mode: 'ready',
    targetEmail: DEFAULT_TARGET_EMAIL,
    primaryCount: DEFAULT_PRIMARY_COUNT,
    secondaryCount: DEFAULT_SECONDARY_COUNT,
    secondaryZones: DEFAULT_SECONDARY_ZONES,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length).trim().toLowerCase();
      if (value === 'ready' || value === 'collecting') {
        options.mode = value;
        continue;
      }
      throw new Error(`Unsupported mode "${value}". Use --mode=ready or --mode=collecting.`);
    }

    if (arg.startsWith('--target-email=')) {
      options.targetEmail = arg.slice('--target-email='.length).trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--primary-count=')) {
      options.primaryCount = parsePositiveInteger(arg.slice('--primary-count='.length), '--primary-count');
      continue;
    }

    if (arg.startsWith('--secondary-count=')) {
      options.secondaryCount = parsePositiveInteger(arg.slice('--secondary-count='.length), '--secondary-count');
      continue;
    }

    if (arg.startsWith('--secondary-zones=')) {
      options.secondaryZones = parseNonNegativeInteger(arg.slice('--secondary-zones='.length), '--secondary-zones');
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(rawValue, flagName) {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  return value;
}

function parseNonNegativeInteger(rawValue, flagName) {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative integer.`);
  }
  return value;
}

function parsePoint(point) {
  if (!point) return null;

  if (typeof point === 'string') {
    const match = point.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      return { lng: Number(match[1]), lat: Number(match[2]) };
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

function parseHexZoneBoundary(raw) {
  if (!raw || typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw);
    const center = parsePoint(parsed.center);
    if (!center || typeof parsed.radiusMeters !== 'number') return null;

    return {
      label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : 'Zone',
      center,
      radiusMeters: parsed.radiusMeters,
    };
  } catch {
    return null;
  }
}

function toPointValue(point) {
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
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

function seededUnit(seed, key) {
  const value = Math.sin(seed * 12.9898 + key * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function seededBetween(seed, key, min, max) {
  return min + seededUnit(seed, key) * (max - min);
}

function buildDropPoints(zoneBoundary, count, seed, profile) {
  const primaryBearings = [18, 86, 152, 223, 307, 46, 122, 188, 267, 338];
  const secondaryBearings = [42, 208, 318, 132, 272, 18];
  const primaryDistances = [1200, 2200, 1750, 2600, 1450, 2950, 2050, 2400, 1650, 2850];
  const secondaryDistances = [1500, 2500, 1900, 2300, 1700, 2100];

  const bearings = profile === 'primary' ? primaryBearings : secondaryBearings;
  const distances = profile === 'primary' ? primaryDistances : secondaryDistances;
  const maxDistance = zoneBoundary.radiusMeters * 0.72;

  return Array.from({ length: count }, (_, index) => {
    const baseBearing = bearings[index % bearings.length];
    const baseDistance = distances[index % distances.length];
    const bearing = baseBearing + seededBetween(seed, index + 1, -11, 11);
    const distance = Math.min(maxDistance, Math.max(700, baseDistance + seededBetween(seed, index + 101, -180, 180)));

    return destinationPoint(zoneBoundary.center, bearing, distance);
  });
}

function buildWeights(count, profile) {
  const template = profile === 'primary'
    ? [0.7, 0.9, 0.8, 0.6, 0.9, 0.5, 0.7]
    : [1.1, 0.8, 0.9, 1.2];

  return Array.from({ length: count }, (_, index) => template[index % template.length]);
}

function buildCollectionWindow(mode, zoneOffset) {
  const now = Date.now();
  if (mode === 'ready') {
    return {
      start: new Date(now - 12 * 60 * 1000 + zoneOffset).toISOString(),
      end: new Date(now - 2 * 60 * 1000 + zoneOffset).toISOString(),
    };
  }

  return {
    start: new Date(now - 60 * 1000 + zoneOffset).toISOString(),
    end: new Date(now + (DEFAULT_WINDOW_MINUTES - 1) * 60 * 1000 + zoneOffset).toISOString(),
  };
}

async function nextIntegerId(supabase, table, idColumn) {
  const { data, error } = await supabase
    .from(table)
    .select(idColumn)
    .order(idColumn, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`${table}: ${error.message}`);

  const row = data ?? null;
  const max = row ? Number(row[idColumn]) : 0;
  return (Number.isFinite(max) ? max : 0) + 1;
}

async function fetchContext(supabase) {
  const [{ data: sellers, error: sellersError }, { data: stores, error: storesError }, { data: zones, error: zonesError }] = await Promise.all([
    supabase.from('sellers').select('seller_id, name, email, store_location_id').order('seller_id', { ascending: true }),
    supabase.from('store_location_zone').select('store_location_id, zone_id, store_location'),
    supabase.from('zones').select('zone_id, boundary_coordinates_ref').order('zone_id', { ascending: true }),
  ]);

  if (sellersError) throw new Error(`sellers: ${sellersError.message}`);
  if (storesError) throw new Error(`store_location_zone: ${storesError.message}`);
  if (zonesError) throw new Error(`zones: ${zonesError.message}`);

  const storesById = new Map((stores ?? []).map((store) => [store.store_location_id, store]));
  const zonesById = new Map((zones ?? []).map((zone) => [zone.zone_id, zone]));

  return (sellers ?? []).map((seller) => {
    const store = storesById.get(seller.store_location_id) ?? null;
    const zone = store ? zonesById.get(store.zone_id) ?? null : null;
    const boundary = zone ? parseHexZoneBoundary(zone.boundary_coordinates_ref) : null;

    return {
      sellerId: seller.seller_id,
      name: seller.name?.trim() || `Seller #${seller.seller_id}`,
      email: seller.email?.trim().toLowerCase() || '',
      storeLocationId: seller.store_location_id,
      storePoint: parsePoint(store?.store_location ?? null),
      zoneId: store?.zone_id ?? null,
      zoneLabel: boundary?.label ?? `Zone ${store?.zone_id ?? 'Unknown'}`,
      zoneBoundary: boundary,
    };
  });
}

function buildSeedPlan(contexts, options) {
  const targetSeller = contexts.find((seller) => seller.email === options.targetEmail) ?? null;
  if (!targetSeller) {
    throw new Error(`Target seller ${options.targetEmail} was not found in Supabase.`);
  }
  if (!targetSeller.zoneId || !targetSeller.zoneBoundary) {
    throw new Error(`Target seller ${options.targetEmail} does not have a usable zone assignment.`);
  }

  const plans = [
    {
      seller: targetSeller,
      orderCount: options.primaryCount,
      profile: 'primary',
      purpose: 'Primary TSP batch and email demo',
    },
  ];

  const secondaryCandidates = contexts
    .filter((seller) => seller.sellerId !== targetSeller.sellerId && seller.zoneId && seller.zoneBoundary)
    .sort((left, right) => {
      if ((left.zoneId ?? 0) !== (right.zoneId ?? 0)) return (left.zoneId ?? 0) - (right.zoneId ?? 0);
      return left.sellerId - right.sellerId;
    });

  const pickedZoneIds = new Set([targetSeller.zoneId]);
  for (const seller of secondaryCandidates) {
    if (plans.length > options.secondaryZones) break;
    if (pickedZoneIds.has(seller.zoneId)) continue;

    plans.push({
      seller,
      orderCount: options.secondaryCount,
      profile: 'secondary',
      purpose: 'Supporting cross-zone demo orders',
    });
    pickedZoneIds.add(seller.zoneId);
  }

  return plans;
}

async function createBatchAndOrders(supabase, plan, options, zoneOffset, runSeed, idAllocator) {
  const window = buildCollectionWindow(options.mode, zoneOffset);
  const batchId = idAllocator.nextBatchId;
  idAllocator.nextBatchId += 1;
  const createdAt = new Date().toISOString();

  const dropPoints = buildDropPoints(plan.seller.zoneBoundary, plan.orderCount, runSeed + plan.seller.sellerId * 17, plan.profile);
  const weights = buildWeights(plan.orderCount, plan.profile);

  const batchPayload = {
    batch_id: batchId,
    zone_id: plan.seller.zoneId,
    hub_id: null,
    drone_id: null,
    status: 'collecting',
    collection_window_start: window.start,
    collection_window_end: window.end,
    created_at: createdAt,
    updated_at: createdAt,
  };

  const orderPayloads = [];
  const stopPayloads = [];

  for (let index = 0; index < plan.orderCount; index += 1) {
    const orderId = idAllocator.nextOrderId;
    idAllocator.nextOrderId += 1;
    const point = dropPoints[index];
    const now = new Date().toISOString();

    orderPayloads.push({
      order_id: orderId,
      seller_id: plan.seller.sellerId,
      zone_id: plan.seller.zoneId,
      batch_id: batchId,
      package_weight: weights[index],
      drop_location: toPointValue(point),
      status: 'batched',
      created_at: now,
      updated_at: now,
    });

    stopPayloads.push({
      batch_id: batchId,
      order_id: orderId,
      stop_type: 'delivery',
      sequence_no: index + 1,
      location: toPointValue(point),
      status: 'pending',
      created_at: now,
    });
  }

  if (options.dryRun) {
    return {
      batchPayload,
      orderPayloads,
      stopPayloads,
    };
  }

  const { error: batchError } = await supabase.from('delivery_batches').insert(batchPayload);
  if (batchError) throw new Error(`delivery_batches: ${batchError.message}`);

  const { error: ordersError } = await supabase.from('orders').insert(orderPayloads);
  if (ordersError) throw new Error(`orders: ${ordersError.message}`);

  const { error: stopsError } = await supabase.from('batch_stops').insert(stopPayloads);
  if (stopsError) throw new Error(`batch_stops: ${stopsError.message}`);

  return {
    batchPayload,
    orderPayloads,
    stopPayloads,
  };
}

function printSummary(plans, results, options) {
  const summary = plans.map((plan, index) => {
    const result = results[index];
    return {
      sellerId: plan.seller.sellerId,
      sellerName: plan.seller.name,
      sellerEmail: plan.seller.email,
      zoneId: plan.seller.zoneId,
      zoneLabel: plan.seller.zoneLabel,
      purpose: plan.purpose,
      batchId: result.batchPayload.batch_id,
      batchStatus: result.batchPayload.status,
      collectionWindowStart: result.batchPayload.collection_window_start,
      collectionWindowEnd: result.batchPayload.collection_window_end,
      orderIds: result.orderPayloads.map((order) => order.order_id),
      weightsKg: result.orderPayloads.map((order) => order.package_weight),
    };
  });

  console.log(JSON.stringify({
    dryRun: options.dryRun,
    mode: options.mode,
    nextStep: options.mode === 'ready'
      ? 'Run `npm run sim:once` or keep the worker running to dispatch these batches immediately.'
      : 'Wait for the collection window to close, then run `npm run sim:once` or keep the worker running.',
    batches: summary,
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (fs.existsSync(ENV_PATH)) {
    loadEnvFile(ENV_PATH);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const contexts = await fetchContext(supabase);
  const plans = buildSeedPlan(contexts, options);
  const runSeed = Date.now();
  const idAllocator = {
    nextBatchId: await nextIntegerId(supabase, 'delivery_batches', 'batch_id'),
    nextOrderId: await nextIntegerId(supabase, 'orders', 'order_id'),
  };

  const results = [];
  for (let index = 0; index < plans.length; index += 1) {
    const zoneOffset = index * 1000;
    const result = await createBatchAndOrders(supabase, plans[index], options, zoneOffset, runSeed + index * 100, idAllocator);
    results.push(result);
  }

  printSummary(plans, results, options);
}

main().catch((error) => {
  console.error(`[demo-seed] ${error.message}`);
  process.exit(1);
});
