import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const must=['db/init.sql','db/migrations/001_queue_controls.sql','db/migrations/002_live_execution_safety.sql','db/migrations/003_comment_groups.sql','apps/api/src/server.js','apps/web/src/main.jsx','apps/web/vite.config.js','apps/worker/src/server.js','START_LOCAL.cmd','STOP_LOCAL.cmd','START_N8N.cmd','STOP_N8N.cmd','docker-compose.n8n.yml','HUONG_DAN_MAC_MINI.md','deploy/cloudflare-config.example.yml','scripts/setup-mac.sh','scripts/start-local.sh','scripts/stop-local.sh','n8n/01-fb-campaign-dispatcher.json','n8n/02-fb-manual-dispatcher.json','n8n/03-fb-failed-job-retry.json','n8n/04-fb-worker-watchdog.json','n8n/05-fb-session-check.json'];
for(const f of must){if(!fs.existsSync(path.join(root,f)))throw new Error(`Missing ${f}`)}
for(const f of fs.readdirSync(path.join(root,'n8n')).filter(x=>x.endsWith('.json'))){
  const text=fs.readFileSync(path.join(root,'n8n',f),'utf8'); JSON.parse(text);
  if(text.includes('http://api:4300')||text.includes('={{ .AUTOMATION_TOKEN }}')) throw new Error(`Outdated n8n configuration in ${f}`);
}
console.log('Project structure OK');
