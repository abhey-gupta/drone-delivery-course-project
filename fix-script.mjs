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
    if (/^[\da-f]+$/i.test(point.trim()) && point.trim().length >= 42) {
      const trimmed = point.trim();
      const bytes = new Uint8Array(trimmed.length / 2);
      for (let i = 0; i < trimmed.length; i += 2) bytes[i/2] = parseInt(trimmed.slice(i, i+2), 16);
      const view = new DataView(bytes.buffer);
      const littleEndian = view.getUint8(0) === 1;
      let offset = 1;
      let geometryType = view.getUint32(offset, littleEndian);
      offset += 4;
      if ((geometryType & 0x20000000) !== 0) { offset += 4; }
      return { lng: view.getFloat64(offset, littleEndian), lat: view.getFloat64(offset + 8, littleEndian) };
    }
  }
  return null;
}

function dist(a, b) {
  const [dLat, dLng, s, e] = [(b.lat-a.lat)*Math.PI/180, (b.lng-a.lng)*Math.PI/180, a.lat*Math.PI/180, b.lat*Math.PI/180];
  const h = Math.sin(dLat/2)**2 + Math.cos(s)*Math.cos(e)*Math.sin(dLng/2)**2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

async function run() {
  for (const batch_id of [17, 18]) {
    const { data: stops } = await supabase.from('batch_stops').select('stop_id, batch_id, order_id, sequence_no, location').eq('batch_id', batch_id);
    const stopPoints = stops.map(stop => ({ stop, point: parsePoint(stop.location) }));
    const startPoint = { lng: 77.1025, lat: 28.7041 };
    
    let bestOrder = []; let bestCost = Infinity;
    function permute(arr, memo = []) {
      if (arr.length === 0) {
        let cost = dist(startPoint, memo[0].point);
        for (let i = 0; i < memo.length - 1; i++) cost += dist(memo[i].point, memo[i+1].point);
        cost += dist(memo[memo.length - 1].point, startPoint);
        if (cost < bestCost) { bestCost = cost; bestOrder = memo; }
      } else {
        for (let i = 0; i < arr.length; i++) {
          const curr = arr.slice();
          permute(curr, memo.concat(curr.splice(i, 1)));
        }
      }
    }
    permute(stopPoints);
    console.log(`Fixing batch ${batch_id}`);
    
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
        await supabase.from('batch_stops').update({ sequence_no: newSequenceNo }).eq('stop_id', stop.stop_id);
      }
    }
  }
}
run();
