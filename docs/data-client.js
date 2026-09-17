/** Public catalogs are a generated projection. Public pages never call local save APIs. */
export const publicMode=document.documentElement.dataset.runtime==='public';
const cache=new Map();
export async function getCatalog(name){
 if(!['reference','gear'].includes(name))throw Error('Unknown catalog');
 if(cache.has(name))return cache.get(name);
 const promise=fetch(publicMode?new URL('./catalog/'+name+'.json'+(new URL(import.meta.url).searchParams.has('v')?'?v='+encodeURIComponent(new URL(import.meta.url).searchParams.get('v')):''),import.meta.url):'/api/'+name,{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error('Reference unavailable. Retry or check the connection.');return r.json();}).catch(e=>{cache.delete(name);throw e;});
 cache.set(name,promise);return promise;
}
export function safePreference(key,fallback){try{const v=localStorage.getItem('field:'+key);return v===null?fallback:JSON.parse(v);}catch{return fallback;}}
export function savePreference(key,value){try{localStorage.setItem('field:'+key,JSON.stringify(value));return true;}catch{return false;}}
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pretty=v=>String(v??'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
