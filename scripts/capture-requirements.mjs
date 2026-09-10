import {chromium} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';

const base='http://127.0.0.1:5173',out='docs/screenshots/requirements';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage(),db=new pg.Pool({connectionString:process.env.DATABASE_URL||'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan'});
const email=`ppt-evidence-${randomUUID()}@example.test`;
const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`,fullPage:false});};
try{
 await page.goto(base+'/signup');await page.waitForSelector('.auth-form');await page.waitForTimeout(600);await shot('01-signup');
 await page.goto(base+'/login');await page.waitForSelector('.auth-form');await page.waitForTimeout(600);await shot('02-login');
 await page.getByLabel('이메일').fill('unknown@example.test');await page.getByLabel('비밀번호').fill('wrong-password');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('alert').waitFor();await shot('13-login-error');
 await page.goto(base+'/admin');await page.waitForURL(/\/login/);await page.waitForSelector('.auth-form');await page.waitForTimeout(600);await shot('03-protected-redirect');
 const registered=await page.request.post(base+'/api/auth/register',{data:{email,name:'기능 검증 여행자',password:'ppt-evidence-password'}});if(!registered.ok())throw new Error('회원가입 실패 '+registered.status());
 const user=(await registered.json()).user;
 const places=await db.query(`SELECT id FROM geo_data.place WHERE region_id='sapporo' AND category='ATTRACTION' ORDER BY (name_ko IS NOT NULL) DESC,(website IS NOT NULL) DESC,(osm_tags ? 'wikidata') DESC LIMIT 2`);
 const ids=places.rows.map(p=>p.id);if(ids.length<2)throw new Error('캡처용 장소 부족');
 const tripResponse=await page.request.post(base+'/api/trips',{data:{title:'삿포로의 하루',startDate:'2026-09-10',days:2,transportMode:'DRIVE'}});const tripId=(await tripResponse.json()).data.id;
 await page.request.put(`${base}/api/trips/${tripId}/days/2026-09-10/items`,{data:{placeIds:ids,expectedRevision:0}});
 await page.goto(base+'/explore?region=sapporo');await page.waitForSelector('.explore-page');await page.waitForSelector('.gm-style',{timeout:15000});await page.waitForTimeout(1800);await shot('04-place-search-map');
 await page.goto(base+'/places/'+ids[0]);await page.waitForSelector('.detail-page');await page.waitForTimeout(1400);await shot('05-place-detail');
 await page.goto(base+'/trips');await page.waitForSelector('.trip-card');await page.waitForTimeout(500);await shot('06-trip-list');
 await page.goto(base+'/trips/'+tripId);await page.waitForSelector('.planner-workspace');await page.waitForTimeout(1800);await shot('07-route-weather');
 await page.getByRole('button',{name:'하루 코스 추천',exact:true}).click();await page.getByRole('region',{name:'하루 코스 추천'}).waitFor();await page.waitForSelector('.day-plan-card');await shot('08-day-plan-options');
 await page.getByRole('button',{name:'이 코스 동선 미리보기'}).first().click();await page.waitForSelector('.day-preview',{timeout:30000});await shot('09-day-plan-preview');
 await page.route('**/api/trips/*/days/*/day-alternatives',async route=>route.request().method()==='PATCH'?route.fulfill({status:409,json:{error:'일정이 변경됐어요. 새로운 코스를 다시 확인해주세요.'}}):route.continue());
 await page.getByRole('button',{name:'이 코스로 하루 교체'}).click();const alert=page.getByRole('alert');await alert.waitFor();await alert.scrollIntoViewIfNeeded();await page.waitForTimeout(350);await shot('10-integrity-conflict');await page.unroute('**/api/trips/*/days/*/day-alternatives');
 await page.getByRole('button',{name:'하루 코스 추천 닫기'}).click();
 await db.query("UPDATE planner.app_user SET role='ADMIN' WHERE id=$1",[user.id]);
 await page.goto(base+'/admin');await page.waitForSelector('.admin-table');await page.waitForTimeout(600);await shot('11-admin');
 await page.goto(base+'/trips');await page.waitForSelector('.trip-card');await page.waitForTimeout(450);await page.getByLabel('삿포로의 하루 여행 메뉴').click();await page.getByRole('button',{name:'여행 삭제',exact:true}).click();await page.getByRole('dialog',{name:'여행 삭제 확인'}).waitFor();await page.waitForTimeout(450);await shot('12-delete-confirmation');
}finally{
 await db.query('DELETE FROM planner.app_user WHERE email=$1',[email]);await db.end();await browser.close();
}
console.log('Requirement screenshots written to',out);
