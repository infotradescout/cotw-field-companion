import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createFeedbackServer} from '../cloud/feedback-server.mjs';

const owner='proxy-owner-secret-012345678901234567890123456789';

test('local owner inbox proxies to the hosted feedback origin without exposing its token',async t=>{
  const feedback=await createFeedbackServer({publicOrigin:'http://127.0.0.1:1',ownerToken:owner,allowInsecureLoopback:true,port:0});
  const dir=mkdtempSync(path.join(tmpdir(),'cotw-feedback-proxy-'));let app;
  t.after(async()=>{if(app)await app.close();await feedback.close();rmSync(dir,{recursive:true,force:true});});
  const accepted=await fetch(feedback.url+'/v1/feedback',{method:'POST',headers:{Origin:'http://127.0.0.1:1','Content-Type':'application/json'},body:JSON.stringify({category:'ui',message:'The owner inbox should be easy to find.'})});
  assert.equal(accepted.status,201);const receipt=await accepted.json();
  app=await createApp({dataDir:dir,port:0,phoneRelayUrl:null,feedbackUrl:feedback.url,feedbackOwnerToken:owner});
  const token=(await (await fetch(app.url+'/api/bootstrap')).json()).token;
  assert.equal((await fetch(app.url+'/api/feedback/inbox')).status,403);
  const inbox=await fetch(app.url+'/api/feedback/inbox',{headers:{'X-Companion-Token':token}});
  assert.equal(inbox.status,200);assert.equal((await inbox.json()).unreadCount,1);
  const marked=await fetch(app.url+'/api/feedback/'+receipt.id+'/read',{method:'POST',headers:{'X-Companion-Token':token,'Content-Type':'application/json'},body:'{}'});
  assert.equal(marked.status,200);assert.equal((await marked.json()).unreadCount,0);
  assert.equal((await fetch(app.url+'/api/feedback/not-a-feedback-id/read',{method:'POST',headers:{'X-Companion-Token':token}})).status,404);
});
