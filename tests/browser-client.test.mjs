import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBrowserClient,createPressureReader} from '../tools/browser-client.mjs';
import {createApp} from '../server.mjs';
import {Store} from '../lib/store.mjs';
import {defs,fixture,pop} from './fixtures.mjs';

const body=(op,extra={})=>({op,requestId:randomUUID(),...extra});
const bootstrap=async client=>(await(await fetch(client.url+'/api/bootstrap')).json());
const post=(client,token,value,headers={})=>fetch(client.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':token,Origin:client.url,...headers},body:typeof value==='string'?value:JSON.stringify(value)});

test('connected browser saves routes and herd plans through the existing API across restarts',async t=>{
  const base=mkdtempSync(path.join(tmpdir(),'cotw-browser-journal-'));let app,client;
  t.after(async()=>{if(client)await client.close();if(app)await app.close();rmSync(base,{recursive:true,force:true});});
  app=await createApp({dataDir:base,port:0});
  client=await createBrowserClient({port:0,upstreamPort:app.server.address().port});
  assert.equal(client.server.address().address,'127.0.0.1');
  let token=(await bootstrap(client)).token;
  const zone=await(await post(client,token,body('zone.create',{reserve:19,species:'Black Bear',need:'drinking',start:8,end:12,x:12000,z:7800}))).json();
  const intent=body('route.toggle',{reserve:19,zoneId:zone.id});
  assert.deepEqual(await(await post(client,token,intent)).json(),{route:[zone.id]});
  assert.deepEqual(await(await post(client,token,intent)).json(),{route:[zone.id]});
  assert.equal((await post(client,token,{...intent,zoneId:'different'})).status,409);
  assert.equal((await post(client,token,body('zone.annotate',{zoneId:zone.id,strategy:'shoot',name:'North lake',notes:'Test journal only'}))).status,200);
  const exported=await fetch(client.url+'/api/export');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal((await exported.json()).annotations[0].name,'North lake');
  await client.close();client=null;await app.close();app=null;
  app=await createApp({dataDir:base,port:0});client=await createBrowserClient({port:0,upstreamPort:app.server.address().port});token=(await bootstrap(client)).token;
  const state=await(await fetch(client.url+'/api/state?reserve=19')).json();
  assert.deepEqual(state.route,[zone.id]);assert.equal(state.zones[0].annotation.strategy,'shoot');assert.equal(state.zones[0].annotation.name,'North lake');
  assert.equal((await post(client,token,body('route.toggle',{reserve:19,zoneId:zone.id}))).status,200);
  assert.deepEqual((await(await fetch(client.url+'/api/state?reserve=19')).json()).route,[]);
});

async function upstreamFixture(t){
  const store=new Store(':memory:');let mode='ok',posts=0,rawBody=null,receivedHeaders=null,redirects=0;
  const upstreamToken=randomUUID();
  const server=http.createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.url==='/api/bootstrap')return json(200,{token:upstreamToken,selectedReserve:3,version:'old-api'});
    if(req.url==='/redirect-target'){redirects++;return json(200,{});}
    if(req.url==='/api/command'){
      posts++;const chunks=[];for await(const chunk of req)chunks.push(chunk);rawBody=Buffer.concat(chunks).toString();receivedHeaders=req.headers;
      if(mode==='redirect'){res.writeHead(307,{Location:'/redirect-target'});return res.end();}
      if(mode==='timeout'){return;}
      const command=JSON.parse(rawBody);let result;
      try{result=store.mutate('test-profile',command.requestId,command,()=>store.command('test-profile',command));}catch(error){return json(error.status||400,{error:error.message});}
      if(mode==='drop'){req.socket.destroy();return;}
      return json(200,result);
    }
    return json(404,{error:'Not found'});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=await createBrowserClient({port:0,upstreamPort:server.address().port,timeoutMs:1000,readPressure:false});
  t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
  return {client,upstreamToken,store,setMode(value){mode=value;},get seen(){return {posts,rawBody,receivedHeaders,redirects};}};
}

test('client blocks other origins, unsupported endpoints and oversized writes before reaching Companion',async t=>{
  const f=await upstreamFixture(t),{token,selectedReserve}=await bootstrap(f.client);assert.equal(selectedReserve,3);assert.notEqual(token,f.upstreamToken);
  const command=body('route.toggle',{reserve:19,zoneId:'zone-test'});
  for(const headers of [{Origin:'https://other.test'},{'Sec-Fetch-Site':'cross-site'},{'X-Companion-Token':'wrong'}])assert.equal((await post(f.client,token,command,headers)).status,403);
  const badHost=await new Promise((resolve,reject)=>http.get(f.client.url+'/api/state',{headers:{Host:'other.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(badHost,403);
  assert.equal((await post(f.client,token,body('run.arbitrary'))).status,400);
  assert.equal((await post(f.client,token,command,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post(f.client,token,'{')).status,400);
  assert.equal((await post(f.client,token,{...command,requestId:'x'})).status,400);
  assert.equal((await post(f.client,token,{...command,pad:'x'.repeat(32769)})).status,413);
  assert.equal((await fetch(f.client.url+'/api/phone/enable',{method:'POST'})).status,404);
  assert.equal((await(await fetch(f.client.url+'/api/phone/status')).json()).available,false);
  assert.equal((await fetch(f.client.url+'/server.mjs')).status,404);
  assert.equal((await fetch(f.client.url+'/api/state?reserve=../secret')).status,400);
  const malformed=await new Promise((resolve,reject)=>http.get(f.client.url,{path:'//['},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(malformed,400);
  assert.equal((await bootstrap(f.client)).selectedReserve,3);
  assert.equal(f.seen.posts,0);
});

test('lost command response stays ambiguous and a deliberate same-ID retry changes the route only once',async t=>{
  const f=await upstreamFixture(t),{token}=await bootstrap(f.client);
  const raw=' { "op": "route.toggle", "reserve":19, "zoneId":"zone-a", "requestId":"durable-action-123" } ';
  f.setMode('drop');assert.equal((await post(f.client,token,raw)).status,502);assert.equal(f.seen.posts,1);
  assert.equal(f.seen.rawBody,raw);assert.equal(f.seen.receivedHeaders['x-companion-token'],f.upstreamToken);
  assert.notEqual(f.seen.receivedHeaders.origin,f.client.url);assert.deepEqual(f.store.get('route:test-profile:19'),['zone-a']);
  f.setMode('ok');assert.deepEqual(await(await post(f.client,token,raw)).json(),{route:['zone-a']});assert.equal(f.seen.posts,2);
  assert.deepEqual(f.store.get('route:test-profile:19'),['zone-a']);
});

test('client does not follow command redirects or automatically replay timeouts',async t=>{
  const f=await upstreamFixture(t),{token}=await bootstrap(f.client),command=body('route.toggle',{reserve:19,zoneId:'zone-b'});
  f.setMode('redirect');assert.equal((await post(f.client,token,command)).status,502);assert.equal(f.seen.posts,1);assert.equal(f.seen.redirects,0);
  f.setMode('timeout');assert.equal((await post(f.client,token,command)).status,504);assert.equal(f.seen.posts,2);assert.deepEqual(f.store.get('route:test-profile:19',[]),[]);
});

test('read-only pressure projection marks retained values old on an observer error',async t=>{
  const base=mkdtempSync(path.join(tmpdir(),'cotw-client-pressure-')),save=path.join(base,'saves');mkdirSync(save);t.after(()=>rmSync(base,{recursive:true,force:true}));
  const definitions={...defs,rootPopulation:{...defs.rootPopulation,HuntingPressureMap:'u8[]'}},values=new Array(65536).fill(0);values[257]=192;
  writeFileSync(path.join(save,'animal_population_19'),fixture(definitions,'rootPopulation',{...pop(),HuntingPressureMap:values}));
  const state={profile:'test',selectedReserve:19,reserves:[{id:19,bounds:[[0,0],[16000,16000]]}],observer:{sourceFolder:save,error:null,sources:[{name:'animal_population_19',sha:'test',status:'ok'}]}};
  const read=createPressureReader();assert.equal((await read(state)).huntingPressure.stale,false);
  const old=await read({...state,observer:{...state.observer,error:'save folder unavailable'}});
  assert.equal(old.huntingPressure.status,'available');assert.equal(old.huntingPressure.stale,true);assert.equal(old.huntingPressure.values[257],192);
});
