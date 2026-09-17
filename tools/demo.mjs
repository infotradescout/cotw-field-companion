// Test/demo only. Synthetic records are written to a new OS temporary directory.
// This does not discover, open, or modify any real game installation or save.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createApp}from '../server.mjs';import {fixture,defs,pop,harvest,zones,makeHarvest}from '../tests/fixtures.mjs';
const base=mkdtempSync(path.join(os.tmpdir(),'cotw-companion-demo-')),save=path.join(base,'synthetic-saves');mkdirSync(save);
const p=pop([1,2,3,4]);p.Populations[0].Groups[0].Animals.push({...p.Populations[0].Groups[0].Animals[0],Gender:2,VisualVariationSeed:8});
const z=structuredClone(zones);for(let i=0;i<12;i++){z.NZData[0].NeedZoneData.push({...z.NZData[0].NeedZoneData[0],Position:{X:7600+(i%4)*1250,Y:1030,Z:6900+Math.floor(i/4)*1500},NeedZoneId:800+i});}
for(const [name,b]of [['animal_population_19',fixture(defs,'rootPopulation',p)],['found_need_zones_adf',fixture(defs,'rootZones',z)],['hunting_log_adf',makeHarvest([harvest()])],['reserveworlddata_adf',fixture(defs,'rootReserve',{Reserve:19})]])writeFileSync(path.join(save,name),b);
const app=await createApp({dataDir:path.join(base,'journal'),saveDir:save,port:Number(process.env.COMPANION_PORT||47832)});
console.log('SYNTHETIC DEMO ONLY '+app.url);for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();rmSync(base,{recursive:true,force:true});process.exit(0);});
