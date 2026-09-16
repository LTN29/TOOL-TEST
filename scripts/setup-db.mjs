import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const root=path.resolve(import.meta.dirname,'..');
const envFile=path.join(root,'.env');
if(!fs.existsSync(envFile)) throw new Error('Chưa có .env. Hãy sao chép từ .env.example và điền mật khẩu MySQL trước.');
process.loadEnvFile(envFile);
const require=createRequire(path.join(root,'apps/api/package.json'));
const mysql=require('mysql2/promise');
const connection=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3307),user:'root',password:process.env.MYSQL_ROOT_PASSWORD||'',multipleStatements:true});
try{
  await connection.query(fs.readFileSync(path.join(root,'db/init.sql'),'utf8'));
  const user=process.env.MYSQL_USER||'fbapp';
  const password=process.env.MYSQL_PASSWORD;
  const database=process.env.MYSQL_DATABASE||'fb_commenter';
  if(!password) throw new Error('MYSQL_PASSWORD chưa được cấu hình');
  for(const host of ['localhost','127.0.0.1']){
    await connection.query(`CREATE USER IF NOT EXISTS ${connection.escapeId(user)}@${connection.escape(host)} IDENTIFIED BY ${connection.escape(password)}`);
    await connection.query(`ALTER USER ${connection.escapeId(user)}@${connection.escape(host)} IDENTIFIED BY ${connection.escape(password)}`);
    await connection.query(`GRANT ALL PRIVILEGES ON ${connection.escapeId(database)}.* TO ${connection.escapeId(user)}@${connection.escape(host)}`);
  }
  await connection.query(fs.readFileSync(path.join(root,'db/migrations/001_queue_controls.sql'),'utf8'));
  await connection.query("UPDATE worker_nodes SET base_url='http://127.0.0.1:4311' WHERE name='local-worker' AND base_url='http://host.docker.internal:4311'");
  await connection.query('FLUSH PRIVILEGES');
  console.log(`Database ${database} và quyền cho user ${user} đã sẵn sàng.`);
} finally { await connection.end(); }
