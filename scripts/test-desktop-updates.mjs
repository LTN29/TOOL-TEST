import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {loadDesktopUpdate} from '../apps/api/src/desktop-updates.js';

const require=createRequire(import.meta.url);
const {compareVersions,validateManifest,updateBaseUrl}=require('../apps/desktop/src/main/update-manager.cjs');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'simi-updates-'));
try{
  assert.equal(compareVersions('0.2.0','0.1.9'),1);
  assert.equal(compareVersions('0.2.0','0.2.0'),0);
  assert.equal(compareVersions('0.1.9','0.2.0'),-1);
  assert.throws(()=>compareVersions('not-a-version','0.2.0'));
  assert.equal(updateBaseUrl('https://updates.example.test/'),'https://updates.example.test');
  assert.throws(()=>updateBaseUrl('http://remote.example.test'));
  const fileName='SIMI-Automation-0.2.0-x64.exe';
  const manifest={version:'0.2.0',fileName,sha256:'a'.repeat(64),size:4};
  validateManifest(manifest,'win32','x64');
  assert.throws(()=>validateManifest({...manifest,fileName:'../other.exe'},'win32','x64'));
  await fs.writeFile(path.join(directory,fileName),'test');
  await fs.writeFile(path.join(directory,'latest-win32-x64.json'),JSON.stringify(manifest));
  assert.equal((await loadDesktopUpdate(directory,'win32','x64')).fileName,fileName);
  assert.equal(await loadDesktopUpdate(directory,'darwin','arm64'),null);
  assert.equal(await loadDesktopUpdate(directory,'linux','x64'),null);
  await fs.writeFile(path.join(directory,'latest-win32-x64.json'),JSON.stringify({...manifest,fileName:'../other.exe'}));
  await assert.rejects(()=>loadDesktopUpdate(directory,'win32','x64'));
  console.log('Desktop update checks passed');
}finally{
  await fs.rm(directory,{recursive:true,force:true});
}
