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
  return <div className="desktop-status">{[['Central API',status?.centralApi],['Worker máy này',status?.worker?.state]].map(([name,value])=><div key={name}><i className={value==='RUNNING'?'on':''}/><span>{name}</span><small>{stateLabel[value]||'Đang kiểm tra'}</small></div>)}</div>;
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
  const [status,setStatus]=useState(null);
  useEffect(()=>{const refresh=()=>desktop().getSystemStatus().then(setStatus).catch(()=>{});refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer)},[]);
  return <section className="panel"><div className="panel-head"><div><h2>Kết nối máy chủ</h2><p>Ứng dụng này chỉ chạy giao diện và Worker trên máy hiện tại. API, MySQL và n8n chạy trên Central Server.</p></div><button className="secondary" onClick={()=>desktop().getSystemStatus().then(setStatus)}><RefreshCw size={15}/>Kiểm tra</button></div><div className="automation-status"><p>Central API: <b>{stateLabel[status?.centralApi]||'Đang kiểm tra'}</b></p><p>Worker máy này: <b>{stateLabel[status?.worker?.state]||'Đang kiểm tra'}</b></p><p>Địa chỉ máy chủ: <b>{status?.serverUrl||'Chưa cấu hình'}</b></p></div>{status?.worker?.owner==='external'&&<p className="desktop-message">Cổng Worker đang do phiên khác sử dụng. Hãy thoát bản dev cũ rồi mở lại app.</p>}{status?.worker?.error&&<p className="desktop-message">{status.worker.error}</p>}</section>;
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
  const fields=[['startWorker','Tự khởi động Worker'],['continueOnClose','Tiếp tục chạy khi đóng cửa sổ'],['openAtLogin','Tự mở cùng macOS']];
  async function save(){try{setValues(await desktop().saveSettings(values));setMessage('Đã lưu cài đặt.')}catch(e){setMessage(e.message)}}
  async function register(){setRegistering(true);try{await desktop().registerDevice({...values,activationCode});setStatus(await desktop().getSystemStatus());setMessage('Đã đăng ký thiết bị và khởi động Worker.');setActivationCode('');window.location.reload()}catch(e){setMessage(e.message)}finally{setRegistering(false)}}
  return <><section className="panel"><h2>Kết nối Central Server</h2><p className="muted">Nhập địa chỉ Central API và mã kích hoạt một lần. Worker sẽ tự kết nối khi mở ứng dụng.</p><div className="form-grid three"><label className="field"><span>Server URL</span><input value={values.serverUrl||''} onChange={e=>setValues({...values,serverUrl:e.target.value})}/></label><label className="field"><span>Worker key</span><input placeholder="pc-sale-01" value={values.workerKey||''} onChange={e=>setValues({...values,workerKey:e.target.value})}/></label><label className="field"><span>Tên máy</span><input placeholder="PC Kinh Doanh 01" value={values.deviceName||''} onChange={e=>setValues({...values,deviceName:e.target.value})}/></label></div><div className="actions"><input className="activation-input" placeholder="Mã kích hoạt thiết bị" value={activationCode} onChange={e=>setActivationCode(e.target.value)}/><button disabled={registering||!activationCode} onClick={register}>{registering?'Đang đăng ký…':'Đăng ký thiết bị'}</button></div><p className="muted">Trạng thái: {status?.deviceAuthenticated?'Đã kết nối API':status?.deviceRegistered?'Đã lưu thiết bị, API chưa xác thực':'Chưa đăng ký'}</p></section><section className="panel"><h2>Cài đặt desktop</h2><p className="muted">Worker và phiên Facebook nằm trên máy này; không cần Docker hay API local.</p><div className="settings-list">{fields.map(([key,label])=><label key={key}><input type="checkbox" checked={!!values[key]} onChange={e=>setValues({...values,[key]:e.target.checked})}/><span>{label}</span></label>)}</div><div className="actions"><button onClick={save}>Lưu cài đặt</button></div>{message&&<p className="desktop-message">{message}</p>}</section></>;
}

export function FacebookDesktop({accounts,children,reload}){
  const [active,setActive]=useState('');const [message,setMessage]=useState('');
  async function open(profileKey){try{await desktop().openFacebookLogin(profileKey);setActive(profileKey);setMessage('Trình duyệt đã mở. Đăng nhập xong rồi bấm “Tôi đã đăng nhập xong”.')}catch(e){setMessage(e.message)}}
  async function complete(){try{const result=await desktop().completeFacebookLogin();setMessage(`Phiên ${result.profileKey}: ${result.status}${result.serverUpdated?'':' · chưa cập nhật được lên Central Server'}`);setActive('');reload()}catch(e){setMessage(e.message)}}
  return <>{children}<section className="panel"><h2>Đăng nhập Facebook trong app</h2><p className="muted">Chọn tài khoản đã lưu. Bạn tự đăng nhập và hoàn thành 2FA; SIMI không lưu mật khẩu.</p><div className="login-accounts">{accounts.map(account=><div key={account.id}><b>{account.name}</b><span>{account.session_status}</span><button className="secondary" disabled={!!active} onClick={()=>open(account.profile_key)}>Mở Facebook</button></div>)}</div>{active&&<button onClick={complete}>Tôi đã đăng nhập xong</button>}{message&&<p className="desktop-message">{message}</p>}</section></>;
}
