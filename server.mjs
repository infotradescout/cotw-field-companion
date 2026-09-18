import http from 'node:http';
import {readFileSync,existsSync,realpathSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from './lib/store.mjs';
import {Observer,inside} from './lib/observer.mjs';
import {reserveId} from './lib/core.mjs';
import {createPhoneAccess} from './lib/phone-access.mjs';
export async function createApp({dataDir,saveDir=null,port=47831,interval=5000,phoneRelayUrl=process.env.COMPANION_PHONE_RELAY_URL,phoneEnrollmentToken=process.env.COMPANION_PHONE_ENROLLMENT_TOKEN,allowInsecurePhoneLoopback=false}={}) {
  const appDir=path.dirname(fileURLToPath(import.meta.url));
  if(!dataDir)throw Error('Companion data directory is required');
  saveDir=saveDir?realpathSync(saveDir):null;dataDir=path.resolve(dataDir);
  let parent=dataDir;while(!existsSync(parent))parent=path.dirname(parent);
  const resolved=path.join(realpathSync(parent),path.relative(parent,dataDir));
  if(saveDir&&(inside(saveDir,resolved)||inside(resolved,saveDir)))throw Error('Companion data and game saves must be separate, non-overlapping directories');
  mkdirSync(dataDir,{recursive:true});dataDir=realpathSync(dataDir);
  if(saveDir&&process.permission?.has('fs.write',saveDir))throw Error('Refusing to start with save-folder write permission');
  const ratingFile=path.join(appDir,'lib/rating-data.json');
  const ratingCatalog=existsSync(ratingFile)?JSON.parse(readFileSync(ratingFile,'utf8')):null;
  const gearCatalog=JSON.parse(readFileSync(path.join(appDir,'lib/gear-data.json'),'utf8'));
  const mapsCatalog=JSON.parse(readFileSync(path.join(appDir,'lib/maps-data.json'),'utf8'));
  const reference=JSON.parse(readFileSync(path.join(appDir,'lib/reference.json'),'utf8'));
  for(const r of mapsCatalog.reserves)reference.reserves[r.id]={...reference.reserves[r.id],...r};
  reference.equipment=gearCatalog.equipmentNames||{};
  const store=new Store(path.join(dataDir,'journal.sqlite'));
  const observer=new Observer(store,saveDir,reference,{interval});await observer.start();
  const runCommand=async body=>{if(body.op==='observer.scan'){await observer.scan(true);return {scanned:true,lastCycle:observer.lastCycle};}return store.mutate(observer.profile,body.requestId,body,()=>store.command(observer.profile,body));};
  const phoneServiceFile=path.join(appDir,'lib/phone-service.json');
  const configuredRelay=phoneRelayUrl??(existsSync(phoneServiceFile)?JSON.parse(readFileSync(phoneServiceFile,'utf8')).relayUrl:null);
  const phone=createPhoneAccess({store,observer,relayUrl:configuredRelay,enrollmentToken:phoneEnrollmentToken,runCommand,allowInsecureLoopback:allowInsecurePhoneLoopback});
  void phone.start().catch(()=>{});
  const token=randomBytes(32).toString('hex');
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const assets=new Map(['/','/index.html','/app.js','/species-style.js','/commands.js','/route-stops.js','/phone-ui.js','/phone.css','/qrcode.js','/map.js','/style.css','/icon.svg','/reference.js','/reference-core.js','/data-client.js','/career.js','/studio.js','/field-library.js','/field-theme.css','/hunting-workspace.css','/map-geometry.js','/terrain-layer.js','/map-atlas.js','/maps.css'].map(url=>[url,readFileSync(path.join(appDir,'public',url==='/'?'index.html':url.slice(1)))]));
  const server=http.createServer(async(req,res)=>{
    const actualPort=server.address().port;
    const goodHosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
    const origin=req.headers.origin;
    const sameOrigin=!origin||goodHosts.some(h=>origin==='http://'+h);
    const allowedSite=!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const json=(status,value)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(!goodHosts.includes(req.headers.host)||!sameOrigin||!allowedSite)return json(403,{error:'Only same-origin local access is accepted'});
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(200,{token,version:'0.4.1',selectedReserve:observer.source('reserveworlddata_adf')?.payload?.reserve??19});
      if(req.method==='GET'&&url.pathname==='/api/phone/status')return json(200,phone.status());
      if(req.method==='GET'&&url.pathname==='/api/maps')return json(200,mapsCatalog);
      if(req.method==='GET'&&url.pathname==='/api/gear')return json(200,gearCatalog);
      if(req.method==='GET'&&url.pathname==='/api/reference')return ratingCatalog?json(200,ratingCatalog):json(503,{error:'The animal reference catalog has not been installed.'});
      if(req.method==='GET'&&url.pathname==='/api/state')return json(200,observer.state(reserveId(url.searchParams.get('reserve')??19)));
      if(req.method==='GET'&&url.pathname==='/api/export'){
        res.writeHead(200,{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="COTW-field-journal.json"'});return res.end(JSON.stringify(store.exportJournal(observer.profile),null,2));
      }
      if(req.method==='POST'&&['/api/command','/api/phone/enable','/api/phone/pair','/api/phone/disable'].includes(url.pathname)) {
        if(req.headers['x-companion-token']!==token)return json(403,{error:'Missing local session token'});
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(415,{error:'JSON required'});
        const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>32768)return json(413,{error:'Request too large'});chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
        if(url.pathname==='/api/phone/enable')return json(200,await phone.enable(body));
        if(url.pathname==='/api/phone/pair')return json(200,await phone.pair());
        if(url.pathname==='/api/phone/disable')return json(200,await phone.disable());
        return json(200,await runCommand(body));
      }
      if(req.method==='GET'&&assets.has(url.pathname)){res.writeHead(200,{...headers,'Content-Type':types[path.extname(url.pathname)]||types['.html']});return res.end(assets.get(url.pathname));}
      return json(404,{error:'Not found'});
    }catch(e){json(e.status??400,{error:String(e.message).slice(0,300)});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // The old address is a redirect owned by this process, never a second observer or journal.
  let legacyRedirect=null;
  if(port===47831){legacyRedirect=http.createServer((req,res)=>{if(!['127.0.0.1:47821','localhost:47821'].includes(req.headers.host)){res.writeHead(403);return res.end();}if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(410,{'Content-Type':'text/plain'});return res.end('Use the canonical COTW Field Companion.');}res.writeHead(302,{Location:'http://127.0.0.1:47831/', 'Cache-Control':'no-store'});res.end();});await new Promise(resolve=>{legacyRedirect.once('error',()=>{legacyRedirect=null;resolve();});legacyRedirect.listen(47821,'127.0.0.1',resolve);});}
  const close=async()=>{await phone.close();if(legacyRedirect)legacyRedirect.close();observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,25));await new Promise(r=>server.close(r));store.close();};
  return {server,store,observer,phone,close,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  try{const app=await createApp({dataDir:process.env.COMPANION_DATA_DIR,saveDir:process.env.COTW_SAVE_DIR||null,port:Number(process.env.COMPANION_PORT||47831)});console.log(`COTW Field Companion listening at ${app.url}\nSave access: READ ONLY. Data: ${process.env.COMPANION_DATA_DIR}\nClose this window or press Ctrl+C to stop.`);let ending=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(ending)return;ending=true;await app.close();process.exit(0);});}catch(e){console.error(e.message);process.exitCode=1;}
}
