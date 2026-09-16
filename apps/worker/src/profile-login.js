import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const validProfileKey=value=>/^[a-zA-Z0-9_-]{1,120}$/.test(String(value||''));

export async function launchProfile(profileKey,{profileRoot,headless=false,channel}={}){
  if(!validProfileKey(profileKey))throw new Error('Mã phiên Facebook không hợp lệ');
  const root=path.resolve(profileRoot||process.env.PROFILE_ROOT||'./profiles');
  const profileDir=path.join(root,profileKey);
  fs.mkdirSync(profileDir,{recursive:true});
  return chromium.launchPersistentContext(profileDir,{headless,channel:channel||process.env.PLAYWRIGHT_CHANNEL||undefined,viewport:{width:1365,height:850},locale:'vi-VN'});
}

export async function openLoginSession(profileKey,options={}){
  const context=await launchProfile(profileKey,{...options,headless:false});
  try{
    const page=context.pages()[0]||await context.newPage();
    await page.goto('https://www.facebook.com/',{waitUntil:'domcontentloaded'});
    return {context,page};
  }catch(error){await context.close().catch(()=>{});throw error}
}

export async function verifyProfileSession(session){
  const page=session.page||session.context.pages()[0];
  if(!page)return 'UNKNOWN';
  const url=page.url();
  if(/checkpoint/i.test(url))return 'CHECKPOINT';
  if(/login|recover/i.test(url))return 'SESSION_EXPIRED';
  if(await page.locator('input[name="email"]:visible').count().catch(()=>0))return 'SESSION_EXPIRED';
  return 'READY';
}

export async function closeAndSaveLoginSession(session){
  const status=await verifyProfileSession(session).catch(()=> 'UNKNOWN');
  await session.context.close();
  return status;
}
