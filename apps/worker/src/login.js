import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const profileKey=process.argv[2];
if(!profileKey){ console.error('Usage: npm run login -- <profileKey>'); process.exit(1); }
if(!/^[a-zA-Z0-9_-]{1,120}$/.test(profileKey)){ console.error('profileKey may only contain letters, numbers, underscore and hyphen'); process.exit(1); }
const profileDir=path.resolve(process.env.PROFILE_ROOT||'./profiles',profileKey);
fs.mkdirSync(profileDir,{recursive:true});
const ctx=await chromium.launchPersistentContext(profileDir,{headless:false,viewport:{width:1365,height:850},locale:'vi-VN'});
const page=ctx.pages()[0]||await ctx.newPage();
await page.goto('https://www.facebook.com/',{waitUntil:'domcontentloaded'});
console.log(`Profile ${profileKey}: login manually, complete 2FA if requested, then close the browser.`);
await new Promise(resolve=>ctx.on('close',resolve));
