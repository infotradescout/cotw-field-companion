import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandClient} from '../public/commands.js';
import {Store} from '../lib/store.mjs';
const pin={op:'pin.create',reserve:19,kind:'stand',label:'Retry proof',x:100,z:200};

test('a committed save retains its identity through timeout, auth rejection, and retry',async()=>{
  const store=new Store(':memory:');let calls=0,ids=0;const received=[];
  try{
    const command=createCommandClient({makeId:()=>`command-${++ids}`,send:async body=>{
      received.push(body.requestId);calls++;
      if(calls===2)throw Object.assign(Error('Session expired'),{status:403});
      const result=store.mutate('synthetic',body.requestId,body,()=>store.command('synthetic',body));
      if(calls===1)throw Object.assign(Error('Response lost'),{status:504});
      return result;
    }});
    await assert.rejects(command(pin),/Response lost/);
    await assert.rejects(command({...pin}),/Session expired/);
    const saved=await command({...pin});assert.ok(saved.id);assert.equal(ids,1);assert.equal(new Set(received).size,1);
    assert.equal(store.exportJournal('synthetic').pins.length,1);
    await command(pin);assert.equal(ids,2);assert.equal(store.exportJournal('synthetic').pins.length,2);
  }finally{store.close();}
});

test('rapid identical submits share one pending request',async()=>{
  let resolve,calls=0;const command=createCommandClient({makeId:()=> 'command-one',send:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  const first=command(pin),second=command({...pin});assert.equal(calls,1);assert.equal(first,second);resolve({id:'saved'});assert.deepEqual(await first,{id:'saved'});
});

test('an initial validation rejection allows a corrected new intent',async()=>{
  let ids=0,calls=0;const command=createCommandClient({makeId:()=>`command-${++ids}`,send:async body=>{if(++calls===1)throw Object.assign(Error('Invalid field'),{status:400});return body;}});
  await assert.rejects(command(pin),/Invalid field/);assert.equal((await command(pin)).requestId,'command-2');
});
