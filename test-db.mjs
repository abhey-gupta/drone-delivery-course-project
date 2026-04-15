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

async function run() {
  // Let's try to set stop_id 22 (curr sequence 1) to sequence 2.
  const { data: stops } = await supabase.from('batch_stops').select('*').eq('batch_id', 17);
  console.log("Current:", stops.map(s => `stop=${s.stop_id} seq=${s.sequence_no}`).join(', '));
  
  // Attempt to swap 22 and 23 directly
  const { error } = await supabase.from('batch_stops').update({ sequence_no: 2 }).eq('stop_id', stops[0].stop_id);
  console.log("Update error:", error);
}
run();
