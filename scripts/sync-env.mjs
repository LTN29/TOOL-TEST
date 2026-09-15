import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'.env');
if(!fs.existsSync(source)){
  fs.copyFileSync(path.join(root,'.env.example'),source);
  console.warn('[CẢNH BÁO] Đã tạo .env từ mẫu. Hãy đổi mật khẩu và các khóa bảo mật.');
}
for(const target of ['apps/api/.env','apps/worker/.env']) fs.copyFileSync(source,path.join(root,target));
