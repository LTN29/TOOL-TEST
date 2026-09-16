import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig(({mode})=>{
  const env=loadEnv(mode,fileURLToPath(new URL('../..',import.meta.url)),'');
  const proxy={
    target:'http://127.0.0.1:4300',
    changeOrigin:true,
    headers:env.AUTOMATION_TOKEN?{'x-automation-token':env.AUTOMATION_TOKEN}:{}
  };
  const allowedHosts=['localhost',...(env.APP_ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean)];
  return {base:'./',plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,allowedHosts,proxy:{'/api':proxy,'/health':proxy}},preview:{host:'127.0.0.1',port:5173,strictPort:true,allowedHosts,proxy:{'/api':proxy,'/health':proxy}}};
});
