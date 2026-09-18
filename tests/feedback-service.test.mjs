import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createFeedbackServer} from '../cloud/feedback-server.mjs';
import {FeedbackStore} from '../cloud/feedback-store.mjs';

const owner='owner-secret-012345678901234567890123456789';
const headers={Origin:'https://infotradescout.github.io', 'Content-Type':'application/json'};
const post=(service,value,extra={})=>fetch(service.url+'/v1/feedback',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});

test('public feedback is validated, rate limited, durable, and visible only through owner API',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'cotw-feedback-')),db=path.join(dir,'feedback.sqlite');let service;
  t.after(async()=>{if(service)await service.close();rmSync(dir,{recursive:true,force:true});});
  service=await createFeedbackServer({publicOrigin:'https://infotradescout.github.io',ownerToken:owner,dbPath:db,port:0,rateLimitPerMinute:4,rateLimitPerHour:10});
  const accepted=await post(service,{category:'ui',message:'The map controls are hard to find.',replyTo:'hunter@example.com',page:'studio',build:'demo-a'});
  assert.equal(accepted.status,201);const receipt=await accepted.json();assert.equal(receipt.accepted,true);assert.match(receipt.id,/^[0-9a-f-]{36}$/);
  const missing=await post(service,{category:'bug'});assert.equal(missing.status,400);
  const cross=await post(service,{category:'bug',message:'nope'},{Origin:'https://evil.example'});assert.equal(cross.status,403);
  const ownerResponse=await fetch(service.url+'/v1/owner/feedback?status=new',{headers:{Authorization:'Bearer '+owner}});assert.equal(ownerResponse.status,200);
  const inbox=await ownerResponse.json();assert.equal(inbox.unreadCount,1);assert.equal(inbox.feedback[0].message,'The map controls are hard to find.');assert.equal('sourceHash' in inbox.feedback[0],false);
  const marked=await fetch(service.url+'/v1/owner/feedback/'+receipt.id+'/read',{method:'POST',headers:{Authorization:'Bearer '+owner}});assert.equal(marked.status,200);assert.equal((await marked.json()).unreadCount,0);
  assert.equal((await fetch(service.url+'/v1/owner/feedback',{headers:{Authorization:'Bearer wrong-token'}})).status,401);
  await service.close();service=null;service=await createFeedbackServer({publicOrigin:'https://infotradescout.github.io',ownerToken:owner,dbPath:db,port:0,rateLimitPerMinute:4,rateLimitPerHour:10});
  const persisted=await fetch(service.url+'/v1/owner/feedback',{headers:{Authorization:'Bearer '+owner}});assert.equal((await persisted.json()).feedback.length,1);
});

test('feedback store never accepts screenshots or oversized content',()=>{
  const store=new FeedbackStore(':memory:');try{
    assert.throws(()=>store.create({category:'bug',message:'x',screenshot:'data:image/png;base64,private'}),/Unsupported feedback field/);
    assert.throws(()=>store.create({category:'bug',message:'x'.repeat(4001)}),/too long/);
    assert.throws(()=>store.create({category:'bug',message:'x',replyTo:'not-an-email'}),/email address/);
  }finally{store.close();}
});

test('owner browser CORS is exact and the public limiter returns 429',async t=>{
  const service=await createFeedbackServer({publicOrigin:'https://infotradescout.github.io',ownerOrigin:'http://127.0.0.1:47831',ownerToken:owner,port:0,rateLimitPerMinute:1,rateLimitPerHour:10});
  t.after(()=>service.close());
  const preflight=await fetch(service.url+'/v1/owner/feedback',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:47831','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:47831');assert.match(preflight.headers.get('access-control-allow-headers')||'',/Authorization/);
  const inbox=await fetch(service.url+'/v1/owner/feedback',{headers:{Origin:'http://127.0.0.1:47831',Authorization:'Bearer '+owner}});assert.equal(inbox.status,200);assert.equal(inbox.headers.get('access-control-allow-origin'),'http://127.0.0.1:47831');
  assert.equal((await post(service,{category:'idea',message:'first'})).status,201);
  assert.equal((await post(service,{category:'idea',message:'second'})).status,429);
  const foreign=await fetch(service.url+'/v1/owner/feedback',{headers:{Origin:'https://evil.example',Authorization:'Bearer '+owner}});assert.equal(foreign.status,401);
});
