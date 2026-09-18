import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeHuntingPressure,huntingPressureView,projectPhonePressure} from '../lib/hunting-pressure.mjs';
import {Observer} from '../lib/observer.mjs';
import {Store} from '../lib/store.mjs';
import {hash,normalizePopulation} from '../lib/core.mjs';
import {fixture,defs,pop} from './fixtures.mjs';

const bounds=[[5696,4296],[13888,12488]],zeros=()=>Array(65536).fill(0);
test('an all-zero saved raster is known empty, while absent or malformed pressure is unavailable',()=>{
 const empty=normalizeHuntingPressure(zeros());assert.equal(empty.status,'available');assert.equal(empty.width,256);assert.equal(empty.height,256);
 for(const value of [undefined,[],[0],zeros().map((v,i)=>i===123?256:v),zeros().map((v,i)=>i===4?.5:v)])assert.deepEqual(normalizeHuntingPressure(value),{status:'unavailable'});
});

test('pressure preserves row-major bytes, reserve AABB and save time without estimating kills',()=>{
 const values=zeros();values[2*256+3]=127;values[65535]=255;
 const p=huntingPressureView(normalizeHuntingPressure(values),{reserve:19,bounds,savedAt:'2026-09-18T05:00:00.000Z'});
 assert.equal(p.values[2*256+3],127);assert.equal(p.values[65535],255);assert.deepEqual(p.bounds,bounds);assert.equal(p.reserve,19);assert.equal(p.stale,false);
 assert.equal(p.sourceHash,normalizeHuntingPressure([...values]).sourceHash);
 assert.notEqual(p.sourceHash,normalizeHuntingPressure(zeros()).sourceHash);
 assert.equal(p.killCount,undefined);assert.equal(p.expiresAt,undefined);
});

test('phone pressure projection is reserve-scoped, bounded and excludes private parser fields',()=>{
 const p=huntingPressureView(normalizeHuntingPressure(zeros()),{reserve:19,bounds});
 const projected=projectPhonePressure({...p,rawFilePath:'private',account:'private',values:p.values},19);
 assert.equal(projected.status,'available');assert.equal(projected.rawFilePath,undefined);assert.equal(projected.account,undefined);
 assert.equal(projectPhonePressure(p,1).status,'unavailable');assert.equal(projectPhonePressure({...p,bounds:[[0,0],[0,0]]},19).status,'unavailable');
 assert.equal(projectPhonePressure({...p,values:[255]},19).status,'unavailable');
});

test('legacy population snapshots reproject unchanged bytes, then saved pressure updates automatically and survives a read error',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'cotw-pressure-')),save=path.join(root,'saves');mkdirSync(save);
 const pressureDefs={...defs,rootPopulation:{...defs.rootPopulation,HuntingPressureMap:'u8[]'}},raw={...pop(),HuntingPressureMap:zeros()};raw.HuntingPressureMap[257]=80;
 const file=path.join(save,'animal_population_19'),bytes=fixture(pressureDefs,'rootPopulation',raw);writeFileSync(file,bytes);
 const store=new Store(path.join(root,'journal.sqlite')),profile=hash(save.toLowerCase()).slice(0,20);
 store.saveSource(profile,'animal_population_19',{sha:hash(bytes),mtime:statSync(file).mtime.toISOString(),checked:new Date().toISOString(),status:'ok',payload:normalizePopulation(raw)});
 const observer=new Observer(store,save,{reserves:{19:{id:19,name:'Synthetic',bounds,mapBounds:[[0,0],[16384,16384]]}},populations:{}},{interval:50});
 const waitFor=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,40));}throw Error('Pressure update did not arrive');};
 try{
  await observer.start();assert.equal(observer.source('animal_population_19').payload.projectionVersion,2);
  let p=observer.state(19).huntingPressure;assert.equal(p.values[257],80);assert.deepEqual(p.bounds,bounds);assert.equal(observer.state(1).huntingPressure.status,'unavailable');
  raw.HuntingPressureMap[257]=0;raw.HuntingPressureMap[258]=200;writeFileSync(file,fixture(pressureDefs,'rootPopulation',raw));
  await waitFor(()=>observer.state(19).huntingPressure.values?.[258]===200);
  p=observer.state(19).huntingPressure;assert.equal(p.values[257],0);assert.equal(p.stale,false);
  writeFileSync(file,Buffer.from('partial save in progress'));
  await waitFor(()=>observer.state(19).huntingPressure.stale===true);
  assert.equal(observer.state(19).huntingPressure.values[258],200);
  assert.equal(store.harvests(profile).length,0);
 }finally{observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,20));store.close();assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'cotw-pressure-'));rmSync(root,{recursive:true,force:true});}
});
