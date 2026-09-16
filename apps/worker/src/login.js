import 'dotenv/config';
import {openLoginSession,closeAndSaveLoginSession,validProfileKey} from './profile-login.js';
import readline from 'node:readline/promises';

const profileKey=process.argv[2];
if(!validProfileKey(profileKey)){console.error('Usage: npm run login -- <profileKey>');process.exit(1)}
const session=await openLoginSession(profileKey);
const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
try{
  await terminal.question(`Đăng nhập Facebook cho ${profileKey}, hoàn thành 2FA rồi quay lại Terminal nhấn Enter...`);
  console.log(`Trạng thái phiên: ${await closeAndSaveLoginSession(session)}`);
}finally{
  terminal.close();
  await session.context.close().catch(()=>{});
}
