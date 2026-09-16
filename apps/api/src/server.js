import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

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
const err = (res, code, message) => res.status(code).json({ error: message });
const isFacebookUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch{return false}};

app.get('/health', async (_req,res) => {
  await pool.query('SELECT 1');
  res.json({ ok:true, database:true, dryRun:globalDryRun, version:'2.1.0' });
});

app.use('/api',(req,res,next)=>{
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
    (SELECT COUNT(*) FROM comment_jobs WHERE status='PENDING') pendingJobs,
    (SELECT COUNT(*) FROM comment_jobs WHERE status='RUNNING') runningJobs,
    (SELECT COUNT(*) FROM comment_jobs WHERE DATE(created_at)=CURRENT_DATE AND status='SUCCESS') successToday,
    (SELECT COUNT(*) FROM comment_jobs WHERE DATE(created_at)=CURRENT_DATE AND status='FAILED') failedToday
  `);
  res.json(r);
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
  const [r]=await pool.query(`INSERT INTO campaigns(name,starts_at,ends_at,cooldown_minutes,max_comments_per_account_per_day,dry_run)
    VALUES(?,?,?,?,?,?)`,[name.trim(),startsAt||null,endsAt||null,n(cooldownMinutes,180),n(maxCommentsPerAccountPerDay,8),asBool(dryRun)]);
  res.status(201).json({id:r.insertId});
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
  const [rows]=await pool.query(`SELECT a.*,
    (SELECT COUNT(*) FROM post_accounts pa WHERE pa.account_id=a.id AND pa.is_enabled=1) assigned_posts,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.account_id=a.id AND DATE(j.finished_at)=CURRENT_DATE AND j.status='SUCCESS') success_today
    FROM fb_accounts a ORDER BY a.id DESC`);
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

async function chooseTemplate(conn,campaignId,postId) {
  const [rows]=await conn.query(`SELECT t.id,t.content FROM comment_templates t
    WHERE t.campaign_id=? AND t.is_active=1
    ORDER BY (SELECT COUNT(*) FROM comment_jobs j WHERE j.post_id=? AND j.template_id=t.id AND j.status='SUCCESS') ASC,
             RAND()/GREATEST(t.weight,1) ASC LIMIT 1`,[campaignId,postId]);
  return rows[0]||null;
}

app.post('/api/posts/:id/assign-accounts', async (req,res) => {
  const postId=n(req.params.id);
  const accountIds=[...new Set((req.body.accountIds||[]).map(Number).filter(Boolean))];
  if(!accountIds.length) return err(res,400,'accountIds is required');
  const minGap=Math.max(0,n(req.body.minGapMinutes,10));
  const maxGap=Math.max(minGap,n(req.body.maxGapMinutes,30));
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
      const [[account]]=await conn.query('SELECT id FROM fb_accounts WHERE id=? AND is_active=1',[accountId]);
      if(!account) continue;
      await conn.query(`INSERT INTO post_accounts(post_id,account_id,is_enabled,scheduled_at) VALUES(?,?,1,?)
        ON DUPLICATE KEY UPDATE is_enabled=1,scheduled_at=VALUES(scheduled_at)`,[postId,accountId,cursor]);
      const template=await chooseTemplate(conn,post.campaign_id,postId);
      if(!template) throw new Error('No active comment template for campaign');
      const id=uuidv4();
      await conn.query(`INSERT INTO comment_jobs(id,campaign_id,post_id,account_id,template_id,comment_text,status,dry_run,scheduled_at)
        VALUES(?,?,?,?,?,?,'PENDING',?,?)
        ON DUPLICATE KEY UPDATE
          scheduled_at=IF(status IN ('SUCCESS','RUNNING'),scheduled_at,VALUES(scheduled_at)),
          template_id=IF(status IN ('SUCCESS','RUNNING'),template_id,VALUES(template_id)),
          comment_text=IF(status IN ('SUCCESS','RUNNING'),comment_text,VALUES(comment_text)),
          status=IF(status='SUCCESS','SUCCESS',IF(status='RUNNING','RUNNING','PENDING')),
          error_code=NULL,error_message=NULL,retry_after=NULL`,
        [id,post.campaign_id,postId,accountId,template.id,template.content,globalDryRun||!!post.campaign_dry_run,cursor]);
      created.push({accountId,scheduledAt:cursor.toISOString()});
      const gap=minGap+Math.floor(Math.random()*(maxGap-minGap+1));
      cursor=new Date(cursor.getTime()+gap*60000);
    }
    await conn.commit();
    res.json({ok:true,assignments:created});
  } catch(e) { await conn.rollback(); console.error(e); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/templates', async (req,res) => {
  const campaignId=n(req.query.campaignId,0);
  const sql=`SELECT t.*,c.name campaign_name,
    (SELECT COUNT(*) FROM comment_jobs j WHERE j.template_id=t.id AND j.status='SUCCESS') usage_count
    FROM comment_templates t JOIN campaigns c ON c.id=t.campaign_id`;
  const [rows]=campaignId ? await pool.query(`${sql} WHERE t.campaign_id=? ORDER BY t.id DESC`,[campaignId]) : await pool.query(`${sql} ORDER BY t.id DESC`);
  res.json(rows);
});
app.post('/api/templates', async (req,res) => {
  const {campaignId,content,weight=1}=req.body;
  if(!campaignId||!content?.trim()) return err(res,400,'campaignId and content are required');
  const [r]=await pool.query('INSERT INTO comment_templates(campaign_id,content,weight) VALUES(?,?,?)',[n(campaignId),content.trim(),Math.max(1,n(weight,1))]);
  res.status(201).json({id:r.insertId});
});

app.get('/api/jobs', async (req,res) => {
  const limit=Math.min(500,Math.max(1,n(req.query.limit,100)));
  const [rows]=await pool.query(`SELECT j.*,c.name campaign_name,p.label post_label,p.post_url,a.name account_name,a.profile_key
    FROM comment_jobs j JOIN campaigns c ON c.id=j.campaign_id JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id
    ORDER BY j.scheduled_at DESC LIMIT ?`,[limit]);
  res.json(rows);
});

app.get('/api/workers', async (_req,res) => {
  const [rows]=await pool.query('SELECT * FROM worker_nodes ORDER BY id'); res.json(rows);
});

app.get('/api/system-status', async (_req,res) => {
  let database=true;
  try { await pool.query('SELECT 1'); } catch { database=false; }
  const [workers]=await pool.query('SELECT * FROM worker_nodes ORDER BY id');
  let n8n={status:'UNKNOWN',message:'Chưa kiểm tra được'};
  try {
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),3000);
    const r=await fetch(process.env.N8N_HEALTH_URL||'http://127.0.0.1:5678/healthz',{signal:ctrl.signal}); clearTimeout(timer);
    n8n={status:r.ok?'ONLINE':'WARNING',message:r.ok?'Hoạt động':`HTTP ${r.status}`};
  } catch(e) { n8n={status:'OFFLINE',message:String(e.message||e)}; }
  res.json({api:{status:'ONLINE'},database:{status:database?'ONLINE':'OFFLINE'},browserWorker:{status:workers.some(w=>w.health_status==='ONLINE')?'ONLINE':workers.some(w=>w.health_status==='UNKNOWN')?'WARNING':'OFFLINE'},n8n,workers,dryRun:globalDryRun});
});
app.post('/api/workers', async (req,res) => {
  const {name,baseUrl}=req.body; if(!name||!baseUrl) return err(res,400,'name and baseUrl required');
  const [r]=await pool.query('INSERT INTO worker_nodes(name,base_url) VALUES(?,?)',[name,baseUrl]); res.status(201).json({id:r.insertId});
});

async function workerHealth() {
  const [workers]=await pool.query('SELECT * FROM worker_nodes WHERE is_enabled=1 ORDER BY id');
  const result=[];
  for(const w of workers) {
    try {
      const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),5000);
      const r=await fetch(`${w.base_url.replace(/\/$/,'')}/health`,{signal:ctrl.signal,headers:automationToken?{'x-automation-token':automationToken}:{}}); clearTimeout(timer);
      const body=await r.json().catch(()=>({}));
      if(!r.ok||!body.ok) throw new Error(`HTTP ${r.status}`);
      await pool.query("UPDATE worker_nodes SET health_status='ONLINE',last_health_at=NOW(),last_error=NULL WHERE id=?",[w.id]);
      result.push({id:w.id,name:w.name,online:true,baseUrl:w.base_url});
    } catch(e) {
      await pool.query("UPDATE worker_nodes SET health_status='OFFLINE',last_health_at=NOW(),last_error=? WHERE id=?",[String(e.message||e),w.id]);
      result.push({id:w.id,name:w.name,online:false,baseUrl:w.base_url,error:String(e.message||e)});
    }
  }
  return result;
}

app.post('/api/automation/watchdog', async (_req,res) => res.json({workers:await workerHealth()}));

app.post('/api/automation/requeue-retriable', async (_req,res) => {
  const [r]=await pool.query(`UPDATE comment_jobs SET status='RETRY_DUE',retry_after=NOW()
    WHERE status='FAILED' AND attempt_count<max_attempts AND error_code IN ('TIMEOUT','NETWORK_ERROR','PAGE_LOAD_FAILED','SELECTOR_FAILED','WORKER_BUSY')`);
  res.json({ok:true,requeued:r.affectedRows});
});

app.post('/api/automation/manual', async (req,res) => {
  const {postId,accountId}=req.body;
  if(!postId||!accountId) return err(res,400,'postId and accountId are required');
  const [r]=await pool.query(`UPDATE comment_jobs SET scheduled_at=NOW(),retry_after=NULL,status=CASE WHEN status='SUCCESS' THEN 'SUCCESS' ELSE 'PENDING' END
    WHERE post_id=? AND account_id=?`,[n(postId),n(accountId)]);
  if(!r.affectedRows) return err(res,404,'job not found; assign the account to the post first');
  const [[j]]=await pool.query('SELECT id,status FROM comment_jobs WHERE post_id=? AND account_id=?',[n(postId),n(accountId)]);
  if(j.status==='SUCCESS') return res.status(409).json({error:'This account already completed this post in the campaign',jobId:j.id});
  res.json({ok:true,jobId:j.id});
});

app.post('/api/automation/run-now', async (req,res) => {
  const {postId,accountId}=req.body;
  if(!postId||!accountId) return err(res,400,'postId and accountId are required');
  const [[job]]=await pool.query('SELECT id,status,dry_run FROM comment_jobs WHERE post_id=? AND account_id=?',[n(postId),n(accountId)]);
  if(!job) return err(res,404,'Không tìm thấy lượt bình luận');
  if(job.status==='SUCCESS'&&!job.dry_run) return err(res,409,'Tài khoản này đã hoàn thành bài viết');
  if(job.status==='RUNNING') return err(res,409,'Lượt bình luận đang được xử lý');
  if(job.dry_run&&['SUCCESS','SKIPPED','FAILED'].includes(job.status)) {
    await pool.query("UPDATE comment_jobs SET status='PENDING',scheduled_at=NOW(),attempt_count=0,retry_after=NULL,error_code=NULL,error_message=NULL WHERE id=?",[job.id]);
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
  res.json({ok:true,jobId:job.id,dryRun:!!workerResult.dryRun,message:workerResult.message||'Đã thực hiện'});
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
    const [workers]=await conn.query("SELECT * FROM worker_nodes WHERE is_enabled=1 AND health_status='ONLINE' ORDER BY last_health_at DESC,id LIMIT 1");
    if(!workers.length) { await conn.rollback(); return res.status(409).json({error:'No ONLINE worker'}); }
    const worker=workers[0];
    const [rows]=await conn.query(`SELECT j.id,j.campaign_id,j.post_id,j.account_id,j.comment_text,j.dry_run,j.attempt_count,
      p.post_url,p.label,a.profile_key,a.name account_name,c.name campaign_name
      FROM comment_jobs j JOIN posts p ON p.id=j.post_id JOIN fb_accounts a ON a.id=j.account_id JOIN campaigns c ON c.id=j.campaign_id
      WHERE j.id=? AND j.status IN ('PENDING','RETRY_DUE','FAILED') AND p.is_enabled=1 AND a.is_active=1 AND c.is_active=1
      AND a.session_status NOT IN ('SESSION_EXPIRED','CHECKPOINT','DISABLED') AND j.attempt_count<j.max_attempts
      AND NOT EXISTS (SELECT 1 FROM comment_jobs r WHERE r.account_id=j.account_id AND r.status='RUNNING' AND r.id<>j.id)
      AND NOT EXISTS (SELECT 1 FROM comment_jobs rp WHERE rp.post_id=j.post_id AND rp.status='RUNNING' AND rp.id<>j.id)
      LIMIT 1 FOR UPDATE`,[req.params.id]);
    if(!rows.length) { await conn.rollback(); return res.status(409).json({error:'Job cannot be claimed'}); }
    const j=rows[0];
    await conn.query(`UPDATE comment_jobs SET status='RUNNING',attempt_count=attempt_count+1,started_at=NOW(),worker_name=?,retry_after=NULL WHERE id=?`,[worker.name,j.id]);
    await conn.commit();
    res.json({...j,runId:j.id,workerName:worker.name,workerUrl:worker.base_url});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.post('/api/automation/claim-next', async (_req,res) => {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [workers]=await conn.query("SELECT * FROM worker_nodes WHERE is_enabled=1 AND health_status='ONLINE' ORDER BY last_health_at DESC,id LIMIT 1");
    if(!workers.length) { await conn.rollback(); return res.status(204).end(); }
    const worker=workers[0];
    const [rows]=await conn.query(`SELECT j.id,j.campaign_id,j.post_id,j.account_id,j.comment_text,j.dry_run,j.attempt_count,
      p.post_url,p.label,a.profile_key,a.name account_name,c.name campaign_name,
      COALESCE(a.daily_limit_override,c.max_comments_per_account_per_day) daily_limit
      FROM comment_jobs j
      JOIN posts p ON p.id=j.post_id
      JOIN fb_accounts a ON a.id=j.account_id
      JOIN campaigns c ON c.id=j.campaign_id
      WHERE j.status IN ('PENDING','RETRY_DUE')
        AND j.scheduled_at<=NOW()
        AND (j.retry_after IS NULL OR j.retry_after<=NOW())
        AND p.is_enabled=1 AND a.is_active=1 AND c.is_active=1
        AND a.session_status NOT IN ('SESSION_EXPIRED','CHECKPOINT','DISABLED')
        AND (c.starts_at IS NULL OR c.starts_at<=NOW()) AND (c.ends_at IS NULL OR c.ends_at>=NOW())
        AND (SELECT COUNT(*) FROM comment_jobs d WHERE d.account_id=j.account_id AND DATE(d.created_at)=CURRENT_DATE AND d.status='SUCCESS') < COALESCE(a.daily_limit_override,c.max_comments_per_account_per_day)
        AND NOT EXISTS (SELECT 1 FROM comment_jobs cool WHERE cool.account_id=j.account_id AND cool.status='SUCCESS' AND cool.finished_at>DATE_SUB(NOW(),INTERVAL c.cooldown_minutes MINUTE))
        AND NOT EXISTS (SELECT 1 FROM comment_jobs r WHERE r.account_id=j.account_id AND r.status='RUNNING')
        AND NOT EXISTS (SELECT 1 FROM comment_jobs rp WHERE rp.post_id=j.post_id AND rp.status='RUNNING')
      ORDER BY j.scheduled_at ASC,p.priority ASC,j.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if(!rows.length) { await conn.rollback(); return res.status(204).end(); }
    const j=rows[0];
    await conn.query(`UPDATE comment_jobs SET status='RUNNING',attempt_count=attempt_count+1,started_at=NOW(),worker_name=? WHERE id=?`,[worker.name,j.id]);
    await conn.commit();
    res.json({...j,runId:j.id,workerName:worker.name,workerUrl:worker.base_url});
  } catch(e) { await conn.rollback(); console.error(e); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.post('/api/automation/jobs/:id/result', async (req,res) => {
  const {ok=false,errorCode=null,errorMessage=null,skipped=false}=req.body;
  const status=skipped?'SKIPPED':(ok?'SUCCESS':'FAILED');
  const [result]=await pool.query(`UPDATE comment_jobs SET status=?,error_code=?,error_message=?,finished_at=NOW() WHERE id=? AND status='RUNNING'`,[status,errorCode||null,errorMessage||null,req.params.id]);
  if(!result.affectedRows) return err(res,409,'Job không ở trạng thái đang chạy');
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
  const [r]=await pool.query(`UPDATE comment_jobs SET status=?,scheduled_at=IF(?='PENDING',NOW(),scheduled_at),retry_after=NULL,error_code=IF(?='PENDING',NULL,error_code),error_message=IF(?='PENDING',NULL,error_message) WHERE id=? AND status IN (${marks})`,[rule.status,rule.status,rule.status,rule.status,req.params.id,...rule.from]);
  if(!r.affectedRows) return err(res,409,'Không thể thực hiện thao tác với trạng thái hiện tại');
  res.json({ok:true,status:rule.status});
});

app.post('/api/automation/account-status', async (req,res) => {
  const {profileKey,status}=req.body;
  const allowed=['UNKNOWN','READY','SESSION_EXPIRED','CHECKPOINT','DISABLED'];
  if(!profileKey||!allowed.includes(status)) return err(res,400,'invalid profileKey/status');
  await pool.query('UPDATE fb_accounts SET session_status=?,last_health_at=NOW() WHERE profile_key=?',[status,profileKey]);
  res.json({ok:true});
});

app.use((e,_req,res,_next)=>{ console.error(e); res.status(500).json({error:e.message||'Internal error'}); });
app.listen(n(process.env.PORT,4300),()=>console.log(`API v2 listening on :${n(process.env.PORT,4300)}`));
