const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('simiDesktop',Object.freeze({
  requestApi:(path,options)=>ipcRenderer.invoke('simi:api',path,options),
  getSystemStatus:()=>ipcRenderer.invoke('simi:status'),
  getLogs:()=>ipcRenderer.invoke('simi:logs'),
  getSettings:()=>ipcRenderer.invoke('simi:settings:get'),
  saveSettings:settings=>ipcRenderer.invoke('simi:settings:save',settings),
  restartWorker:()=>ipcRenderer.invoke('simi:worker:restart'),
  openN8n:()=>ipcRenderer.invoke('simi:n8n:open'),
  setupN8nWorkflows:()=>ipcRenderer.invoke('simi:n8n:workflow-setup'),
  startN8n:()=>ipcRenderer.invoke('simi:n8n:start'),
  openDocker:()=>ipcRenderer.invoke('simi:docker:open'),
  openConfigFolder:()=>ipcRenderer.invoke('simi:config:open-folder')
  ,openFacebookLogin:profileKey=>ipcRenderer.invoke('simi:facebook:open-login',profileKey)
  ,completeFacebookLogin:()=>ipcRenderer.invoke('simi:facebook:complete-login')
}));
