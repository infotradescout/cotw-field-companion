/** Renew only an explicitly rejected CSRF session; never replay an uncertain POST. */
export function createSessionPost({getToken,setToken,fetch:request=(...args)=>globalThis.fetch(...args)}){
  const endpoints=new Set(['/api/command','/api/phone/enable','/api/phone/pair','/api/phone/disable']);
  const expired=new Set(['Missing local session token','Missing local session token. Reload this page.','Refresh the phone page before saving.']);
  let refreshing=null;
  async function renew(previous){
    if(getToken()!==previous)return;
    if(!refreshing)refreshing=(async()=>{
      const response=await request('/api/bootstrap',{cache:'no-store',credentials:'same-origin',redirect:'error'}),data=await response.json();
      if(!response.ok)throw Object.assign(Error(data.error||'Could not reconnect. Try again.'),{status:response.status});
      if(typeof data.token!=='string'||!data.token.trim())throw Error('Could not reconnect. Try again.');
      setToken(data.token);
    })().finally(()=>{refreshing=null;});
    await refreshing;
  }
  return async function post(url,body={}){
    if(!endpoints.has(url))throw Error('Unsupported companion action.');
    const raw=JSON.stringify(body),previous=getToken();
    const send=async token=>{const response=await request(url,{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-Companion-Token':token},body:raw});return {response,data:await response.json()};};
    let result=await send(previous);
    if(result.response.status===403&&expired.has(result.data.error)){
      await renew(previous);
      if(getToken()!==previous)result=await send(getToken());
    }
    if(!result.response.ok)throw Object.assign(Error(result.data.error||'Could not save. Try again.'),{status:result.response.status});
    return result.data;
  };
}

/** Retain one command identity when a response is lost; coalesce pending taps. */
export function createCommandClient({send,makeId}){
  const unresolved=new Map();
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return function command(body){
    const key=JSON.stringify(stable(body));
    let intent=unresolved.get(key);
    if(intent?.pending)return intent.pending;
    if(!intent){intent={body:{...body,requestId:body.requestId||makeId()},pending:null,ambiguous:false};unresolved.set(key,intent);}
    intent.pending=(async()=>{
      try{
        const result=await send(intent.body);
        unresolved.delete(key);
        return result;
      }catch(error){
        // These responses explicitly reject the action before it can be applied.
        const rejected=[400,401,403,404,409,413,422].includes(error.status);
        if(rejected&&!intent.ambiguous)unresolved.delete(key);
        if(!rejected)intent.ambiguous=true;
        throw error;
      }finally{intent.pending=null;}
    })();
    return intent.pending;
  };
}
