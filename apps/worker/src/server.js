import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {launchProfile} from './profile-login.js';

const app=express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cache-Control':'no-store'});next()});
app.use(express.json({limit:'256kb'}));
const port=Number(process.env.PORT||4311);
const profileRoot=path.resolve(process.env.PROFILE_ROOT||'./profiles');
const defaultDryRun=String(process.env.DRY_RUN??'true').toLowerCase()!=='false';
const headless=String(process.env.HEADLESS??'false').toLowerCase()==='true';
const navTimeout=Number(process.env.NAV_TIMEOUT_MS||45000);
const actionDelay=Number(process.env.ACTION_DELAY_MS||1200);
const dryRunHoldMs=Number(process.env.DRY_RUN_HOLD_MS||8000);
const workerName=process.env.WORKER_NAME||'local-worker';
const automationToken=String(process.env.AUTOMATION_TOKEN||'').trim();
const deviceToken=String(process.env.DEVICE_TOKEN||'').trim();
const centralApiUrl=String(process.env.CENTRAL_API_URL||'').replace(/\/$/,'');
const workerPollMs=Math.max(3000,Number(process.env.WORKER_POLL_MS||5000));
const busyProfiles=new Set();
fs.mkdirSync(profileRoot,{recursive:true});
const validProfileKey=value=>/^[a-zA-Z0-9_-]{1,120}$/.test(String(value||''));
const validFacebookUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch{return false}};

function classifyError(e){
  const s=String(e?.message||e||'');
  if(/checkpoint/i.test(s)) return 'CHECKPOINT';
  if(/session|login|authenticated/i.test(s)) return 'SESSION_EXPIRED';
  if(/selector|comment box/i.test(s)) return 'SELECTOR_FAILED';
  if(/submit|send button/i.test(s)) return 'SUBMIT_UNCONFIRMED';
  if(/timeout/i.test(s)) return 'TIMEOUT';
  if(/net::|network|ERR_/i.test(s)) return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}
async function openProfile(profileKey){
  return launchProfile(profileKey,{profileRoot,headless});
}
async function classifyPage(page){
  const url=page.url();
  if(/checkpoint/i.test(url)) return 'CHECKPOINT';
  if(/login|recover/i.test(url)) return 'SESSION_EXPIRED';
  const loginInput=page.locator('input[name="email"]:visible').first();
  if(await loginInput.count().catch(()=>0)) return 'SESSION_EXPIRED';
  return 'READY';
}

async function findSendButton(page,box){
  const labelledSelectors=[
    'div[role="dialog"] [role="button"][aria-label*="bình luận" i]',
    'div[role="dialog"] [role="button"][aria-label*="comment" i]',
    'div[role="dialog"] [role="button"][aria-label*="gửi" i]',
    'div[role="dialog"] [role="button"][aria-label*="send" i]',
    'div[role="dialog"] button[aria-label*="bình luận" i]',
    'div[role="dialog"] button[aria-label*="comment" i]',
    'div[role="dialog"] button[aria-label*="gửi" i]',
    'div[role="dialog"] button[aria-label*="send" i]'
  ];
  for(const sel of labelledSelectors){
    const matches=page.locator(`${sel}:visible`);
    for(let i=(await matches.count().catch(()=>0))-1;i>=0;i--){
      const candidate=matches.nth(i);
      if(await candidate.isEnabled().catch(()=>false)) return {locator:candidate,method:`label:${sel}`};
    }
  }

  // Facebook frequently removes the accessible name from the blue paper-plane
  // button. In that case, choose the right-most enabled button on the same row
  // as the active comment editor. Emoji/GIF buttons are all to its left.
  const editorRect=await box.boundingBox();
  if(!editorRect) return null;
  const candidates=page.locator('div[role="dialog"] button:visible, div[role="dialog"] [role="button"]:visible');
  let best=null;
  for(let i=0,count=await candidates.count().catch(()=>0);i<count;i++){
    const candidate=candidates.nth(i);
    if(!await candidate.isEnabled().catch(()=>false)) continue;
    const rect=await candidate.boundingBox().catch(()=>null);
    if(!rect) continue;
    const centerY=rect.y+rect.height/2;
    const centerX=rect.x+rect.width/2;
    const editorCenterY=editorRect.y+editorRect.height/2;
    const sameRow=Math.abs(centerY-editorCenterY)<=Math.max(32,editorRect.height/2);
    const onRight=centerX>editorRect.x+editorRect.width*0.55;
    const compact=rect.width<=96&&rect.height<=96;
    if(sameRow&&onRight&&compact&&(!best||centerX>best.centerX)) best={locator:candidate,centerX,method:'geometry:rightmost'};
  }
  return best;
}

app.get('/health',(_req,res)=>res.json({ok:true,workerName,headless,defaultDryRun,busyCount:busyProfiles.size}));
app.use((req,res,next)=>{
  if(!automationToken) return next();
  const supplied=req.get('x-automation-token')||req.get('x-device-token')||String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(supplied!==automationToken&&supplied!==deviceToken) return res.status(401).json({ok:false,errorCode:'UNAUTHORIZED',error:'Unauthorized'});
  next();
});
app.get('/profiles',(_req,res)=>{
  const profiles=fs.readdirSync(profileRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({profileKey:x.name,busy:busyProfiles.has(x.name)}));
  res.json(profiles);
});
app.post('/profiles/status',async(req,res)=>{
  const {profileKey,deep=false}=req.body||{};
  if(!validProfileKey(profileKey)) return res.status(400).json({ok:false,error:'invalid profileKey'});
  const dir=path.join(profileRoot,String(profileKey));
  if(!fs.existsSync(dir)) return res.json({ok:true,profileKey,status:'UNKNOWN',exists:false});
  if(!deep) return res.json({ok:true,profileKey,status:'UNKNOWN',exists:true,busy:busyProfiles.has(profileKey)});
  if(busyProfiles.has(profileKey)) return res.status(409).json({ok:false,errorCode:'WORKER_BUSY',error:'profile is busy'});
  busyProfiles.add(profileKey);
  let ctx;
  try{
    ctx=await openProfile(profileKey);
    const page=ctx.pages()[0]||await ctx.newPage();
    page.setDefaultTimeout(navTimeout);
    await page.goto('https://www.facebook.com/',{waitUntil:'domcontentloaded',timeout:navTimeout});
    await page.waitForTimeout(700);
    const status=await classifyPage(page);
    res.json({ok:true,profileKey,status,exists:true});
  }catch(e){res.status(500).json({ok:false,errorCode:classifyError(e),error:String(e.message||e)});}
  finally{if(ctx) await ctx.close().catch(()=>{}); busyProfiles.delete(profileKey);}
});

app.post('/execute',async(req,res)=>{
  const {runId,profileKey,postUrl,commentText,dryRun,idempotencyKey,progressUrl,guardUrl}=req.body||{};
  if(!runId||!profileKey||!postUrl||!commentText) return res.status(400).json({ok:false,errorCode:'BAD_REQUEST',error:'runId, profileKey, postUrl, commentText required'});
  if(!validProfileKey(profileKey)||!validFacebookUrl(postUrl)) return res.status(400).json({ok:false,errorCode:'BAD_REQUEST',error:'Invalid profile key or Facebook URL'});
  if(busyProfiles.has(profileKey)) return res.status(409).json({ok:false,errorCode:'WORKER_BUSY',error:'profile is already executing another job'});
  busyProfiles.add(profileKey);
  const effectiveDryRun=defaultDryRun||!!dryRun;
  let ctx; let submitAttempted=false;
  const apiHeaders={'Content-Type':'application/json',...(automationToken?{'x-automation-token':automationToken}:{})};
  const progress=async stage=>{if(!progressUrl)return;const r=await fetch(progressUrl,{method:'POST',headers:apiHeaders,body:JSON.stringify({stage,idempotencyKey})});if(!r.ok)throw new Error(`Job state changed before ${stage}`)};
  try{
    await progress('OPENING_BROWSER');
    ctx=await openProfile(profileKey);
    const page=ctx.pages()[0]||await ctx.newPage();
    page.setDefaultTimeout(navTimeout);
    await progress('NAVIGATING');
    await page.goto(postUrl,{waitUntil:'domcontentloaded',timeout:navTimeout});
    await page.waitForTimeout(actionDelay);
    const pageStatus=await classifyPage(page);
    if(pageStatus==='CHECKPOINT') throw new Error('Facebook checkpoint detected');
    if(pageStatus==='SESSION_EXPIRED') throw new Error('Facebook session expired or login required');

    await progress('LOCATING_COMMENT_BOX');
    const selectors=[
      'div[role="dialog"] [aria-label*="bình luận" i][contenteditable="true"]',
      'div[role="dialog"] [aria-label*="comment" i][contenteditable="true"]',
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      '[aria-label*="bình luận" i][contenteditable="true"]',
      '[aria-label*="comment" i][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]'
    ];
    let box=null;
    for(const sel of selectors){
      const loc=page.locator(`${sel}:visible`).first();
      if(await loc.count().catch(()=>0)){ box=loc; break; }
    }
    if(!box) throw new Error('Comment box selector not found');
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await page.waitForTimeout(250);
    await progress('TYPING');
    await page.keyboard.insertText(commentText);
    await page.waitForTimeout(700);
    const typedText=String(await box.textContent().catch(()=>'' )).replace(/\s+/g,' ').trim();
    const expected=String(commentText).replace(/\s+/g,' ').trim();
    if(typedText!==expected) throw new Error('Comment box verification failed after typing');
    if(effectiveDryRun){
      await page.waitForTimeout(Math.max(1500,dryRunHoldMs));
      return res.json({ok:true,dryRun:true,workerName,message:'Typed and verified; not submitted'});
    }
    if(!page.url().includes('facebook.com')) throw new Error('Current page is not Facebook');
    const finalSession=await classifyPage(page);
    if(finalSession!=='READY') throw new Error(finalSession==='CHECKPOINT'?'Facebook checkpoint detected':'Facebook session expired');
    if(!guardUrl) throw new Error('Missing final submit guard');
    const guard=await fetch(guardUrl,{method:'POST',headers:apiHeaders,body:JSON.stringify({idempotencyKey})});
    if(!guard.ok) throw new Error('Job is no longer authorized to submit');
    const sendTarget=await findSendButton(page,box);
    if(!sendTarget) throw new Error('Comment send button not found');
    console.log(`[run ${runId}] submitting comment via ${sendTarget.method}`);
    await progress('SUBMITTING');
    submitAttempted=true;
    await sendTarget.locator.click({timeout:5000});
    await progress('VERIFYING');
    let submitted=false;
    for(let i=0;i<12;i++){
      await page.waitForTimeout(500);
      const posted=page.getByText(commentText,{exact:true}).last();
      if(await posted.isVisible().catch(()=>false)){submitted=true;break;}
    }
    if(!submitted) return res.json({ok:false,outcome:'UNKNOWN',errorCode:'SUBMIT_UNCONFIRMED',error:`Clicked ${sendTarget.method}, but the posted comment could not be verified`,workerName});
    await progress('SUCCESS');
    res.json({ok:true,outcome:'SUCCESS',dryRun:false,workerName,message:`Comment submitted and verified via ${sendTarget.method}`});
  }catch(e){
    let errorCode=classifyError(e);
    if(!submitAttempted&&errorCode==='NETWORK_ERROR')errorCode='NETWORK_ERROR_BEFORE_SUBMIT';
    if(!submitAttempted&&errorCode==='TIMEOUT')errorCode='PAGE_LOAD_FAILED';
    res.status(errorCode==='WORKER_BUSY'?409:500).json({ok:false,outcome:submitAttempted?'UNKNOWN':'FAILED',errorCode,error:String(e.message||e),workerName});
  }finally{
    if(ctx) await ctx.close().catch(()=>{});
    busyProfiles.delete(profileKey);
  }
});

async function reportHeartbeat(currentJobId=null){if(!centralApiUrl||!deviceToken)return;try{await fetch(`${centralApiUrl}/api/workers/heartbeat`,{method:'POST',headers:{'Content-Type':'application/json','x-device-token':deviceToken},body:JSON.stringify({currentJobId,defaultDryRun}),signal:AbortSignal.timeout(5000)})}catch(e){console.warn(`[worker] heartbeat failed: ${e.message}`)}}
let polling=false;
async function claimAndExecute(){if(!centralApiUrl||!deviceToken||polling)return;polling=true;try{const r=await fetch(`${centralApiUrl}/api/worker/jobs/claim-next`,{method:'POST',headers:{'x-device-token':deviceToken},signal:AbortSignal.timeout(8000)});if(r.status===204)return;const job=await r.json();if(!r.ok)throw new Error(job.error||`claim HTTP ${r.status}`);await reportHeartbeat(job.id);const local=await fetch(`http://127.0.0.1:${port}/execute`,{method:'POST',headers:{'Content-Type':'application/json','x-device-token':deviceToken},body:JSON.stringify(job),signal:AbortSignal.timeout(120000)});const result=await local.json().catch(()=>({ok:false,errorCode:'UNKNOWN_ERROR',error:`Worker HTTP ${local.status}`}));await fetch(`${centralApiUrl}/api/automation/jobs/${job.id}/result`,{method:'POST',headers:{'Content-Type':'application/json','x-device-token':deviceToken},body:JSON.stringify({ok:!!result.ok,skipped:!!result.dryRun,outcome:result.outcome||null,errorCode:result.errorCode||null,errorMessage:result.error||null,idempotencyKey:job.idempotency_key}),signal:AbortSignal.timeout(10000)});await reportHeartbeat(null)}catch(e){console.warn(`[worker] claim/execute failed: ${e.message}`)}finally{polling=false}}
app.listen(port,'127.0.0.1',()=>{console.log(`Browser Worker v2 ${workerName} listening on 127.0.0.1:${port}; DRY_RUN=${defaultDryRun}`);if(centralApiUrl&&deviceToken){reportHeartbeat();setInterval(()=>reportHeartbeat(busyProfiles.size? 'busy':null),20000);setInterval(claimAndExecute,workerPollMs);console.log(`[worker] outbound polling ${centralApiUrl} every ${workerPollMs}ms`)}});
