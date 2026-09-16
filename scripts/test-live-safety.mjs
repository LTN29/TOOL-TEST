import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const api=read('apps/api/src/server.js');
const worker=read('apps/worker/src/server.js');
const db=read('db/migrations/002_live_execution_safety.sql');
const ui=read('apps/web/src/main.jsx');
const manual=JSON.parse(read('n8n/02-fb-manual-dispatcher.json'));
const auto=JSON.parse(read('n8n/01-fb-campaign-dispatcher.json'));
const retry=JSON.parse(read('n8n/03-fb-failed-job-retry.json'));
const groupsDb=read('db/migrations/003_comment_groups.sql');
const groupUi=read('apps/web/src/CommentGroups.jsx');
const tests=[
 ['1. claim chỉ nhận PENDING',()=>assert.match(api,/j\.status!=='PENDING'/)],
 ['2. claim trùng trả ALREADY_CLAIMED',()=>assert.match(api,/ALREADY_CLAIMED/)],
 ['3. SUCCESS không thể claim lại',()=>{const claim=api.slice(api.indexOf("app.post('/api/automation/claim-job"),api.indexOf("app.post('/api/automation/jobs/:id/progress"));assert.doesNotMatch(claim,/status IN/);assert.match(claim,/j\.status!=='PENDING'/)}],
 ['4. idempotency_key bắt buộc và unique',()=>{assert.match(db,/NOT NULL/);assert.match(db,/uq_jobs_idempotency/)}],
 ['5. giới hạn live test bằng 1',()=>{assert.match(api,/LIVE_TEST_MAX_JOBS/);assert.match(api,/LIVE_TEST_LIMIT/)}],
 ['6. UNKNOWN có trong schema và không auto retry',()=>{assert.match(db,/'UNKNOWN'/);assert.doesNotMatch(api,/error_code IN \([^)]*UNKNOWN/)}],
 ['7. chỉ retry ba lỗi trước submit',()=>assert.match(api,/NETWORK_ERROR_BEFORE_SUBMIT','PAGE_LOAD_FAILED','WORKER_BUSY'/)],
 ['8. worker có guard trước submit và verify nội dung exact',()=>{assert.match(worker,/guardUrl/);assert.match(worker,/getByText\(commentText,\{exact:true\}/)}],
 ['9. modal không cho Enter xác nhận',()=>assert.match(ui,/if\(e\.key==='Enter'\)e\.preventDefault/)],
 ['10. workflow đầu tiên đều chưa tự kích hoạt',()=>{assert.equal(auto.active,false);assert.equal(retry.active,false);assert.equal(manual.active,false)}],
 ['11. workflow 02 chỉ trigger → claim → worker → save',()=>assert.deepEqual(manual.nodes.map(n=>n.name),['Manual Webhook','Claim Manual Job','Browser Worker','Save Result'])],
 ['12. nhóm nội dung có ID và liên kết chiến dịch/tài khoản',()=>{assert.match(groupsDb,/CREATE TABLE IF NOT EXISTS comment_groups/);assert.match(groupsDb,/CREATE TABLE IF NOT EXISTS campaign_account_groups/);assert.match(groupsDb,/ADD COLUMN group_id BIGINT/)}],
 ['13. giao diện nhóm lấy câu từ DB',()=>{assert.match(groupUi,/templates\.filter/);assert.match(groupUi,/group\.id/)}],
 ['14. job đã xử lý không bị tạo đè',()=>assert.match(api,/existingJob\.status!=='PENDING'/)],
 ['15. ba nhóm mẫu có ID trong DB cho chiến dịch cũ và mới',()=>{assert.match(groupsDb,/INSERT INTO comment_groups\(campaign_id,name,description\)/);assert.match(api,/INSERT INTO comment_groups\(campaign_id,name,description\) VALUES/)}]
];
for(const [name,test] of tests){test();console.log(`PASS ${name}`)}
console.log(`Safety checks passed: ${tests.length}/${tests.length}`);
