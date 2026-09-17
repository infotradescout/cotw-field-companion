/** Build an attributed, offline numeric reference. Never reads or writes game saves. */
import {writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const endpoint='https://raw.githubusercontent.com/RyMaxim/apc/master/apc/config/';
const officialTaruca='https://callofthewild.thehunter.com/patch-notes-9-3/';
const keys=['animal_details','animal_names','reserve_details'];
const raw={},sources=[];
for(const key of keys){
  const url=endpoint+key+'.json',response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`${key}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2000000)throw Error('Reference exceeds size limit');
  raw[key]=JSON.parse(bytes.toString());sources.push({id:key,label:'APC community-extracted '+key.replaceAll('_',' '),url,sha256:createHash('sha256').update(bytes).digest('hex'),retrievedAt:new Date().toISOString(),authority:'community_extracted_reference'});
}
const names=raw.animal_names.animal_names||raw.animal_names;
const bounds=g=>g&&Number.isFinite(g.weight_low)&&Number.isFinite(g.weight_high)?[g.weight_low,g.weight_high]:null;
const species=Object.entries(raw.animal_details).map(([key,a])=>{
 const thresholds=Object.fromEntries(['bronze','silver','gold','diamond'].map(m=>[m,Number.isFinite(a.trophy?.[m]?.score_low)?a.trophy[m].score_low:null]));
 const go=a.gender?.great_one_male;
 return {key,name:names[key]?.animal_name||key.replaceAll('_',' '),animalClass:a.ammo_class??null,truracs:a.truracs===true,
  thresholds,weightKg:{male:bounds(a.gender?.male),female:bounds(a.gender?.female)},
  levelWeightKg:Array.isArray(a.level)?a.level.map((range,i)=>({level:i+1,range})):[],
  greatOne:{eligible:!!go||key==='taruca',weightKg:bounds(go),source:key==='taruca'?'official_taruca':'animal_details'},
  source:'animal_details',patchVerified:false};
});
const reserves=Object.values(raw.reserve_details).map(r=>({id:r.index,name:r.reserve_name||r.name,species:r.species,source:'reserve_details'}));
for(const r of reserves){if(!Number.isInteger(r.id)||!Array.isArray(r.species)||r.species.some(k=>!species.some(s=>s.key===k)))throw Error('Unresolved reserve roster: '+r.name);}
for(const s of species){const ts=Object.values(s.thresholds).filter(Number.isFinite);if(ts.some((v,i)=>v<0||(i&&v<ts[i-1])))throw Error('Invalid trophy thresholds: '+s.key);}
sources.push({id:'official_taruca',label:'Expansive Worlds Patch 9.3 — Taruca Great One',url:officialTaruca,authority:'official_patch_note',retrievedAt:new Date().toISOString()});
const data={schema:'cotw.animal_reference.v1',builtAt:new Date().toISOString(),sources,species,reserves,
 notice:'Offline community-extracted reference. Values are not verified against every installed patch. Trophy-score minimums are separate from body weight and difficulty. Near thresholds, use the in-game harvest screen; public guides can differ by 0.01 from the extracted precision. The selected reserve filters species; it does not change a species threshold.',
 patchNotes:[{label:'Scoring ranges changed in the 2025 Snowfall remaster',url:'https://callofthewild.thehunter.com/snowfall-update-patch-notes-june-16th-2025/'},{label:'Mountain Goat difficulty is not trophy or medal potential',url:'https://callofthewild.thehunter.com/patch-notes-9-2/'}]};
mkdirSync(path.join(root,'lib'),{recursive:true});const target=path.join(root,'lib/rating-data.json');
writeFileSync(target+'.tmp',JSON.stringify(data));renameSync(target+'.tmp',target);
console.log(JSON.stringify({species:species.length,reserves:reserves.length,missingThresholds:species.filter(s=>Object.values(s.thresholds).some(x=>x===null)).map(s=>s.key),missingDifficulty:species.filter(s=>!s.levelWeightKg.length).map(s=>s.key),dataSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')}));
