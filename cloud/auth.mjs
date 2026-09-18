/** Operator-only enrollment utilities. This module is never served as a browser asset. */
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
const ID=/^[A-Za-z0-9_-]{43}$/;
export const PHONE_DAY=86400000;
export function phoneSigningKey(input){
  if(Buffer.isBuffer(input)&&input.length>=32)return input;
  if(typeof input==='string'&&ID.test(input)){const key=Buffer.from(input,'base64url');if(key.length===32)return key;}
  throw Error('PHONE_RELAY_SIGNING_KEY must be a persistent, randomly generated 32-byte base64url secret');
}
export function phoneTokenCodec({key,now=Date.now}){
  const secret=phoneSigningKey(key);
  const mac=value=>createHmac('sha256',secret).update(value).digest('base64url');
  const issue=(purpose,claims,lifetime)=>{const payload=Buffer.from(JSON.stringify({v:1,purpose,...claims,iat:now(),exp:now()+lifetime})).toString('base64url');return payload+'.'+mac(payload);};
  function verify(token,purpose){
    if(typeof token!=='string'||token.length>2048)return null;
    const [payload,signature,...extra]=token.split('.');if(extra.length||!payload||!ID.test(signature??''))return null;
    const expected=mac(payload);if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
    try{
      const v=JSON.parse(Buffer.from(payload,'base64url').toString());
      if(v.v!==1||v.purpose!==purpose||!Number.isFinite(v.exp)||v.exp<=now()||!Number.isFinite(v.iat)||v.iat>now()+30000)return null;
      if(purpose==='enrollment')return ID.test(v.installationId)?v:null;
      if(purpose==='device')return ID.test(v.deviceId)&&ID.test(v.installationId)&&Number.isSafeInteger(v.generation)&&v.generation>0?v:null;
      if(purpose==='phone')return ID.test(v.deviceId)&&ID.test(v.sid)?v:null;
      return null;
    }catch{return null;}
  }
  return {mac,issue,verify};
}
export function createPhoneEnrollmentToken({key,installationId=randomBytes(32).toString('base64url'),expiresAt,now=Date.now}={}){
  if(!ID.test(installationId))throw Error('A random installation identity is required');
  const lifetime=(expiresAt??now()+365*PHONE_DAY)-now();if(!Number.isFinite(lifetime)||lifetime<=0||lifetime>365*PHONE_DAY)throw Error('Enrollment expiry must be within one year');
  return phoneTokenCodec({key,now}).issue('enrollment',{installationId},lifetime);
}
