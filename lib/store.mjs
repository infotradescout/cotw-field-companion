import {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {hash,harvestDelta,reduceEncounter,OUTCOMES,STRATEGIES,text,coordinate,reserveId,observationTime} from './core.mjs';
export class Store {
  constructor(filename) {
    this.db=new DatabaseSync(filename);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(profile TEXT,name TEXT,sha TEXT,mtime TEXT,checked TEXT,status TEXT,error TEXT,payload BLOB,PRIMARY KEY(profile,name));
      CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY,profile TEXT,reserve INTEGER,at TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS harvests(id TEXT PRIMARY KEY,profile TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,profile TEXT,kind TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,result TEXT NOT NULL);`);
    const version=this.get('schema_version',1);if(version!==1)throw Error('Unsupported companion database version');this.set('schema_version',1);
  }
  get(k,fallback=null){const r=this.db.prepare('SELECT v FROM meta WHERE k=?').get(k);return r?JSON.parse(r.v):fallback;}
  set(k,v){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  source(profile,name){const r=this.db.prepare('SELECT * FROM sources WHERE profile=? AND name=?').get(profile,name);if(!r)return null;return {...r,payload:r.payload?JSON.parse(gunzipSync(r.payload).toString()):null};}
  sources(profile){return this.db.prepare('SELECT name,sha,mtime,checked,status,error FROM sources WHERE profile=? ORDER BY name').all(profile);}
  saveSource(profile,name,data){this.db.prepare(`INSERT INTO sources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile,name) DO UPDATE SET sha=excluded.sha,mtime=excluded.mtime,checked=excluded.checked,status=excluded.status,error=excluded.error,payload=excluded.payload`).run(profile,name,data.sha,data.mtime,data.checked,data.status,data.error??null,data.payload?gzipSync(JSON.stringify(data.payload)):null);}
  sourceStatus(profile,name,status,error){this.db.prepare(`INSERT INTO sources(profile,name,checked,status,error) VALUES(?,?,?,?,?) ON CONFLICT(profile,name) DO UPDATE SET checked=excluded.checked,status=excluded.status,error=excluded.error`).run(profile,name,new Date().toISOString(),status,error??null);}
  touch(profile,name,mtime=null){this.db.prepare('UPDATE sources SET checked=?,mtime=COALESCE(?,mtime),status=?,error=NULL WHERE profile=? AND name=?').run(new Date().toISOString(),mtime,'ok',profile,name);}
  change(profile,reserve,data){this.db.prepare('INSERT INTO changes(profile,reserve,at,data) VALUES(?,?,?,?)').run(profile,reserve,new Date().toISOString(),JSON.stringify(data));this.db.prepare('DELETE FROM changes WHERE id NOT IN (SELECT id FROM changes ORDER BY id DESC LIMIT 5000)').run();}
  changes(profile,reserve){return this.db.prepare('SELECT at,data FROM changes WHERE profile=? AND reserve=? ORDER BY id DESC LIMIT 80').all(profile,reserve).map(r=>({...JSON.parse(r.data),at:r.at}));}
  journal(profile,kind){return this.db.prepare('SELECT data FROM journal WHERE profile=? AND kind=?').all(profile,kind).map(r=>JSON.parse(r.data));}
  item(profile,id,kind){return this.journal(profile,kind).find(r=>r.id===id);}
  put(profile,kind,data){this.db.prepare('INSERT INTO journal VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,profile,kind,JSON.stringify(data));return data;}
  harvests(profile){return this.db.prepare('SELECT data FROM harvests WHERE profile=?').all(profile).map(r=>JSON.parse(r.data));}
  importHarvests(profile,before,after){
    const seen=new Set(this.harvests(profile).map(r=>r.recordId));const d=harvestDelta(before,after,seen);
    for(const h of d.records){const id=hash([profile,h.id]);this.db.prepare('INSERT OR IGNORE INTO harvests VALUES(?,?,?)').run(id,profile,JSON.stringify({...h,id,recordId:h.id,firstSeen:new Date().toISOString()}));}
    if(d.gap||d.rollback)this.change(profile,-1,{boundary:d.rollback?'harvest_history_rollback':'harvest_history_coverage_gap',changes:[]});
    return d;
  }
  mutate(profile,requestId,body,fn){
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw Error('Request ID required');
    const key=profile+':'+requestId,bh=hash(body);
    return this.transaction(()=>{const old=this.db.prepare('SELECT body_hash,result FROM requests WHERE id=?').get(key);if(old){if(old.body_hash!==bh)throw Object.assign(Error('Request ID reused with different content'),{status:409});return JSON.parse(old.result);}const result=fn();this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key,bh,JSON.stringify(result));return result;});
  }
  command(profile,body){
    const now=new Date().toISOString(),id=randomUUID(),op=body.op;
    if(op==='encounter.create') {
      const e={id,reserve:reserveId(body.reserve),species:text(body.species??'Unknown',120),notes:text(body.notes??''),search:'searching',version:1,createdAt:now,sessionId:this.journal(profile,'sessions').find(s=>!s.endedAt)?.id??null,evidence:[]};
      const x=coordinate(body.x),z=coordinate(body.z);if((x===null)!==(z===null))throw Error('Supply both coordinates');
      e.evidence.push({id:randomUUID(),type:'shot',observedAt:observationTime(body.observedAt),createdAt:now,source:'player_report',x,z,notes:'Initial shot reported'});
      return this.put(profile,'encounters',e);
    }
    if(op==='encounter.evidence'||op==='encounter.search') {
      const e=this.item(profile,body.id,'encounters');if(!e)throw Error('Encounter not found');
      if(e.version!==body.version)throw Object.assign(Error('Encounter changed in another tab. Refresh before saving.'),{status:409});
      if(op==='encounter.search'){if(!['searching','paused','abandoned'].includes(body.search))throw Error('Invalid search state');e.search=body.search;}
      else {
        if(!OUTCOMES.includes(body.type))throw Error('Invalid observation type');
        const ev={id:randomUUID(),type:body.type,observedAt:observationTime(body.observedAt),createdAt:now,source:'player_report',notes:text(body.notes??''),x:coordinate(body.x),z:coordinate(body.z)};
        if((ev.x===null)!==(ev.z===null))throw Error('Supply both coordinates');
        if(body.type==='harvest_linked') {
          const h=this.harvests(profile).find(h=>h.id===body.harvestId);if(!h)throw Error('Harvest receipt not found');
          const already=this.journal(profile,'encounters').some(r=>r.evidence.some(v=>v.harvestId===h.id));if(already)throw Object.assign(Error('Harvest receipt is already linked'),{status:409});
          ev.harvestId=h.id;ev.source='save_receipt_player_association';ev.observedAt=new Date(h.timestamp*1000).toISOString();
        }
        e.evidence.push(ev);
      }
      e.version++;return this.put(profile,'encounters',e);
    }
    if(op==='route.reorder') {
      const rid=reserveId(body.reserve),key='route:'+profile+':'+rid;
      const current=this.get(key,[]),order=body.order;
      if(JSON.stringify(body.expectedOrder)!==JSON.stringify(current))throw Object.assign(Error('Circuit changed in another tab. Refresh before reordering.'),{status:409});
      if(!Array.isArray(order)||order.length!==current.length||new Set(order).size!==order.length||order.some(v=>!current.includes(v)))throw Error('Circuit order must preserve the current stops');
      this.set(key,order);return order;
    }
    if(op==='zone.annotate') {
      const key=text(body.zoneId,200);if(!STRATEGIES.includes(body.strategy))throw Error('Invalid strategy');
      const annotation={id:hash([profile,key]),zoneId:key,strategy:body.strategy,name:text(body.name??'',120),notes:text(body.notes??''),updatedAt:now};return this.put(profile,'annotations',annotation);
    }
    if(op==='zone.create') {
      const x=coordinate(body.x),z=coordinate(body.z);if(x===null||z===null)throw Error('Zone coordinates required');
      if(!['feeding','drinking','resting'].includes(body.need))throw Error('Invalid need type');
      const start=Number(body.start),end=Number(body.end);if(![start,end].every(n=>Number.isFinite(n)&&n>=0&&n<=24)||start===end)throw Error('Invalid schedule');
      return this.put(profile,'zones',{id:'manual:'+id,reserve:reserveId(body.reserve),species:text(body.species??'Unknown',120),x,z,start,end,need:body.need,source:'player_report',createdAt:now});
    }
    if(op==='pin.create') {
      if(!['tent','stand','feeder','outpost','last_seen','shot','scout'].includes(body.kind))throw Error('Invalid pin type');
      const x=coordinate(body.x),z=coordinate(body.z);if(x===null||z===null)throw Error('Pin coordinates required');
      return this.put(profile,'pins',{id,reserve:reserveId(body.reserve),kind:body.kind,label:text(body.label||body.kind,120),x,z,notes:text(body.notes??''),source:'player_report',createdAt:now});
    }
    if(op==='pin.delete') {const p=this.item(profile,body.id,'pins');if(!p)throw Error('Pin not found');this.db.prepare('DELETE FROM journal WHERE id=? AND profile=? AND kind=?').run(p.id,profile,'pins');return {id:p.id,removed:true};}
    if(op==='route.toggle') {
      const r=reserveId(body.reserve),key='route:'+profile+':'+r,route=this.get(key,[]),zone=text(body.zoneId,200);const next=route.includes(zone)?route.filter(v=>v!==zone):[...route,zone];this.set(key,next);return {route:next};
    }
    if(op==='session.start') {if(this.journal(profile,'sessions').some(s=>!s.endedAt))throw Object.assign(Error('A session is already active'),{status:409});return this.put(profile,'sessions',{id,reserve:reserveId(body.reserve),name:text(body.name||'Field session',120),startedAt:now,endedAt:null});}
    if(op==='session.end') {const s=this.journal(profile,'sessions').find(s=>!s.endedAt);if(!s)throw Error('No active session');s.endedAt=now;return this.put(profile,'sessions',s);}
    if(op==='settings') {
      const settings=this.get('settings:'+profile,{spoilers:false,terrain:false});
      if(body.spoilers!==undefined){if(typeof body.spoilers!=='boolean'||(body.spoilers&&body.confirmSpoilers!==true))throw Error('Explicit spoiler consent required');settings.spoilers=body.spoilers;}
      if(body.terrain!==undefined){if(typeof body.terrain!=='boolean')throw Error('Invalid terrain setting');settings.terrain=body.terrain;}
      this.set('settings:'+profile,settings);return settings;
    }
    throw Error('Unknown command');
  }
  exportJournal(profile){return {format:'cotw-field-companion-journal',version:1,exportedAt:new Date().toISOString(),settings:this.get('settings:'+profile,{spoilers:false,terrain:false}),encounters:this.journal(profile,'encounters'),zones:this.journal(profile,'zones'),annotations:this.journal(profile,'annotations'),pins:this.journal(profile,'pins'),sessions:this.journal(profile,'sessions'),harvests:this.harvests(profile)};}
  close(){this.db.close();}
}
