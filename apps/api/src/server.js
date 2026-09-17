import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'node:crypto';

const app = express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});next()});
app.use(express.json({ limit: '1mb' }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || process.env.MYSQL_USER || 'fbapp',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || 'change_me_app',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'fb_commenter',
  waitForConnections: true,
  connectionLimit: 15,
  charset: 'utf8mb4'
});
const globalDryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const automationToken = String(process.env.AUTOMATION_TOKEN || '').trim();
const asBool = v => v === true || v === 1 || v === '1' || v === 'true';
const n = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const liveTestMaxJobs = Math.max(1,n(process.env.LIVE_TEST_MAX_JOBS,1));
const n8nManualWebhook = process.env.N8N_MANUAL_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook/fb-comment-now';
const deviceActivationCode=String(process.env.DEVICE_ACTIVATION_CODE||'').trim();
const hashToken=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const makeDeviceToken=()=>`simi_${crypto.randomBytes(32).toString('hex')}`;
const err = (res, code, message) => res.status(code).json({ error: message });
const isFacebookUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch{return false}};

app.get('/health', async (_req,res) => {
  await pool.query('SELECT 1');
  let n8n=false;try{n8n=(await fetch(process.env.N8N_HEALTH_URL||'http://n8n:5678/healthz',{signal:AbortSignal.timeout(1200)})).ok}catch{}
  res.json({ ok:true, database:true, n8n, apiDryRun:globalDryRun, dryRun:globalDryRun, liveTestMaxJobs, version:'2.2.0' });
});

app.post('/api/devices/register',async(req,res)=>{
  const {activationCode,workerKey,deviceName,os='unknown',appVersion='unknown',baseUrl=''}=req.body||{};
  if(!deviceActivationCode||activationCode!==deviceActivationCode)return err(res,401,'Mã kích hoạt không hợp lệ');
  if(!/^[A-Za-z0-9_-]{3,120}$/.test(String(workerKey||''))||!String(deviceName||'').trim())return err(res,400,'workerKey và deviceName không hợp lệ');
  const token=makeDeviceToken(),hash=hashToken(token),conn=await pool.getConnection();
  try{await conn.beginTransaction();await conn.query(`INSERT INTO worker_nodes(worker_key,name,device_name,os,app_version,base_url,is_enabled,health_status,last_seen_at) VALUES(?,?,?,?,?,?,1,'ONLINE',NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name),device_name=VALUES(device_name),os=VALUES(os),app_version=VALUES(app_version),base_url=VALUES(base_url),is_enabled=1,health_status='ONLINE',last_seen_at=NOW()`,[workerKey,deviceName,deviceName,os,appVersion,baseUrl||`http://127.0.0.1:4311`]);const [[worker]]=await conn.query('SELECT id,worker_key,device_name FROM worker_nodes WHERE worker_key=?',[workerKey]);await conn.query('UPDATE device_tokens SET revoked_at=NOW() WHERE worker_id=? AND revoked_at IS NULL',[worker.id]);await conn.query('INSERT INTO device_tokens(worker_id,token_hash) VALUES(?,?)',[worker.id,hash]);await conn.commit();res.status(201).json({worker,deviceToken:token});}catch(e){await conn.rollback();throw e}finally{conn.release()}
});

async function deviceContext(req){const supplied=req.get('x-device-token')||String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!supplied)return null;const [[row]]=await pool.query(`SELECT d.id token_id,d.worker_id,w.worker_key,w.device_name,w.is_enabled FROM device_tokens d JOIN worker_nodes w ON w.id=d.worker_id WHERE d.token_hash=? AND d.revoked_at IS NULL`,[hashToken(supplied)]);if(!row||!row.is_enabled)return null;await pool.query('UPDATE device_tokens SET last_used_at=NOW() WHERE id=?',[row.token_id]);return row}
async function requireDevice(req,res,next){try{const ctx=await deviceContext(req);if(!ctx)return err(res,401,'Device token không hợp lệ');req.device=ctx;next()}catch(e){next(e)}}

app.use('/api',async(req,res,next)=>{
  if(req.path==='/devices/register'&&req.method==='POST') return next();
  const device=await deviceContext(req).catch(()=>null);if(device){req.device=device;return next();}
  if(!automationToken) return next();
  const supplied=req.get('x-automation-token')||String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(supplied!==automationToken) return res.status(401).json({error:'Không có quyền truy cập'});
  next();
});

app.get('/api/dashboard', async (_req,res) => {
  const [[r]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM campaigns WHERE is_active=1) activeCampaigns,
    (SELECT COUNT(*) FROM fb_accounts WHERE is_active=1) activeAccounts,
    (SELECT COUNT(*) FROM posts WHERE is_enabled=1) enabledPosts,
    (SELECT COUNT(*) FROM post_accounts WHERE is_enabled=1) assignments,
    (SELECT COUNT(*) FROM comment_jobs WHERE status IN ('PENDING','READY_FOR_WORKER')) pendingJobs,
    (SELECT COUNT(*) FROM comment_jobs WHERE status='RUNNING') runningJobs,
    (SELECT COUNT(*) FROM comment_jobs WHERE DATE(created_at)=CURRENT_DATE AND status='SUCCESS') successToday,
    (SELECT COUNT(*) FROM comment_jobs WHERE DATE(created_at)=CURRENT_DATE AND status='FAILED') failedToday
  `);
  const [nextJobs]=await pool.query(`SELECT j.id,j.scheduled_at,j.comment_text,j.status,j.dry_run,
    p.label post_label,a.name account_name,a.profile_key,c.name campaign_name
    FROM comment_jobs j JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id JOIN campaigns c ON c.id=j.campaign_id
    WHERE j.status IN ('PENDING','READY_FOR_WORKER','RETRY_DUE','RUNNING')
    ORDER BY CASE WHEN j.status='RUNNING' THEN 0 ELSE 1 END,j.scheduled_at ASC LIMIT 8`);
  res.json({...r,nextJobs});
});

app.get('/api/campaigns', async (_req,res) => {
  const [rows] = await pool.query(`SELECT c.*,
    (SELECT COUNT(*) FROM campaign_windows w WHERE w.campaign_id=c.id AND w.is_active=1) window_count
    FROM campaigns c ORDER BY c.id DESC`);
  res.json(rows);
});
app.post('/api/campaigns', async (req,res) => {
  const {name,startsAt=null,endsAt=null,cooldownMinutes=180,maxCommentsPerAccountPerDay=8,dryRun=true}=req.body;
  if(!name?.trim()) return err(res,400,'name is required');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [r]=await conn.query(`INSERT INTO campaigns(name,starts_at,ends_at,cooldown_minutes,max_comments_per_account_per_day,dry_run)
      VALUES(?,?,?,?,?,?)`,[name.trim(),startsAt||null,endsAt||null,n(cooldownMinutes,180),n(maxCommentsPerAccountPerDay,8),asBool(dryRun)]);
    await conn.query(`INSERT INTO comment_groups(campaign_id,name,description) VALUES
      (?,'Hỏi thông tin','Nhóm gợi ý; thêm câu đã duyệt trước khi tạo lịch'),
      (?,'Hỏi giá & giao hàng','Nhóm gợi ý; thêm câu đã duyệt trước khi tạo lịch'),
      (?,'Thể hiện quan tâm','Nhóm gợi ý; thêm câu đã duyệt trước khi tạo lịch')`,[r.insertId,r.insertId,r.insertId]);
    await conn.commit();res.status(201).json({id:r.insertId});
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
});

app.patch('/api/campaigns/:id', async (req,res) => {
  const fields=[]; const values=[];
  if(req.body.name!==undefined){fields.push('name=?');values.push(String(req.body.name).trim());}
  if(req.body.isActive!==undefined){fields.push('is_active=?');values.push(asBool(req.body.isActive));}
  if(req.body.dryRun!==undefined){fields.push('dry_run=?');values.push(asBool(req.body.dryRun));}
  if(req.body.cooldownMinutes!==undefined){fields.push('cooldown_minutes=?');values.push(n(req.body.cooldownMinutes,180));}
  if(req.body.maxCommentsPerAccountPerDay!==undefined){fields.push('max_comments_per_account_per_day=?');values.push(n(req.body.maxCommentsPerAccountPerDay,8));}
  if(!fields.length) return err(res,400,'no fields to update');
  values.push(n(req.params.id));
  await pool.query(`UPDATE campaigns SET ${fields.join(',')} WHERE id=?`,values);
  if(req.body.dryRun!==undefined){
    const effective=globalDryRun||asBool(req.body.dryRun);
    await pool.query(`UPDATE comment_jobs SET dry_run=? WHERE campaign_id=? AND status IN ('PENDING','RETRY_DUE','FAILED')`,[effective,n(req.params.id)]);
  }
  res.json({ok:true});
});

app.post('/api/campaigns/:id/windows', async (req,res) => {
  const {windowDate=null,weekday=null,startTime,endTime,minGapMinutes=10,maxGapMinutes=30,maxJobs=50}=req.body;
  if(!startTime||!endTime) return err(res,400,'startTime and endTime are required');
  if(!windowDate&&!weekday) return err(res,400,'windowDate or weekday is required');
  const [r]=await pool.query(`INSERT INTO campaign_windows(campaign_id,window_date,weekday,start_time,end_time,min_gap_minutes,max_gap_minutes,max_jobs)
    VALUES(?,?,?,?,?,?,?,?)`,[n(req.params.id),windowDate||null,weekday? n(weekday):null,startTime,endTime,n(minGapMinutes,10),n(maxGapMinutes,30),n(maxJobs,50)]);
  res.status(201).json({id:r.insertId});
});
app.get('/api/campaigns/:id/windows', async (req,res) => {
  const [rows]=await pool.query('SELECT * FROM campaign_windows WHERE campaign_id=? ORDER BY window_date,weekday,start_time',[n(req.params.id)]);
  res.json(rows);
});

app.get('/api/accounts', async (_req,res) => {
  const [rows]=await pool.query(`SELECT a.*,w.worker_key,w.device_name,w.health_status worker_status,
    (SELECT COUNT(*) FROM post_accounts pa WHERE pa.account_id=a.id AND pa.is_enabled=1) assigned_posts,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.account_id=a.id AND DATE(j.finished_at)=CURRENT_DATE AND j.status='SUCCESS') success_today
    FROM fb_accounts a LEFT JOIN worker_nodes w ON w.id=a.assigned_worker_id ORDER BY a.id DESC`);
  res.json(rows);
});
app.post('/api/accounts', async (req,res) => {
  const {name,profileKey,dailyLimitOverride=null,notes=null}=req.body;
  if(!name?.trim()||!profileKey?.trim()) return err(res,400,'name and profileKey are required');
  try {
    const [r]=await pool.query('INSERT INTO fb_accounts(name,profile_key,daily_limit_override,notes) VALUES(?,?,?,?)',
      [name.trim(),profileKey.trim(),dailyLimitOverride? n(dailyLimitOverride):null,notes||null]);
    res.status(201).json({id:r.insertId});
  } catch(e) { if(e.code==='ER_DUP_ENTRY') return err(res,409,'profileKey already exists'); throw e; }
});
app.patch('/api/accounts/:id', async (req,res) => {
  const fields=[]; const values=[];
  if(req.body.name!==undefined){fields.push('name=?');values.push(String(req.body.name).trim());}
  if(req.body.isActive!==undefined){fields.push('is_active=?');values.push(asBool(req.body.isActive));}
  if(req.body.dailyLimitOverride!==undefined){fields.push('daily_limit_override=?');values.push(req.body.dailyLimitOverride===''?null:Math.max(1,n(req.body.dailyLimitOverride,1)));}
  if(!fields.length) return err(res,400,'Không có dữ liệu cần cập nhật');
  values.push(n(req.params.id));
  const [r]=await pool.query(`UPDATE fb_accounts SET ${fields.join(',')} WHERE id=?`,values);
  if(!r.affectedRows) return err(res,404,'Không tìm thấy tài khoản');
  res.json({ok:true});
});

app.get('/api/posts', async (_req,res) => {
  const [rows]=await pool.query(`SELECT p.*,c.name campaign_name,
    (SELECT COUNT(*) FROM post_accounts pa WHERE pa.post_id=p.id AND pa.is_enabled=1) account_count,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.post_id=p.id AND j.status='SUCCESS') success_count,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.post_id=p.id AND j.status IN ('PENDING','RETRY_DUE')) pending_count
    FROM posts p JOIN campaigns c ON c.id=p.campaign_id ORDER BY p.id DESC`);
  res.json(rows);
});
app.post('/api/posts', async (req,res) => {
  const {campaignId,postUrl,externalPostId=null,label=null,priority=100}=req.body;
  if(!campaignId||!postUrl?.trim()) return err(res,400,'campaignId and postUrl are required');
  if(!isFacebookUrl(postUrl.trim())) return err(res,400,'Đường dẫn phải là URL HTTPS của Facebook');
  const [r]=await pool.query(`INSERT INTO posts(campaign_id,post_url,external_post_id,label,priority) VALUES(?,?,?,?,?)`,
    [n(campaignId),postUrl.trim(),externalPostId||null,label||null,n(priority,100)]);
  res.status(201).json({id:r.insertId});
});
app.patch('/api/posts/:id', async (req,res) => {
  const fields=[]; const values=[];
  if(req.body.isEnabled!==undefined){fields.push('is_enabled=?');values.push(asBool(req.body.isEnabled));}
  if(req.body.priority!==undefined){fields.push('priority=?');values.push(n(req.body.priority,100));}
  if(req.body.label!==undefined){fields.push('label=?');values.push(String(req.body.label).trim()||null);}
  if(!fields.length) return err(res,400,'Không có dữ liệu cần cập nhật');
  values.push(n(req.params.id));
  const [r]=await pool.query(`UPDATE posts SET ${fields.join(',')} WHERE id=?`,values);
  if(!r.affectedRows) return err(res,404,'Không tìm thấy bài viết');
  res.json({ok:true});
});
app.get('/api/posts/:id/accounts', async (req,res) => {
  const [rows]=await pool.query(`SELECT pa.*,a.name account_name,a.profile_key,a.session_status
    FROM post_accounts pa JOIN fb_accounts a ON a.id=pa.account_id WHERE pa.post_id=? ORDER BY pa.scheduled_at,a.id`,[n(req.params.id)]);
  res.json(rows);
});

async function chooseTemplate(conn,campaignId,postId,groupId=0) {
  const [rows]=await conn.query(`SELECT t.id,t.content FROM comment_templates t
    WHERE t.campaign_id=? AND t.is_active=1 AND (?=0 OR t.group_id=?)
    ORDER BY (SELECT COUNT(*) FROM comment_jobs j WHERE j.post_id=? AND j.template_id=t.id AND j.status='SUCCESS') ASC,
             RAND()/GREATEST(t.weight,1) ASC LIMIT 1`,[campaignId,groupId,groupId,postId]);
  return rows[0]||null;
}

app.post('/api/posts/:id/assign-accounts', async (req,res) => {
  const postId=n(req.params.id);
  const accountIds=[...new Set((req.body.accountIds||[]).map(Number).filter(Boolean))];
  if(!accountIds.length) return err(res,400,'accountIds is required');
  const minGap=Math.max(0,n(req.body.minGapMinutes,10));
  const maxGap=Math.max(minGap,n(req.body.maxGapMinutes,30));
  const requestedTemplateId=n(req.body.templateId,0);
  const requestedGroupId=n(req.body.groupId,0);
  const startAt=req.body.startAt ? new Date(req.body.startAt) : new Date();
  if(Number.isNaN(startAt.getTime())) return err(res,400,'invalid startAt');

  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[post]]=await conn.query(`SELECT p.*,c.dry_run campaign_dry_run FROM posts p JOIN campaigns c ON c.id=p.campaign_id WHERE p.id=? FOR UPDATE`,[postId]);
    if(!post) { await conn.rollback(); return err(res,404,'post not found'); }
    let cursor=new Date(startAt);
    const created=[];
    for(const accountId of accountIds) {
      const [[account]]=await conn.query('SELECT id,assigned_worker_id FROM fb_accounts WHERE id=? AND is_active=1',[accountId]);
      if(!account) continue;
      const [[existingJob]]=await conn.query('SELECT id,status FROM comment_jobs WHERE campaign_id=? AND post_id=? AND account_id=? FOR UPDATE',[post.campaign_id,postId,accountId]);
      if(existingJob&&existingJob.status!=='PENDING') {const conflict=new Error(`Tài khoản #${accountId} đã có job ${existingJob.status} cho bài này; không tạo lại để tránh trùng bình luận`);conflict.status=409;throw conflict;}
      await conn.query(`INSERT INTO post_accounts(post_id,account_id,is_enabled,scheduled_at) VALUES(?,?,1,?)
        ON DUPLICATE KEY UPDATE is_enabled=1,scheduled_at=VALUES(scheduled_at)`,[postId,accountId,cursor]);
      await conn.query(`INSERT INTO campaign_accounts(campaign_id,account_id,is_enabled) VALUES(?,?,1)
        ON DUPLICATE KEY UPDATE is_enabled=1`,[post.campaign_id,accountId]);
      let groupId=requestedGroupId;
      if(!groupId){
        const [[assignedGroup]]=await conn.query(`SELECT cag.group_id FROM campaign_account_groups cag JOIN comment_groups g ON g.id=cag.group_id
          WHERE cag.campaign_id=? AND cag.account_id=? AND g.is_active=1`,[post.campaign_id,accountId]);
        groupId=assignedGroup?.group_id||0;
      }
      if(!groupId){
        const [[fallbackGroup]]=await conn.query('SELECT id FROM comment_groups WHERE campaign_id=? AND is_active=1 ORDER BY id LIMIT 1',[post.campaign_id]);
        groupId=fallbackGroup?.id||0;
      }
      if(!groupId) throw new Error('Chiến dịch chưa có nhóm bình luận');
      const [[validGroup]]=await conn.query('SELECT id FROM comment_groups WHERE id=? AND campaign_id=? AND is_active=1',[groupId,post.campaign_id]);
      if(!validGroup) throw new Error('Nhóm bình luận không thuộc chiến dịch đã chọn');
      await conn.query(`INSERT INTO campaign_account_groups(campaign_id,account_id,group_id) VALUES(?,?,?)
        ON DUPLICATE KEY UPDATE group_id=VALUES(group_id)`,[post.campaign_id,accountId,groupId]);
      let template;
      if(requestedTemplateId){
        [[template]]=await conn.query('SELECT id,content FROM comment_templates WHERE id=? AND campaign_id=? AND group_id=? AND is_active=1',[requestedTemplateId,post.campaign_id,groupId]);
      } else template=await chooseTemplate(conn,post.campaign_id,postId,groupId);
      if(!template) throw new Error('No active comment template for campaign');
      const id=uuidv4();
      await conn.query(`INSERT INTO comment_jobs(id,idempotency_key,campaign_id,post_id,account_id,assigned_worker_id,template_id,group_id,comment_text,status,dry_run,execution_stage,effective_mode,scheduled_at)
        VALUES(?,?,?,?,?,?,?, ?,?,'PENDING',?,'QUEUED',?,?)
        ON DUPLICATE KEY UPDATE
          scheduled_at=IF(status IN ('SUCCESS','RUNNING'),scheduled_at,VALUES(scheduled_at)),
          template_id=IF(status IN ('SUCCESS','RUNNING'),template_id,VALUES(template_id)),
          group_id=IF(status IN ('SUCCESS','RUNNING'),group_id,VALUES(group_id)),
          comment_text=IF(status IN ('SUCCESS','RUNNING'),comment_text,VALUES(comment_text)),
          dry_run=IF(status IN ('SUCCESS','RUNNING'),dry_run,VALUES(dry_run)),
          status=IF(status='SUCCESS','SUCCESS',IF(status='RUNNING','RUNNING','PENDING')),
          attempt_count=IF(status IN ('SUCCESS','RUNNING'),attempt_count,0),
          finished_at=IF(status IN ('SUCCESS','RUNNING'),finished_at,NULL),
          error_code=NULL,error_message=NULL,retry_after=NULL`,
        [id,id,post.campaign_id,postId,accountId,account.assigned_worker_id,template.id,groupId,template.content,globalDryRun||!!post.campaign_dry_run,(globalDryRun||!!post.campaign_dry_run)?'DRY_RUN':'LIVE',cursor]);
      created.push({accountId,groupId,scheduledAt:cursor.toISOString(),templateId:template.id,commentText:template.content,dryRun:globalDryRun||!!post.campaign_dry_run});
      const gap=minGap+Math.floor(Math.random()*(maxGap-minGap+1));
      cursor=new Date(cursor.getTime()+gap*60000);
    }
    await conn.commit();
    res.json({ok:true,assignments:created});
  } catch(e) { await conn.rollback(); console.error(e); res.status(e.status||500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/templates', async (req,res) => {
  const campaignId=n(req.query.campaignId,0);
  const sql=`SELECT t.*,c.name campaign_name,g.name group_name,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.template_id=t.id AND j.status='SUCCESS') usage_count
    FROM comment_templates t JOIN campaigns c ON c.id=t.campaign_id LEFT JOIN comment_groups g ON g.id=t.group_id`;
  const [rows]=campaignId ? await pool.query(`${sql} WHERE t.campaign_id=? ORDER BY t.id DESC`,[campaignId]) : await pool.query(`${sql} ORDER BY t.id DESC`);
  res.json(rows);
});
app.post('/api/templates', async (req,res) => {
  const {campaignId,groupId,content,weight=1}=req.body;
  if(!campaignId||!groupId||!content?.trim()) return err(res,400,'campaignId, groupId and content are required');
  const [[group]]=await pool.query('SELECT id FROM comment_groups WHERE id=? AND campaign_id=? AND is_active=1',[n(groupId),n(campaignId)]);
  if(!group)return err(res,400,'Nhóm bình luận không thuộc chiến dịch');
  const [r]=await pool.query('INSERT INTO comment_templates(campaign_id,group_id,content,weight) VALUES(?,?,?,?)',[n(campaignId),n(groupId),content.trim(),Math.max(1,n(weight,1))]);
  res.status(201).json({id:r.insertId});
});

app.get('/api/comment-groups',async(req,res)=>{
  const campaignId=n(req.query.campaignId,0);
  const base=`SELECT g.*,c.name campaign_name,(SELECT COUNT(*) FROM comment_templates t WHERE t.group_id=g.id AND t.is_active=1) template_count,
    (SELECT COUNT(*) FROM campaign_account_groups cag WHERE cag.group_id=g.id) account_count FROM comment_groups g JOIN campaigns c ON c.id=g.campaign_id`;
  const [rows]=campaignId?await pool.query(`${base} WHERE g.campaign_id=? ORDER BY g.id`,[campaignId]):await pool.query(`${base} ORDER BY g.campaign_id,g.id`);
  res.json(rows);
});
app.post('/api/comment-groups',async(req,res)=>{
  const {campaignId,name,description=null}=req.body;
  if(!campaignId||!name?.trim())return err(res,400,'campaignId and name are required');
  try{const [r]=await pool.query('INSERT INTO comment_groups(campaign_id,name,description) VALUES(?,?,?)',[n(campaignId),name.trim(),description||null]);res.status(201).json({id:r.insertId});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return err(res,409,'Nhóm này đã tồn tại trong chiến dịch');throw e;}
});

app.get('/api/jobs', async (req,res) => {
  const limit=Math.min(500,Math.max(1,n(req.query.limit,100)));
  const [rows]=await pool.query(`SELECT j.*,c.name campaign_name,c.dry_run campaign_dry_run,
    (? OR c.dry_run) effective_dry_run,p.label post_label,p.post_url,p.is_enabled post_enabled,a.name account_name,a.profile_key,a.session_status
    FROM comment_jobs j JOIN campaigns c ON c.id=j.campaign_id JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id
    ORDER BY j.scheduled_at DESC LIMIT ?`,[globalDryRun?1:0,limit]);
  res.json(rows);
});

app.get('/api/workers', async (_req,res) => {
  await pool.query("UPDATE worker_nodes SET health_status='OFFLINE' WHERE is_enabled=1 AND last_seen_at IS NOT NULL AND last_seen_at < DATE_SUB(NOW(),INTERVAL 90 SECOND)");
  const [rows]=await pool.query('SELECT w.*, (SELECT COUNT(*) FROM fb_accounts a WHERE a.assigned_worker_id=w.id AND a.is_active=1) account_count FROM worker_nodes w ORDER BY w.id'); res.json(rows);
});

app.post('/api/workers/heartbeat',requireDevice,async(req,res)=>{
  const currentJob=req.body?.currentJobId||null;
  const defaultDryRun=req.body?.defaultDryRun===undefined?true:asBool(req.body.defaultDryRun);
  await pool.query("UPDATE worker_nodes SET health_status=IF(is_enabled=1,'ONLINE','DISABLED'),last_seen_at=NOW(),last_health_at=NOW(),current_job_id=?,default_dry_run=? WHERE id=?",[currentJob,defaultDryRun,req.device.worker_id]);
  const [[worker]]=await pool.query('SELECT id,worker_key,device_name,health_status,is_enabled,current_job_id FROM worker_nodes WHERE id=?',[req.device.worker_id]);
  res.json({ok:true,worker});
});
app.patch('/api/accounts/:id/worker',async(req,res)=>{
  const workerId=req.body?.workerId===null||req.body?.workerId===''?null:n(req.body?.workerId,0);
  if(workerId!==null){const [[w]]=await pool.query('SELECT id FROM worker_nodes WHERE id=? AND is_enabled=1',[workerId]);if(!w)return err(res,400,'Worker không tồn tại hoặc đang tắt');}
  const [r]=await pool.query('UPDATE fb_accounts SET assigned_worker_id=? WHERE id=?',[workerId,n(req.params.id)]);if(!r.affectedRows)return err(res,404,'Không tìm thấy tài khoản');
  await pool.query('UPDATE comment_jobs j JOIN fb_accounts a ON a.id=j.account_id SET j.assigned_worker_id=? WHERE j.account_id=? AND j.status IN (\'PENDING\',\'RETRY_DUE\',\'READY_FOR_WORKER\')',[workerId,n(req.params.id)]);
  res.json({ok:true,assignedWorkerId:workerId});
});

app.get('/api/system-status', async (_req,res) => {
  let database=true;
  try { await pool.query('SELECT 1'); } catch { database=false; }
  const workerChecks=await workerHealth();
  const [workers]=await pool.query('SELECT * FROM worker_nodes ORDER BY id');
  const [[campaign]]=await pool.query('SELECT id,name,dry_run FROM campaigns WHERE is_active=1 ORDER BY id LIMIT 1');
  const onlineWorker=workerChecks.find(w=>w.online);
  const workerDryRun=onlineWorker?.defaultDryRun ?? null;
  const campaignDryRun=campaign ? !!campaign.dry_run : null;
  const effectiveDryRun=globalDryRun || workerDryRun!==false || campaignDryRun!==false;
  let n8n={status:'UNKNOWN',message:'Chưa kiểm tra được'};
  try {
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),3000);
    const r=await fetch(process.env.N8N_HEALTH_URL||'http://127.0.0.1:5678/healthz',{signal:ctrl.signal}); clearTimeout(timer);
    n8n={status:r.ok?'ONLINE':'WARNING',message:r.ok?'Hoạt động':`HTTP ${r.status}`};
  } catch(e) { n8n={status:'OFFLINE',message:String(e.message||e)}; }
  res.json({api:{status:'ONLINE'},database:{status:database?'ONLINE':'OFFLINE'},browserWorker:{status:workers.some(w=>w.health_status==='ONLINE')?'ONLINE':workers.some(w=>w.health_status==='UNKNOWN')?'WARNING':'OFFLINE'},n8n,workers,dryRun:effectiveDryRun,apiDryRun:globalDryRun,workerDryRun,campaignDryRun,effectiveMode:effectiveDryRun?'DRY_RUN':'LIVE',campaign:campaign||null,configurationMismatch:new Set([globalDryRun,workerDryRun,campaignDryRun].filter(v=>v!==null)).size>1});
});
app.post('/api/workers', async (req,res) => {
  const {name,baseUrl}=req.body; if(!name||!baseUrl) return err(res,400,'name and baseUrl required');
  const [r]=await pool.query('INSERT INTO worker_nodes(name,base_url) VALUES(?,?)',[name,baseUrl]); res.status(201).json({id:r.insertId});
});

async function workerHealth() {
  const [workers]=await pool.query("SELECT * FROM worker_nodes WHERE is_enabled=1 ORDER BY id");
  const result=[];
  for(const w of workers){const online=!!w.last_seen_at&&(Date.now()-new Date(w.last_seen_at).getTime()<90000);if(online&&w.health_status!=='ONLINE')await pool.query("UPDATE worker_nodes SET health_status='ONLINE',last_health_at=NOW(),last_error=NULL WHERE id=?",[w.id]);if(!online&&w.health_status==='ONLINE')await pool.query("UPDATE worker_nodes SET health_status='OFFLINE',last_error='Heartbeat quá hạn' WHERE id=?",[w.id]);result.push({id:w.id,name:w.name,online,baseUrl:w.base_url,defaultDryRun:w.default_dry_run!==false,lastSeenAt:w.last_seen_at,currentJobId:w.current_job_id});}
  return result;
}

app.post('/api/automation/watchdog', async (_req,res) => {
  const [stale]=await pool.query(`UPDATE comment_jobs
    SET status=IF(execution_stage IN ('SUBMITTING','VERIFYING'),'UNKNOWN','FAILED'),error_code='WORKER_TIMEOUT',error_message='Worker did not report a result within 5 minutes',execution_result=IF(execution_stage IN ('SUBMITTING','VERIFYING'),'UNKNOWN','FAILED'),finished_at=NOW()
    WHERE status='RUNNING' AND started_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)`);
  res.json({workers:await workerHealth(),staleJobsRecovered:stale.affectedRows});
});

app.post('/api/automation/requeue-retriable', async (_req,res) => {
  const [r]=await pool.query(`UPDATE comment_jobs SET status='PENDING',execution_stage='QUEUED',retry_after=NULL
    WHERE status='FAILED' AND attempt_count<max_attempts AND error_code IN ('NETWORK_ERROR_BEFORE_SUBMIT','PAGE_LOAD_FAILED','WORKER_BUSY')`);
  res.json({ok:true,requeued:r.affectedRows});
});

async function livePreflight(jobId){
  const [[job]]=await pool.query(`SELECT j.*,p.post_url,p.label post_label,p.is_enabled post_enabled,
    a.name account_name,a.profile_key,a.session_status,a.is_active account_active,c.name campaign_name,c.dry_run campaign_dry_run,c.is_active campaign_active
    FROM comment_jobs j JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id JOIN campaigns c ON c.id=j.campaign_id WHERE j.id=?`,[jobId]);
  if(!job) return null;
  const checks=await workerHealth();
  const worker=checks.find(w=>w.online);
  const workerDryRun=worker?.defaultDryRun ?? true;
  const effectiveDryRun=globalDryRun||workerDryRun||!!job.campaign_dry_run;
  const reasons=[];
  if(job.status!=='PENDING') reasons.push('Job phải ở trạng thái PENDING');
  if(job.session_status!=='READY') reasons.push('Tài khoản chưa READY');
  if(!job.account_active||!job.post_enabled||!job.campaign_active) reasons.push('Tài khoản, bài viết hoặc chiến dịch đang tắt');
  if(!worker) reasons.push('Worker chưa ONLINE');
  if(!isFacebookUrl(job.post_url)) reasons.push('URL bài viết không hợp lệ');
  if(effectiveDryRun) reasons.push('API, Worker và Chiến dịch đều phải ở CHẠY THẬT');
  return {...job,worker:worker||null,apiDryRun:globalDryRun,workerDryRun,campaignDryRun:!!job.campaign_dry_run,effectiveMode:effectiveDryRun?'DRY_RUN':'LIVE',eligible:reasons.length===0,reasons};
}

app.get('/api/live-test/:id/preflight',async(req,res)=>{
  const result=await livePreflight(req.params.id); if(!result)return err(res,404,'Không tìm thấy job'); res.json(result);
});

app.post('/api/live-test/:id/execute',async(req,res)=>{
  const check=await livePreflight(req.params.id);
  if(!check)return err(res,404,'Không tìm thấy job');
  if(!check.eligible)return res.status(409).json({error:'Chưa đủ điều kiện gửi thật',reasons:check.reasons});
  try{
    const r=await fetch(n8nManualWebhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:check.id,idempotencyKey:check.idempotency_key})});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(502).json({error:body.message||body.error||`n8n HTTP ${r.status}`});
    res.json({ok:true,jobId:check.id,dispatched:true,result:body});
  }catch(e){res.status(502).json({error:`Không gọi được workflow 02: ${e.message}`});}
});

app.post('/api/automation/manual', async (req,res) => {
  return res.status(410).json({error:'Endpoint cũ đã tắt; dùng /api/live-test/:id/execute với xác nhận trên giao diện'});
  /* legacy compatibility code kept temporarily for rollback reference
  const {postId,accountId}=req.body;
  if(!postId||!accountId) return err(res,400,'postId and accountId are required');
  const [r]=await pool.query(`UPDATE comment_jobs SET scheduled_at=NOW(),retry_after=NULL,attempt_count=IF(status='SUCCESS',attempt_count,0),status=CASE WHEN status='SUCCESS' THEN 'SUCCESS' ELSE 'PENDING' END
    WHERE post_id=? AND account_id=?`,[n(postId),n(accountId)]);
  if(!r.affectedRows) return err(res,404,'job not found; assign the account to the post first');
  const [[j]]=await pool.query('SELECT id,status FROM comment_jobs WHERE post_id=? AND account_id=?',[n(postId),n(accountId)]);
  if(j.status==='SUCCESS') return res.status(409).json({error:'This account already completed this post in the campaign',jobId:j.id});
  res.json({ok:true,jobId:j.id}); */
});

app.post('/api/automation/run-now', async (req,res) => {
  return res.status(410).json({error:'Chạy ngay không còn được phép; hãy chọn một job PENDING và dùng Gửi thử 1 bình luận'});
  /* legacy compatibility code kept temporarily for rollback reference
  const {postId,accountId}=req.body;
  if(!postId||!accountId) return err(res,400,'postId and accountId are required');
  const [[job]]=await pool.query(`SELECT j.id,j.status,j.dry_run,c.dry_run campaign_dry_run
    FROM comment_jobs j JOIN campaigns c ON c.id=j.campaign_id
    WHERE j.post_id=? AND j.account_id=?`,[n(postId),n(accountId)]);
  if(!job) return err(res,404,'Không tìm thấy lượt bình luận');
  const effectiveDryRun=globalDryRun||!!job.campaign_dry_run;
  if(job.status==='SUCCESS'&&!job.dry_run) return err(res,409,'Tài khoản này đã hoàn thành bài viết');
  if(job.status==='RUNNING') return err(res,409,'Lượt bình luận đang được xử lý');
  if(job.dry_run&&['SUCCESS','SKIPPED','FAILED'].includes(job.status)) {
    await pool.query("UPDATE comment_jobs SET status='PENDING',dry_run=?,scheduled_at=NOW(),attempt_count=0,retry_after=NULL,error_code=NULL,error_message=NULL WHERE id=?",[effectiveDryRun,job.id]);
  } else if(!!job.dry_run!==effectiveDryRun) {
    await pool.query('UPDATE comment_jobs SET dry_run=? WHERE id=?',[effectiveDryRun,job.id]);
  }
  const apiHeaders={'Content-Type':'application/json',...(automationToken?{'x-automation-token':automationToken}:{})};
  const apiBase=`http://127.0.0.1:${n(process.env.PORT,4300)}`;
  const claimResponse=await fetch(`${apiBase}/api/automation/claim-job/${job.id}`,{method:'POST',headers:apiHeaders,body:'{}'});
  const claimed=await claimResponse.json().catch(()=>({}));
  if(!claimResponse.ok) return err(res,claimResponse.status,claimed.error||'Không thể nhận lượt bình luận');

  let workerResult;
  try {
    const workerResponse=await fetch(`${claimed.workerUrl.replace(/\/$/,'')}/execute`,{
      method:'POST',headers:apiHeaders,
      body:JSON.stringify({runId:claimed.runId,profileKey:claimed.profile_key,postUrl:claimed.post_url,commentText:claimed.comment_text,dryRun:claimed.dry_run})
    });
    workerResult=await workerResponse.json().catch(()=>({ok:false,errorCode:'UNKNOWN_ERROR',error:`Worker HTTP ${workerResponse.status}`}));
    if(!workerResponse.ok&&workerResult.ok!==false) workerResult={ok:false,errorCode:'UNKNOWN_ERROR',error:`Worker HTTP ${workerResponse.status}`};
  } catch(e) {
    workerResult={ok:false,errorCode:/timeout/i.test(String(e.message||e))?'TIMEOUT':'NETWORK_ERROR',error:String(e.message||e)};
  }
  const resultResponse=await fetch(`${apiBase}/api/automation/jobs/${job.id}/result`,{
    method:'POST',headers:apiHeaders,
    body:JSON.stringify({ok:!!workerResult.ok,skipped:!!workerResult.dryRun,errorCode:workerResult.errorCode||null,errorMessage:workerResult.error||null})
  });
  if(!resultResponse.ok) return err(res,500,'Worker đã chạy nhưng không lưu được kết quả');
  if(!workerResult.ok) return res.status(502).json({error:workerResult.error||'Trình điều khiển Facebook báo lỗi',errorCode:workerResult.errorCode||'UNKNOWN_ERROR',jobId:job.id});
  res.json({ok:true,jobId:job.id,dryRun:!!workerResult.dryRun,message:workerResult.message||'Đã thực hiện'}); */
});


app.post('/api/automation/session-check', async (_req,res) => {
  const [workers]=await pool.query("SELECT * FROM worker_nodes WHERE is_enabled=1 AND health_status='ONLINE' ORDER BY last_health_at DESC,id LIMIT 1");
  if(!workers.length) return res.status(409).json({error:'No ONLINE worker'});
  const worker=workers[0];
  const [accounts]=await pool.query('SELECT id,profile_key FROM fb_accounts WHERE is_active=1 ORDER BY id');
  const results=[];
  for(const a of accounts) {
    try {
      const r=await fetch(`${worker.base_url.replace(/\/$/,'')}/profiles/status`,{
        method:'POST',headers:{'Content-Type':'application/json',...(automationToken?{'x-automation-token':automationToken}:{})},body:JSON.stringify({profileKey:a.profile_key,deep:true})
      });
      const body=await r.json().catch(()=>({}));
      const status=body.status||(['CHECKPOINT','SESSION_EXPIRED'].includes(body.errorCode)?body.errorCode:'UNKNOWN');
      await pool.query('UPDATE fb_accounts SET session_status=?,last_health_at=NOW() WHERE id=?',[status,a.id]);
      results.push({profileKey:a.profile_key,status,ok:r.ok});
    } catch(e) {
      results.push({profileKey:a.profile_key,status:'UNKNOWN',ok:false,error:String(e.message||e)});
    }
  }
  res.json({ok:true,worker:worker.name,results});
});

app.post('/api/automation/claim-job/:id', async (req,res) => {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[j]]=await conn.query(`SELECT j.id,j.idempotency_key,j.status,j.campaign_id,j.post_id,j.account_id,j.comment_text,j.attempt_count,
      p.post_url,p.label,a.profile_key,a.name account_name,a.session_status,c.name campaign_name,c.dry_run campaign_dry_run
      FROM comment_jobs j JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id JOIN campaigns c ON c.id=j.campaign_id
      WHERE j.id=? FOR UPDATE`,[req.params.id]);
    if(!j){await conn.rollback();return err(res,404,'Job not found');}
    if(j.status!=='PENDING'||(req.body.idempotencyKey&&req.body.idempotencyKey!==j.idempotency_key)){
      await conn.rollback(); return res.status(409).json({error:'Job đã được claim hoặc không còn PENDING',errorCode:'ALREADY_CLAIMED',status:j.status});
    }
    const [workers]=await conn.query("SELECT * FROM worker_nodes WHERE is_enabled=1 AND health_status='ONLINE' ORDER BY last_health_at DESC,id LIMIT 1");
    if(!workers.length){await conn.rollback();return res.status(409).json({error:'No ONLINE worker',errorCode:'WORKER_OFFLINE'});}
    const worker=workers[0];
    const health=await fetch(`${worker.base_url.replace(/\/$/,'')}/health`,{headers:automationToken?{'x-automation-token':automationToken}:{}}).then(r=>r.json());
    const effectiveDryRun=globalDryRun||!!health.defaultDryRun||!!j.campaign_dry_run;
    if(!effectiveDryRun){
      const [[live]]=await conn.query("SELECT COUNT(*) total FROM comment_jobs WHERE status='RUNNING' AND effective_mode='LIVE'");
      if(live.total>=liveTestMaxJobs){await conn.rollback();return res.status(409).json({error:'Đã có một live test đang chạy',errorCode:'LIVE_TEST_LIMIT'});}
    }
    if(j.session_status!=='READY'){await conn.rollback();return res.status(409).json({error:'Account is not READY',errorCode:'SESSION_NOT_READY'});}
    const [updated]=await conn.query(`UPDATE comment_jobs SET status='RUNNING',attempt_count=attempt_count+1,started_at=NOW(),worker_name=?,retry_after=NULL,execution_stage='OPENING_BROWSER',effective_mode=?,dry_run=? WHERE id=? AND status='PENDING'`,[worker.name,effectiveDryRun?'DRY_RUN':'LIVE',effectiveDryRun,j.id]);
    if(updated.affectedRows!==1){await conn.rollback();return res.status(409).json({error:'Job đã được claim',errorCode:'ALREADY_CLAIMED'});}
    await conn.commit();
    const apiBase=process.env.PUBLIC_API_URL||`${req.protocol}://${req.get('host')}`;
    res.json({...j,dry_run:effectiveDryRun,runId:j.id,workerName:worker.name,workerUrl:worker.base_url,progressUrl:`${apiBase}/api/automation/jobs/${j.id}/progress`,guardUrl:`${apiBase}/api/automation/jobs/${j.id}/guard`});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.post('/api/automation/jobs/:id/progress',async(req,res)=>{
  const allowed=['OPENING_BROWSER','NAVIGATING','LOCATING_COMMENT_BOX','TYPING','SUBMITTING','VERIFYING','SUCCESS'];
  const stage=String(req.body.stage||''); if(!allowed.includes(stage))return err(res,400,'Invalid execution stage');
  const [r]=await pool.query(`UPDATE comment_jobs SET execution_stage=?,submit_at=IF(?='SUBMITTING',COALESCE(submit_at,NOW()),submit_at),verified_at=IF(?='SUCCESS',NOW(),verified_at) WHERE id=? AND status='RUNNING' AND idempotency_key=?`,[stage,stage,stage,req.params.id,req.body.idempotencyKey]);
  if(!r.affectedRows)return res.status(409).json({error:'Job is no longer RUNNING',errorCode:'JOB_STATE_CHANGED'});res.json({ok:true,stage});
});
app.post('/api/automation/jobs/:id/guard',async(req,res)=>{
  const [[j]]=await pool.query('SELECT status,idempotency_key,effective_mode FROM comment_jobs WHERE id=?',[req.params.id]);
  const canSubmit=!!j&&j.status==='RUNNING'&&j.idempotency_key===req.body.idempotencyKey&&j.effective_mode==='LIVE';
  res.status(canSubmit?200:409).json({canSubmit,status:j?.status||'NOT_FOUND',effectiveMode:j?.effective_mode||null});
});

app.post('/api/automation/dispatch-due', async (_req,res) => {
  const [r]=await pool.query(`UPDATE comment_jobs j JOIN fb_accounts a ON a.id=j.account_id SET j.status='READY_FOR_WORKER',j.execution_stage='QUEUED' WHERE j.status='PENDING' AND j.scheduled_at<=NOW() AND (j.retry_after IS NULL OR j.retry_after<=NOW()) AND a.assigned_worker_id IS NOT NULL`);
  res.json({ok:true,dispatched:r.affectedRows});
});
app.post('/api/automation/dispatch-job/:id', async (req,res)=>{
  const [r]=await pool.query("UPDATE comment_jobs SET status='READY_FOR_WORKER',execution_stage='QUEUED' WHERE id=? AND status='PENDING' AND (?='' OR idempotency_key=?) AND assigned_worker_id IS NOT NULL",[req.params.id,String(req.body?.idempotencyKey||''),String(req.body?.idempotencyKey||'')]);
  if(!r.affectedRows)return err(res,409,'Job không ở trạng thái PENDING hoặc chưa gán worker');
  res.json({ok:true,dispatched:1,jobId:req.params.id});
});

app.post('/api/worker/jobs/claim-next', requireDevice, async (req,res) => {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[worker]]=await conn.query("SELECT * FROM worker_nodes WHERE id=? AND is_enabled=1 AND health_status='ONLINE' AND current_job_id IS NULL FOR UPDATE",[req.device.worker_id]);
    if(!worker) { await conn.rollback(); return res.status(204).end(); }
    const [rows]=await conn.query(`SELECT j.id,j.idempotency_key,j.campaign_id,j.post_id,j.account_id,j.comment_text,j.dry_run,j.attempt_count,
      p.post_url,p.label,a.profile_key,a.name account_name,c.name campaign_name,
      COALESCE(a.daily_limit_override,c.max_comments_per_account_per_day) daily_limit
      FROM comment_jobs j
      JOIN posts p ON p.id=j.post_id
      JOIN fb_accounts a ON a.id=j.account_id
      JOIN campaigns c ON c.id=j.campaign_id
      WHERE j.status IN ('PENDING','READY_FOR_WORKER') AND j.assigned_worker_id=?
        AND j.scheduled_at<=NOW()
        AND (j.retry_after IS NULL OR j.retry_after<=NOW())
        AND p.is_enabled=1 AND a.is_active=1 AND c.is_active=1
        AND a.session_status NOT IN ('SESSION_EXPIRED','CHECKPOINT','DISABLED')
        AND (c.starts_at IS NULL OR c.starts_at<=NOW()) AND (c.ends_at IS NULL OR c.ends_at>=NOW())
        AND (SELECT COUNT(*) FROM comment_jobs d WHERE d.account_id=j.account_id AND DATE(d.created_at)=CURRENT_DATE AND d.status='SUCCESS') < COALESCE(a.daily_limit_override,c.max_comments_per_account_per_day)
        AND NOT EXISTS (SELECT 1 FROM comment_jobs cool WHERE cool.account_id=j.account_id AND cool.status='SUCCESS' AND cool.finished_at>DATE_SUB(NOW(),INTERVAL c.cooldown_minutes MINUTE))
        AND NOT EXISTS (SELECT 1 FROM comment_jobs r WHERE r.account_id=j.account_id AND r.status='RUNNING')
        AND NOT EXISTS (SELECT 1 FROM comment_jobs rp WHERE rp.post_id=j.post_id AND rp.status='RUNNING')
      ORDER BY j.scheduled_at ASC,p.priority ASC,j.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,[worker.id]);
    if(!rows.length) { await conn.rollback(); return res.status(204).end(); }
    const j=rows[0];
    const [[campaignMode]]=await conn.query('SELECT dry_run FROM campaigns WHERE id=?',[j.campaign_id]);
    const effectiveDryRun=globalDryRun||!!worker.default_dry_run||!!campaignMode.dry_run;
    if(!effectiveDryRun){const [[live]]=await conn.query("SELECT COUNT(*) total FROM comment_jobs WHERE status='RUNNING' AND effective_mode='LIVE'");if(live.total>=liveTestMaxJobs){await conn.rollback();return res.status(409).json({errorCode:'LIVE_TEST_LIMIT',error:'Live test limit reached'});}}
    await conn.query(`UPDATE comment_jobs SET status='RUNNING',attempt_count=attempt_count+1,started_at=NOW(),worker_name=?,assigned_worker_id=?,execution_stage='OPENING_BROWSER',effective_mode=?,dry_run=? WHERE id=? AND status IN ('PENDING','READY_FOR_WORKER')`,[worker.name,worker.id,effectiveDryRun?'DRY_RUN':'LIVE',effectiveDryRun,j.id]);
    await conn.query('UPDATE worker_nodes SET current_job_id=? WHERE id=?',[j.id,worker.id]);
    await conn.commit();
    const apiBase=process.env.PUBLIC_API_URL||`${req.protocol}://${req.get('host')}`;
    res.json({...j,dry_run:effectiveDryRun,runId:j.id,workerName:worker.name,workerUrl:worker.base_url,progressUrl:`${apiBase}/api/automation/jobs/${j.id}/progress`,guardUrl:`${apiBase}/api/automation/jobs/${j.id}/guard`});
  } catch(e) { await conn.rollback(); console.error(e); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.post('/api/automation/jobs/:id/result', async (req,res) => {
  const {ok=false,errorCode=null,errorMessage=null,skipped=false,outcome=null,idempotencyKey=null}=req.body;
  const status=outcome==='UNKNOWN'?'UNKNOWN':(skipped?'SKIPPED':(ok?'SUCCESS':'FAILED'));
  const stage=status==='SUCCESS'?'SUCCESS':status;
  const [result]=await pool.query(`UPDATE comment_jobs SET status=?,execution_stage=?,execution_result=?,error_code=?,error_message=?,verified_at=IF(?='SUCCESS',NOW(),verified_at),finished_at=NOW() WHERE id=? AND status='RUNNING' AND idempotency_key=?`,[status,stage,status,errorCode||null,errorMessage||null,status,req.params.id,idempotencyKey]);
  if(!result.affectedRows) return err(res,409,'Job không ở trạng thái đang chạy');
  await pool.query("UPDATE worker_nodes w JOIN comment_jobs j ON j.assigned_worker_id=w.id SET w.current_job_id=NULL WHERE j.id=?",[req.params.id]);
  if(['SESSION_EXPIRED','CHECKPOINT'].includes(errorCode)) {
    await pool.query(`UPDATE fb_accounts a JOIN comment_jobs j ON j.account_id=a.id SET a.session_status=?,a.last_health_at=NOW() WHERE j.id=?`,[errorCode,req.params.id]);
  }
  res.json({ok:true,status});
});

app.post('/api/jobs/:id/action', async (req,res) => {
  const action=String(req.body.action||'');
  if(action==='test-again'){
    const [r]=await pool.query("UPDATE comment_jobs SET status='PENDING',scheduled_at=NOW(),attempt_count=0,retry_after=NULL,error_code=NULL,error_message=NULL WHERE id=? AND dry_run=1 AND status IN ('SUCCESS','SKIPPED','FAILED')",[req.params.id]);
    if(!r.affectedRows) return err(res,409,'Chỉ có thể chạy lại lượt thử nghiệm đã hoàn tất hoặc bị lỗi');
    return res.json({ok:true,status:'PENDING'});
  }
  const transitions={
    pause:{from:['PENDING','RETRY_DUE'],status:'PAUSED'},
    cancel:{from:['PENDING','RETRY_DUE','PAUSED','FAILED'],status:'CANCELLED'},
    resume:{from:['PAUSED'],status:'PENDING'},
    retry:{from:['FAILED','CANCELLED'],status:'PENDING'}
  };
  const rule=transitions[action];
  if(!rule) return err(res,400,'Thao tác không hợp lệ');
  const marks=rule.from.map(()=>'?').join(',');
  const [r]=await pool.query(`UPDATE comment_jobs SET status=?,scheduled_at=IF(?='PENDING',NOW(),scheduled_at),attempt_count=IF(?='PENDING',0,attempt_count),retry_after=NULL,error_code=IF(?='PENDING',NULL,error_code),error_message=IF(?='PENDING',NULL,error_message) WHERE id=? AND status IN (${marks})`,[rule.status,rule.status,rule.status,rule.status,rule.status,req.params.id,...rule.from]);
  if(!r.affectedRows) return err(res,409,'Không thể thực hiện thao tác với trạng thái hiện tại');
  res.json({ok:true,status:rule.status});
});

app.post('/api/automation/account-status', async (req,res) => {
  const {profileKey,status}=req.body;
  const allowed=['UNKNOWN','READY','SESSION_EXPIRED','CHECKPOINT','DISABLED'];
  if(!profileKey||!allowed.includes(status)) return err(res,400,'invalid profileKey/status');
  if(req.device){const [[account]]=await pool.query('SELECT assigned_worker_id FROM fb_accounts WHERE profile_key=?',[profileKey]);if(!account||account.assigned_worker_id!==req.device.worker_id)return err(res,403,'Tài khoản chưa được gán cho Worker này');}
  await pool.query('UPDATE fb_accounts SET session_status=?,last_health_at=NOW() WHERE profile_key=?',[status,profileKey]);
  res.json({ok:true});
});

app.use((e,_req,res,_next)=>{ console.error(e); res.status(500).json({error:e.message||'Internal error'}); });
const listenHost=process.env.HOST||'127.0.0.1';
app.listen(n(process.env.PORT,4300),listenHost,()=>console.log(`API v2 listening on ${listenHost}:${n(process.env.PORT,4300)}`));
