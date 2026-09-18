/** Career projections use named game counters; never infer deaths from population changes. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dictionary=JSON.parse(readFileSync(new URL('./stat-definitions.json',import.meta.url),'utf8'));
const defs=new Map(dictionary.definitions.map(d=>[d.id,d]));
const pretty=s=>s.replace(/^playerstat_/,'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export function normalizeStatistics(root){
 if(!Array.isArray(root?.StatsNameHash)||!Array.isArray(root.StatsData)||root.StatsNameHash.length!==root.StatsData.length||root.StatsData.length>20000)throw Error('Unsupported career statistics schema');
 const rows={},conflicts=[];
 root.StatsNameHash.forEach((id,i)=>{const r=root.StatsData[i];if(!Number.isInteger(id)||!r||!['IntValue','FloatValue','AvgCount','AvgValue'].every(k=>Number.isFinite(r[k])))throw Error('Invalid career counter');
  const key=String(id>>>0),value={int:r.IntValue,float:r.FloatValue,count:r.AvgCount,sum:r.AvgValue};
  if(rows[key]&&JSON.stringify(rows[key])!==JSON.stringify(value))conflicts.push(key);else rows[key]=value;
 });
 for(const key of conflicts)delete rows[key];
 return {rows,conflicts:[...new Set(conflicts)],rawRecordCount:root.StatsData.length,uniqueRecordCount:Object.keys(rows).length};
}
export function normalizeProfile(root){
 const fields={level:root.Level,xp:root.Xp,cash:root.Cash,skillPoints:root.SkillPoints,perkPoints:root.PerkPoints};
 if(!Object.values(fields).every(v=>Number.isFinite(v)&&v>=0))throw Error('Unsupported career profile');
 return fields; // No tracking ID, account identity, inventory, consent or cosmetic state is retained.
}
export function careerCounters(snapshot){
 const rows=snapshot?.rows||{},memo=new Map();
 function get(id,depth=0){if(depth>10)return null;if(memo.has(id))return memo.get(id);const d=defs.get(id),r=rows[id];let value=null;
  if(!d)return null;
  if(d.type===3){const values=d.children.map(x=>get(x,depth+1));if(values.length&&values.every(Number.isFinite))value=values.reduce((a,b)=>a+b,0);}
  else if(r&&d.type===0)value=r.int;else if(r&&d.type===1)value=r.float;
  else if(r&&d.type===4&&r.count>0)value=r.sum/r.count;
  memo.set(id,value);return value;}
 return dictionary.definitions.filter(d=>d.type!==2).map(d=>({key:d.key,label:d.label||pretty(d.labelKey||d.key),value:get(d.id),display:d.display,computed:d.type===3,visible:d.visible,sourceId:d.id,...(d.type===4?{accuracySamples:rows[d.id]?.count??null,accuracySum:rows[d.id]?.sum??null}:{})}));
}
export function buildCareer({statistics,profile,player,reserves,zones,equipment,harvests,sourceStatus}){
 const counters=careerCounters(statistics?.payload),byKey=Object.fromEntries(counters.map(r=>[r.key,r]));
 const lookup=key=>byKey[key]?.value??null;
 const allMaps=reserves.map(r=>{const prefix=Object.keys(dictionary.reserveIds).find(k=>dictionary.reserveIds[k]===r.id);return {
  id:r.id,name:r.name,available:r.available,zoneCount:zones.filter(z=>z.reserve===r.id).length,
  equipmentCount:equipment.filter(p=>p.reserve===r.id).length,statPrefix:prefix,
  stats:prefix?counters.filter(c=>c.key.startsWith(prefix+'_')).map(c=>({...c,label:pretty(c.key.slice(prefix.length+1))})):[],
  shotsFired:null,kills:null,harvests:null,attribution:'Per-reserve shot/kill/harvest totals are not defined by the inspected statistics schema.'
 };});
 const accuracy=lookup('accuracy'),shots=lookup('shots_fired');
 const accuracyDef=dictionary.definitions.find(d=>d.key==='accuracy');const denominator=statistics?.payload?.rows?.[accuracyDef?.id]?.count??null;
 return {status:statistics?'available':'not_available',savedAt:statistics?.mtime??null,checkedAt:statistics?.checked??null,sourceStatus:sourceStatus??'missing',
  profile:profile?.payload??null,unharvested:player?.payload?.unharvested??null,unharvestedSavedAt:player?.mtime??null,
  lifetimeKills:null,killCoverage:'The inspected save does not expose a validated lifetime-kill total. The unharvested counter is current saved state, not all animals ever left behind.',
  counters,allMaps,retainedHarvests:harvests.length,recentScope:'Retained log, not a complete lifetime ledger',
  shotReconciliation:{displayedShots:shots,accuracyDenominator:denominator,consistent:shots!==null&&denominator!==null?shots===denominator:null},
  coverage:{source:'statistics_adf',dictionarySource:dictionary.source,definitionHash:dictionary.sourceSha256,conflicts:statistics?.payload?.conflicts??[],mapCount:reserves.length},
  summary:{shotsFired:shots,hits:lookup('shots_hit'),misses:lookup('shots_missed'),accuracy,lifetimeHarvests:lookup('harvests'),diamonds:lookup('harvests_platinum'),greatOnes:lookup('harvests_greatone'),longestShot:lookup('longest_shot'),spooked:lookup('animals_spooked'),deaths:lookup('deaths')}
 };
}
export function statisticsDelta(before,after){
 const a=Object.fromEntries(careerCounters(before).map(v=>[v.key,v.value]));
 const changed=careerCounters(after).filter(v=>Number.isFinite(a[v.key])&&Number.isFinite(v.value)&&v.value!==a[v.key]).map(v=>({key:v.key,before:a[v.key],after:v.value,delta:v.value-a[v.key]}));
 return {kind:'career_counter_change',changed,resetPossible:changed.some(c=>['shots_fired','harvests','xp','level'].includes(c.key)&&c.delta<0),killsInferred:0};
}
