/** Save access is restricted to these read-only APIs and an exact filename allowlist. */
import {open,stat,readdir,realpath} from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {decodeSave,decodeSaveScalars} from './decoder.mjs';
import {normalizeStatistics,normalizeProfile,buildCareer,statisticsDelta,sessionHarvestSummary} from './career.mjs';
import {normalizeHuntingPressure,huntingPressureView} from './hunting-pressure.mjs';
import {hash,normalizePopulation,diffPopulation,harvestRows,normalizeZones,linkZone,candidateSummary,reduceEncounter} from './core.mjs';
const EXTRA=['statistics_adf','thp_player_profile_adf','playerinformation_adf','found_need_zones_adf','hunting_log_adf','worlditemsdata_adf','health_component_manager_adf','reserveworlddata_adf'];
const placeCoordinates=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z);
function positiveIdentity(value,max=18446744073709551615n){
 if(typeof value==='number'&&!Number.isSafeInteger(value)||!['string','number','bigint'].includes(typeof value))return null;
 const encoded=String(value);if(!/^[1-9]\d{0,19}$/.test(encoded))return null;
 return BigInt(encoded)<=max?encoded:null;
}
function decoratePlaces(places,labels){return places.map(p=>{const originalLabel=p.label||p.kind||'Map point',customLabel=p.canRename===true?labels.get(p.renameId)??null:null;return {...p,originalLabel,customLabel,label:customLabel||originalLabel};});}
export const allowedName=name=>/^animal_population_\d{1,3}$/.test(name)||EXTRA.includes(name);
export function inside(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
export async function stableRead(root,name) {
  if(!allowedName(name))throw Error('File is outside the read allowlist');
  const target=await realpath(path.join(root,name));if(!inside(root,target))throw Error('Save symlink leaves the selected folder');
  async function once(){const h=await open(target,'r');try{const s=await h.stat();if(!s.isFile()||s.size>32*1024*1024)throw Error('Invalid save file');const b=await h.readFile();const end=await h.stat();if(s.size!==end.size||s.mtimeMs!==end.mtimeMs||b.length!==s.size)throw Error('Save is being written');return {b,mtime:s.mtime.toISOString(),size:s.size,sha:hash(b)};}finally{await h.close();}}
  const a=await once();await new Promise(r=>setTimeout(r,120));const b=await once();
  if(a.sha!==b.sha||a.mtime!==b.mtime)throw Error('Save changed between reads; retrying later');return {...b,checked:new Date().toISOString()};
}
export function normalizeFile(name,decoded) {
  const v=decoded.value;
  if(name==='statistics_adf')return normalizeStatistics(v);
  if(name==='thp_player_profile_adf')return normalizeProfile(v);
  if(name==='playerinformation_adf'){if(!Number.isInteger(v.NumUnharvestedAnimals)||v.NumUnharvestedAnimals<0)throw Error('Invalid unharvested count');return {unharvested:v.NumUnharvestedAnimals,harvestStreak:v.AnimalHarvestStreak,timeOfDay:v.TimeOfDay};}
  if(name.startsWith('animal_population_'))return {...normalizePopulation(v),huntingPressure:normalizeHuntingPressure(v.HuntingPressureMap),projectionVersion:2};
  if(name==='found_need_zones_adf')return normalizeZones(v);
  if(name==='hunting_log_adf')return harvestRows(v);
  if(name==='reserveworlddata_adf'){if(!Number.isInteger(v.Reserve))throw Error('Unknown reserve schema');return {reserve:v.Reserve};}
  if(name==='health_component_manager_adf') {
    if(!Array.isArray(v.SavedHealthComponentList))throw Error('Unknown health schema');
    return {recordCount:v.SavedHealthComponentList.length,identityValidated:false,description:'Entity-to-animal identity is unresolved. No health labels are generated.'};
  }
  if(name==='worlditemsdata_adf') {
    if(!Array.isArray(v.WorldItems))throw Error('Unknown world-item schema');
    const counts=new Map();for(const w of v.WorldItems){const link=positiveIdentity(w.SaveLinkId),key=link===null?null:`${w.ReserveId}:${link}`;if(key)counts.set(key,(counts.get(key)||0)+1);}
    return v.WorldItems.map((w,i)=>{const saveLinkId=positiveIdentity(w.SaveLinkId);return {id:`equipment:${w.ReserveId}:${w.SaveLinkId}:${i}`,reserve:Number(w.ReserveId),x:w.Position?.X,z:w.Position?.Z,hash:String(w.EquipmentHash),label:'Unidentified deployed item',source:'save',saveLinkId,renameIdentityVersion:1,renameIdentityUnique:saveLinkId!==null&&counts.get(`${w.ReserveId}:${saveLinkId}`)===1,bait:w.BaitSiteData?.map(b=>({amount:b.BaitAmountLeft,destroyed:!!b.IsDestroyed}))??[]};}).filter(placeCoordinates);
  }
  throw Error('Unsupported file');
}
export class Observer {
  constructor(store,root,reference,{interval=5000}={}) {
    this.store=store;this.root=root;this.reference=reference;this.profile=root?hash(root.toLowerCase()).slice(0,20):'manual';this.interval=interval;this.busy=false;this.stopped=false;this.watchHandle=null;this.cache=new Map();this.lastCycle=null;this.lastError=null;this.readCount=0;this.startedAt=new Date().toISOString();
  }
  source(name){if(!this.cache.has(name))this.cache.set(name,this.store.source(this.profile,name));return this.cache.get(name);}
  equipmentPlaces(){
    const raw=this.source('worlditemsdata_adf')?.payload??[],counts=new Map();
    for(const p of raw){const key=`${p.reserve}:${p.saveLinkId}`;counts.set(key,(counts.get(key)||0)+1);}
    return raw.filter(placeCoordinates).map(p=>{
      const known=this.reference.equipment?.[p.hash],place=known?.name?{...p,label:known.name,kind:known.kind,typeVerified:true}:{...p};
      const link=positiveIdentity(p.saveLinkId),type=positiveIdentity(p.hash,4294967295n),valid=Number.isInteger(p.reserve)&&p.reserve>=0&&p.reserve<=999&&p.renameIdentityVersion===1&&p.renameIdentityUnique===true&&link!==null&&type!==null&&counts.get(`${p.reserve}:${p.saveLinkId}`)===1;
      return {...place,renameId:valid?'place:equipment:'+hash([p.reserve,link,type]):null,canRename:valid,renameUnavailableReason:valid?null:'The save does not provide a unique, stable identity for this item. Rescan after the next save.'};
    });
  }
  publicPlaces(reserve){
    const raw=this.reference.reserves[reserve]?.poi??[],keys=raw.map(p=>placeCoordinates(p)&&p.source==='public_map_reference'&&typeof p.kind==='string'&&typeof p.id==='string'?'place:poi:'+hash([reserve,p.kind,p.x,p.z]):null),counts=new Map();
    for(const key of keys)if(key)counts.set(key,(counts.get(key)||0)+1);
    return raw.map((p,i)=>{const valid=keys[i]!==null&&counts.get(keys[i])===1;return {...p,renameId:valid?keys[i]:null,canRename:valid,renameUnavailableReason:valid?null:'This map reference does not have a unique place identity.'};});
  }
  pinPlaces(){return this.store.journal(this.profile,'pins').map(p=>{const valid=placeCoordinates(p)&&p.source==='player_report'&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=200;return {...p,renameId:valid?p.id:null,canRename:valid,renameUnavailableReason:valid?null:'This marker cannot be renamed.'};});}
  command(body){return this.store.command(this.profile,body,{canRenamePlace:id=>[...this.pinPlaces(),...this.equipmentPlaces(),...Object.values(this.reference.reserves).flatMap(r=>this.publicPlaces(r.id))].some(p=>p.canRename===true&&p.renameId===id)});}
  async scan(force=false) {
    if(this.busy||!this.root||this.stopped)return;this.busy=true;
    try {
      const list=(await readdir(this.root)).filter(allowedName).sort();
      for(const old of this.store.sources(this.profile))if(!list.includes(old.name))this.store.sourceStatus(this.profile,old.name,'missing','File is not available; last good data retained.');
      for(const name of list) {
        try {
          const prior=this.source(name),s=await stat(path.join(this.root,name)),needsProjectionRefresh=name.startsWith('animal_population_')&&prior?.payload?.projectionVersion!==2||name==='worlditemsdata_adf'&&Array.isArray(prior?.payload)&&prior.payload.some(p=>p.renameIdentityVersion!==1);
          if(!force&&!needsProjectionRefresh&&prior?.mtime===s.mtime.toISOString()&&this.store.sources(this.profile).find(r=>r.name===name)?.status==='ok'){this.store.touch(this.profile,name);continue;}
          const read=await stableRead(this.root,name);this.readCount++;
          if(prior?.sha===read.sha&&!needsProjectionRefresh){this.store.touch(this.profile,name,read.mtime);this.cache.set(name,{...prior,mtime:read.mtime,checked:read.checked});continue;}
          const decoded=name==='playerinformation_adf'?{value:decodeSaveScalars(read.b,['NumUnharvestedAnimals','AnimalHarvestStreak','TimeOfDay'])}:decodeSave(read.b),payload=normalizeFile(name,decoded);
          const next={sha:read.sha,mtime:read.mtime,checked:read.checked,status:'ok',error:null,payload};
          this.store.transaction(()=>{
            if(name.startsWith('animal_population_')) {
              const change=prior?.mtime>read.mtime?{boundary:'save_time_moved_backwards',changes:[]}:diffPopulation(prior?.payload,payload);
              if(change.boundary||change.changes.length)this.store.change(this.profile,Number(name.split('_').at(-1)),change);
            }
            if(name==='statistics_adf'&&prior?.payload){const delta=statisticsDelta(prior.payload,payload);if(delta.changed.length)this.store.change(this.profile,-2,delta);}
            if(name==='playerinformation_adf'&&prior?.payload?.unharvested!==undefined&&prior.payload.unharvested!==payload.unharvested)this.store.change(this.profile,-2,{kind:'unharvested_counter_change',before:prior.payload.unharvested,after:payload.unharvested,killsInferred:0});
            if(name==='hunting_log_adf')this.store.importHarvests(this.profile,prior?.payload??null,payload);
            this.store.saveSource(this.profile,name,next);
          });
          this.cache.set(name,next);
        }catch(e){this.store.sourceStatus(this.profile,name,'error',String(e.message).slice(0,400));}
      }
      this.lastError=null;this.lastCycle=new Date().toISOString();
    }catch(e){this.lastError=String(e.message);}finally{this.busy=false;}
  }
  async start() {
    await this.scan(true);
    if(this.root){try{this.watchHandle=watch(this.root,(_event,name)=>{if(name&&allowedName(String(name))){clearTimeout(this.debounce);this.debounce=setTimeout(()=>this.scan(),700);}});this.watchHandle.on('error',e=>{this.lastError='Watcher unavailable; polling continues: '+e.message;});}catch(e){this.lastError='Polling only: '+e.message;}}
    let cycle=0;this.timer=setInterval(()=>this.scan(++cycle%12===0),this.interval);this.timer.unref();
  }
  stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.debounce);this.watchHandle?.close();}
  state(reserve) {
    const profile=this.profile,s=this.store,settings=s.get('settings:'+profile,{spoilers:false,terrain:false});
    const sources=s.sources(profile),statusByName=Object.fromEntries(sources.map(r=>[r.name,r]));
    const rawZones=this.source('found_need_zones_adf')?.payload??[];
    const names={};const zones=rawZones.map(z=>{
      const r=linkZone(z,this.source('animal_population_'+z.reserve)?.payload,this.reference);
      if(r.speciesKey)names[r.localizationHash]=r.species;
      return r;
    });
    const annotations=s.journal(profile,'annotations');
    const selected=[...zones,...s.journal(profile,'zones')].filter(z=>z.reserve===reserve).map(z=>({...z,annotation:annotations.find(a=>a.zoneId===z.id)??null}));
    const encounters=s.journal(profile,'encounters').map(reduceEncounter);
    const used=new Map();for(const e of encounters)for(const v of e.evidence)if(v.harvestId)used.set(v.harvestId,e.id);
    const harvests=s.harvests(profile).map(h=>({...h,species:names[h.speciesHash]||`Species hash ${h.speciesHash}`,linkedEncounter:used.get(h.id)||null})).sort((a,b)=>b.timestamp-a.timestamp);
    const population=this.source('animal_population_'+reserve)?.payload;
    const labels=new Map(s.journal(profile,'placeLabels').filter(p=>typeof p.label==='string'&&p.label.trim()&&p.label.length<=120).map(p=>[p.placeId,p.label]));
    const reserves=Object.values(this.reference.reserves).map(r=>({...r,poi:r.id===reserve?decoratePlaces(this.publicPlaces(r.id),labels):[],available:!!this.source('animal_population_'+r.id)?.payload,status:statusByName['animal_population_'+r.id]?.status??'not_found',zoneCount:zones.filter(z=>z.reserve===r.id).length}));
    const pins=decoratePlaces(this.pinPlaces().filter(p=>p.reserve===reserve),labels),equipment=decoratePlaces(this.equipmentPlaces().filter(p=>p.reserve===reserve),labels);
    const visiblePlaces=[...pins,...equipment,...reserves.flatMap(r=>r.poi)],placeLabels=visiblePlaces.filter(p=>p.customLabel!==null).map(p=>({placeId:p.renameId,label:p.customLabel}));
    return {
      app:{name:'COTW Field Companion',version:'0.4.1',release:'Public preview',startedAt:this.startedAt},profile,selectedReserve:reserve,reserves,settings,
      observer:{connected:!!this.root,busy:this.busy,lastCycle:this.lastCycle,error:this.lastError,sourceFolder:this.root,intervalMs:this.interval,readCount:this.readCount,readOnly:true,permissionWriteBlocked:!!this.root&&!!process.permission&&!process.permission.has('fs.write',this.root),healthIdentityValidated:false,sources},
      career:buildCareer({statistics:this.source('statistics_adf'),profile:this.source('thp_player_profile_adf'),player:this.source('playerinformation_adf'),reserves,zones,equipment:this.source('worlditemsdata_adf')?.payload??[],harvests,sourceStatus:statusByName['statistics_adf']?.status}),careerChanges:s.changes(profile,-2),
      huntingPressure:huntingPressureView(population?.huntingPressure,{reserve,bounds:this.reference.reserves[reserve]?.bounds,savedAt:this.source('animal_population_'+reserve)?.mtime??null,sourceStatus:this.lastError?'error':statusByName['animal_population_'+reserve]?.status??'unavailable'}),
      zones:selected,pins,equipment,placeLabels,
      encounters:encounters.filter(e=>e.reserve===reserve),harvests:harvests.slice(0,500),harvestCount:harvests.length,
      sessions:s.journal(profile,'sessions').map(session=>({...session,harvestSummary:sessionHarvestSummary(session,harvests)})),route:s.get('route:'+profile+':'+reserve,[]),
      population:settings.spoilers?candidateSummary(population,this.reference):null,
      changes:settings.spoilers?s.changes(profile,reserve):null,
      candidateNotice:'Experimental weight-range candidates, not in-game confirmation. No live locations. Taruca and unmapped species are not evaluated. Reference retrieved 2026-09-17; game updates may invalidate it.',
      coverageEvents:s.changes(profile,-1),
      healthDiagnostics:this.source('health_component_manager_adf')?.payload??null
    };
  }
}
