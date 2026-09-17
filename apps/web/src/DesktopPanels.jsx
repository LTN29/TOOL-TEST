import React,{useEffect,useState} from 'react';
import {Clock3,ExternalLink,RefreshCw} from 'lucide-react';

const desktop=()=>window.simiDesktop;
const fmt=value=>value?new Date(value).toLocaleString('vi-VN'):'—';
const stateLabel={RUNNING:'Hoạt động',STARTING:'Đang khởi động',RESTARTING:'Đang khởi động lại',STOPPED:'Chưa hoạt động',ERROR:'Có lỗi'};

export function DesktopStatus(){
  const [status,setStatus]=useState(null);
  const [update,setUpdate]=useState(null);
  useEffect(()=>{
    if(!desktop())return;
    const refresh=()=>desktop().getSystemStatus().then(setStatus).catch(()=>{});
    desktop().getUpdateStatus().then(setUpdate).catch(()=>{});
    const unsubscribe=desktop().onUpdateStatus(setUpdate);
    refresh();const timer=setInterval(refresh,30000);
    return()=>{clearInterval(timer);unsubscribe()};
  },[]);
  return <div className="desktop-status">{[['Central API',status?.centralApi],['Worker máy này',status?.worker?.state]].map(([name,value])=><div key={name}><i className={value==='RUNNING'?'on':''}/><span>{name}</span><small>{stateLabel[value]||'Đang kiểm tra'}</small></div>)}{['available','downloading','ready'].includes(update?.phase)&&<div><i className="on"/><span>Bản mới {update.latestVersion}</span><small>{update.phase==='ready'?'Sẵn sàng cài':'Vào Cài đặt'}</small></div>}</div>;
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
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Nhật ký</h2>
          <p>Log API, Worker và ứng dụng hiện tại. Không chứa mật khẩu Facebook.</p>
        </div>
        <button className="secondary" onClick={() => setRaw(!raw)}>
          {raw ? 'Xem dễ đọc' : 'Xem log kỹ thuật'}
        </button>
      </div>
      <div className="log-filters">
        {['TẤT CẢ', 'API', 'WORKER', 'DESKTOP'].map(name => (
          <button key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>{name}</button>
        ))}
      </div>
      <div className="log-terminal">
        {visible.length ? visible.map((row, index) => (
          <div key={`${row.at}-${index}`} className="log-row">
            <time>{fmt(row.at)}</time>
            <b>{row.source}</b>
            <span>{raw ? row.message : row.message.replace(/^\[[^\]]+\]\s*/, '')}</span>
          </div>
        )) : <p style={{ color: '#64748b' }}>Chưa có log trong phiên này.</p>}
      </div>
    </section>
  );
}

export function ConnectPanel({onConnected}){
  const [key,setKey]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [access,setAccess]=useState({cloudflareClientId:'',cloudflareClientSecret:''});const [manual,setManual]=useState({serverUrl:'http://127.0.0.1:4300',workerKey:'',deviceName:'',activationCode:'',cloudflareClientId:'',cloudflareClientSecret:''});
  async function connect(event){event.preventDefault();setError('');setBusy(true);try{await desktop().pairDevice(key,access);setKey('');onConnected()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function register(event){event.preventDefault();setError('');setBusy(true);try{await desktop().registerDevice(manual);setManual(current=>({...current,activationCode:''}));onConnected()}catch(e){setError(e.message)}finally{setBusy(false)}}
  const accessFields=[['cloudflareClientId','Cloudflare Access Client ID'],['cloudflareClientSecret','Cloudflare Access Client Secret']];
  return <div className="connect-page"><div className="connect-card"><span className="eyebrow">SIMI AUTOMATION</span><h1>Kết nối ứng dụng</h1><p>Dán mã kết nối được tạo trên máy chủ. Bạn chỉ làm bước này một lần; lần sau mở app sẽ vào thẳng màn hình chính.</p><form onSubmit={connect}><label className="field"><span>Mã kết nối</span><input autoFocus type="password" autoComplete="off" spellCheck="false" placeholder="SIMI1.…" value={key} onChange={event=>setKey(event.target.value)}/></label>{accessFields.map(([field,label])=><label className="field" key={field}><span>{label}</span><input type="password" autoComplete="off" required value={access[field]} onChange={event=>setAccess({...access,[field]:event.target.value})}/></label>)}<button disabled={busy||!key.trim()} type="submit">{busy?'Đang kết nối…':'Kết nối và mở app'}</button></form>{error&&<p className="desktop-message" role="alert">{error}</p>}<small>Cloudflare Service Token chỉ được chuyển một lần tới tiến trình chính của app và lưu bằng OS secure storage; không nằm trong React hay Git.</small><div className="actions"><button className="secondary" disabled={busy} onClick={()=>desktop().getSystemStatus().then(s=>s.deviceAuthenticated?onConnected():setError('Chưa kết nối được server. Kiểm tra mạng hoặc dán mã mới.')).catch(e=>setError(e.message))}>Thử kết nối lại</button></div><details className="manual-connect"><summary>Thiết lập máy chủ đầu tiên (nâng cao)</summary><p>Chỉ dùng khi chưa có máy nào được ghép để tạo mã.</p><form onSubmit={register}>{[['serverUrl','Server URL'],['workerKey','Worker key'],['deviceName','Tên máy'],['activationCode','Mã kích hoạt gốc'],...accessFields].map(([field,label])=><label className="field" key={field}><span>{label}</span><input type={field==='activationCode'||field==='cloudflareClientSecret'?'password':'text'} required value={manual[field]} onChange={e=>setManual({...manual,[field]:e.target.value})}/></label>)}<button type="submit" disabled={busy}>Đăng ký máy đầu tiên</button></form></details></div></div>;
}

export function SettingsPanel(){
  const [values,setValues]=useState(null);const [status,setStatus]=useState(null);const [message,setMessage]=useState('');const [saveMessage,setSaveMessage]=useState('');const [activationCode,setActivationCode]=useState('');const [registering,setRegistering]=useState(false);const [publicUrl,setPublicUrl]=useState('');const [pairingKey,setPairingKey]=useState('');const [creating,setCreating]=useState(false);
  useEffect(()=>{desktop().getSettings().then(setValues);desktop().getSystemStatus().then(setStatus)},[]);
  if(!values)return <section className="panel">Đang tải cài đặt…</section>;
  const fields=[['startWorker','Tự khởi động Worker'],['continueOnClose','Tiếp tục chạy khi đóng cửa sổ'],['openAtLogin','Tự mở cùng macOS']];
  async function save(){try{setValues(await desktop().saveSettings(values));setSaveMessage('Đã lưu cài đặt.')}catch(e){setSaveMessage(e.message)}}
  async function register(){
    setMessage('');
    if(!/^[A-Za-z0-9_-]{3,120}$/.test(values.workerKey||'')){
      setMessage('Worker key chỉ được dùng chữ, số, dấu gạch ngang hoặc gạch dưới; không có khoảng trắng.');
      return;
    }
    setRegistering(true);
    try{
      await desktop().registerDevice({...values,activationCode});
      setStatus(await desktop().getSystemStatus());
      setMessage('Đã đăng ký thiết bị và khởi động Worker.');
      setActivationCode('');
      window.location.reload();
    }catch(e){
      setMessage(/fetch failed|network|timed out|aborted/i.test(e.message)
        ? 'Không kết nối được Central API. Trên máy khác Mac mini, không dùng 127.0.0.1; hãy nhập URL truy cập được từ máy này.'
        : e.message);
    }finally{setRegistering(false)}
  }
  async function createPairingKey(){setMessage('');setPairingKey('');setCreating(true);try{const result=await desktop().requestApi('/api/devices/pairing-keys',{method:'POST',body:JSON.stringify({serverUrl:publicUrl.trim()})});if(!result.ok)throw new Error(result.data?.error||'Không tạo được mã');setPairingKey(result.data.key)}catch(e){setMessage(e.message)}finally{setCreating(false)}}
  return <><section className="panel"><h2>Máy đã kết nối</h2><p className="muted">{status?.deviceAuthenticated?'Đang kết nối Central Server':'Không xác thực được. Kiểm tra kết nối hoặc dùng mã mới.'} · {values.deviceName||values.workerKey} · {values.serverUrl}</p></section><section className="panel"><h2>Thêm máy khác</h2><p className="muted">Tạo mã một lần trên máy đang kết nối, chuyển mã cho máy mới rồi dán vào màn hình mở app. Không gửi mã cho người không được phép quản lý hệ thống.</p><label className="field"><span>Địa chỉ API máy mới truy cập được</span><input type="url" placeholder="https://api.example.com" value={publicUrl} onChange={e=>setPublicUrl(e.target.value)}/><small>Trên Windows, nhập hostname HTTPS của Cloudflare Tunnel đang trỏ tới API trên Mac mini; không dùng 127.0.0.1.</small></label><div className="actions"><button disabled={creating||!publicUrl.trim()||!status?.deviceAuthenticated} onClick={createPairingKey}>{creating?'Đang tạo…':'Tạo mã kết nối'}</button></div>{pairingKey&&<div className="pairing-output"><b>Mã dùng một lần · hết hạn sau 10 phút</b><code>{pairingKey}</code><button className="secondary" onClick={()=>navigator.clipboard.writeText(pairingKey).then(()=>setMessage('Đã sao chép mã')).catch(()=>setMessage('Hãy chọn và sao chép mã thủ công'))}>Sao chép</button></div>}{message&&<p className="desktop-message" role="status">{message}</p>}</section><UpdatesPanel/><section className="panel"><h2>Cài đặt desktop</h2><p className="muted">Worker và phiên Facebook nằm trên máy này; không cần Docker hay API local.</p><div className="settings-list">{fields.map(([key,label])=><label key={key}><input type="checkbox" checked={!!values[key]} onChange={e=>setValues({...values,[key]:e.target.checked})}/><span>{label}</span></label>)}</div><div className="actions"><button onClick={save}>Lưu cài đặt</button></div>{saveMessage&&<p className="desktop-message" role="status">{saveMessage}</p>}</section><details className="panel"><summary>Thiết lập thủ công (nâng cao)</summary><p className="muted">Chỉ dùng để khôi phục thiết bị cũ; thông thường hãy dùng mã kết nối bên trên.</p><div className="form-grid three"><label className="field"><span>Server URL</span><input value={values.serverUrl||''} onChange={e=>setValues({...values,serverUrl:e.target.value})}/></label><label className="field"><span>Worker key</span><input value={values.workerKey||''} onChange={e=>setValues({...values,workerKey:e.target.value})}/></label><label className="field"><span>Tên máy</span><input value={values.deviceName||''} onChange={e=>setValues({...values,deviceName:e.target.value})}/></label></div><div className="actions"><input className="activation-input" placeholder="Mã kích hoạt thiết bị" type="password" value={activationCode} onChange={e=>setActivationCode(e.target.value)}/><button disabled={registering||!activationCode} onClick={register}>{registering?'Đang đăng ký…':'Đăng ký thủ công'}</button></div></details></>;
}

function UpdatesPanel(){
  const [update,setUpdate]=useState(null);
  useEffect(()=>{
    desktop().getUpdateStatus().then(setUpdate).catch(()=>{});
    return desktop().onUpdateStatus(setUpdate);
  },[]);
  async function action(method){
    try{setUpdate(await desktop()[method]())}
    catch(error){setUpdate(current=>({...current,phase:'error',message:error.message}))}
  }
  const busy=['checking','downloading'].includes(update?.phase);
  
  if (['available', 'downloading', 'ready'].includes(update?.phase)) {
    return (
      <div className="updates-alert">
        <div>
          <b>Bản cập nhật mới: {update.latestVersion}</b>
          <span>{update.message}</span>
          {update.phase === 'downloading' && (
            <progress value={update.progress} max="100" aria-label="Tiến độ tải bản cập nhật" />
          )}
        </div>
        <div className="actions">
          {update.phase === 'available' && <button onClick={() => action('downloadUpdate')} disabled={busy}>Tải bản mới</button>}
          {update.phase === 'ready' && <button onClick={() => action('openUpdateInstaller')}>Mở bộ cài đã tải</button>}
        </div>
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cập nhật ứng dụng</h2>
          <p>App tự kiểm tra định kỳ. Chỉ tải bộ cài từ Central Server đã đăng ký và xác minh SHA-256 trước khi mở.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => action('checkForUpdates')}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} /> Kiểm tra
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: '#334155' }}>
        Phiên bản đang dùng: <b>{update?.currentVersion||'—'}</b>
      </p>
      {update?.message && update.phase === 'error' && (
        <p className="desktop-message" role="status" style={{ background: '#fee2e2', color: '#991b1b' }}>{update.message}</p>
      )}
      {update?.message && update.phase !== 'error' && (
        <p className="muted" style={{ marginTop: 8 }}>{update.message}</p>
      )}
    </section>
  );
}

export function FacebookDesktop({accounts,children,reload}){
  const [active,setActive]=useState('');const [message,setMessage]=useState('');
  async function addAndOpen(){try{const result=await desktop().addFacebookAccountAndLogin();setActive(result.profileKey);setMessage('Đã tạo tài khoản, lưu vào danh sách và mở Chrome. Đăng nhập xong rồi bấm “Tôi đã đăng nhập xong”.');await reload()}catch(e){setMessage(e.message)}}
  async function open(profileKey){try{await desktop().openFacebookLogin(profileKey);setActive(profileKey);setMessage('Trình duyệt đã mở. Đăng nhập xong rồi bấm “Tôi đã đăng nhập xong”.')}catch(e){setMessage(e.message)}}
  async function complete(){try{const result=await desktop().completeFacebookLogin();setMessage(`Phiên ${result.profileKey}: ${result.status}${result.serverUpdated?'':' · chưa cập nhật được lên Central Server'}`);setActive('');reload()}catch(e){setMessage(e.message)}}
  return <>{children}<section className="panel"><div className="panel-head"><div><h2>Đăng nhập Facebook</h2><p className="muted">Bấm thêm tài khoản để app tạo profile, lưu/gán vào Central Server và mở Chrome. Bạn tự đăng nhập, hoàn thành 2FA; SIMI không lưu mật khẩu.</p></div><button disabled={!!active} onClick={addAndOpen}>+ Thêm tài khoản và mở Chrome</button></div><div className="login-accounts">{accounts.map(account=><div key={account.id}><b>{account.name}</b><span>{account.session_status}</span><button className="secondary" disabled={!!active} onClick={()=>open(account.profile_key)}>Mở lại Facebook</button></div>)}</div>{active&&<button onClick={complete}>Tôi đã đăng nhập xong</button>}{message&&<p className="desktop-message">{message}</p>}</section></>;
}
