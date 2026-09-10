import 'dotenv/config';
import {writeFile} from 'node:fs/promises';
import {placeDetails} from '../server/place-details.js';
import {routeSegment} from '../server/routing.js';
const a={id:'clock',nameJa:'札幌市時計台',latitude:43.0625537,longitude:141.3536448},b={id:'park',latitude:43.0599018,longitude:141.3475101};
const requests:any[]=[];const inspect:typeof fetch=async(input,options)=>{const r=await fetch(input,options);const body=await r.clone().json().catch(()=>({}));requests.push({service:'Google Places',status:r.status,error:body.error?.status,reason:body.error?.details?.find((d:any)=>d.reason)?.reason});return r;};
const details:any=await placeDetails(a,inspect),route=await routeSegment(a,b,'TAXI');
const result={checkedAt:new Date().toISOString(),requests,details:{available:details.available,notice:details.notice,nameKo:details.nameKo,hasPhoto:!!details.photo,hasAddress:!!details.address,hasHours:!!details.openingHours?.length,reviewCount:details.reviewCount,reviewSample:details.reviewEvidence},route:{source:route.source,distanceMeters:route.distanceMeters,durationSeconds:route.durationSeconds,geometryPresent:!!route.coordinates?.length,cost:route.estimatedCost}};
console.log(JSON.stringify(result,null,2));await writeFile('docs/improvements-live-check.json',JSON.stringify(result,null,2));
