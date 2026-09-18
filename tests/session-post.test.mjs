import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createCommandClient,createSessionPost} from '../public/commands.js';

const pin={op:'pin.create',reserve:19,kind:'stand',label:'Reconnect proof',x:100,z:200};

test('a browser session saves once after a real server restart and retains its journal',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'cotw-session-'));
  let app,token;const requests=[];
  try{
    const start=()=>createApp({dataDir:dir,saveDir:null,port:0,phoneRelayUrl:null});
    app=await start();token=(await (await fetch(app.url+'/api/bootstrap')).json()).token;
    await app.close();app=await start();
    const post=createSessionPost({getToken:()=>token,setToken:value=>{token=value;},fetch:async(url,options)=>{
      requests.push({url,body:options?.body});return fetch(app.url+url,options);
    }});
    const command=createCommandClient({makeId:()=> 'restart-proof',send:body=>post('/api/command',body)});
    const saved=await command(pin);assert.ok(saved.id);
    assert.deepEqual(requests.map(r=>r.url),['/api/command','/api/bootstrap','/api/command']);
    assert.equal(requests[0].body,requests[2].body);
    await app.close();app=await start();
    const journal=await (await fetch(app.url+'/api/export')).json();
    assert.equal(journal.pins.length,1);assert.equal(journal.pins[0].label,pin.label);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a lost committed response is never automatically replayed; deliberate retry keeps its identity',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'cotw-response-'));let app,token,calls=0,ids=0;
  try{
    app=await createApp({dataDir:dir,saveDir:null,port:0,phoneRelayUrl:null});
    token=(await (await fetch(app.url+'/api/bootstrap')).json()).token;
    const post=createSessionPost({getToken:()=>token,setToken:value=>{token=value;},fetch:async(url,options)=>{
      const response=await fetch(app.url+url,options);
      if(++calls===1){await response.text();throw Error('Response lost');}return response;
    }});
    const command=createCommandClient({makeId:()=>`lost-response-${++ids}`,send:body=>post('/api/command',body)});
    await assert.rejects(command(pin),/Response lost/);assert.equal(calls,1);
    await command(pin);assert.equal(calls,2);assert.equal(ids,1);
    assert.equal((await (await fetch(app.url+'/api/export')).json()).pins.length,1);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('an unrelated forbidden action cannot trigger session renewal or replay',async()=>{
  let calls=0;const post=createSessionPost({getToken:()=> 'old',setToken:()=>assert.fail('unexpected renewal'),fetch:async()=>{
    calls++;return Response.json({error:'Access denied'},{status:403});
  }});
  await assert.rejects(post('/api/command',pin),{message:'Access denied',status:403});assert.equal(calls,1);
  await assert.rejects(post('/api/unrecognized',pin),/Unsupported/);assert.equal(calls,1);
});
