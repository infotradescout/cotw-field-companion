/** A bounded, read-only decoder of the self-describing ADF records in COTW saves.
 * Format research: kk49/deca. No game executable, memory access, or save serializer.
 */
import { inflateSync } from 'node:zlib';
const LIMIT = 32 * 1024 * 1024;
const PRIMITIVES = new Map([
  [0x075e4e4f, ['readUInt32LE', 4]], [0x0ca2821d, ['readUInt8', 1]],
  [0x192fe633, ['readInt32LE', 4]], [0x580d0a62, ['readInt8', 1]],
  [0x7515a207, ['readFloatLE', 4]], [0x86d152bd, ['readUInt16LE', 2]],
  [0xa139e01f, ['readBigUInt64LE', 8]], [0xaf41354f, ['readBigInt64LE', 8]],
  [0xc609f663, ['readDoubleLE', 8]], [0xd13fcf93, ['readInt16LE', 2]]
]);
function check(buffer, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) throw Error('Invalid ADF bounds');
}
function unwrapSave(file) {
  if (!Buffer.isBuffer(file) || file.length < 34 || file.length > LIMIT) throw Error('Invalid save size');
  if (file.toString('ascii', 0, 4) !== 'SAVE' || file.toString('ascii', 16, 20) !== 'COMP') throw Error('Unsupported save wrapper');
  if (file[20] !== 1 || file[21] !== 1) throw Error('Unsupported compression version');
  const expected = Number(file.readBigUInt64LE(24));
  if (expected <= 0 || expected > LIMIT) throw Error('Uncompressed size exceeds limit');
  const raw = inflateSync(file.subarray(32), {maxOutputLength: LIMIT});
  if (raw.length !== expected) throw Error('Save length mismatch');
  return raw;
}
export function decodeSave(file) { return decodeADF(unwrapSave(file)); }
export function decodeADF(raw) {
  const prefix = raw.indexOf(Buffer.from(' FDA'));
  if (prefix < 0 || prefix > 16) throw Error('ADF signature absent');
  const b = raw.subarray(prefix); check(b, 0, 64);
  const u = o => {check(b, o, 4); return b.readUInt32LE(o);};
  const q = o => {check(b, o, 8); const n = b.readBigUInt64LE(o); if(n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Unsafe name index'); return Number(n);};
  const header = {version:u(4), instances:u(8), instanceOffset:u(12), types:u(16), typeOffset:u(20), names:u(32), nameOffset:u(36), size:u(40)};
  if (header.version !== 4 || header.instances > 100 || header.types > 4096 || header.names > 10000 || header.size > b.length) throw Error('Unsupported or invalid ADF header');
  check(b, header.nameOffset, header.names);
  let pos = header.nameOffset + header.names;
  const names = [];
  for(let i=0; i<header.names; i++) { const len=b[header.nameOffset+i]; check(b,pos,len+1); names.push(b.toString('utf8',pos,pos+len)); pos+=len+1; }
  const name = i => {if(i>=names.length)throw Error('Invalid name index'); return names[i];};
  pos = header.typeOffset; const types = new Map();
  for(let i=0; i<header.types; i++) {
    check(b,pos,36);
    const t={kind:u(pos),size:u(pos+4),hash:u(pos+12),name:name(q(pos+16)),element:u(pos+28),length:u(pos+32),members:[]}; pos+=36;
    if(t.size>LIMIT) throw Error('Invalid type size');
    if(t.kind!==0) {
      const count=u(pos); pos+=4; if(count>4096) throw Error('Too many members');
      for(let j=0;j<count;j++) {
        if(t.kind===1) { check(b,pos,32); t.members.push({name:name(q(pos)),hash:u(pos+8),offset:u(pos+16)&0xffffff,bit:u(pos+16)>>>24}); pos+=32; }
        else if(t.kind===8) { check(b,pos,12); t.members.push({name:name(q(pos)),value:u(pos+8)}); pos+=12; }
        else throw Error('Unsupported type members');
      }
    }
    types.set(t.hash,t);
  }
  let budget=1500000;
  function value(data,offset,hash,depth=0,bit=0) {
    if(--budget<0 || depth>24) throw Error('ADF complexity limit');
    const prim=PRIMITIVES.get(hash);
    if(prim) {check(data,offset,prim[1]); const n=data[prim[0]](offset); if(typeof n==='number' && !Number.isFinite(n)) throw Error('Nonfinite value'); return typeof n==='bigint'?n.toString():n;}
    if(hash===0x8955583e) {check(data,offset,8); const p=data.readUInt32LE(offset); check(data,p,1); const end=data.indexOf(0,p); if(end<0||end-p>65536)throw Error('Invalid string');return data.toString('utf8',p,end);}
    const t=types.get(hash); if(!t)throw Error('Unknown ADF type '+hash.toString(16)); check(data,offset,t.size);
    if(t.kind===1) {const obj={}; for(const m of t.members) {if(['__proto__','constructor','prototype'].includes(m.name))throw Error('Invalid member name'); obj[m.name]=value(data,offset+m.offset,m.hash,depth+1,m.bit);} return obj;}
    if(t.kind===3 || t.kind===4) {
      const start=t.kind===3?data.readUInt32LE(offset):offset;
      const n=t.kind===3?data.readUInt32LE(offset+8):t.length;
      const stride=t.element===0x8955583e?8:PRIMITIVES.get(t.element)?.[1]??types.get(t.element)?.size;
      if(!stride||n>200000)throw Error('Invalid array size'); check(data,start,n*stride);
      return Array.from({length:n},(_,i)=>value(data,start+i*stride,t.element,depth+1));
    }
    if(t.kind===8) return data.readUInt32LE(offset);
    if(t.kind===7) {if(t.size>6)throw Error('Unsupported bitfield size');return (data.readUIntLE(offset,t.size)>>>bit)&1;}
    if(t.kind===9) return t.size===8?data.readBigUInt64LE(offset).toString():data.readUIntLE(offset,t.size);
    throw Error('Unsupported ADF kind '+t.kind);
  }
  const values=[];
  for(let i=0;i<header.instances;i++) { const p=header.instanceOffset+i*24; check(b,p,24); const offset=u(p+8),size=u(p+12); check(b,offset,size); values.push(value(b.subarray(offset,offset+size),0,u(p+4))); }
  if(values.length!==1) throw Error('Expected one save root');
  return {header, types:[...types.values()].map(t=>t.name), value:values[0]};
}

/** Read only explicitly requested primitive fields from the first root struct.
 * Unsupported nested tables stay unread; this does not relax the general decoder. */
export function decodeSaveScalars(file,wanted){
 const raw=unwrapSave(file),prefix=raw.indexOf(Buffer.from(' FDA'));if(prefix<0||prefix>16)throw Error('ADF signature absent');
 const b=raw.subarray(prefix);check(b,0,64);const u=o=>{check(b,o,4);return b.readUInt32LE(o)};
 if(u(4)!==4||u(8)!==1||u(16)<1||u(32)>10000)throw Error('Unsupported scalar projection schema');
 const names=[],count=u(32),nameOffset=u(36);check(b,nameOffset,count);let p=nameOffset+count;
 for(let i=0;i<count;i++){const n=b[nameOffset+i];check(b,p,n+1);names.push(b.toString('utf8',p,p+n));p+=n+1;}
 const t=u(20),instance=u(12);check(b,t,40);check(b,instance,24);
 if(u(t)!==1||u(t+12)!==u(instance+4))throw Error('Unsupported root type order');
 const start=u(instance+8),size=u(instance+12),members=u(t+36);check(b,start,size);if(members>4096)throw Error('Scalar member limit');
 const result={};
 for(let i=0;i<members;i++){p=t+40+i*32;check(b,p,32);const index=b.readBigUInt64LE(p);if(index>=BigInt(names.length))throw Error('Invalid scalar name');const name=names[Number(index)];if(!wanted.includes(name))continue;
  const type=PRIMITIVES.get(u(p+8)),offset=u(p+16)&0xffffff;if(!type)throw Error('Requested field is not primitive');
  check(b.subarray(start,start+size),offset,type[1]);const value=b[type[0]](start+offset);if(!Number.isFinite(value))throw Error('Invalid scalar value');result[name]=value;
 }
 if(wanted.some(name=>!(name in result)))throw Error('Requested scalar absent');return result;
}
