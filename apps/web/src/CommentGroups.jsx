import React,{useMemo,useState} from 'react';
import {Plus} from 'lucide-react';

const API=import.meta.env.VITE_API_BASE||'';
const SUGGESTED=['Hỏi thông tin','Hỏi giá & giao hàng','Thể hiện quan tâm'];

async function request(path,body){
  if(window.simiDesktop){const result=await window.simiDesktop.requestApi(path,{method:'POST',body:JSON.stringify(body)});if(!result.ok)throw new Error(result.data?.error||`HTTP ${result.status}`);return result.data}
  const response=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
  return data;
}

export default function CommentGroups({campaigns,groups,templates,reload,tell}){
  const [campaignId,setCampaignId]=useState('');
  const [groupName,setGroupName]=useState('');
  const [groupId,setGroupId]=useState('');
  const [content,setContent]=useState('');
  const [weight,setWeight]=useState(1);
  const [busy,setBusy]=useState(false);
  const visibleGroups=useMemo(()=>groups.filter(g=>String(g.campaign_id)===String(campaignId)),[groups,campaignId]);
  const selectedGroup=visibleGroups.find(g=>String(g.id)===String(groupId));

  async function createGroup(){
    if(!campaignId||!groupName.trim())return tell('Chọn chiến dịch và nhập tên nhóm');
    setBusy(true);
    try{const result=await request('/api/comment-groups',{campaignId,name:groupName.trim()});setGroupId(String(result.id));setGroupName('');tell('Đã tạo nhóm bình luận');await reload();}
    catch(e){tell(e.message)}finally{setBusy(false)}
  }
  async function saveTemplate(){
    if(!campaignId||!groupId||!content.trim())return tell('Chọn nhóm và nhập nội dung');
    setBusy(true);
    try{await request('/api/templates',{campaignId,groupId,content:content.trim(),weight:Number(weight)||1});setContent('');tell('Đã lưu câu vào nhóm');await reload();}
    catch(e){tell(e.message)}finally{setBusy(false)}
  }

  return <>
    <section className="panel">
      <div className="panel-head"><div><h2>Nhóm bình luận theo chiến dịch</h2><p>Mỗi nhóm có ID riêng và chứa nhiều câu. Tài khoản được gán nhóm khi tạo lịch; từng job giữ nguyên câu đã chọn.</p></div></div>
      <div className="group-toolbar">
        <label className="field"><span>Chiến dịch</span><select value={campaignId} onChange={e=>{setCampaignId(e.target.value);setGroupId('')}}><option value="">Chọn chiến dịch</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Tên nhóm mới</span><input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Ví dụ: Hỏi thông tin"/></label>
        <button disabled={busy||!campaignId||!groupName.trim()} onClick={createGroup}><Plus size={15}/>Tạo nhóm</button>
      </div>
      {campaignId&&<div className="group-suggestions">Gợi ý tên nhóm: {SUGGESTED.map(name=><button key={name} className="tiny secondary" onClick={()=>setGroupName(name)}>{name}</button>)}</div>}
    </section>
    {campaignId&&<section className="group-cards">
      {visibleGroups.length?visibleGroups.map(group=>{
        const items=templates.filter(t=>String(t.group_id)===String(group.id)&&t.is_active);
        return <article key={group.id} className={`group-card ${String(group.id)===String(groupId)?'selected-group':''}`}>
          <div className="group-card-head"><div><small>NHÓM #{group.id}</small><h3>{group.name}</h3></div><span>{items.length} câu</span></div>
          <div className="group-card-items">{items.length?items.map(item=><button key={item.id} className="preset" onClick={()=>{setGroupId(String(group.id));setContent(item.content)}} title="Sao chép vào ô soạn để chỉnh sửa rồi lưu câu mới">{item.content}</button>):<p>Chưa có câu nào. Chọn nhóm này để thêm câu.</p>}</div>
          <button className="tiny secondary" onClick={()=>setGroupId(String(group.id))}>Thêm câu vào nhóm</button>
        </article>;
      }):<div className="panel">Chưa có nhóm. Tạo một nhóm ở phía trên.</div>}
    </section>}
    {selectedGroup&&<section className="panel">
      <div className="panel-head"><div><h2>Thêm câu vào “{selectedGroup.name}”</h2><p>Câu chỉ được lưu khi bạn bấm nút bên dưới. Hãy kiểm tra nội dung trước khi dùng.</p></div></div>
      <div className="group-editor"><label className="field"><span>Nội dung bình luận</span><textarea rows="3" value={content} onChange={e=>setContent(e.target.value)} placeholder="Viết câu phù hợp với bài viết và nhóm đã chọn"/></label><label className="field"><span>Trọng số</span><input type="number" min="1" value={weight} onChange={e=>setWeight(e.target.value)}/><small>Chỉ dùng để cân bằng lựa chọn trong nhóm.</small></label><button disabled={busy||!content.trim()} onClick={saveTemplate}><Plus size={15}/>Lưu câu</button></div>
    </section>}
  </>;
}
