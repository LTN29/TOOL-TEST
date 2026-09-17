const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {shell}=require('electron');

function compareVersions(left,right){
  const parse=value=>String(value).split('.').map(Number);
  const a=parse(left),b=parse(right);
  if(a.length!==3||b.length!==3||[...a,...b].some(v=>!Number.isSafeInteger(v)||v<0))
    throw new Error('Phiên bản cập nhật không hợp lệ');
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
  return 0;
}
function validateManifest(value,platform,arch){
  const extension=platform==='win32'?'exe':'dmg';
  if(!/^\d+\.\d+\.\d+$/.test(value?.version||'')||
    value.fileName!==`SIMI-Automation-${value.version}-${arch}.${extension}`||
    !/^[a-f0-9]{64}$/.test(value.sha256||'')||
    !Number.isSafeInteger(value.size)||value.size<=0)
    throw new Error('Thông tin bản cập nhật không hợp lệ');
  return value;
}
function updateBaseUrl(raw){
  const url=new URL(raw);
  if(url.username||url.password||url.search||url.hash)throw new Error('Server URL không hợp lệ');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))
    throw new Error('Tải bộ cài chỉ được phép qua HTTPS (hoặc localhost)');
  return url.href.replace(/\/$/,'');
}
async function fileHash(file){
  const hash=createHash('sha256');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
function createUpdateManager({app,getServerUrl,getDeviceToken,getAccessHeaders=()=>({}),onStatus}){
  const platform=process.platform,arch=process.arch,currentVersion=app.getVersion();
  const supported=(platform==='win32'&&arch==='x64')||(platform==='darwin'&&arch==='arm64');
  let manifest=null,downloadedPath='',busy=false;
  let state={phase:supported?'idle':'unsupported',currentVersion,latestVersion:null,progress:0,message:''};
  const emit=change=>{state={...state,...change};onStatus({...state})};
  const status=()=>({...state});
  function credentials(){
    const token=getDeviceToken();
    if(!token)throw new Error('Hãy đăng ký thiết bị trước khi kiểm tra cập nhật');
    return {base:updateBaseUrl(getServerUrl()),headers:{...getAccessHeaders(),'x-device-token':token}};
  }
  async function check(){
    if(busy)throw new Error('Đang tải bản cập nhật');
    if(!supported||!app.isPackaged){emit({phase:'unsupported',message:'Chỉ kiểm tra cập nhật trên app đã cài'});return status()}
    const {base,headers}=credentials();
    emit({phase:'checking',message:'Đang kiểm tra bản mới…'});
    try{
      const response=await fetch(`${base}/api/desktop-updates/latest?platform=${platform}&arch=${arch}`,{
        headers,redirect:'error',signal:AbortSignal.timeout(10000)
      });
      if(response.status===404){emit({phase:'unavailable',message:'Máy chủ chưa phát hành bộ cài cho hệ điều hành này'});return status()}
      if(!response.ok)throw new Error(`Máy chủ trả về HTTP ${response.status}`);
      const candidate=validateManifest(await response.json(),platform,arch);
      if(compareVersions(candidate.version,currentVersion)<=0){
        manifest=null;downloadedPath='';
        emit({phase:'current',latestVersion:candidate.version,progress:0,message:'Bạn đang dùng phiên bản mới nhất'});
      }else{
        if(manifest?.sha256!==candidate.sha256)downloadedPath='';
        manifest=candidate;
        emit({phase:downloadedPath?'ready':'available',latestVersion:candidate.version,progress:downloadedPath?100:0,message:`Có bản mới ${candidate.version}`});
      }
      return status();
    }catch(error){emit({phase:'error',message:error.message});throw error}
  }
  async function download(){
    if(busy)throw new Error('Đang tải bản cập nhật');
    if(!manifest||compareVersions(manifest.version,currentVersion)<=0)throw new Error('Chưa có bản cập nhật mới');
    const {base,headers}=credentials();
    const directory=path.join(app.getPath('userData'),'updates',manifest.version);
    const destination=path.join(directory,manifest.fileName);
    const temporary=`${destination}.part`;
    busy=true;
    emit({phase:'downloading',progress:0,message:'Đang tải bản cập nhật…'});
    try{
      await fsp.mkdir(directory,{recursive:true});
      if(await fsp.stat(destination).then(s=>s.size===manifest.size).catch(()=>false)&&
        await fileHash(destination)===manifest.sha256){
        downloadedPath=destination;
        emit({phase:'ready',progress:100,message:'Đã tải và xác minh bộ cài'});
        return status();
      }
      const response=await fetch(`${base}/api/desktop-updates/download?platform=${platform}&arch=${arch}`,{
        headers,redirect:'error',signal:AbortSignal.timeout(15*60*1000)
      });
      if(!response.ok||!response.body)throw new Error(`Tải bộ cài thất bại (HTTP ${response.status})`);
      const hash=createHash('sha256');
      let received=0,lastReported=0;
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({transform(chunk,_encoding,callback){
          received+=chunk.length;hash.update(chunk);
          if(Date.now()-lastReported>500){
            lastReported=Date.now();
            emit({progress:Math.min(99,Math.floor(received/manifest.size*100))});
          }
          callback(null,chunk);
        }}),
        fs.createWriteStream(temporary,{flags:'w'})
      );
      if(received!==manifest.size||hash.digest('hex')!==manifest.sha256)
        throw new Error('Bộ cài tải về không khớp SHA-256/kích thước');
      await fsp.rename(temporary,destination);
      downloadedPath=destination;
      emit({phase:'ready',progress:100,message:'Đã tải và xác minh bộ cài'});
      return status();
    }catch(error){
      await fsp.rm(temporary,{force:true}).catch(()=>{});
      emit({phase:'error',message:error.message});
      throw error;
    }finally{busy=false}
  }
  async function openInstaller(){
    if(!manifest||!downloadedPath)throw new Error('Chưa tải bộ cài');
    const stat=await fsp.stat(downloadedPath);
    if(stat.size!==manifest.size||await fileHash(downloadedPath)!==manifest.sha256)
      throw new Error('Bộ cài đã thay đổi; hãy tải lại');
    const error=await shell.openPath(downloadedPath);
    if(error)throw new Error(error);
    return status();
  }
  return {status,check,download,openInstaller};
}
module.exports={createUpdateManager,compareVersions,validateManifest,updateBaseUrl};
