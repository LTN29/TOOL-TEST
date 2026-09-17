import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [platform,arch,source]=process.argv.slice(2);
const supported=new Set(['win32-x64','darwin-arm64']);
if(!supported.has(`${platform}-${arch}`)||!source){
  console.error('Usage: node scripts/publish-desktop-update.mjs <win32 x64|darwin arm64> <installer path>');
  process.exit(1);
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const desktopPackage=JSON.parse(await fs.readFile(path.join(root,'apps/desktop/package.json'),'utf8'));
const version=desktopPackage.version;
const extension=platform==='win32'?'exe':'dmg';
const fileName=`SIMI-Automation-${version}-${arch}.${extension}`;
const sourcePath=path.resolve(source);
if(path.basename(sourcePath)!==fileName)throw new Error(`Tên bộ cài phải là ${fileName}`);
const directory=path.join(root,'updates');
await fs.mkdir(directory,{recursive:true});
const destination=path.join(directory,fileName);
const stat=await fs.stat(sourcePath);
if(!stat.isFile()||stat.size===0)throw new Error('Bộ cài trống hoặc không phải file');
async function sha256(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
const digest=await sha256(sourcePath);
const existing=await fs.stat(destination).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
if(existing){
  if(existing.size!==stat.size||await sha256(destination)!==digest)
    throw new Error('Phiên bản này đã phát hành với nội dung khác; hãy tăng version');
}else if(sourcePath!==destination){
  const temporaryArtifact=`${destination}.tmp`;
  await fs.copyFile(sourcePath,temporaryArtifact);
  await fs.rename(temporaryArtifact,destination);
}
const manifest={version,fileName,sha256:digest,size:stat.size};
const finalManifest=path.join(directory,`latest-${platform}-${arch}.json`);
const temporaryManifest=`${finalManifest}.tmp`;
await fs.writeFile(temporaryManifest,JSON.stringify(manifest,null,2)+'\n');
await fs.rename(temporaryManifest,finalManifest);
console.log(`Published ${fileName} (${stat.size} bytes) to ${directory}`);
