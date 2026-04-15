import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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
loadEnvFile('.env.local');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parsePoint(point) {
  if (!point) return null;
  if (typeof point === 'string') {
    const match = point.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) return { lng: Number(match[1]), lat: Number(match[2]) };
    if (/^[\da-f]+$/i.test(point.trim()) && point.trim().length >= 42 && point.trim().length % 2 === 0) {
      const trimmed = point.trim();
      const bytes = new Uint8Array(trimmed.length / 2);
      for (let index = 0; index < trimmed.length; index += 2) {
        bytes[index / 2] = Number.parseInt(trimmed.slice(index, index + 2), 16);
      }
      const view = new DataView(bytes.buffer);
      const littleEndian = view.getUint8(0) === 1;
      let offset = 1;
      let geometryType = view.getUint32(offset, littleEndian);
      offset += 4;
      if ((geometryType & 0x20000000) !== 0) { offset += 4; geometryType &= ~0x20000000; }
      if (geometryType % 1000 !== 1) return null;
      const lng = view.getFloat64(offset, littleEndian);
      const lat = view.getFloat64(offset + 8, littleEndian);
      return { lng, lat };
    }
    return null;
  }
  return null;
}

function distanceBetweenMeters(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const startLat = toRadians(a.lat);
  const endLat = toRadians(b.lat);
  const haversine = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

async function run() {
  const { data: stops } = await supabase.from('batch_stops').select('stop_id, batch_id, order_id, sequence_no, location').eq('batch_id', 18);
  const stopPoints = stops.map(stop => ({ stop, point: parsePoint(stop.location) }));
  
  const startPoint = { lng: 77.1025, lat: 28.7041 }; // approx hub
  const returnPoint = startPoint;

  let bestCost = Number.POSITIVE_INFINITY;
  let bestOrder = [];

  function permute(arr, memo = []) {
    if (arr.length === 0) {
      let cost = distanceBetweenMeters(startPoint, memo[0].point);
      for (let i = 0; i < memo.length - 1; i++) {
        cost += distanceBetweenMeters(memo[i].point, memo[i + 1].point);
      }
      const lastPoint = memo[memo.length - 1].point;
      cost += distanceBetweenMeters(lastPoint, returnPoint);

      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = memo;
      }
    } else {
      for (let i = 0; i < arr.length; i++) {
        const curr = arr.slice();
        const next = curr.splice(i, 1);
        permute(curr, memo.concat(next));
      }
    }
  }

  permute(stopPoints);
  
  console.log("Best Cost:", bestCost);
  for (let i = 0; i < bestOrder.length; i++) {
    console.log(`Pos ${i+1}: order ${bestOrder[i].stop.order_id}`);
  }
}
run();
