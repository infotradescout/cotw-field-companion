import http from 'node:http';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FeedbackStore,normalizeFeedbackInput} from './feedback-store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const trimOrigin=value=>{const url=new URL(value);if(url.pathname!=='/'||url.search||url.hash)throw Error('Origins must not include a path or query');return url.origin;};
const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};

function tokenEquals(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function sourceHash(value,salt){return createHmac('sha256',salt).update(value||'unknown').digest('hex');}

export async function createFeedbackServer({publicOrigin,ownerOrigin=null,ownerToken,dbPath=':memory:',port=0,host='127.0.0.1',allowInsecureLoopback=false,trustProxy=false,clientIdentity=null,now=Date.now,rateLimitPerMinute=1,rateLimitPerHour=5,rateSalt=randomBytes(32)}={}){
  if(!publicOrigin)throw Error('FEEDBACK_PUBLIC_ORIGIN is required');
  const allowedPublicOrigin=trimOrigin(publicOrigin);
  if(!allowInsecureLoopback&&!/^https:$/.test(new URL(allowedPublicOrigin).protocol))throw Error('Public feedback origin must use HTTPS');
  const allowedOwnerOrigin=ownerOrigin?trimOrigin(ownerOrigin):null;
  if(typeof ownerToken!=='string'||ownerToken.length<32)throw Error('FEEDBACK_OWNER_TOKEN must be a random secret of at least 32 characters');
  if(dbPath!==':memory:')mkdirSync(path.dirname(path.resolve(dbPath)),{recursive:true});
  const store=new FeedbackStore(dbPath),rates=new Map();
  const cleanRates=()=>{const nowValue=now();for(const [key,value] of rates)if(value.until<=nowValue)rates.delete(key);};
  const limited=(key,limit,windowMs)=>{const nowValue=now();let value=rates.get(key);if(!value||value.until<=nowValue){cleanRates();value={count:0,until:nowValue+windowMs};rates.set(key,value);}return ++value.count>limit;};
  const responseHeaders=(req,origin=null,methods='POST, OPTIONS',allowHeaders='Content-Type')=>origin&&req.headers.origin===origin?{...baseHeaders,'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':methods,'Access-Control-Allow-Headers':allowHeaders,'Vary':'Origin'}:baseHeaders;
  const json=(req,res,status,value,origin=null)=>{res.writeHead(status,{...responseHeaders(req,origin),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const body=async req=>{if(String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json')throw Object.assign(Error('JSON required'),{status:415});let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}};
  const ownerAuthorized=req=>{const value=String(req.headers.authorization??'');return value.startsWith('Bearer ')&&tokenEquals(value.slice(7),ownerToken)&&(allowedOwnerOrigin?req.headers.origin===allowedOwnerOrigin:!req.headers.origin||req.headers.origin===allowedPublicOrigin);};
  const clientHash=req=>{
    let identity=typeof clientIdentity==='function'?clientIdentity(req):null;
    if(identity===null||identity===undefined||identity===''){
      if(trustProxy){
        const forwarded=String(req.headers['x-forwarded-for']??'').split(',')[0].trim();
        if(forwarded)identity=forwarded;
      }
      if(identity===null||identity===undefined||identity==='')identity=req.socket.remoteAddress||'unknown';
    }
    return sourceHash(String(identity).slice(0,200),rateSalt);
  };
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/healthz')return json(req,res,200,{ok:true,mode:'feedback_service'});
      if(req.method==='OPTIONS'&&url.pathname==='/v1/feedback'){
        if(req.headers.origin!==allowedPublicOrigin)return json(req,res,403,{error:'This public origin is not accepted'});
        res.writeHead(204,responseHeaders(req,allowedPublicOrigin));return res.end();
      }
      if(req.method==='OPTIONS'&&url.pathname.startsWith('/v1/owner/')){
        if(!allowedOwnerOrigin||req.headers.origin!==allowedOwnerOrigin)return json(req,res,403,{error:'This owner origin is not accepted'});
        res.writeHead(204,responseHeaders(req,allowedOwnerOrigin,'GET, POST, OPTIONS','Authorization, Content-Type'));return res.end();
      }
      if(req.method==='POST'&&url.pathname==='/v1/feedback'){
        if(req.headers.origin!==allowedPublicOrigin)return json(req,res,403,{error:'Feedback must be sent from the public companion'});
        const key=clientHash(req);if(limited('minute:'+key,rateLimitPerMinute,60000)||limited('hour:'+key,rateLimitPerHour,3600000))return json(req,res,429,{error:'Please wait before sending more feedback.'},allowedPublicOrigin);
        const value=normalizeFeedbackInput(await body(req));
        const record=store.create(value,{now:new Date(now()).toISOString()});
        return json(req,res,201,{accepted:true,id:record.id,message:'Feedback received. Thank you.'},allowedPublicOrigin);
      }
      if(url.pathname.startsWith('/v1/owner/')){
        const ownerCors=allowedOwnerOrigin&&req.headers.origin===allowedOwnerOrigin?allowedOwnerOrigin:null;
        if(!ownerAuthorized(req))return json(req,res,401,{error:'Owner authorization required'},ownerCors);
        if(req.method==='GET'&&url.pathname==='/v1/owner/feedback'){
          const status=url.searchParams.get('status')||'all',limit=url.searchParams.get('limit')||50;
          return json(req,res,200,{feedback:store.list({status,limit}),unreadCount:store.unreadCount()},ownerCors);
        }
        const match=url.pathname.match(/^\/v1\/owner\/feedback\/([^/]+)\/read$/);
        if(req.method==='POST'&&match){const record=store.markRead(match[1],new Date(now()).toISOString());if(!record)return json(req,res,404,{error:'Feedback not found'},ownerCors);return json(req,res,200,{feedback:record,unreadCount:store.unreadCount()},ownerCors);}
      }
      return json(req,res,404,{error:'Not found'});
    }catch(error){const status=[400,401,403,404,413,415,429].includes(error.status)?error.status:500;return json(req,res,status,{error:status===500?'Feedback service unavailable':String(error.message).slice(0,160)},req.headers.origin===allowedPublicOrigin?allowedPublicOrigin:null);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const address=server.address(),url=`http://${address.address==='::1'?'[::1]':address.address}:${address.port}`;
  return {server,store,url,publicOrigin:allowedPublicOrigin,async close(){await new Promise(resolve=>server.close(resolve));store.close();}};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const service=await createFeedbackServer({
    publicOrigin:process.env.FEEDBACK_PUBLIC_ORIGIN,
    ownerOrigin:process.env.FEEDBACK_OWNER_ORIGIN||null,
    ownerToken:process.env.FEEDBACK_OWNER_TOKEN,
    dbPath:process.env.FEEDBACK_DB_PATH||path.join(root,'data','feedback.sqlite'),
    port:Number(process.env.PORT||10000),host:'0.0.0.0'
  });
  console.log(`COTW feedback service listening at ${service.url}`);
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await service.close();process.exit(0);});
}
