const {app,BrowserWindow,Tray,Menu,nativeImage,shell,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {ManagedService}=require('./process-manager.cjs');
const {createUpdateManager}=require('./update-manager.cjs');
const {pathToFileURL}=require('node:url');
const os=require('node:os');
const crypto=require('node:crypto');

if(!app.requestSingleInstanceLock()){app.quit();process.exit(0)}
const isDev=!app.isPackaged;
const projectRoot=path.resolve(__dirname,'../../../..');
const backendRoot=isDev?path.join(projectRoot,'apps'):path.join(process.resourcesPath,'backend');
if(!isDev)process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(process.resourcesPath,'playwright-browsers');
const userData=app.getPath('userData');
const settingsFile=path.join(userData,'settings.json');
const logs=[];
let window=null,tray=null,quitting=false,worker=null,updates=null;
let loginSession=null,loginWorkerWasRunning=false;
const defaults={startWorker:true,continueOnClose:true,openAtLogin:false,serverUrl:'http://127.0.0.1:4300',workerKey:'',deviceName:'',deviceOs:process.platform,appVersion:app.getVersion()};
const tokenFile=path.join(userData,'device-token.bin');
const cloudflareTokenFile=path.join(userData,'cloudflare-service-token.bin');
function getDeviceToken(){try{if(!fs.existsSync(tokenFile)||!require('electron').safeStorage.isEncryptionAvailable())return '';return require('electron').safeStorage.decryptString(fs.readFileSync(tokenFile))}catch{return ''}}
function saveDeviceToken(token){if(!require('electron').safeStorage.isEncryptionAvailable())throw new Error('OS secure storage chưa khả dụng');fs.writeFileSync(tokenFile,require('electron').safeStorage.encryptString(token),{mode:0o600})}
function cloudflareCredentials(){
  const clientId=String(process.env.CF_ACCESS_CLIENT_ID||'').trim(),clientSecret=String(process.env.CF_ACCESS_CLIENT_SECRET||'').trim();
  if(clientId&&clientSecret)return {clientId,clientSecret};
  try{if(!fs.existsSync(cloudflareTokenFile)||!require('electron').safeStorage.isEncryptionAvailable())return null;const saved=JSON.parse(require('electron').safeStorage.decryptString(fs.readFileSync(cloudflareTokenFile)));return /^[A-Za-z0-9._-]{8,300}$/.test(saved.clientId||'')&&String(saved.clientSecret||'').length>=16?{clientId:saved.clientId,clientSecret:saved.clientSecret}:null}catch{return null}
}
function saveCloudflareCredentials(clientId,clientSecret){
  if(!clientId&&!clientSecret)return;
  if(!/^[A-Za-z0-9._-]{8,300}$/.test(String(clientId||''))||String(clientSecret||'').length<16)throw new Error('Cloudflare Service Token không hợp lệ');
  if(!require('electron').safeStorage.isEncryptionAvailable())throw new Error('OS secure storage chưa khả dụng');
  fs.writeFileSync(cloudflareTokenFile,require('electron').safeStorage.encryptString(JSON.stringify({clientId:String(clientId),clientSecret:String(clientSecret)})),{mode:0o600});
}
function cloudflareHeaders(override={}){const credentials=override.clientId&&override.clientSecret?override:cloudflareCredentials();return credentials?{'CF-Access-Client-Id':credentials.clientId,'CF-Access-Client-Secret':credentials.clientSecret}:{}}
function pairingServer(key){
  const parts=String(key||'').trim().split('.');
  if(parts.length!==3||parts[0]!=='SIMI1'||!/^[A-Za-z0-9_-]{40,64}$/.test(parts[2]))throw new Error('Mã kết nối không hợp lệ');
  const raw=Buffer.from(parts[1],'base64url').toString('utf8');
  let url;try{url=new URL(raw)}catch{throw new Error('Địa chỉ máy chủ trong mã không hợp lệ')}
  if(url.origin!==raw||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Mã chỉ chấp nhận HTTPS; HTTP chỉ dùng trên chính Mac mini');
  if(Buffer.from(raw).toString('base64url')!==parts[1])throw new Error('Mã kết nối không hợp lệ');
  return url.origin;
}

function getSettings(){try{return {...defaults,...JSON.parse(fs.readFileSync(settingsFile,'utf8'))}}catch{return {...defaults}}}
function writeLog(source,message){
  for(const line of String(message).split(/\r?\n/).filter(Boolean))logs.push({at:new Date().toISOString(),source,message:line.slice(0,1200)});
  if(logs.length>500)logs.splice(0,logs.length-500);
}
function changed(){updateTray();window?.webContents.send('simi:status-changed')}
function backendEnv(port){const settings=getSettings(),cf=cloudflareCredentials()||{};return {...process.env,PORT:String(port),HOST:'127.0.0.1',PROFILE_ROOT:path.join(userData,'profiles'),PLAYWRIGHT_BROWSERS_PATH:isDev?(process.env.PLAYWRIGHT_BROWSERS_PATH||''):path.join(process.resourcesPath,'playwright-browsers'),PLAYWRIGHT_CHANNEL:'',DRY_RUN:'true',CENTRAL_API_URL:settings.serverUrl,DEVICE_TOKEN:getDeviceToken(),CF_ACCESS_CLIENT_ID:cf.clientId||'',CF_ACCESS_CLIENT_SECRET:cf.clientSecret||'',WORKER_NAME:settings.workerKey||'desktop-worker'}}
function makeServices(){
  worker=new ManagedService({name:'WORKER',port:4311,script:path.join(backendRoot,'worker','src','server.js'),cwd:userData,env:backendEnv(4311),identity:b=>b.ok===true&&typeof b.workerName==='string',onLog:writeLog,onChange:changed});
}
async function httpReady(url,headers={}){try{return (await fetch(url,{headers,signal:AbortSignal.timeout(2500)})).ok}catch{return false}}
async function systemStatus(){
  const serverUrl=getSettings().serverUrl.replace(/\/$/,'');
  const token=getDeviceToken();
  const [centralOnline,deviceAuthenticated]=await Promise.all([httpReady(`${serverUrl}/health`,cloudflareHeaders()),token?httpReady(`${serverUrl}/api/dashboard`,{...cloudflareHeaders(),'x-device-token':token}):Promise.resolve(false)]);
  return {centralApi:centralOnline?'RUNNING':'STOPPED',worker:worker.snapshot(),serverUrl,deviceRegistered:!!token,deviceAuthenticated};
}
function showWindow(){if(!window)return;window.show();window.focus();if(process.platform==='darwin')app.dock?.show()}
function trayIcon(){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect x="1" y="1" width="16" height="16" rx="5" fill="#16335a"/><circle cx="9" cy="9" r="4" fill="#ffffff"/></svg>';
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function updateTray(){
  if(!tray)return;
  const menu=Menu.buildFromTemplate([
    {label:'SIMI Automation',enabled:false},
    {label:'Mở SIMI Automation',click:showWindow},
    {type:'separator'},
    {label:`Worker: ${worker?.state||'STOPPED'}`,enabled:false},
    {label:'Kiểm tra hệ thống',click:()=>window?.webContents.send('simi:status-changed')},
    {type:'separator'},
    {label:'Khởi động lại Worker',click:()=>worker?.restart().catch(e=>writeLog('DESKTOP',e.message))},
    {type:'separator'},
    {label:'Thoát SIMI Automation',click:()=>{quitting=true;app.quit()}}
  ]);
  tray.setContextMenu(menu);tray.setToolTip('SIMI Automation');
}
function createWindow(){
  window=new BrowserWindow({width:1440,height:900,minWidth:1000,minHeight:700,title:'SIMI Automation',backgroundColor:'#f5f7fa',webPreferences:{preload:path.join(__dirname,'../preload/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/(www\.)?facebook\.com\//.test(url))shell.openExternal(url);return {action:'deny'}});
  window.webContents.on('will-navigate',(event,url)=>{if(isDev? !url.startsWith('http://127.0.0.1:5173/') : !url.startsWith('file://'))event.preventDefault()});
  window.on('close',event=>{if(!quitting&&getSettings().continueOnClose){event.preventDefault();window.hide();if(process.platform==='darwin')app.dock?.hide()}});
  if(isDev)window.loadURL('http://127.0.0.1:5173');else window.loadFile(path.join(process.resourcesPath,'renderer','index.html'));
}
async function openFacebookLogin(profileKey){
  if(loginSession)throw new Error('Đang có phiên đăng nhập Facebook khác');
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(String(profileKey||'')))throw new Error('Mã phiên không hợp lệ');
  const settings=getSettings(),token=getDeviceToken();
  if(!token)throw new Error('Hãy đăng ký thiết bị trước khi đăng nhập Facebook');
  const response=await fetch(`${settings.serverUrl.replace(/\/$/,'')}/api/accounts`,{headers:{...cloudflareHeaders(),'x-device-token':token},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Central API từ chối kiểm tra tài khoản (${response.status})`);
  const account=(await response.json()).find(item=>item.profile_key===profileKey);
  if(!account)throw new Error('Tài khoản chưa được lưu trong SIMI');
  if(account.worker_key!==settings.workerKey)throw new Error('Tài khoản này chưa được gán cho máy hiện tại');
  if(worker.owner==='external')throw new Error('Worker đang chạy ngoài app; hãy dừng Worker đó trước khi đăng nhập');
  loginWorkerWasRunning=worker.state==='RUNNING';
  if(worker.child)worker.stop();
  try{
    const modulePath=path.join(backendRoot,'worker','src','profile-login.js');
    const {openLoginSession}=await import(pathToFileURL(modulePath).href);
    loginSession=await openLoginSession(profileKey,{profileRoot:path.join(userData,'profiles')});
    loginSession.profileKey=profileKey;
    return {opened:true,profileKey,account};
  }catch(error){if(loginWorkerWasRunning)worker.start();throw error}
}
function registerIpc(){
  ipcMain.handle('simi:api',async(_event,requestPath,options={})=>{
    if(typeof requestPath!=='string'||!/^\/api\/[A-Za-z0-9_/?=&.%-]+$/.test(requestPath))throw new Error('API path không hợp lệ');
    const method=String(options.method||'GET').toUpperCase();if(!['GET','POST','PATCH'].includes(method))throw new Error('Method không hợp lệ');
    const body=options.body===undefined?undefined:String(options.body);if(body&&body.length>1024*1024)throw new Error('Request quá lớn');
    const settings=getSettings();const base=String(settings.serverUrl||'http://127.0.0.1:4300').replace(/\/$/,'');const token=getDeviceToken();
    const response=await fetch(`${base}${requestPath}`,{method,body,headers:{'Content-Type':'application/json',...cloudflareHeaders(),...(token?{'x-device-token':token}:{})},signal:AbortSignal.timeout(30000),redirect:'error'});
    return {status:response.status,ok:response.ok,data:response.status===204?null:await response.json().catch(()=>({}))};
  });
  ipcMain.handle('simi:status',systemStatus);
  ipcMain.handle('simi:logs',()=>logs.slice(-300));
  ipcMain.handle('simi:update:status',()=>updates.status());
  ipcMain.handle('simi:update:check',()=>updates.check());
  ipcMain.handle('simi:update:download',()=>updates.download());
  ipcMain.handle('simi:update:open',()=>updates.openInstaller());
  ipcMain.handle('simi:settings:get',getSettings);
  ipcMain.handle('simi:settings:save',(_event,values)=>{
    const current=getSettings();for(const key of Object.keys(defaults))if(typeof values?.[key]==='boolean'||['serverUrl','workerKey','deviceName','deviceOs'].includes(key)&&typeof values?.[key]==='string')current[key]=values[key];
    fs.writeFileSync(settingsFile,JSON.stringify(current,null,2));
    if(process.platform==='darwin')app.setLoginItemSettings({openAtLogin:current.openAtLogin});
    if(!current.startWorker&&worker.owner==='desktop')worker.stop();
    if(current.startWorker&&getDeviceToken()&&worker.owner!=='external'){worker.env=backendEnv(4311);worker.restart().catch(e=>writeLog('DESKTOP',e.message))}
    return current;
  });
  ipcMain.handle('simi:device:register',async(_event,values)=>{
    const current=getSettings();const base=String(values?.serverUrl||current.serverUrl||'').replace(/\/$/,'');
    if(!/^https?:\/\//.test(base))throw new Error('Server URL không hợp lệ');
    const cf={clientId:String(values?.cloudflareClientId||'').trim(),clientSecret:String(values?.cloudflareClientSecret||'').trim()};
    const response=await fetch(`${base}/api/devices/register`,{method:'POST',headers:{'Content-Type':'application/json',...cloudflareHeaders(cf)},body:JSON.stringify({activationCode:values.activationCode,workerKey:values.workerKey,deviceName:values.deviceName,os:values.deviceOs||process.platform,appVersion:app.getVersion(),baseUrl:''}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Đăng ký thất bại (${response.status})`);saveCloudflareCredentials(cf.clientId,cf.clientSecret);saveDeviceToken(data.deviceToken);const next={...current,serverUrl:base,workerKey:values.workerKey,deviceName:values.deviceName,deviceOs:values.deviceOs||process.platform};fs.writeFileSync(settingsFile,JSON.stringify(next,null,2));worker.env=backendEnv(4311);if(next.startWorker&&worker.owner!=='external')await worker.restart();setTimeout(()=>updates.check().catch(error=>writeLog('DESKTOP',`Kiểm tra cập nhật: ${error.message}`)),1000);return {worker:data.worker,serverUrl:base,workerExternal:worker.owner==='external'};
  });
  ipcMain.handle('simi:device:pair',async(_event,key,access={})=>{
    const cleanKey=String(key||'').trim();const base=pairingServer(cleanKey);
    if(!require('electron').safeStorage.isEncryptionAvailable())throw new Error('Máy chưa hỗ trợ lưu token an toàn; không thể kết nối');
    let response;
    const cf={clientId:String(access?.cloudflareClientId||'').trim(),clientSecret:String(access?.cloudflareClientSecret||'').trim()};
    try{response=await fetch(`${base}/api/devices/pair`,{method:'POST',headers:{'Content-Type':'application/json',...cloudflareHeaders(cf)},body:JSON.stringify({key:cleanKey,deviceName:os.hostname(),os:process.platform,appVersion:app.getVersion()}),signal:AbortSignal.timeout(15000),redirect:'error'})}
    catch{throw new Error(`Không tới được ${base}. Máy này cần truy cập được địa chỉ trong mã; 127.0.0.1 chỉ dùng trên Mac mini.`)}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Kết nối thất bại (${response.status})`);
    if(!data.deviceToken||data.serverUrl!==base||!data.worker?.worker_key)throw new Error('Máy chủ trả về phiên kết nối không hợp lệ');
    saveCloudflareCredentials(cf.clientId,cf.clientSecret);saveDeviceToken(data.deviceToken);
    const next={...getSettings(),serverUrl:base,workerKey:data.worker.worker_key,deviceName:data.worker.device_name,deviceOs:process.platform};
    fs.writeFileSync(settingsFile,JSON.stringify(next,null,2));
    worker.env=backendEnv(4311);if(next.startWorker&&worker.owner!=='external')worker.restart().catch(error=>writeLog('DESKTOP',`Worker: ${error.message}`));
    setTimeout(()=>updates.check().catch(error=>writeLog('DESKTOP',`Kiểm tra cập nhật: ${error.message}`)),1000);
    return {worker:data.worker,serverUrl:base};
  });
  ipcMain.handle('simi:worker:restart',async()=>{await worker.restart();return worker.snapshot()});
  ipcMain.handle('simi:facebook:open-login',(_event,profileKey)=>openFacebookLogin(profileKey));
  ipcMain.handle('simi:facebook:add-and-login',async()=>{
    const settings=getSettings(),token=getDeviceToken();
    if(!token||!settings.workerKey)throw new Error('Hãy kết nối thiết bị trước');
    if(loginSession)throw new Error('Đang có phiên đăng nhập Facebook khác');
    const profileKey=`fb_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const headers={'Content-Type':'application/json',...cloudflareHeaders(),'x-device-token':token};
    const base=settings.serverUrl.replace(/\/$/,'');
    const created=await fetch(`${base}/api/accounts`,{method:'POST',headers,body:JSON.stringify({name:`Facebook mới ${new Date().toLocaleString('vi-VN')}`,profileKey}),signal:AbortSignal.timeout(10000)});
    const account=await created.json().catch(()=>({}));
    if(!created.ok)throw new Error(account.error||`Không tạo được tài khoản (${created.status})`);
    const workersResponse=await fetch(`${base}/api/workers`,{headers,signal:AbortSignal.timeout(10000)});
    const workers=await workersResponse.json().catch(()=>[]);
    const own=workers.find(item=>item.worker_key===settings.workerKey);
    if(!own)throw new Error('Đã tạo tài khoản nhưng không tìm thấy Worker hiện tại để gán');
    const assigned=await fetch(`${base}/api/accounts/${account.id}/worker`,{method:'PATCH',headers,body:JSON.stringify({workerId:own.id}),signal:AbortSignal.timeout(10000)});
    if(!assigned.ok)throw new Error('Đã tạo tài khoản nhưng chưa gán được cho máy này');
    return openFacebookLogin(profileKey);
  });
  ipcMain.handle('simi:facebook:complete-login',async()=>{
    if(!loginSession)throw new Error('Chưa mở phiên đăng nhập');
    const session=loginSession;loginSession=null;
    const modulePath=path.join(backendRoot,'worker','src','profile-login.js');
    const {closeAndSaveLoginSession}=await import(pathToFileURL(modulePath).href);
    const status=await closeAndSaveLoginSession(session);
    let serverUpdated=false;
    try{const response=await fetch(`${getSettings().serverUrl.replace(/\/$/,'')}/api/automation/account-status`,{method:'POST',headers:{'Content-Type':'application/json',...cloudflareHeaders(),'x-device-token':getDeviceToken()},body:JSON.stringify({profileKey:session.profileKey,status})});if(!response.ok)throw new Error(`HTTP ${response.status}`);serverUpdated=true}catch(error){writeLog('DESKTOP',`Cập nhật phiên thất bại: ${error.message}`)}
    if(loginWorkerWasRunning)worker.start();
    return {profileKey:session.profileKey,status,serverUpdated};
  });
}

app.on('second-instance',showWindow);
app.on('before-quit',()=>{quitting=true;loginSession?.context.close().catch(()=>{});worker?.stop()});
app.whenReady().then(async()=>{
  fs.mkdirSync(userData,{recursive:true});makeServices();
  updates=createUpdateManager({
    app,
    getServerUrl:()=>getSettings().serverUrl,
    getDeviceToken,
    getAccessHeaders:cloudflareHeaders,
    onStatus:status=>window?.webContents.send('simi:update:status-changed',status)
  });
  registerIpc();createWindow();
  try{tray=new Tray(trayIcon());updateTray()}catch(error){writeLog('DESKTOP',`Tray chưa khả dụng: ${error.message}`)}
  if(getSettings().startWorker&&getDeviceToken())worker.start();
  if(getDeviceToken())setTimeout(()=>updates.check().catch(error=>writeLog('DESKTOP',`Kiểm tra cập nhật: ${error.message}`)),15000);
  setInterval(()=>{
    if(getDeviceToken())updates.check().catch(error=>writeLog('DESKTOP',`Kiểm tra cập nhật: ${error.message}`));
  },6*60*60*1000).unref();
  app.on('activate',showWindow);
});
