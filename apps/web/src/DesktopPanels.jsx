import React,{useEffect,useState} from 'react';
import {Clock3,ExternalLink,RefreshCw} from 'lucide-react';

const desktop=()=>window.simiDesktop;
const fmt=value=>value?new Date(value).toLocaleString('vi-VN'):'—';
const stateLabel={RUNNING:'Hoạt động',STARTING:'Đang khởi động',RESTARTING:'Đang khởi động lại',STOPPED:'Chưa hoạt động',ERROR:'Có lỗi'};

export function DesktopStatus(){
  const [status,setStatus]=useState(null);
  useEffect(()=>{
    if(!desktop())return;
    const refresh=()=>desktop().getSystemStatus().then(setStatus).catch(()=>{});
    refresh();const timer=setInterval(refresh,30000);
    return()=>clearInterval(timer);
  },[]);
  return <div className="desktop-status">{[['API',status?.api?.state],['Worker',status?.worker?.state],['MySQL',status?.mysql],['n8n',status?.n8n]].map(([name,value])=><div key={name}><i className={value==='RUNNING'?'on':''}/><span>{name}</span><small>{stateLabel[value]||'Đang kiểm tra'}</small></div>)}</div>;
}

export function NextJob({jobs,go}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
  const job=jobs.filter(item=>item.status==='PENDING').sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0];
  if(!job)return <section className="next-job"><span className="eyebrow">LẦN BÌNH LUẬN TIẾP THEO</span><h2>Chưa có lịch sắp chạy</h2><p>Vào Bài viết để tạo lịch và xem trước nội dung.</p></section>;
  const seconds=Math.max(0,Math.floor((new Date(job.scheduled_at)-now)/1000));
  const countdown=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(' : ');
  return <section className="next-job"><div><span className="eyebrow">LẦN BÌNH LUẬN TIẾP THEO</span><strong>{countdown}</strong><small>Đếm ngược trên máy, không gọi API mỗi giây</small></div><div className="next-job-details"><b>{job.account_name}</b><span>{job.post_label||`Bài #${job.post_id}`}</span><blockquote>“{job.comment_text}”</blockquote><small><Clock3 size={13}/>{fmt(job.scheduled_at)}</small></div><div className="next-job-actions"><button onClick={()=>go('jobs')}>Xem trong hàng chờ</button><a className="secondary" href={job.post_url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Mở bài</a></div></section>;
}

export function AutomationPanel(){
  const [status,setStatus]=useState(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  async function refresh(){try{setStatus(await desktop().getSystemStatus())}catch(e){setMessage(e.message)}}
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer)},[]);
  async function act(fn){setBusy(true);setMessage('');try{const result=await fn();await refresh();setMessage(result?.message||'Đã gửi yêu cầu')}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  const workflows=['01 Campaign Dispatcher','02 Manual Dispatcher','03 Failed Job Retry','04 Worker Watchdog','05 Session Check'];
  return <><section className="panel"><div className="panel-head"><div><h2>Automation</h2><p>n8n chạy local trong Docker. App không tự bật workflow.</p></div><button className="secondary" onClick={refresh}><RefreshCw size={15}/>Kiểm tra</button></div><div className="automation-status"><p>Docker: <b>{stateLabel[status?.docker]||'Đang kiểm tra'}</b></p><p>n8n: <b>{stateLabel[status?.n8n]||'Đang kiểm tra'}</b></p></div><div className="actions"><button onClick={()=>act(()=>desktop().openN8n())}>Mở n8n</button><button className="secondary" disabled={busy} onClick={()=>act(()=>desktop().startN8n())}>Khởi động n8n/MySQL</button><button className="secondary" onClick={()=>act(()=>desktop().openDocker())}>Mở Docker Desktop</button></div>{message&&<p className="desktop-message">{message}</p>}</section><section className="panel"><div className="panel-head"><div><h2>5 workflow trong project</h2><p>Trạng thái Publish phải kiểm tra trực tiếp trong n8n; app không suy đoán Bật/Tắt.</p></div><button className="secondary" disabled={busy} onClick={()=>act(()=>desktop().setupN8nWorkflows())}>Thiết lập workflow n8n</button></div><div className="workflow-list">{workflows.map(name=><div key={name}><span>{name}</span><small>Chưa xác minh trạng thái</small></div>)}</div><p className="muted">Nút thiết lập mở thư mục 5 JSON để import thủ công. Lần thử đầu: chỉ Publish 02, 04, 05; giữ 01 và 03 tắt.</p></section></>;
}

export function LogsPanel(){
  const [rows,setRows]=useState([]);const [raw,setRaw]=useState(false);const [filter,setFilter]=useState('TẤT CẢ');
  useEffect(()=>{let active=true;const refresh=()=>desktop().getLogs().then(data=>{if(active)setRows(data)}).catch(()=>{});refresh();const timer=setInterval(refresh,2500);return()=>{active=false;clearInterval(timer)}},[]);
  const visible=rows.filter(row=>filter==='TẤT CẢ'||row.source===filter).slice().reverse();
  return <section className="panel"><div className="panel-head"><div><h2>Nhật ký</h2><p>Log API, Worker và ứng dụng hiện tại. Không chứa mật khẩu Facebook.</p></div><button className="secondary" onClick={()=>setRaw(!raw)}>{raw?'Xem dễ đọc':'Xem log kỹ thuật'}</button></div><div className="log-filters">{['TẤT CẢ','API','WORKER','DESKTOP'].map(name=><button key={name} className={filter===name?'active':''} onClick={()=>setFilter(name)}>{name}</button>)}</div><div className="log-list">{visible.length?visible.map((row,index)=><div key={`${row.at}-${index}`}><time>{fmt(row.at)}</time><b>{row.source}</b><span>{raw?row.message:row.message.replace(/^\[[^\]]+\]\s*/, '')}</span></div>):<p>Chưa có log trong phiên này.</p>}</div></section>;
}

export function SettingsPanel(){
  const [values,setValues]=useState(null);const [status,setStatus]=useState(null);const [message,setMessage]=useState('');const [activationCode,setActivationCode]=useState('');const [registering,setRegistering]=useState(false);
  useEffect(()=>{desktop().getSettings().then(setValues);desktop().getSystemStatus().then(setStatus)},[]);
  if(!values)return <section className="panel">Đang tải cài đặt…</section>;
  const fields=[['startApi','Tự khởi động API'],['startWorker','Tự khởi động Worker'],['checkN8n','Kiểm tra n8n khi mở'],['continueOnClose','Tiếp tục chạy khi đóng cửa sổ'],['openAtLogin','Tự mở cùng macOS']];
  async function save(){try{setValues(await desktop().saveSettings(values));setMessage('Đã lưu cài đặt. Tùy chọn khởi động API/Worker áp dụng ở lần mở sau.')}catch(e){setMessage(e.message)}}
  async function register(){setRegistering(true);try{await desktop().registerDevice({...values,activationCode});setMessage('Đã đăng ký thiết bị. Khởi động lại app để Worker nhận cấu hình mới.');setActivationCode('')}catch(e){setMessage(e.message)}finally{setRegistering(false)}}
  return <><section className="panel"><h2>Kết nối Central Server</h2><p className="muted">Mỗi máy nhận một device token riêng; token được lưu bằng secure storage của hệ điều hành.</p><div className="form-grid three"><label className="field"><span>Server URL</span><input value={values.serverUrl||''} onChange={e=>setValues({...values,serverUrl:e.target.value})}/></label><label className="field"><span>Worker key</span><input placeholder="pc-sale-01" value={values.workerKey||''} onChange={e=>setValues({...values,workerKey:e.target.value})}/></label><label className="field"><span>Tên máy</span><input placeholder="PC Kinh Doanh 01" value={values.deviceName||''} onChange={e=>setValues({...values,deviceName:e.target.value})}/></label></div><div className="actions"><input className="activation-input" placeholder="Mã kích hoạt thiết bị" value={activationCode} onChange={e=>setActivationCode(e.target.value)}/><button disabled={registering||!activationCode} onClick={register}>{registering?'Đang đăng ký…':'Đăng ký thiết bị'}</button></div><p className="muted">Trạng thái: {status?.deviceRegistered?'Đã đăng ký':'Chưa đăng ký'}</p></section><section className="panel"><h2>Cài đặt desktop</h2><p className="muted">Không lưu tên đăng nhập hoặc mật khẩu Facebook.</p><div className="settings-list">{fields.map(([key,label])=><label key={key}><input type="checkbox" checked={!!values[key]} onChange={e=>setValues({...values,[key]:e.target.checked})}/><span>{label}</span></label>)}</div><div className="actions"><button onClick={save}>Lưu cài đặt</button><button className="secondary" onClick={()=>desktop().openConfigFolder()}>Mở thư mục cấu hình</button></div><p className="muted">File cấu hình: {status?.configPath||'Đang kiểm tra'}</p>{!status?.configReady&&<p className="desktop-message">Thiếu config.env. API và Worker sẽ không tự chạy cho đến khi cấu hình được cung cấp.</p>}{message&&<p className="desktop-message">{message}</p>}</section></>;
}

export function FacebookDesktop({accounts,children,reload}){
  const [active,setActive]=useState('');const [message,setMessage]=useState('');
  async function open(profileKey){try{await desktop().openFacebookLogin(profileKey);setActive(profileKey);setMessage('Trình duyệt đã mở. Đăng nhập xong rồi bấm “Tôi đã đăng nhập xong”.')}catch(e){setMessage(e.message)}}
  async function complete(){try{const result=await desktop().completeFacebookLogin();setMessage(`Phiên ${result.profileKey}: ${result.status}`);setActive('');reload()}catch(e){setMessage(e.message)}}
  return <>{children}<section className="panel"><h2>Đăng nhập Facebook trong app</h2><p className="muted">Chọn tài khoản đã lưu. Bạn tự đăng nhập và hoàn thành 2FA; SIMI không lưu mật khẩu.</p><div className="login-accounts">{accounts.map(account=><div key={account.id}><b>{account.name}</b><span>{account.session_status}</span><button className="secondary" disabled={!!active} onClick={()=>open(account.profile_key)}>Mở Facebook</button></div>)}</div>{active&&<button onClick={complete}>Tôi đã đăng nhập xong</button>}{message&&<p className="desktop-message">{message}</p>}</section></>;
}
