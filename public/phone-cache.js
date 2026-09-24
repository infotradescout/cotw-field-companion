/** Optional private copies in this paired browser. No cloud player database, raw saves or write queue. */
export const CACHE_SCHEMA='grindzone.paired-browser.v1';
export const CACHE_DATABASE='GrindZone.private-phone-progress.v1';
export const CACHE_MAX_RESERVES=3;
export const CACHE_MAX_BYTES=2*1024*1024;
export const CACHE_RETENTION_MS=7*86400000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validReserve=v=>Number.isInteger(v)&&v>=0&&v<=999;
const validScope=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const fail=(message,status=0,cacheDenied=false)=>Object.assign(Error(message),{status,cacheDenied});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>Number.isFinite(v)?new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable';
const newEpoch=()=>globalThis.crypto.randomUUID();
const stateFields='app selectedReserve harvestCount candidateNotice reserves settings career careerChanges huntingPressure zones pins equipment placeLabels encounters harvests sessions route routeOptimization routeSetup population changes coverageEvents zoneLedgerVersion zoneTracking zoneHistory zoneActivity zoneDiscovery'.split(' ');

export function cacheAuthority(bootstrap,now=Date.now()){
 const c=bootstrap?.phone?.cache;
 if(bootstrap?.phone?.remote!==true||!validScope(c?.scope)||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now)return null;
 return {scope:c.scope,expiresAt:c.expiresAt};
}
/** Only an existing, authenticated phone projection is accepted. No credentials are copied. */
export function snapshotState(value,reserve){
 if(!plain(value)||value.selectedReserve!==reserve||!validReserve(reserve)||value.phone?.mode!=='live_relay'||!plain(value.settings)||!Array.isArray(value.zones)||!Array.isArray(value.sessions)||!Array.isArray(value.reserves))throw fail('The live phone view is not valid for this reserve.',409,true);
 const snapshot=Object.fromEntries(stateFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
 const o=value.observer||{};
 snapshot.observer={connected:o.connected===true,busy:false,lastCycle:typeof o.lastCycle==='string'?o.lastCycle:null,readOnly:true,error:o.error?'The source needed attention when this copy was saved.':null,sources:Array.isArray(o.sources)?o.sources.map(s=>({name:s.name,mtime:s.mtime,checked:s.checked,status:s.status,error:s.error?'Source needed attention':null})):[]};
 const encoded=JSON.stringify(snapshot);
 if(new TextEncoder().encode(encoded).length>CACHE_MAX_BYTES)throw fail('This reserve is too large to keep in the phone cache.',413);
 return JSON.parse(encoded);
}
export function storedView(record,authority,reserve,now=Date.now()){
 if(!authority||!record||record.schema!==CACHE_SCHEMA||record.scope!==authority.scope||record.reserve!==reserve||!Number.isSafeInteger(record.capturedAt)||!Number.isSafeInteger(record.expiresAt)||!plain(record.state)||record.expiresAt<=now||record.capturedAt>now+300000||record.expiresAt>Math.min(record.capturedAt+CACHE_RETENTION_MS,authority.expiresAt)||record.state?.selectedReserve!==reserve)return null;
 const s=structuredClone(record.state);
 s.phone={mode:'cached_snapshot',readOnly:true,cachedAt:new Date(record.capturedAt).toISOString(),expiresAt:new Date(record.expiresAt).toISOString(),privateDiagnosticsExcluded:true};
 s.observer={...s.observer,connected:false,busy:false};
 if(s.huntingPressure)s.huntingPressure={...s.huntingPressure,stale:true};
 if(s.zoneTracking)s.zoneTracking={...s.zoneTracking,active:false,stopReason:'cached_view'};
 return s;
}

/** One small transactional store: erase/consent epochs reject writes already in flight, including other tabs. */
export class BrowserSnapshotStore{
 constructor(indexedDB=globalThis.indexedDB){this.indexedDB=indexedDB;this.opened=null;}
 async open(){
  if(!this.indexedDB)throw fail('This browser does not allow private saved progress. Live access still works.');
  if(this.opened)return this.opened;
  this.opened=new Promise((resolve,reject)=>{
   const request=this.indexedDB.open(CACHE_DATABASE,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('cache'))request.result.createObjectStore('cache');};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.opened=null;};resolve(db);};
   request.onerror=()=>{this.opened=null;reject(fail('Private storage is unavailable. Live access still works.'));};
   request.onblocked=()=>{this.opened=null;reject(fail('Close another GrindZone tab before changing private storage.'));};
  });
  return this.opened;
 }
 async read(){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly'),r=tx.objectStore('cache').get('root');let value;r.onsuccess=()=>{value=r.result??null;};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(fail('Could not read private saved progress.'));});}
 async edit(change){
  const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('cache','readwrite'),store=tx.objectStore('cache'),r=store.get('root');let result,error;
   r.onsuccess=()=>{try{const next=change(r.result??null);result=next.result;if(next.root===null)store.delete('root');else store.put(next.root,'root');}catch(e){error=e;tx.abort();}};
   tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(error||fail('Could not save private progress. Storage may be full or blocked.'));
  });
 }
 async close(){if(this.opened)(await this.opened).close();this.opened=null;}
}

export class PhoneSnapshotCache{
 constructor({store=new BrowserSnapshotStore(),fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
  this.store=store;this.fetch=fetchImpl;this.now=now;this.authority=null;this.readOnly=false;this.cachedAt=null;this.expiresAt=null;this.enabled=false;this.records=[];this.storageError='';this.latest=null;
 }
 async request(url,token){
  const response=await this.fetch(url,{cache:'no-store',headers:token?{'X-Companion-Token':token}:{}});
  let data;try{data=await response.json();}catch{throw fail('The phone service returned an unreadable response.',response.status);}
  if(!response.ok)throw Object.assign(fail(data?.error||'Request failed',response.status,[401,403].includes(response.status)),{cacheScope:response.headers.get('x-grindzone-cache-scope')});
  return {response,data};
 }
 async bind(bootstrap){
  const authority=cacheAuthority(bootstrap,this.now());
  if(this.authority?.scope!==authority?.scope){this.latest=null;this.readOnly=false;this.cachedAt=null;}
  this.authority=authority;
  if(!authority){this.enabled=false;return;}
  try{
   let root=await this.store.read();
   if(root&&root.scope!==authority.scope){await this.store.edit(current=>current?.scope!==authority.scope?{root:null,result:null}:{root:current,result:null});root=null;}
   this.enabled=root?.enabled===true&&root.scope===authority.scope;
   this.records=this.enabled?(root.records||[]).filter(r=>storedView(r,authority,r.reserve,this.now())).map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt})):[];
  }catch(error){this.enabled=false;this.storageError=error.message;}
 }
 async forget(){
  this.latest=null;this.readOnly=false;this.cachedAt=null;this.expiresAt=null;this.enabled=false;this.records=[];
  await this.store.edit(root=>({root:{schema:CACHE_SCHEMA,scope:this.authority?.scope||root?.scope||null,enabled:false,epoch:newEpoch(),records:[]},result:null}));
 }
 async invalidate(){this.authority=null;await this.forget().catch(()=>{});}
 async authenticate(token){
  try{const {response,data}=await this.request('/api/bootstrap',token);const metadata={...data,phone:{...data.phone,cache:{scope:response.headers.get('x-grindzone-cache-scope'),expiresAt:Number(response.headers.get('x-grindzone-cache-expires'))}}};await this.bind(metadata);return data;}
  catch(error){if([401,403].includes(error.status)){await this.invalidate();error.cacheDenied=true;}throw error;}
 }
 async get(url,{token}={}){
  if(/\/api\/bootstrap(?:\?|$)/.test(url))return this.authenticate(token);
  if(!/\/api\/state(?:\?|$)/.test(url))return (await this.request(url,token)).data;
  const bootstrap=await this.authenticate(token),authority=this.authority,startedAt=this.now();
  const reserve=Number(new URL(url,'https://grindzone.invalid').searchParams.get('reserve')??bootstrap.selectedReserve??19);
  if(!validReserve(reserve))throw fail('Invalid reserve',400);
  let permit=null;
  if(authority)try{const root=await this.store.read();if(root?.enabled&&root.scope===authority.scope)permit={scope:root.scope,epoch:root.epoch};}catch{}
  let result;
  try{result=await this.request(url,token);}catch(error){
   if([401,403].includes(error.status)){await this.invalidate();error.cacheDenied=true;throw error;}
   if(![503,504].includes(error.status)||!authority)throw error;
   if(error.cacheScope!==authority.scope){await this.invalidate();throw fail('The paired source changed. Reload before continuing.',409,true);}
   const saved=await this.read(reserve,authority);
   if(!saved){this.readOnly=false;error.cacheDenied=true;error.message='The PC is unavailable and this reserve has no saved copy in this browser. Reconnect the PC to load it.';throw error;}
   this.latest=null;this.readOnly=true;this.cachedAt=Date.parse(saved.phone.cachedAt);this.expiresAt=Date.parse(saved.phone.expiresAt);return saved;
  }
  const {response,data}=result;
  if(authority&&response.headers.get('x-grindzone-cache-scope')!==authority.scope){await this.invalidate();throw fail('The paired source changed. Reload before continuing.',409,true);}
  if(data?.selectedReserve!==reserve)throw fail('The phone received a different reserve. Retry before continuing.',409,true);
  this.readOnly=false;this.cachedAt=null;this.expiresAt=null;
  this.latest={state:data,authority,startedAt};
  if(authority&&permit)try{await this.save(data,reserve,authority,permit,startedAt);}catch(error){this.storageError=error.message;}
  return data;
 }
 async save(state,reserve,authority,permit,startedAt){
  const data=snapshotState(state,reserve),now=this.now(),expiresAt=Math.min(now+CACHE_RETENTION_MS,authority.expiresAt);
  const record={schema:CACHE_SCHEMA,scope:authority.scope,reserve,capturedAt:now,startedAt,expiresAt,state:data};
  const saved=await this.store.edit(root=>{
   if(!root?.enabled||root.scope!==permit.scope||root.epoch!==permit.epoch||this.authority?.scope!==authority.scope)return {root,result:false};
   let records=(root.records||[]).filter(r=>r.expiresAt>now);
   // Turning spoilers off removes hidden information from ALL saved reserves, not just the open map.
   if(data.settings?.spoilers!==true)records=records.filter(r=>r.state?.settings?.spoilers!==true);
   const previous=records.find(r=>r.reserve===reserve);
   if(previous?.startedAt>startedAt)return {root,result:false};
   records=[record,...records.filter(r=>r.reserve!==reserve)].sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,CACHE_MAX_RESERVES);
   return {root:{...root,records},result:true};
  });
  if(saved){this.storageError='';this.records=(await this.store.read())?.records?.map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt}))||[];}
  return saved;
 }
 async read(reserve,authority=this.authority){
  try{const root=await this.store.read();return root?.enabled&&root.scope===authority?.scope?storedView(root.records?.find(r=>r.reserve===reserve),authority,reserve,this.now()):null;}catch(error){this.storageError=error.message;return null;}
 }
 async enable(state){
  const live=this.latest,authority=this.authority;
  if(!authority||this.readOnly||live?.state!==state||live.authority?.scope!==authority.scope||this.now()-live.startedAt>60000)throw fail('Reconnect and refresh this reserve before keeping a private copy.',409);
  // Verify before enabling; storage errors must not report a successful copy.
  snapshotState(state,state.selectedReserve);
  const epoch=newEpoch();
  await this.store.edit(()=>({root:{schema:CACHE_SCHEMA,scope:authority.scope,enabled:true,epoch,records:[]},result:null}));
  this.enabled=true;
  try{if(!await this.save(state,state.selectedReserve,authority,{scope:authority.scope,epoch},live.startedAt))throw fail('Cache settings changed in another tab.');}
  catch(error){await this.forget().catch(()=>{});throw error;}
 }
 notice(){return this.readOnly?'PC unavailable · saved '+stamp(this.cachedAt)+' · read only. No actions are queued.':'Tracking PC unavailable. Reconnecting automatically…';}
 warning(){return `<div class="callout warning phone-saved-notice"><strong>Saved view · read only</strong><p>Last received ${esc(stamp(this.cachedAt))}. Game-save timestamps are unchanged. Reconnect the PC for current progress or edits.</p></div>`;}
 updateStatus(node){if(this.readOnly&&node){node.textContent='Saved view · read only';node.className='pill warn';}}
 settings(){
  if(!this.authority)return '';
  const copies=this.records.map(r=>`<li>Reserve ${r.reserve} · saved ${esc(stamp(r.capturedAt))} · expires ${esc(stamp(r.expiresAt))}</li>`).join('');
  return `<section class="panel phone-private-cache"><h2>Progress when the PC is off</h2><p>Keep a private, read-only copy in this paired browser. The phone still needs internet to open GrindZone and verify its pairing.</p><p class="small muted">Your PC keeps the original saves and journal. Up to ${CACHE_MAX_RESERVES} recently viewed reserves are kept here for seven days or until pairing expires. This is not an account backup or public post.</p>${this.enabled?`<p role="status">Private copies enabled.</p><ul>${copies||'<li>No saved reserve yet.</li>'}</ul><button class="button" data-action="cache-delete">Delete saved copies</button>`:`<button class="button" data-action="cache-enable" ${this.readOnly||!this.latest?'disabled':''}>Keep progress on this phone</button>`}<p class="small muted">Use only a device you trust. Anyone using this paired browser may view these copies. Turning off live access on the PC does not erase a previously saved copy; delete it here. Clearing browser data also removes it.</p>${this.storageError?`<p class="error" role="status">${esc(this.storageError)}</p>`:''}</section>`;
 }
}
