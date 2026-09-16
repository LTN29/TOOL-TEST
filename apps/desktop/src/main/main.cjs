const {app,BrowserWindow,Tray,Menu,nativeImage,shell,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {ManagedService,health}=require('./process-manager.cjs');
const {pathToFileURL}=require('node:url');

if(!app.requestSingleInstanceLock()){app.quit();process.exit(0)}
const isDev=!app.isPackaged;
const projectRoot=path.resolve(__dirname,'../../../..');
const backendRoot=isDev?path.join(projectRoot,'apps'):path.join(process.resourcesPath,'backend');
const configFile=isDev?path.join(projectRoot,'.env'):path.join(app.getPath('userData'),'config.env');
const userData=app.getPath('userData');
const settingsFile=path.join(userData,'settings.json');
const logs=[];
let window=null,tray=null,quitting=false,api=null,worker=null;
let loginSession=null,loginWorkerWasRunning=false;
const defaults={startApi:isDev,startWorker:true,checkN8n:true,continueOnClose:true,openAtLogin:false,serverUrl:'http://127.0.0.1:4300',workerKey:'',deviceName:'',deviceOs:process.platform,appVersion:'0.1.0'};
const tokenFile=path.join(userData,'device-token.bin');
function getDeviceToken(){try{if(!fs.existsSync(tokenFile)||!require('electron').safeStorage.isEncryptionAvailable())return '';return require('electron').safeStorage.decryptString(fs.readFileSync(tokenFile))}catch{return ''}}
function saveDeviceToken(token){if(!require('electron').safeStorage.isEncryptionAvailable())throw new Error('OS secure storage chưa khả dụng');fs.writeFileSync(tokenFile,require('electron').safeStorage.encryptString(token),{mode:0o600})}

function parseEnv(file){
  if(!fs.existsSync(file))return {};
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).map(line=>line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean).map(match=>[match[1],match[2].replace(/^['"]|['"]$/g,'')]));
}
const config=parseEnv(configFile);
function getSettings(){try{return {...defaults,...JSON.parse(fs.readFileSync(settingsFile,'utf8'))}}catch{return {...defaults}}}
function writeLog(source,message){
  const secret=config.AUTOMATION_TOKEN;
  const safe=secret?String(message).replaceAll(secret,'[REDACTED]'):String(message);
  for(const line of safe.split(/\r?\n/).filter(Boolean))logs.push({at:new Date().toISOString(),source,message:line.slice(0,1200)});
  if(logs.length>500)logs.splice(0,logs.length-500);
}
function changed(){updateTray();window?.webContents.send('simi:status-changed')}
function backendEnv(port){const settings=getSettings();return {...process.env,...config,PORT:String(port),HOST:'127.0.0.1',DOTENV_CONFIG_PATH:configFile,PROFILE_ROOT:path.join(userData,'profiles'),PLAYWRIGHT_CHANNEL:isDev?(config.PLAYWRIGHT_CHANNEL||''):(config.PLAYWRIGHT_CHANNEL||'chrome'),CENTRAL_API_URL:settings.serverUrl,DEVICE_TOKEN:getDeviceToken(),WORKER_NAME:settings.workerKey||config.WORKER_NAME||'desktop-worker'}}
function makeServices(){
  api=new ManagedService({name:'API',port:4300,script:path.join(backendRoot,'api','src','server.js'),cwd:userData,env:backendEnv(4300),identity:b=>b.ok===true&&typeof b.version==='string',onLog:writeLog,onChange:changed});
  worker=new ManagedService({name:'WORKER',port:4311,script:path.join(backendRoot,'worker','src','server.js'),cwd:userData,env:backendEnv(4311),identity:b=>b.ok===true&&typeof b.workerName==='string',onLog:writeLog,onChange:changed});
}
function tcpOpen(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1500);socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('timeout',()=>{socket.destroy();resolve(false)});socket.once('error',()=>resolve(false))})}
function run(command,args,cwd){return new Promise((resolve,reject)=>execFile(command,args,{cwd,timeout:30000,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message))):resolve(String(stdout))))}
async function dockerStatus(){try{await run('docker',['info','--format','{{.ServerVersion}}'],userData);return 'RUNNING'}catch{return 'STOPPED'}}
async function httpReady(url){try{return (await fetch(url,{signal:AbortSignal.timeout(2500)})).ok}catch{return false}}
async function systemStatus(){
  const [mysql,n8n,docker]=await Promise.all([tcpOpen(Number(config.DB_PORT||3307)),httpReady('http://127.0.0.1:5678/healthz'),dockerStatus()]);
  return {api:api.snapshot(),worker:worker.snapshot(),mysql:mysql?'RUNNING':'STOPPED',n8n:n8n?'RUNNING':'STOPPED',docker,configReady:fs.existsSync(configFile),configPath:configFile,serverUrl:getSettings().serverUrl,deviceRegistered:!!getDeviceToken()};
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
    {label:`API: ${api?.state||'STOPPED'}`,enabled:false},
    {label:`Worker: ${worker?.state||'STOPPED'}`,enabled:false},
    {label:'Kiểm tra hệ thống',click:()=>window?.webContents.send('simi:status-changed')},
    {type:'separator'},
    {label:'Khởi động lại Worker',click:()=>worker?.restart().catch(e=>writeLog('DESKTOP',e.message))},
    {label:'Mở n8n',click:()=>shell.openExternal('http://127.0.0.1:5678')},
    {type:'separator'},
    {label:'Thoát SIMI Automation',click:()=>{quitting=true;app.quit()}}
  ]);
  tray.setContextMenu(menu);tray.setToolTip('SIMI Automation');
}
function createWindow(){
  window=new BrowserWindow({width:1440,height:900,minWidth:1000,minHeight:700,title:'SIMI Automation',backgroundColor:'#f5f7fa',webPreferences:{preload:path.join(__dirname,'../preload/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/(www\.)?facebook\.com\//.test(url)||url==='http://127.0.0.1:5678/')shell.openExternal(url);return {action:'deny'}});
  window.webContents.on('will-navigate',(event,url)=>{if(isDev? !url.startsWith('http://127.0.0.1:5173/') : !url.startsWith('file://'))event.preventDefault()});
  window.on('close',event=>{if(!quitting&&getSettings().continueOnClose){event.preventDefault();window.hide();if(process.platform==='darwin')app.dock?.hide()}});
  if(isDev)window.loadURL('http://127.0.0.1:5173');else window.loadFile(path.join(process.resourcesPath,'renderer','index.html'));
}
function registerIpc(){
  ipcMain.handle('simi:api',async(_event,requestPath,options={})=>{
    if(typeof requestPath!=='string'||!/^\/api\/[A-Za-z0-9_/?=&.%-]+$/.test(requestPath))throw new Error('API path không hợp lệ');
    const method=String(options.method||'GET').toUpperCase();if(!['GET','POST','PATCH'].includes(method))throw new Error('Method không hợp lệ');
    const body=options.body===undefined?undefined:String(options.body);if(body&&body.length>1024*1024)throw new Error('Request quá lớn');
    const settings=getSettings();const base=String(settings.serverUrl||'http://127.0.0.1:4300').replace(/\/$/,'');const token=getDeviceToken();
    const response=await fetch(`${base}${requestPath}`,{method,body,headers:{'Content-Type':'application/json',...(token?{'x-device-token':token}:{}),...(config.AUTOMATION_TOKEN?{'x-automation-token':config.AUTOMATION_TOKEN}:{})},signal:AbortSignal.timeout(30000),redirect:'error'});
    return {status:response.status,ok:response.ok,data:response.status===204?null:await response.json().catch(()=>({}))};
  });
  ipcMain.handle('simi:status',systemStatus);
  ipcMain.handle('simi:logs',()=>logs.slice(-300));
  ipcMain.handle('simi:settings:get',getSettings);
  ipcMain.handle('simi:settings:save',(_event,values)=>{
    const current=getSettings();for(const key of Object.keys(defaults))if(typeof values?.[key]==='boolean'||['serverUrl','workerKey','deviceName','deviceOs'].includes(key)&&typeof values?.[key]==='string')current[key]=values[key];
    fs.writeFileSync(settingsFile,JSON.stringify(current,null,2));
    if(process.platform==='darwin')app.setLoginItemSettings({openAtLogin:current.openAtLogin});
    return current;
  });
  ipcMain.handle('simi:device:register',async(_event,values)=>{
    const current=getSettings();const base=String(values?.serverUrl||current.serverUrl||'').replace(/\/$/,'');
    if(!/^https?:\/\//.test(base))throw new Error('Server URL không hợp lệ');
    const response=await fetch(`${base}/api/devices/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({activationCode:values.activationCode,workerKey:values.workerKey,deviceName:values.deviceName,os:values.deviceOs||process.platform,appVersion:values.appVersion||'0.1.0',baseUrl:''}),signal:AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Đăng ký thất bại (${response.status})`);saveDeviceToken(data.deviceToken);const next={...current,serverUrl:base,workerKey:values.workerKey,deviceName:values.deviceName,deviceOs:values.deviceOs||process.platform};fs.writeFileSync(settingsFile,JSON.stringify(next,null,2));return {worker:data.worker,serverUrl:base};
  });
  ipcMain.handle('simi:worker:restart',async()=>{await worker.restart();return worker.snapshot()});
  ipcMain.handle('simi:n8n:open',()=>shell.openExternal('http://127.0.0.1:5678'));
  ipcMain.handle('simi:n8n:workflow-setup',async()=>{
    const folder=isDev?path.join(projectRoot,'n8n'):path.join(process.resourcesPath,'n8n');
    const files=fs.readdirSync(folder).filter(name=>/^0[1-5]-.*\.json$/.test(name)).sort();
    if(files.length!==5)throw new Error(`Tìm thấy ${files.length}/5 file workflow trong ${folder}`);
    const result=await shell.openPath(folder);
    if(result)throw new Error(result);
    return {folder,files,imported:false,message:'Đã mở thư mục chứa 5 workflow. Hãy import thủ công trong n8n rồi kiểm tra Publish; app chưa thể xác minh import idempotent.'};
  });
  ipcMain.handle('simi:n8n:start',async()=>{
    if(process.platform!=='darwin')throw new Error('Thiết lập Docker desktop hiện chỉ dành cho macOS');
    if(!fs.existsSync(configFile))throw new Error('Thiếu config.env');
    const compose=isDev?path.join(projectRoot,'docker-compose.n8n.yml'):path.join(process.resourcesPath,'docker-compose.n8n.yml');
    await run('docker',['compose','-p','simi-automation','--env-file',configFile,'-f',compose,'up','-d','mysql','n8n'],userData);
    return systemStatus();
  });
  ipcMain.handle('simi:docker:open',()=>process.platform==='darwin'?run('open',['-a','Docker'],userData):Promise.reject(new Error('Chỉ hỗ trợ macOS')));
  ipcMain.handle('simi:config:open-folder',()=>shell.openPath(userData));
  ipcMain.handle('simi:facebook:open-login',async(_event,profileKey)=>{
    if(loginSession)throw new Error('Đang có phiên đăng nhập Facebook khác');
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(String(profileKey||'')))throw new Error('Mã phiên không hợp lệ');
    const response=await fetch('http://127.0.0.1:4300/api/accounts',{headers:config.AUTOMATION_TOKEN?{'x-automation-token':config.AUTOMATION_TOKEN}:{},signal:AbortSignal.timeout(5000)});
    if(!response.ok||!(await response.json()).some(account=>account.profile_key===profileKey))throw new Error('Tài khoản chưa được lưu trong SIMI');
    if(worker.owner==='external')throw new Error('Worker đang chạy ngoài app; hãy dừng Worker đó trước khi đăng nhập');
    loginWorkerWasRunning=worker.state==='RUNNING';
    if(worker.child)worker.stop();
    try{
      const modulePath=path.join(backendRoot,'worker','src','profile-login.js');
      const {openLoginSession}=await import(pathToFileURL(modulePath).href);
      loginSession=await openLoginSession(profileKey,{profileRoot:path.join(userData,'profiles'),channel:isDev?(config.PLAYWRIGHT_CHANNEL||undefined):(config.PLAYWRIGHT_CHANNEL||'chrome')});
      loginSession.profileKey=profileKey;
      return {opened:true,profileKey};
    }catch(error){if(loginWorkerWasRunning)worker.start();throw error}
  });
  ipcMain.handle('simi:facebook:complete-login',async()=>{
    if(!loginSession)throw new Error('Chưa mở phiên đăng nhập');
    const session=loginSession;loginSession=null;
    const modulePath=path.join(backendRoot,'worker','src','profile-login.js');
    const {closeAndSaveLoginSession}=await import(pathToFileURL(modulePath).href);
    const status=await closeAndSaveLoginSession(session);
    await fetch('http://127.0.0.1:4300/api/automation/account-status',{method:'POST',headers:{'Content-Type':'application/json',...(config.AUTOMATION_TOKEN?{'x-automation-token':config.AUTOMATION_TOKEN}:{})},body:JSON.stringify({profileKey:session.profileKey,status})}).catch(error=>writeLog('DESKTOP',`Cập nhật phiên thất bại: ${error.message}`));
    if(loginWorkerWasRunning)worker.start();
    return {profileKey:session.profileKey,status};
  });
}

app.on('second-instance',showWindow);
app.on('before-quit',()=>{quitting=true;loginSession?.context.close().catch(()=>{});api?.stop();worker?.stop()});
app.whenReady().then(async()=>{
  fs.mkdirSync(userData,{recursive:true});makeServices();registerIpc();createWindow();
  try{tray=new Tray(trayIcon());updateTray()}catch(error){writeLog('DESKTOP',`Tray chưa khả dụng: ${error.message}`)}
  if(fs.existsSync(configFile)){
    const settings=getSettings();
    if(settings.startApi)api.start();if(settings.startWorker)worker.start();
  }else writeLog('DESKTOP',`Thiếu cấu hình: ${configFile}`);
  app.on('activate',showWindow);
});
