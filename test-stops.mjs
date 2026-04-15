import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

async function run() {
  const { data: batches } = await supabase.from('delivery_batches').select('batch_id').order('batch_id', { ascending: false }).limit(2);
  for (const b of batches) {
    const { data: stops } = await supabase.from('batch_stops').select('batch_id, order_id, sequence_no').eq('batch_id', b.batch_id).order('sequence_no', { ascending: true });
    console.log('Batch', b.batch_id, stops);
  }
}
run();
