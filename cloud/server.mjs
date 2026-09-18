/** A bounded, single-instance live relay. The PC owns all journal persistence. */
import http from 'node:http';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {PHONE_PROTOCOL,PHONE_MAX_BYTES,phoneRelayOrigin,validatePhoneCommand} from '../lib/phone-bridge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const random=()=>randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const DAY=86400000;
const assets=['app.js','map.js','style.css','icon.svg','reference.js','reference-core.js','data-client.js','career.js','studio.js','field-library.js','field-theme.css','map-geometry.js','terrain-layer.js','map-atlas.js','maps.css','hunting-workspace.css','species-style.js'];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

function signingKey(input){
  if(Buffer.isBuffer(input)&&input.length>=32)return input;
  if(typeof input==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input)){const key=Buffer.from(input,'base64url');if(key.length===32)return key;}
  throw Error('PHONE_RELAY_SIGNING_KEY must be a persistent, randomly generated 32-byte base64url secret');
}

export async function createPhoneRelay({key,publicOrigin,port=0,host='127.0.0.1',allowInsecureLoopback=false,now=Date.now,requestTimeoutMs=10000,pairTtlMs=300000,maxPeers=16,maxPending=4,pairAttemptLimit=30,provisionLimit=20}={}){
  const secret=signingKey(key);
  let origin=phoneRelayOrigin(publicOrigin,{allowInsecureLoopback});
  const peers=new Map(),pairs=new Map(),pending=new Map(),rates=new Map(),sessionReserve=new Map();
  const files=new Map(assets.map(name=>['/'+name,readFileSync(path.join(root,'public',name))]));
  const index=readFileSync(path.join(root,'public/index.html'),'utf8').replace('<html','<html data-runtime="phone"');
  const connectPage=readFileSync(new URL('./connect.html',import.meta.url));
  const connectScript=readFileSync(new URL('./connect.js',import.meta.url));
  const catalogs=Object.fromEntries([['maps','maps-data'],['gear','gear-data'],['reference','rating-data']].map(([name,file])=>[name,JSON.parse(readFileSync(path.join(root,'lib',file+'.json'),'utf8'))]));
  const mac=value=>createHmac('sha256',secret).update(value).digest('base64url');
  function issue(purpose,deviceId,lifetime,extra={}){const payload=Buffer.from(JSON.stringify({v:1,purpose,deviceId,iat:now(),exp:now()+lifetime,...extra})).toString('base64url');return payload+'.'+mac(payload);}
  function verify(token,purpose){
    if(typeof token!=='string'||token.length>2048)return null;
    const [payload,signature,...extra]=token.split('.');if(extra.length||!payload||!equal(signature,mac(payload)))return null;
    try{const value=JSON.parse(Buffer.from(payload,'base64url').toString());return value.v===1&&value.purpose===purpose&&/^[A-Za-z0-9_-]{43}$/.test(value.deviceId)&&Number.isFinite(value.exp)&&value.exp>now()&&Number.isFinite(value.iat)&&value.iat<=now()+30000?value:null;}catch{return null;}
  }
  function limited(key,limit,windowMs=60000){
    let r=rates.get(key);if(!r||r.until<=now()){if(rates.size>=2048){for(const [k,v]of rates)if(v.until<=now())rates.delete(k);if(rates.size>=2048)return true;}r={count:0,until:now()+windowMs};rates.set(key,r);}return ++r.count>limit;
  }
  function auth(req){
    const found=String(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-cotw-phone='));if(found.length!==1)return null;
    const token=found[0].slice('__Host-cotw-phone='.length),claims=verify(token,'phone');return claims&&typeof claims.sid==='string'?{...claims,token,csrf:mac('csrf:'+token)}:null;
  }
  const json=(res,status,value,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));};
  function browserOrigin(req){return req.headers.origin===origin&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin');}
  async function body(req){
    if(String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json')throw Object.assign(Error('JSON required'),{status:415});
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Object.assign(Error('Invalid request'),{status:400});}
  }
  function invalidatePeer(peer){
    if(peers.get(peer.deviceId)===peer)peers.delete(peer.deviceId);
    for(const [key,value]of pairs)if(value.peer===peer)pairs.delete(key);
    for(const [key,value]of pending)if(value.peer===peer){clearTimeout(value.timer);pending.delete(key);value.reject(Object.assign(Error('PC connection changed. Refresh before retrying an action.'),{status:503}));}
  }
  function relay(peer,operation,data){
    if(!peer||peer.socket.readyState!==1)throw Object.assign(Error('Your PC companion is offline. Open it on your PC to reconnect.'),{status:503});
    if([...pending.values()].filter(v=>v.peer===peer).length>=maxPending)throw Object.assign(Error('Your PC is busy. Try again shortly.'),{status:429});
    const id=random();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error(operation==='command'?'Action status is unknown. Refresh before retrying.':'The PC did not respond in time.'),{status:504}));},requestTimeoutMs);timer.unref?.();pending.set(id,{peer,resolve,reject,timer});peer.socket.send(JSON.stringify({type:'request',id,operation,...data}));});
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true,mode:'live_relay'});
      if(req.headers.host!==new URL(origin).host)return json(res,403,{error:'This address is not accepted'});
      if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return json(res,403,{error:'Use the phone companion directly'});
      if(req.method==='POST'&&url.pathname==='/phone/device'){
        if(limited('provision',provisionLimit)||limited('provision:'+req.socket.remoteAddress,provisionLimit))return json(res,429,{error:'Connection setup is busy. Try again later.'});
        const input=await body(req);if(Object.keys(input).length)return json(res,400,{error:'No profile or save data is accepted during setup'});
        const deviceId=random();return json(res,201,{deviceId,deviceToken:issue('device',deviceId,365*DAY)});
      }
      if(req.method==='GET'&&url.pathname==='/phone/connect'){res.writeHead(200,{...headers,'Content-Type':types['.html']});return res.end(connectPage);}
      if(req.method==='GET'&&url.pathname==='/phone/connect.js'){res.writeHead(200,{...headers,'Content-Type':types['.js']});return res.end(connectScript);}
      if(req.method==='POST'&&url.pathname==='/phone/pair'){
        if(!browserOrigin(req))return json(res,403,{error:'Pair from the phone connection page'});
        if(limited('pair-attempts',pairAttemptLimit)||limited('pair-attempts:'+req.socket.remoteAddress,pairAttemptLimit))return json(res,429,{error:'Too many pairing attempts. Try again later.'});
        const input=await body(req),pair=typeof input.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.token)?pairs.get(hash(input.token)):null;
        if(!pair||pair.expiresAt<=now()||peers.get(pair.peer.deviceId)!==pair.peer)return json(res,400,{error:'This pairing link is unavailable. Request a new one on the PC.'});
        pairs.delete(hash(input.token));const cookie=issue('phone',pair.peer.deviceId,30*DAY,{sid:random()});
        return json(res,200,{paired:true},{'Set-Cookie':'__Host-cotw-phone='+cookie+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'});
      }
      const session=auth(req);
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
        res.writeHead(session?200:302,{...headers,...(session?{'Content-Type':types['.html']}:{Location:'/phone/connect'})});return res.end(session?index:'');
      }
      // Assets contain only application code and public catalogs; all data APIs below require a paired owner.
      if(req.method==='GET'&&files.has(url.pathname)){res.writeHead(200,{...headers,'Content-Type':types[path.extname(url.pathname)]});return res.end(files.get(url.pathname));}
      if(!session)return json(res,401,{error:'Pair this browser from the companion on your PC.'});
      if(limited('owner:'+session.deviceId,180))return json(res,429,{error:'Too many requests. Try again shortly.'});
      if(req.method==='POST'){
        if(!browserOrigin(req)||!equal(req.headers['x-companion-token'],session.csrf))return json(res,403,{error:'Refresh the phone page before saving.'});
        if(url.pathname==='/phone/logout')return json(res,200,{signedOut:true},{'Set-Cookie':'__Host-cotw-phone=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
        if(url.pathname==='/api/command'){
          if(limited('commands:'+session.deviceId,30))return json(res,429,{error:'Too many actions. Try again shortly.'});
          const command=validatePhoneCommand(await body(req));const result=await relay(peers.get(session.deviceId),'command',{body:command});return json(res,200,result);
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(res,200,{token:session.csrf,version:'0.4.1',selectedReserve:sessionReserve.get(session.sid)?.reserve??19,phone:{remote:true,online:peers.has(session.deviceId),mode:'live_relay'}});
      if(req.method==='GET'&&Object.hasOwn(catalogs,url.pathname.slice(5))&&url.pathname.startsWith('/api/'))return json(res,200,catalogs[url.pathname.slice(5)]);
      if(req.method==='GET'&&['/api/state','/api/export'].includes(url.pathname)){
        const reserve=Number(url.searchParams.get('reserve')??sessionReserve.get(session.sid)?.reserve??19);if(!Number.isInteger(reserve)||reserve<0||reserve>999)return json(res,400,{error:'Invalid reserve'});
        if(sessionReserve.size<2048||sessionReserve.has(session.sid))sessionReserve.set(session.sid,{reserve,expiresAt:session.exp});
        const result=await relay(peers.get(session.deviceId),url.pathname==='/api/state'?'state':'export',{reserve});
        if(url.pathname==='/api/state')result.reserves=(result.reserves??[]).map(r=>({...catalogs.maps.reserves.find(x=>x.id===r.id),...r,poi:r.id===reserve?catalogs.maps.reserves.find(x=>x.id===r.id)?.poi??[]:[]}));
        return json(res,200,result,url.pathname==='/api/export'?{'Content-Disposition':'attachment; filename="COTW-phone-view.json"'}:{});
      }
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,[400,403,409,413,415,429,503,504].includes(e.status)?e.status:500,{error:[400,403,409,413,415,429,503,504].includes(e.status)?e.message:'The phone service could not complete the request.'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const wss=new WebSocketServer({noServer:true,maxPayload:PHONE_MAX_BYTES,perMessageDeflate:false});
  const connections=new Set();
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/phone/bridge'||req.headers.host!==new URL(origin).host||req.headers.origin||connections.size>=maxPeers||limited('upgrades',120))return socket.destroy();
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',socket=>{
    connections.add(socket);let peer=null;
    const helloTimer=setTimeout(()=>socket.close(1008,'Authentication required'),5000);helloTimer.unref?.();
    socket.on('error',()=>{});
    socket.on('message',(bytes,isBinary)=>{
      try{
        if(isBinary||bytes.length>PHONE_MAX_BYTES)return socket.close(1009);
        let m;try{m=JSON.parse(bytes.toString());}catch{return socket.close(1008);}
        if(!peer){
          const identity=m.type==='hello'&&m.protocol===PHONE_PROTOCOL?verify(m.deviceToken,'device'):null;
          if(!identity)return socket.close(1008,'Invalid device credential');
          clearTimeout(helloTimer);peer={deviceId:identity.deviceId,socket,alive:true,expiresAt:identity.exp};
          const previous=peers.get(peer.deviceId);if(previous){invalidatePeer(previous);previous.socket.close(1012,'PC reconnected');}
          peers.set(peer.deviceId,peer);socket.send(JSON.stringify({type:'ready',deviceId:peer.deviceId}));return;
        }
        if(peers.get(peer.deviceId)!==peer)return socket.close(1008);
        if(peer.expiresAt<=now())return socket.close(1008,'Device credential expired');
        if(limited('messages:'+peer.deviceId,120))return socket.close(1008,'Too many messages');
        if(m.type==='pong'){peer.alive=true;return;}
        if(m.type==='pair'){
          if(typeof m.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(m.requestId)||limited('pair-create:'+peer.deviceId,10))return socket.close(1008);
          for(const [k,v]of pairs)if(v.expiresAt<=now()||v.peer===peer)pairs.delete(k);
          if(pairs.size>=maxPeers)return socket.close(1013);
          const token=random(),expiresAt=now()+pairTtlMs;pairs.set(hash(token),{peer,expiresAt});
          socket.send(JSON.stringify({type:'pairing',requestId:m.requestId,url:origin+'/phone/connect#pair='+token,expiresAt}));return;
        }
        if(m.type==='response'){
          const waiting=pending.get(m.id);if(!waiting||waiting.peer!==peer)return;
          clearTimeout(waiting.timer);pending.delete(m.id);
          if(m.status===200&&m.data&&typeof m.data==='object')waiting.resolve(m.data);
          else waiting.reject(Object.assign(Error(m.status===409?'The journal changed. Refresh before saving.':'The PC could not complete this request.'),{status:[400,403,409,413,429].includes(m.status)?m.status:503}));
          return;
        }
        socket.close(1008,'Unsupported message');
      }catch{socket.close(1008,'Invalid message');}
    });
    socket.on('close',()=>{clearTimeout(helloTimer);connections.delete(socket);if(peer)invalidatePeer(peer);});
  });
  const cleanup=setInterval(()=>{
    for(const [k,p]of pairs)if(p.expiresAt<=now())pairs.delete(k);
    for(const [k,r]of rates)if(r.until<=now())rates.delete(k);
    for(const [k,s]of sessionReserve)if(s.expiresAt<=now())sessionReserve.delete(k);
    for(const p of peers.values()){if(!p.alive||p.expiresAt<=now()){p.socket.terminate();continue;}p.alive=false;p.socket.send(JSON.stringify({type:'ping'}));}
  },30000);cleanup.unref();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  if(allowInsecureLoopback&&new URL(origin).port==='0')origin=origin.replace(':0',':'+server.address().port);
  return {server,origin,async close(){clearInterval(cleanup);for(const p of peers.values())invalidatePeer(p);for(const s of connections)s.terminate();await new Promise(resolve=>wss.close(resolve));server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const relay=await createPhoneRelay({key:process.env.PHONE_RELAY_SIGNING_KEY,publicOrigin:process.env.PHONE_RELAY_ORIGIN||process.env.RENDER_EXTERNAL_URL,port:Number(process.env.PORT||10000),host:'0.0.0.0'});
  console.log('COTW phone relay ready. No game-save storage is configured.');
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();process.exit(0);});
}
