const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('simiDesktop',Object.freeze({
  requestApi:(path,options)=>ipcRenderer.invoke('simi:api',path,options),
  getSystemStatus:()=>ipcRenderer.invoke('simi:status'),
  getLogs:()=>ipcRenderer.invoke('simi:logs'),
  getUpdateStatus:()=>ipcRenderer.invoke('simi:update:status'),
  checkForUpdates:()=>ipcRenderer.invoke('simi:update:check'),
  downloadUpdate:()=>ipcRenderer.invoke('simi:update:download'),
  openUpdateInstaller:()=>ipcRenderer.invoke('simi:update:open'),
  onUpdateStatus:listener=>{
    const handler=(_event,status)=>listener(status);
    ipcRenderer.on('simi:update:status-changed',handler);
    return ()=>ipcRenderer.removeListener('simi:update:status-changed',handler);
  },
  getSettings:()=>ipcRenderer.invoke('simi:settings:get'),
  saveSettings:settings=>ipcRenderer.invoke('simi:settings:save',settings),
  registerDevice:values=>ipcRenderer.invoke('simi:device:register',values),
  pairDevice:key=>ipcRenderer.invoke('simi:device:pair',key),
  restartWorker:()=>ipcRenderer.invoke('simi:worker:restart'),
  openFacebookLogin:profileKey=>ipcRenderer.invoke('simi:facebook:open-login',profileKey),
  completeFacebookLogin:()=>ipcRenderer.invoke('simi:facebook:complete-login')
}));
