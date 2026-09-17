/** Synthetic test-only save writer. Never imported by the application. */
import {deflateSync} from 'node:zlib';
const P={u8:[0x0ca2821d,1,'writeUInt8'],u16:[0x86d152bd,2,'writeUInt16LE'],u32:[0x075e4e4f,4,'writeUInt32LE'],i32:[0x192fe633,4,'writeInt32LE'],u64:[0xa139e01f,8,'writeBigUInt64LE'],f32:[0x7515a207,4,'writeFloatLE']};
export function fixture(definitions,rootName,value){
  const types=new Map();let next=0x40000000;
  for(const name of Object.keys(definitions))types.set(name,{hash:next++,name,kind:1,members:[],size:0});
  const resolve=name=>{if(P[name])return {hash:P[name][0],size:P[name][1],name};if(name.endsWith('[]')){if(!types.has(name)){const element=resolve(name.slice(0,-2));types.set(name,{hash:next++,name,kind:3,element:element.hash,size:16,members:[]});}return types.get(name);}return types.get(name);};
  for(const [name,members]of Object.entries(definitions)){const t=types.get(name);let offset=0;for(const [member,type]of Object.entries(members)){const v=resolve(type);offset=Math.ceil(offset/Math.min(v.size||8,8))*Math.min(v.size||8,8);t.members.push({name:member,type,hash:v.hash,offset,size:v.size});offset+=v.size;}t.size=Math.ceil(offset/8)*8;}
  const slab=Buffer.alloc(1024*1024);let cursor=types.get(rootName).size;
  const alloc=n=>{cursor=Math.ceil(cursor/8)*8;const start=cursor;cursor+=n;return start;};
  function write(type,obj,offset){
    if(P[type]){const [,size,method]=P[type];slab[method](type==='u64'?BigInt(obj??0):obj??0,offset);return;}
    const t=resolve(type);
    if(t.kind===3){const arr=obj??[],baseType=type.slice(0,-2),stride=resolve(baseType).size;const p=alloc(arr.length*stride);slab.writeUInt32LE(p,offset);slab.writeUInt32LE(arr.length,offset+8);arr.forEach((v,i)=>write(baseType,v,p+i*stride));}
    else for(const m of t.members)write(m.type,obj?.[m.name],offset+m.offset);
  }
  write(rootName,value,0);const data=slab.subarray(0,cursor),names=[...new Set([...types.values()].flatMap(t=>[t.name,...t.members.map(m=>m.name)]))];
  const defParts=[];
  for(const t of types.values()) {const h=Buffer.alloc(40);h.writeUInt32LE(t.kind,0);h.writeUInt32LE(t.size,4);h.writeUInt32LE(8,8);h.writeUInt32LE(t.hash,12);h.writeBigUInt64LE(BigInt(names.indexOf(t.name)),16);h.writeUInt32LE(t.element??0,28);h.writeUInt32LE(t.members.length,36);defParts.push(h);for(const m of t.members){const b=Buffer.alloc(32);b.writeBigUInt64LE(BigInt(names.indexOf(m.name)),0);b.writeUInt32LE(m.hash,8);b.writeUInt32LE(m.size,12);b.writeUInt32LE(m.offset,16);defParts.push(b);}}
  const defs=Buffer.concat(defParts),table=Buffer.concat([Buffer.from(names.map(n=>Buffer.byteLength(n))),...names.map(n=>Buffer.from(n+'\0'))]);
  const header=Buffer.alloc(64);header.write(' FDA');header.writeUInt32LE(4,4);header.writeUInt32LE(1,8);const io=64+data.length,to=io+24,no=to+defs.length;header.writeUInt32LE(io,12);header.writeUInt32LE(types.size,16);header.writeUInt32LE(to,20);header.writeUInt32LE(names.length,32);header.writeUInt32LE(no,36);header.writeUInt32LE(no+table.length,40);
  const instance=Buffer.alloc(24);instance.writeUInt32LE(types.get(rootName).hash,4);instance.writeUInt32LE(64,8);instance.writeUInt32LE(data.length,12);
  const raw=Buffer.concat([Buffer.from([1,1,0,0,0]),header,data,instance,defs,table]),wrapper=Buffer.alloc(32);wrapper.write('SAVE');wrapper.writeBigUInt64LE(BigInt(raw.length),8);wrapper.write('COMP',16);wrapper[20]=wrapper[21]=1;wrapper.writeBigUInt64LE(BigInt(raw.length),24);return Buffer.concat([wrapper,deflateSync(raw)]);
}
export const defs={
  vector:{X:'f32',Y:'f32',Z:'f32'}, modifiers:{Flags:'u8'},
  animal:{Gender:'u8',Weight:'f32',Score:'f32',VisualVariationSeed:'u32',FeatureModifiers:'modifiers',IsScripted:'u8'},
  group:{SpawnAreadId:'u32',NeedZonePathGuids:'u32[]',Animals:'animal[]'},
  population:{NameHashId:'u32',Revision:'u32',Groups:'group[]'},
  rootPopulation:{ReserveSeed:'u32',Populations:'population[]'},
  health:{HealhComponentId:'u64',MaxHealth:'u16',CurrentHealth:'u16'},rootHealth:{SavedHealthComponentList:'health[]'},
  harvest:{SpeciesName:'u32',Score:'f32',TrophyScore:'u32',VariationName:'u32',Timestamp:'u32',RegionName:'u32'},rootHarvest:{HarvestHistory:'harvest[]'},
  zone:{Position:'vector',NeedZoneId:'i32',NeedType:'u32',NeedZoneStartTimeHours:'f32',NeedZoneEndTimeHours:'f32',AnimalTypeLocalizationName:'u32',NeedZoneScheduleIndex:'u8'},
  reserveZones:{ReserveId:'u64',NeedZoneData:'zone[]'},rootZones:{NZData:'reserveZones[]'},rootReserve:{Reserve:'u32'}
};
export const animal=(seed,sex=1)=>({Gender:sex,Weight:80,Score:201,VisualVariationSeed:seed,FeatureModifiers:{Flags:0},IsScripted:0});
export const pop=(seeds=[1,2],seed=123)=>({ReserveSeed:seed,Populations:[{NameHashId:3845994887,Revision:1,Groups:[{SpawnAreadId:77,NeedZonePathGuids:[123,456,789],Animals:seeds.map(s=>animal(s))}]}]});
export const harvest=(timestamp=1789650000,score=200)=>({SpeciesName:1124598738,Score:score,TrophyScore:2,VariationName:999,Timestamp:timestamp,RegionName:888});
export const zones={NZData:[{ReserveId:'19',NeedZoneData:[{Position:{X:12800,Y:1030,Z:7832},NeedZoneId:789,NeedType:2,NeedZoneStartTimeHours:8,NeedZoneEndTimeHours:12,AnimalTypeLocalizationName:1124598738,NeedZoneScheduleIndex:2}]}]};
export const makePopulation=(seeds,seed)=>fixture(defs,'rootPopulation',pop(seeds,seed));
export const makeHarvest=rows=>fixture(defs,'rootHarvest',{HarvestHistory:rows});
