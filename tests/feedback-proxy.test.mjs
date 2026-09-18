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

test('local owner inbox can read a bounded GitHub Issues fallback without credentials',async t=>{
  const originalFetch=globalThis.fetch;
  const mockedFetch=async(input,init)=>{
    if(String(input).startsWith('http://127.0.0.1:'))return originalFetch(input,init);
    assert.equal(String(input),'https://api.github.test/repos/infotradescout/cotw-field-companion/issues?state=open&labels=feedback&per_page=20');
    assert.equal(init.headers['User-Agent'],'COTW-Companion');
    return new Response(JSON.stringify([
      {number:7,title:'The map is hard to read',body:'Please make the pressure layer clearer.',html_url:'https://github.com/infotradescout/cotw-field-companion/issues/7',created_at:'2026-09-18T20:00:00Z',updated_at:'2026-09-18T20:05:00Z',user:{login:'hunter'}},
      {number:8,title:'Pull request must not appear',body:'implementation',html_url:'https://github.com/infotradescout/cotw-field-companion/pull/8',created_at:'2026-09-18T20:00:00Z',updated_at:'2026-09-18T20:05:00Z',user:{login:'builder'},pull_request:{url:'https://api.github.test/pulls/8'}}
    ]),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const dir=mkdtempSync(path.join(tmpdir(),'cotw-github-feedback-'));let app;
  t.after(async()=>{globalThis.fetch=originalFetch;if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
  app=await createApp({dataDir:dir,port:0,phoneRelayUrl:null,githubFeedbackUrl:'https://api.github.test/repos/infotradescout/cotw-field-companion/issues?state=open&labels=feedback&per_page=20'});
  const token=(await (await fetch(app.url+'/api/bootstrap')).json()).token;
  globalThis.fetch=mockedFetch;
  assert.equal((await fetch(app.url+'/api/feedback/github')).status,403);
  const response=await fetch(app.url+'/api/feedback/github',{headers:{'X-Companion-Token':token}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{source:'github',feedback:[{id:'7',title:'The map is hard to read',message:'Please make the pressure layer clearer.',url:'https://github.com/infotradescout/cotw-field-companion/issues/7',createdAt:'2026-09-18T20:00:00Z',updatedAt:'2026-09-18T20:05:00Z',author:'hunter'}]});
});
