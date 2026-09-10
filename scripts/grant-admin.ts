import {pool,migrate} from '../server/db.js';
const email=process.argv[2]?.trim().toLowerCase();
try{
 if(!email||!email.includes('@'))throw new Error('사용법: npx tsx scripts/grant-admin.ts <기존 가입 이메일>');
 await migrate();
 const result=await pool.query("UPDATE planner.app_user SET role='ADMIN' WHERE email=$1 AND status='ACTIVE' RETURNING id",[email]);
 if(!result.rowCount)throw new Error('정상 상태의 기존 가입 계정을 찾을 수 없습니다.');
 console.log('지정한 계정에 관리자 권한을 부여했습니다. 새로고침 후 관리자 메뉴를 확인하세요.');
}finally{await pool.end();}
