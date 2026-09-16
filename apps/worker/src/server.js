import 'dotenv/config';
import express from 'express';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

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
const busyProfiles=new Set();
fs.mkdirSync(profileRoot,{recursive:true});
const validProfileKey=value=>/^[a-zA-Z0-9_-]{1,120}$/.test(String(value||''));
const validFacebookUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch{return false}};

function classifyError(e){
  const s=String(e?.message||e||'');
  if(/checkpoint/i.test(s)) return 'CHECKPOINT';
  if(/session|login|authenticated/i.test(s)) return 'SESSION_EXPIRED';
  if(/selector|comment box/i.test(s)) return 'SELECTOR_FAILED';
  if(/timeout/i.test(s)) return 'TIMEOUT';
  if(/net::|network|ERR_/i.test(s)) return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}
async function openProfile(profileKey){
  const profileDir=path.join(profileRoot,String(profileKey));
  fs.mkdirSync(profileDir,{recursive:true});
  return chromium.launchPersistentContext(profileDir,{headless,viewport:{width:1365,height:850},locale:'vi-VN'});
}
async function classifyPage(page){
  const url=page.url();
  if(/checkpoint/i.test(url)) return 'CHECKPOINT';
  if(/login|recover/i.test(url)) return 'SESSION_EXPIRED';
  const loginInput=page.locator('input[name="email"]:visible').first();
  if(await loginInput.count().catch(()=>0)) return 'SESSION_EXPIRED';
  return 'READY';
}

app.get('/health',(_req,res)=>res.json({ok:true,workerName,headless,defaultDryRun,busyCount:busyProfiles.size}));
app.use((req,res,next)=>{
  if(!automationToken) return next();
  const supplied=req.get('x-automation-token')||String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(supplied!==automationToken) return res.status(401).json({ok:false,errorCode:'UNAUTHORIZED',error:'Unauthorized'});
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
  const {runId,profileKey,postUrl,commentText,dryRun}=req.body||{};
  if(!runId||!profileKey||!postUrl||!commentText) return res.status(400).json({ok:false,errorCode:'BAD_REQUEST',error:'runId, profileKey, postUrl, commentText required'});
  if(!validProfileKey(profileKey)||!validFacebookUrl(postUrl)) return res.status(400).json({ok:false,errorCode:'BAD_REQUEST',error:'Invalid profile key or Facebook URL'});
  if(busyProfiles.has(profileKey)) return res.status(409).json({ok:false,errorCode:'WORKER_BUSY',error:'profile is already executing another job'});
  busyProfiles.add(profileKey);
  const effectiveDryRun=defaultDryRun||!!dryRun;
  let ctx;
  try{
    ctx=await openProfile(profileKey);
    const page=ctx.pages()[0]||await ctx.newPage();
    page.setDefaultTimeout(navTimeout);
    await page.goto(postUrl,{waitUntil:'domcontentloaded',timeout:navTimeout});
    await page.waitForTimeout(actionDelay);
    const pageStatus=await classifyPage(page);
    if(pageStatus==='CHECKPOINT') throw new Error('Facebook checkpoint detected');
    if(pageStatus==='SESSION_EXPIRED') throw new Error('Facebook session expired or login required');

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
    await page.keyboard.insertText(commentText);
    await page.waitForTimeout(700);
    const typedText=String(await box.textContent().catch(()=>'' )).replace(/\s+/g,' ').trim();
    const expected=String(commentText).replace(/\s+/g,' ').trim();
    if(!typedText.includes(expected)) throw new Error('Comment box verification failed after typing');
    if(effectiveDryRun){
      await page.waitForTimeout(Math.max(1500,dryRunHoldMs));
      return res.json({ok:true,dryRun:true,workerName,message:'Typed and verified; not submitted'});
    }
    const sendSelectors=[
      'div[role="dialog"] [role="button"][aria-label="Bình luận"]',
      'div[role="dialog"] [role="button"][aria-label="Comment"]',
      'div[role="dialog"] [role="button"][aria-label="Gửi"]',
      'div[role="dialog"] [role="button"][aria-label="Send"]',
      'div[role="dialog"] button[aria-label="Bình luận"]',
      'div[role="dialog"] button[aria-label="Comment"]'
    ];
    let sendButton=null;
    for(const sel of sendSelectors){
      const loc=page.locator(`${sel}:visible`).last();
      if(await loc.count().catch(()=>0)){ sendButton=loc; break; }
    }
    if(sendButton) await sendButton.click();
    else await box.press('Enter');

    let submitted=false;
    for(let i=0;i<12;i++){
      await page.waitForTimeout(500);
      const remaining=String(await box.textContent().catch(()=>'')).replace(/\s+/g,' ').trim();
      if(!remaining.includes(expected)){ submitted=true; break; }
    }
    if(!submitted) throw new Error('Comment submit was not confirmed');
    res.json({ok:true,dryRun:false,workerName,message:sendButton?'Send button clicked and confirmed':'Enter submitted and confirmed'});
  }catch(e){
    const errorCode=classifyError(e);
    res.status(errorCode==='WORKER_BUSY'?409:500).json({ok:false,errorCode,error:String(e.message||e),workerName});
  }finally{
    if(ctx) await ctx.close().catch(()=>{});
    busyProfiles.delete(profileKey);
  }
});

app.listen(port,'0.0.0.0',()=>console.log(`Browser Worker v2 ${workerName} listening on :${port}; DRY_RUN=${defaultDryRun}`));
