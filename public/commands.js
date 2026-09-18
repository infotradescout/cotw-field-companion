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
