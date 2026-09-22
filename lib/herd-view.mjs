/** Bounded, read-only herd/zone view. Group IDs come from the durable companion ledger. */
import {createHash} from 'node:crypto';
import {readHerdLedger} from './herd-ledger.mjs';
import {trophyCounts,findHerdRule} from './herd-trophies.mjs';
export const HERD_VIEW_SCHEMA='grindzone.herds.v1';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const text=(v,n=120)=>typeof v==='string'&&v.trim()&&v.length<=n?v:null;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const rid=v=>Number.isInteger(v)&&v>=0&&v<=999;
const point=v=>typeof v?.x==='number'&&typeof v?.z==='number'&&[v.x,v.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000);
const kinds=['feeding','drinking','resting'];
export function herdQuery(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['reserve','species','herd','zone','trophy','offset','limit','revision'].includes(k)))fail('Unsupported herd filter');
 if(input.reserve!=null&&!(typeof input.reserve==='number'||typeof input.reserve==='string'&&/^\d{1,3}$/.test(input.reserve)))fail('Invalid reserve');
 const reserve=Number(input.reserve??19);if(!rid(reserve)||typeof input.reserve==='boolean'||input.reserve==='')fail('Invalid reserve');
 const result={reserve,species:null,herd:null,zone:null,trophy:'all',offset:0,limit:25,revision:null};
 for(const k of ['species','herd','zone'])if(input[k]!=null&&input[k]!==''&&input[k]!=='all'){if(!text(input[k],200))fail('Invalid '+k);result[k]=input[k];}
 if(input.trophy!=null){if(!['all','diamond','great_one','female_diamond'].includes(input.trophy))fail('Invalid trophy filter');result.trophy=input.trophy;}
 for(const [k,max]of [['offset',100000],['limit',50]])if(input[k]!=null){const v=input[k];if(!(typeof v==='number'||typeof v==='string'&&/^\d{1,6}$/.test(v)))fail('Invalid herd page');const n=Number(v);if(!Number.isSafeInteger(n)||n<(k==='limit'?1:0)||n>max)fail('Invalid herd page');result[k]=n;}
 if(input.revision!=null&&input.revision!==''){if(typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision))fail('Invalid herd revision');result.revision=input.revision;}
 return result;
}
export function herdSearchParams(params){const input=Object.create(null);for(const [k,v]of params){if(Object.hasOwn(input,k))fail('Duplicate herd filter');input[k]=v;}return herdQuery(input);}
export function readHerdView(observer,input={}){
 const query=herdQuery(input),store=observer.store,profile=observer.profile,settings=store.get('settings:'+profile,{spoilers:false});
 const empty=status=>({schema:HERD_VIEW_SCHEMA,status,reserve:query.reserve,query,herds:[],summary:null,nextOffset:null,revision:null,facets:{species:[],zones:[]}});
 if(settings.spoilers!==true)return empty('spoilers_off');
 const source=observer.source('animal_population_'+query.reserve),ledger=readHerdLedger(store,profile,query.reserve);
 if(!source?.payload||ledger?.sourceSha!==source.sha||ledger?.savedAt!==source.mtime)return empty('unavailable');
 const metadata=store.sources(profile).find(r=>r.name==='animal_population_'+query.reserve);
 const status=metadata?.status==='ok'&&!observer.lastError?'available':'stale';
 const annotations=new Map(store.journal(profile,'annotations').map(a=>[a.zoneId,a]));
 const discoveries=observer.describeZones((observer.source('found_need_zones_adf')?.payload??[]).filter(z=>z.reserve===query.reserve));
 const hidden=typeof observer.hiddenView==='function'?observer.hiddenView(query.reserve,discoveries):{zones:[]};
 const known=new Map([...discoveries,...hidden.zones].map(z=>[z.id,z]));
 const removed=new Map(store.journal(profile,'zoneHistory').filter(r=>r.reserve===query.reserve&&r.state==='removed').map(r=>[r.zoneId,r]));
 const zoneStatus=observer.zoneSourceStatus();
 function zoneFor(path,slot){
  if(path===4294967295)return {slot,status:'unassigned',id:null,need:null,start:null,end:null,x:null,z:null,name:null,source:null};
  const key=`saved:${query.reserve}:${path}:${slot}`,current=known.get(key),prior=removed.get(key)?.snapshot,z=current||prior;
  if(!z||!point(z))return {slot,status:'unmapped',id:key,need:null,start:null,end:null,x:null,z:null,name:null,source:null};
  return {slot,status:!current&&prior?'removed':zoneStatus!=='ok'?'stale':z.source==='population_path_reference'?'undiscovered':'discovered',id:key,
   need:kinds.includes(z.need)?z.need:null,start:typeof z.start==='number'&&z.start>=0&&z.start<=24?z.start:null,end:typeof z.end==='number'&&z.end>=0&&z.end<=24?z.end:null,
   x:z.x,z:z.z,name:text(annotations.get(key)?.name)||text(z.name)||text(z.species)||'Need zone',source:z.source==='population_path_reference'?'reference_area':'saved_zone'};
 }
 const populations=new Map(source.payload.populations.map(p=>[p.hash,p]));
 const rows=ledger.records.filter(r=>r.active).map(r=>{
  const pop=populations.get(r.speciesHash),group=pop?.groups[r.index];if(!group)fail('Herd snapshot changed',503);
  const species=observer.reference.populations?.[r.speciesHash],rule=findHerdRule(observer.herdReference,species?.key);
  return {id:r.id,label:r.label,species:text(species?.name)||'Unidentified animal',speciesKey:text(species?.key),reserve:query.reserve,
   firstSeenAt:r.firstSeenAt,lastSeenAt:r.lastSeenAt,continuity:r.continuity,counts:trophyCounts(group.animals,rule),zones:r.paths.map(zoneFor),
   zoneChanges:(r.routeHistory||[]).map(v=>({savedAt:v.savedAt,zones:v.paths.map(zoneFor)})),referenceAvailable:!!rule};
 });
 const all=rows.filter(r=>(!query.species||(r.speciesKey||r.species)===query.species)&&(!query.herd||r.id===query.herd)&&(!query.zone||r.zones.some(z=>z.id===query.zone))&&(query.trophy==='all'||query.trophy==='diamond'&&r.counts.diamonds>0||query.trophy==='great_one'&&(r.counts.greatOnes>0||r.counts.greatOneCandidates>0)||query.trophy==='female_diamond'&&r.counts.femaleDiamondCapable===true));
 all.sort((a,b)=>a.label.localeCompare(b.label));
 const summary={herds:all.length,animals:0,diamonds:0,greatOnes:0,greatOneCandidates:0,unknownGreatOne:0,unclassified:0,unclassifiedHerds:0};
 for(const r of all){for(const k of ['animals','greatOnes','greatOneCandidates','unknownGreatOne','unclassified'])summary[k]+=r.counts[k];if(r.counts.diamonds===null)summary.unclassifiedHerds++;else summary.diamonds+=r.counts.diamonds;}
 // A fully unmapped population is not a confirmed zero. Partial counts retain an explicit omission count.
 if(all.length&&summary.unclassifiedHerds===all.length)summary.diamonds=null;
 const revision=digest([ledger.sourceSha,ledger.generation,all,metadata?.status,zoneStatus]);
 if(query.offset&&query.revision!==revision)fail('Herds changed. Reload the first page.',409);
 const page=all.slice(query.offset,query.offset+query.limit);
 const byZone=new Map();for(const r of rows)for(const z of r.zones)if(z.id&&z.need){if(!byZone.has(z.id))byZone.set(z.id,{id:z.id,name:z.name,need:z.need,herds:[]});byZone.get(z.id).herds.push({id:r.id,label:r.label});}
 return {schema:HERD_VIEW_SCHEMA,status,reserve:query.reserve,query,revision,savedAt:iso(source.mtime),checkedAt:iso(metadata?.checked),summary,herds:page,nextOffset:query.offset+page.length<all.length?query.offset+page.length:null,
  facets:{species:[...new Map(rows.map(r=>[r.speciesKey||r.species,{key:r.speciesKey||r.species,name:r.species,femaleDiamondCapable:r.counts.femaleDiamondCapable}])).values()],zones:[...byZone.values()].slice(0,500),omittedZones:Math.max(0,byZone.size-500)},
  identityNotice:'GrindZone IDs track saved groups by unambiguous member or zone-assignment continuity; they are not native permanent herd IDs. Resets and ambiguous matches start new identities.',
  trophyNotice:'Diamonds are stored-score potential, not awarded harvest medals. Saved Great Ones use explicit flags; legacy flags/weight matches are separate candidates.',
  movementNotice:'Need-zone assignments and schedules from saves; these do not prove a real-time visit or an animal\'s current position.'};
}
/** Independent transport projection; no raw member IDs, population seeds, paths or account identifiers. */
export function projectHerdView(value){
 if(value?.schema!==HERD_VIEW_SCHEMA||!rid(value.reserve)||!['spoilers_off','unavailable','available','stale'].includes(value.status))fail('Herd view unavailable',503);
 const query=herdQuery(value.query);if(query.reserve!==value.reserve)fail('Herd response belongs to a different reserve',503);
 if(['spoilers_off','unavailable'].includes(value.status))return {schema:HERD_VIEW_SCHEMA,status:value.status,reserve:value.reserve,query,herds:[],summary:null,nextOffset:null,revision:null,facets:{species:[],zones:[]}};
 const counts=v=>({...Object.fromEntries(['animals','males','females','diamonds','greatOnes','greatOneCandidates','unknownGreatOne','unclassified','scripted'].map(k=>[k,number(v?.[k])])),femaleDiamondCapable:typeof v?.femaleDiamondCapable==='boolean'?v.femaleDiamondCapable:null,diamondBasis:v?.diamondBasis==='saved_score_potential_truracs'?'saved_score_potential_truracs':'saved_score_potential',greatOneBasis:'explicit_saved_flag'});
 const zone=z=>({slot:number(z?.slot),status:['unassigned','unmapped','removed','stale','undiscovered','discovered'].includes(z?.status)?z.status:'unmapped',id:id(z?.id)?z.id:null,need:kinds.includes(z?.need)?z.need:null,start:typeof z?.start==='number'&&z.start>=0&&z.start<=24?z.start:null,end:typeof z?.end==='number'&&z.end>=0&&z.end<=24?z.end:null,x:point(z)?z.x:null,z:point(z)?z.z:null,name:text(z?.name),source:['reference_area','saved_zone'].includes(z?.source)?z.source:null});
 if(!Array.isArray(value.herds)||value.herds.length>50||!/^[a-f0-9]{64}$/.test(value.revision))fail('Invalid herd page',503);
 const result={schema:HERD_VIEW_SCHEMA,status:value.status,reserve:value.reserve,query,revision:value.revision,savedAt:iso(value.savedAt),checkedAt:iso(value.checkedAt),summary:Object.fromEntries(['herds','animals','diamonds','greatOnes','greatOneCandidates','unknownGreatOne','unclassified','unclassifiedHerds'].map(k=>[k,number(value.summary?.[k])])),
  herds:value.herds.map(r=>{if(!id(r?.id)||!text(r.label)||r.reserve!==value.reserve)fail('Invalid herd identity',503);return {id:r.id,label:r.label,species:text(r.species)||'Unidentified animal',speciesKey:text(r.speciesKey),reserve:r.reserve,firstSeenAt:iso(r.firstSeenAt),lastSeenAt:iso(r.lastSeenAt),continuity:['member_signature','shared_members','unique_saved_assignment','new_after_restore','new_group','new_ambiguous'].includes(r.continuity)?r.continuity:'new_ambiguous',counts:counts(r.counts),zones:(Array.isArray(r.zones)?r.zones:[]).slice(0,51).map(zone),zoneChanges:(Array.isArray(r.zoneChanges)?r.zoneChanges:[]).slice(0,20).map(v=>({savedAt:iso(v.savedAt),zones:(Array.isArray(v.zones)?v.zones:[]).slice(0,51).map(zone)})),referenceAvailable:r.referenceAvailable===true};}),
  nextOffset:value.nextOffset===null?null:number(value.nextOffset),facets:{species:(Array.isArray(value.facets?.species)?value.facets.species:[]).slice(0,250).filter(s=>text(s?.key)).map(s=>({key:s.key,name:text(s.name)||'Unidentified animal',femaleDiamondCapable:typeof s.femaleDiamondCapable==='boolean'?s.femaleDiamondCapable:null})),zones:(Array.isArray(value.facets?.zones)?value.facets.zones:[]).slice(0,500).filter(z=>id(z?.id)).map(z=>({id:z.id,name:text(z.name),need:kinds.includes(z.need)?z.need:null,herds:(Array.isArray(z.herds)?z.herds:[]).slice(0,1000).filter(h=>id(h?.id)).map(h=>({id:h.id,label:text(h.label)}))})),omittedZones:number(value.facets?.omittedZones)??0},
  identityNotice:text(value.identityNotice,500),trophyNotice:text(value.trophyNotice,500),movementNotice:text(value.movementNotice,500)};
 if(Buffer.byteLength(JSON.stringify(result))>1500000)fail('Herd view too large; use fewer rows',413);return result;
}
