import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {pool,migrate} from '../server/db.js';
import {dateOnly,uuid,addDate} from '../server/domain.js';
import {analyzeReviews,jstDay} from '../server/review-trends.js';
import {placeDetails} from '../server/place-details.js';
const args=process.argv.slice(2),arg=(name:string)=>args[args.indexOf(name)+1];
async function apify(path:string,init:RequestInit={}){const token=process.env.APIFY_API_TOKEN;if(!token)throw Error('APIFY_TOKEN_MISSING');const r=await fetch('https://api.apify.com/v2/'+path,{...init,signal:AbortSignal.timeout(25000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}});if(!r.ok)throw Error('APIFY_HTTP_'+r.status);return r.json();}
async function main(){
 const placeId=uuid.parse(arg('--place')),today=jstDay(new Date()),startDate=dateOnly.parse(args.includes('--start')?arg('--start'):addDate(today,-61)),endDate=dateOnly.parse(args.includes('--end')?arg('--end'):addDate(today,-1));
 if(startDate>endDate||endDate>=today||Date.parse(endDate)-Date.parse(startDate)>5*366*86400000)throw Error('INVALID_DATE_RANGE');
 await migrate();const p=(await pool.query('SELECT id,name_ja AS "nameJa",latitude,longitude FROM geo_data.place WHERE id=$1',[placeId])).rows[0];if(!p)throw Error('PLACE_NOT_FOUND');
 let link=(await pool.query('SELECT google_place_id FROM planner.google_place_link WHERE place_id=$1',[placeId])).rows[0]?.google_place_id;
 if(!link){const d=await placeDetails(p);if(!d.available||!d.googlePlaceId)throw Error('GOOGLE_MATCH_UNAVAILABLE');link=d.googlePlaceId;await pool.query('INSERT INTO planner.google_place_link(place_id,google_place_id) VALUES($1,$2) ON CONFLICT(place_id) DO NOTHING',[placeId,link]);}
 if(!args.includes('--run')){console.log(JSON.stringify({dryRun:true,placeId,googlePlaceId:link,input:{placeIds:[link],startDate,endDate,sortBy:'newest',maxReviewsPerPlace:100,country:'jp',language:'ja'},maxTotalChargeUsd:.10,next:'새 유료 실행: --run new. 기존 실행 결과 재조회: --run RUN_ID. 범위 완주 확인 후에만 --coverage-verified 사용.'},null,2));return;}
 let run:any;
 if(arg('--run')==='new'){run=(await apify('acts/beatanalytics~google-maps-reviews-scraper/runs?maxTotalChargeUsd=0.1&maxItems=100&timeout=180',{method:'POST',body:JSON.stringify({placeIds:[link],startDate,endDate,sortBy:'newest',maxReviewsPerPlace:100,country:'jp',language:'ja'})})).data;console.log(JSON.stringify({runId:run.id,status:run.status,next:'같은 --place/--start/--end 값과 --run '+run.id+' 로 완료 후 결과를 저장하세요. 새 실행을 반복하지 마세요.'}));return;}
 const runId=arg('--run');if(!/^[A-Za-z0-9]+$/.test(runId))throw Error('INVALID_RUN_ID');run=(await apify('actor-runs/'+runId)).data;
 if(run.status!=='SUCCEEDED'){console.log(JSON.stringify({runId,status:run.status,imported:false}));return;}
 const actual=await apify('key-value-stores/'+run.defaultKeyValueStoreId+'/records/INPUT');
 if(actual.placeIds?.length!==1||actual.placeIds[0]!==link||actual.startDate!==startDate||actual.endDate!==endDate||actual.sortBy!=='newest')throw Error('RUN_INPUT_MISMATCH');
 const actor=(await apify('acts/beatanalytics~google-maps-reviews-scraper')).data;if(run.actId!==actor.id)throw Error('WRONG_ACTOR');
 const meta=(await apify('datasets/'+run.defaultDatasetId)).data;if(!Number.isInteger(meta.itemCount)||meta.itemCount>50000)throw Error('DATASET_TOO_LARGE');
 const rows:any[]=[];for(let offset=0;offset<meta.itemCount;offset+=1000){const batch=await apify('datasets/'+run.defaultDatasetId+'/items?clean=true&limit=1000&offset='+offset);if(!Array.isArray(batch))throw Error('BAD_DATASET');rows.push(...batch);}
 if(rows.length!==meta.itemCount)throw Error('PARTIAL_DATASET_DOWNLOAD');
 const analyzed=analyzeReviews(rows,{googlePlaceId:link,startDate,endDate,scrapedAt:run.finishedAt,complete:args.includes('--coverage-verified'),maxResults:actual.maxReviewsPerPlace||100});
 const db=await pool.connect(),id=randomUUID();
 try{await db.query('BEGIN');await db.query('SELECT id FROM geo_data.place WHERE id=$1 FOR UPDATE',[placeId]);
 const prior=await db.query('SELECT id FROM planner.review_import WHERE provider_run_id=$1',[runId]);if(prior.rowCount){await db.query('ROLLBACK');console.log(JSON.stringify({alreadyImported:true,runId}));return;}
 const q=analyzed.quality;
 await db.query('INSERT INTO planner.review_import(id,place_id,provider_run_id,google_place_id,coverage_start,coverage_end,complete,received_count,accepted_count,rejected_count,duplicate_count,reason,scraped_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,placeId,runId,link,startDate,endDate,q.complete,q.received,q.accepted,q.rejected,q.duplicates,q.reason,run.finishedAt]);
 for(const p of analyzed.periods)await db.query('INSERT INTO planner.place_review_stats(place_id,import_id,period_type,period_start,review_count,average_rating,previous_review_count,growth_rate,complete) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[placeId,id,p.periodType,p.periodStart,p.reviewCount,p.averageRating,p.previousReviewCount,p.growthRate,p.complete]);
 await db.query('INSERT INTO planner.place_review_trend(place_id,import_id,trend_type,recent_review_count,previous_review_count,growth_rate,seasonal_patterns,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(place_id) DO UPDATE SET import_id=excluded.import_id,trend_type=excluded.trend_type,recent_review_count=excluded.recent_review_count,previous_review_count=excluded.previous_review_count,growth_rate=excluded.growth_rate,seasonal_patterns=excluded.seasonal_patterns,quality=excluded.quality,calculated_at=now() WHERE (planner.place_review_trend.quality->>\'asOf\')::date <= (excluded.quality->>\'asOf\')::date',[placeId,id,analyzed.trendType,analyzed.recentReviewCount,analyzed.previousReviewCount,analyzed.growthRate,JSON.stringify(analyzed.seasonalPatterns),JSON.stringify(q)]);
 await db.query('COMMIT');console.log(JSON.stringify({runId,placeId,trendType:analyzed.trendType,quality:q,periods:analyzed.periods.length,rawBodiesStored:false},null,2));
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
main().catch(e=>{console.error('REVIEW_POC_ERROR',e.name,e.message?.startsWith('APIFY_')?e.message:e.message?.match(/^[A-Z_]+$/)?e.message:'VALIDATION_OR_IMPORT_FAILED');process.exitCode=1;}).finally(()=>pool.end());
