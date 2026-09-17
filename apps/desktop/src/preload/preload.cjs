const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('simiDesktop',Object.freeze({
  requestApi:(path,options)=>ipcRenderer.invoke('simi:api',path,options),
  getSystemStatus:()=>ipcRenderer.invoke('simi:status'),
  getLogs:()=>ipcRenderer.invoke('simi:logs'),
  getSettings:()=>ipcRenderer.invoke('simi:settings:get'),
  saveSettings:settings=>ipcRenderer.invoke('simi:settings:save',settings),
  registerDevice:values=>ipcRenderer.invoke('simi:device:register',values),
  restartWorker:()=>ipcRenderer.invoke('simi:worker:restart'),
  openFacebookLogin:profileKey=>ipcRenderer.invoke('simi:facebook:open-login',profileKey),
  completeFacebookLogin:()=>ipcRenderer.invoke('simi:facebook:complete-login')
}));
