import {createHash} from 'node:crypto';
export const PRESSURE_SIZE=256;
const CELLS=PRESSURE_SIZE*PRESSURE_SIZE;
const validValues=values=>Array.isArray(values)&&values.length===CELLS&&values.every(v=>Number.isInteger(v)&&v>=0&&v<=255);
const validBounds=bounds=>Array.isArray(bounds)&&bounds.length===2&&bounds.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=100000))&&bounds[1][0]>bounds[0][0]&&bounds[1][1]>bounds[0][1];

/** Saved raster, not estimated kill circles. Empty/unsupported data is not zero pressure. */
export function normalizeHuntingPressure(values){
 if(!validValues(values))return {status:'unavailable'};
 return {status:'available',width:PRESSURE_SIZE,height:PRESSURE_SIZE,sourceHash:createHash('sha256').update(Buffer.from(values)).digest('hex'),values:[...values]};
}

export function huntingPressureView(pressure,{reserve,bounds,savedAt=null,sourceStatus='ok'}={}){
 if(pressure?.status!=='available'||pressure.width!==PRESSURE_SIZE||pressure.height!==PRESSURE_SIZE||!validValues(pressure.values)||!validBounds(bounds))return {status:'unavailable',reserve};
 return {status:'available',reserve,width:PRESSURE_SIZE,height:PRESSURE_SIZE,bounds:bounds.map(p=>[...p]),values:pressure.values,sourceHash:pressure.sourceHash,savedAt,stale:sourceStatus!=='ok'};
}

/** Allowlist the phone view; do not transport future parser fields or private metadata. */
export function projectPhonePressure(pressure,reserve){
 if(pressure?.reserve!==reserve||pressure?.status!=='available'||pressure.width!==PRESSURE_SIZE||pressure.height!==PRESSURE_SIZE)return {status:'unavailable',reserve};
 const normalized=normalizeHuntingPressure(pressure.values);
 return huntingPressureView(normalized,{reserve,bounds:pressure.bounds,savedAt:typeof pressure.savedAt==='string'&&Number.isFinite(Date.parse(pressure.savedAt))?pressure.savedAt:null,sourceStatus:pressure.stale?'error':'ok'});
}
