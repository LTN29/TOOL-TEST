import fs from 'node:fs/promises';
import path from 'node:path';

const targets=new Set(['win32-x64','darwin-arm64']);
const safeName=/^SIMI-Automation-[0-9]+\.[0-9]+\.[0-9]+-(x64|arm64)\.(exe|dmg)$/;
const versionPattern=/^[0-9]+\.[0-9]+\.[0-9]+$/;

export async function loadDesktopUpdate(directory,platform,arch){
  const target=`${platform}-${arch}`;
  if(!targets.has(target))return null;
  let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(directory,`latest-${target}.json`),'utf8'))}
  catch(error){if(error.code==='ENOENT')return null;throw error}
  if(!versionPattern.test(manifest.version||'')||!safeName.test(manifest.fileName||'')||
    !/^[a-f0-9]{64}$/.test(manifest.sha256||'')||!Number.isSafeInteger(manifest.size)||manifest.size<=0)
    throw new Error('Desktop update manifest không hợp lệ');
  const expectedSuffix=platform==='win32'?`-x64.exe`:`-arm64.dmg`;
  if(!manifest.fileName.endsWith(expectedSuffix)||!manifest.fileName.includes(`-${manifest.version}-`))
    throw new Error('Desktop update manifest không khớp phiên bản/nền tảng');
  const filePath=path.join(directory,manifest.fileName);
  const stat=await fs.stat(filePath);
  if(!stat.isFile()||stat.size!==manifest.size)throw new Error('Desktop update artifact thiếu hoặc sai kích thước');
  return {...manifest,filePath};
}
