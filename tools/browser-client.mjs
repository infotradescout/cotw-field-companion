/** Optional local browser client. The running Companion remains the only journal writer.
 * No installed files, SQLite databases, or game saves are written by this process.
 */
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {portableFiles} from './build-portable.mjs';
import {stableRead} from '../lib/observer.mjs';
import {decodeSave} from '../lib/decoder.mjs';
import {normalizeHuntingPressure,huntingPressureView} from '../lib/hunting-pressure.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const reads=new Set(['/api/state','/api/maps','/api/gear','/api/reference','/api/export']);
const commands=new Set(['observer.scan','route.toggle','route.reorder','zone.annotate','zone.create','pin.create','pin.delete','session.start','session.end','encounter.create','encounter.evidence','encounter.search','settings']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const responseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

export function createPressureReader(){
  const cache=new Map();
  return async state=>{
    if(state.huntingPressure)return state;
    const reserve=state.selectedReserve,name='animal_population_'+reserve,source=state.observer?.sources?.find(s=>s.name===name);
    const bounds=state.reserves?.find(r=>r.id===reserve)?.bounds;
    if(!Number.isInteger(reserve)||!state.observer?.sourceFolder||!source)return {...state,huntingPressure:{status:'unavailable',reserve}};
    const key=state.profile+':'+reserve;let cached=cache.get(key),status=state.observer.error?'error':source.status;
    if(!cached||cached.sha!==source.sha){
      try{const read=await stableRead(state.observer.sourceFolder,name);cached={sha:read.sha,mtime:read.mtime,pressure:normalizeHuntingPressure(decodeSave(read.b).value.HuntingPressureMap)};cache.set(key,cached);}
      catch{status='error';}
    }
    return {...state,huntingPressure:huntingPressureView(cached?.pressure,{reserve,bounds,savedAt:cached?.mtime??null,sourceStatus:status})};
  };
}

// The destination is fixed per process, always loopback. It cannot be set by a browser request.
// Tests supply a disposable loopback server's port; the CLI always uses installed port 47831.
export async function createBrowserClient({port=47844,upstreamPort=47831,timeoutMs=5000,readPressure=true}={}){
  if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535)throw Error('Invalid local Companion port');
  const upstream='http://127.0.0.1:'+upstreamPort,token=randomBytes(32).toString('hex');
  const pressure=createPressureReader();
  const assets=new Map(portableFiles.filter(n=>n.startsWith('public/')).map(n=>['/'+n.slice(7),readFileSync(path.join(sourceRoot,n))]));
  assets.set('/',assets.get('/index.html'));
  const request=(pathname,options={})=>fetch(upstream+pathname,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  const server=http.createServer(async(req,res)=>{
    const actualPort=server.address().port,hosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
    const json=(code,value)=>{res.writeHead(code,{...responseHeaders,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.some(h=>req.headers.origin==='http://'+h)||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return json(403,{error:'Only same-origin local access is accepted'});
    let url;
    try{url=new URL(req.url,`http://127.0.0.1:${actualPort}`);}catch{return json(400,{error:'Invalid request URL'});}
    // Consume each response inside this timeout too; a stalled body is an ambiguous failure.
    const forward=async response=>{
      const data=Buffer.from(await response.arrayBuffer());
      const headers={...responseHeaders,'Content-Type':response.headers.get('content-type')||'application/json'};
      if(url.pathname==='/api/export'&&response.ok)headers['Content-Disposition']='attachment; filename="COTW-field-journal.json"';
      res.writeHead(response.status,headers);res.end(data);
    };
    try{
      if(req.method==='GET'&&url.pathname==='/api/bootstrap'){
        const response=await request('/api/bootstrap');if(!response.ok)return await forward(response);
        const bootstrap=await response.json();return json(200,{token,version:bootstrap.version,selectedReserve:bootstrap.selectedReserve,browserClient:true});
      }
      if(req.method==='GET'&&url.pathname==='/api/phone/status')return json(200,{available:false,enabled:false,status:'unavailable'});
      if(req.method==='GET'&&reads.has(url.pathname)){
        let suffix='';
        if(url.pathname==='/api/state'&&url.searchParams.has('reserve')){
          const reserve=url.searchParams.get('reserve');if(!/^\d{1,3}$/.test(reserve))return json(400,{error:'Invalid reserve'});
          suffix='?reserve='+reserve;
        }
        const response=await request(url.pathname+suffix);
        if(url.pathname==='/api/state'&&response.ok&&readPressure)return json(200,await pressure(await response.json()));
        return await forward(response);
      }
      if(req.method==='POST'&&url.pathname==='/api/command'){
        if(req.headers['x-companion-token']!==token)return json(403,{error:'Missing local session token. Reload this page.'});
        if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'])))return json(415,{error:'JSON required'});
        let length=0;const chunks=[];
        for await(const chunk of req){length+=chunk.length;if(length>32768)return json(413,{error:'Request too large'});chunks.push(chunk);}
        const raw=Buffer.concat(chunks);let body;
        try{body=JSON.parse(raw.toString());}catch{return json(400,{error:'Invalid JSON'});}
        if(!body||typeof body!=='object'||Array.isArray(body)||!commands.has(body.op))return json(400,{error:'Unsupported Companion action'});
        if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))return json(400,{error:'Request ID required'});
        // Read credentials before the one and only POST. Never replay after an uncertain result.
        const bootstrapResponse=await request('/api/bootstrap');
        if(!bootstrapResponse.ok)return json(503,{error:'Companion is unavailable. This action was not sent.'});
        const bootstrap=await bootstrapResponse.json();
        if(typeof bootstrap.token!=='string'||!bootstrap.token)return json(503,{error:'Companion is unavailable. This action was not sent.'});
        return await forward(await request('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':bootstrap.token,Origin:upstream},body:raw}));
      }
      if(req.method==='GET'&&assets.has(url.pathname)){
        res.writeHead(200,{...responseHeaders,'Content-Type':types[path.extname(url.pathname)]||types['.html']});return res.end(assets.get(url.pathname));
      }
      return json(404,{error:'Not found'});
    }catch(error){
      const timeout=error.name==='TimeoutError'||error.name==='AbortError';
      json(timeout?504:502,{error:'Companion did not confirm this request. Check the connection, then retry the same action.'});
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const client=await createBrowserClient();
  console.log('Connected browser: '+client.url+' (uses the running Companion; this PC only)');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await client.close();process.exit(0);});
}
