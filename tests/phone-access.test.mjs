import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPhoneAccess} from '../lib/phone-access.mjs';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';
import {createApp} from '../server.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(await check())return;await pause(10);}throw Error('Condition did not become true');}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function memoryStore(initial=[]){const values=new Map(initial);return {get:(k,f)=>values.has(k)?values.get(k):f,set:(k,v)=>values.set(k,v)};}

test('phone controller defaults off and makes no network request without local consent',async()=>{
  let requests=0;const access=createPhoneAccess({store:memoryStore(),observer:{profile:'synthetic'},relayUrl:'https://relay.invalid',provision:async()=>{requests++;},bridgeFactory:()=>{throw Error('Unexpected bridge');}});
  assert.deepEqual({enabled:access.status().enabled,status:access.status().status},{enabled:false,status:'disabled'});
  await access.start();assert.equal(requests,0);await assert.rejects(()=>access.enable({consent:false}),{status:400});assert.equal(requests,0);
});

test('old close and status callbacks cannot overwrite a newer enabled connection',async()=>{
  const closing=deferred(),options=[];let created=0;
  const access=createPhoneAccess({store:memoryStore(),observer:{profile:'synthetic'},relayUrl:'https://relay.invalid',provision:async()=>({deviceToken:'test-only-'+created}),bridgeFactory:opts=>{const index=created++;options.push(opts);return {async connect(){opts.onStatus({status:'connected'});},async close(){if(index===0)await closing.promise;opts.onStatus({status:'disabled'});},async pair(){return {};}};}});
  await access.enable({consent:true});const disabling=access.disable();await access.enable({consent:true});closing.resolve();await disabling;
  options[0].onStatus({status:'reconnecting'});
  assert.deepEqual({enabled:access.status().enabled,status:access.status().status},{enabled:true,status:'connected'});
  await access.disable();options[1].onStatus({status:'connected'});assert.deepEqual({enabled:access.status().enabled,status:access.status().status},{enabled:false,status:'disabled'});
});

test('resume start is idempotent for one stored connection',async()=>{
  let created=0;const access=createPhoneAccess({store:memoryStore([['phone:connection:synthetic',{enabled:true,relayUrl:'https://relay.invalid',deviceToken:'test-only'}]]),observer:{profile:'synthetic'},relayUrl:'https://relay.invalid',bridgeFactory:opts=>{created++;return {async connect(){opts.onStatus({status:'connected'});},async close(){},async pair(){}};}});
  await Promise.all([access.start(),access.start()]);assert.equal(created,1);await access.close();
});

test('installed-app integration keeps enable local, persists pairing, and rotates on disable',async()=>{
  const base=mkdtempSync(path.join(tmpdir(),'cotw-phone-integration-'));
  const signingKey=randomBytes(32),enrollmentToken=createPhoneEnrollmentToken({key:signingKey});
  const relay=await createPhoneRelay({key:signingKey,publicOrigin:'http://127.0.0.1:0',allowInsecureLoopback:true});
  let app;
  try{
    const options={dataDir:base,saveDir:null,port:0,phoneRelayUrl:relay.origin,phoneEnrollmentToken:enrollmentToken,allowInsecurePhoneLoopback:true};
    app=await createApp(options);assert.equal(app.server.address().address,'127.0.0.1');
    let token=(await(await fetch(app.url+'/api/bootstrap')).json()).token;
    const post=(route,body,withToken=true)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(withToken?{'X-Companion-Token':token}:{})},body:JSON.stringify(body)});
    assert.equal((await(await fetch(app.url+'/api/phone/status')).json()).enabled,false);
    assert.equal((await post('/api/phone/enable',{consent:true},false)).status,403);
    assert.equal((await post('/api/phone/enable',{consent:false})).status,400);
    let reads=0;const actualState=app.observer.state.bind(app.observer);app.observer.state=reserve=>{reads++;return actualState(reserve);};
    assert.equal((await post('/api/phone/enable',{consent:true})).status,200);assert.equal(reads,0);
    const firstCredential=app.store.get('phone:connection:'+app.observer.profile).deviceToken;
    const localStatus=await(await fetch(app.url+'/api/phone/status')).json();assert.equal(localStatus.enabled,true);assert.equal(Object.hasOwn(localStatus,'deviceToken'),false);assert.equal(JSON.stringify(localStatus).includes(enrollmentToken),false);
    const exported=await(await fetch(app.url+'/api/export')).text();assert.equal(exported.includes(firstCredential),false);assert.equal(exported.includes(enrollmentToken),false);
    const link=await(await post('/api/phone/pair',{})).json(),pairToken=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair');
    const pairing=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:relay.origin,'Content-Type':'application/json'},body:JSON.stringify({token:pairToken})});assert.equal(pairing.status,200);
    const cookie=pairing.headers.get('set-cookie').split(';')[0];
    const phoneView=await fetch(relay.origin+'/api/state?reserve=19',{headers:{Cookie:cookie}});assert.equal(phoneView.status,200);assert.equal(reads,1);assert.equal((await phoneView.json()).profile,undefined);
    await app.close();app=await createApp(options);token=(await(await fetch(app.url+'/api/bootstrap')).json()).token;
    await until(()=>app.phone.status().status==='connected');
    assert.equal((await fetch(relay.origin+'/api/state',{headers:{Cookie:cookie}})).status,200);
    assert.equal(app.store.get('phone:connection:'+app.observer.profile).deviceToken===firstCredential,true);
    assert.equal((await post('/api/phone/disable',{})).status,200);assert.equal(app.store.get('phone:connection:'+app.observer.profile),null);
    await until(async()=>!(await(await fetch(relay.origin+'/api/bootstrap',{headers:{Cookie:cookie}})).json()).phone.online);
    assert.equal((await fetch(relay.origin+'/api/state',{headers:{Cookie:cookie}})).status,503);
    assert.equal((await post('/api/phone/enable',{consent:true})).status,200);
    assert.equal(app.store.get('phone:connection:'+app.observer.profile).deviceToken===firstCredential,false);
    assert.equal((await fetch(relay.origin+'/api/state',{headers:{Cookie:cookie}})).status,503);
    await post('/api/phone/disable',{});
  }finally{
    if(app)await app.close();await relay.close();
    assert.ok(path.resolve(base).startsWith(path.resolve(tmpdir())+path.sep+'cotw-phone-integration-'));rmSync(base,{recursive:true,force:true});
  }
});
