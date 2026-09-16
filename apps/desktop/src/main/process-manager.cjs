const {utilityProcess}=require('electron');
const net=require('node:net');

const MAX_RESTARTS=5;
const RESTART_WINDOW_MS=5*60*1000;

async function health(url,identity){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(2500)});
    const body=await response.json();
    return response.ok&&identity(body)?body:null;
  }catch{return null}
}
function portOpen(port){return new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.setTimeout(1200);
  socket.once('connect',()=>{socket.destroy();resolve(true)});
  socket.once('timeout',()=>{socket.destroy();resolve(false)});
  socket.once('error',()=>resolve(false));
})}

class ManagedService{
  constructor({name,port,script,cwd,env,identity,onLog,onChange}){
    Object.assign(this,{name,port,script,cwd,env,identity,onLog,onChange});
    this.state='STOPPED';this.owner=null;this.child=null;this.restarts=[];this.intentionalStop=false;
  }
  get url(){return `http://127.0.0.1:${this.port}/health`}
  setState(state,error=null){this.state=state;this.error=error;this.onChange?.()}
  async probe(){
    const body=await health(this.url,this.identity);
    if(body){this.setState('RUNNING');return body}
    if(!this.child&&this.state==='RUNNING')this.setState('STOPPED');
    return null;
  }
  async start(){
    if(this.child||this.state==='STARTING')return;
    const existing=await health(this.url,this.identity);
    if(existing){this.owner='external';this.setState('RUNNING');return}
    if(await portOpen(this.port)){this.setState('ERROR',`Cổng ${this.port} đang do tiến trình khác sử dụng`);return}
    this.owner=null;this.intentionalStop=false;this.setState('STARTING');
    try{
      const child=utilityProcess.fork(this.script,[],{cwd:this.cwd,env:this.env,stdio:'pipe',serviceName:`SIMI ${this.name}`});
      this.child=child;this.owner='desktop';
      child.stdout?.on('data',buffer=>this.onLog(this.name,String(buffer)));
      child.stderr?.on('data',buffer=>this.onLog(this.name,String(buffer)));
      child.on('error',error=>{this.onLog(this.name,String(error));this.setState('ERROR',String(error))});
      child.on('exit',code=>{
        if(this.child!==child)return;
        this.child=null;this.owner=null;
        this.onLog(this.name,`Process exited (${code})`);
        if(this.intentionalStop){this.setState('STOPPED');return}
        this.restarts=this.restarts.filter(time=>Date.now()-time<RESTART_WINDOW_MS);
        if(this.restarts.length>=MAX_RESTARTS){this.setState('ERROR','Đã vượt giới hạn 5 lần khởi động lại trong 5 phút');return}
        this.restarts.push(Date.now());this.setState('RESTARTING');
        setTimeout(()=>{if(!this.intentionalStop)this.start()},Math.min(5000,1000*this.restarts.length));
      });
      for(let attempt=0;attempt<20;attempt++){
        await new Promise(resolve=>setTimeout(resolve,500));
        if(this.child!==child)return;
        if(await health(this.url,this.identity)){this.setState('RUNNING');return}
      }
      this.setState('ERROR','Service không trả lời health sau 10 giây');
    }catch(error){this.child=null;this.owner=null;this.setState('ERROR',String(error))}
  }
  stop(){
    this.intentionalStop=true;
    if(this.owner==='desktop'&&this.child)this.child.kill();
    this.child=null;this.owner=null;this.setState('STOPPED');
  }
  async restart(){
    if(this.owner==='external')throw new Error('Không thể khởi động lại service không do SIMI quản lý');
    this.stop();this.intentionalStop=false;await this.start();
  }
  snapshot(){return {state:this.state,owner:this.owner,pid:this.child?.pid||null,error:this.error||null}}
}

module.exports={ManagedService,health};
