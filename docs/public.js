import {getCatalog,esc,safePreference,savePreference} from './data-client.js?v=6b391a6cb5f8520d';
import {ReferencePanel} from './reference.js?v=6b391a6cb5f8520d';
import {FieldLibrary} from './field-library.js?v=6b391a6cb5f8520d';
import {ShareStudio} from './studio.js?v=6b391a6cb5f8520d';
import {careerView} from './career.js?v=6b391a6cb5f8520d';
import {MapAtlas} from './map-atlas.js?v=6b391a6cb5f8520d';
const root=document.querySelector('#content'),picker=document.querySelector('#reserve');
const views=['home','maps','reserves','reference','rares','gear','studio','career','faq'];
let view=views.includes(location.hash.slice(1))?location.hash.slice(1):'home',reserve=19,catalog=null;
const reference=new ReferencePanel(root,()=>{if(view==='reference')render();});
const library=new FieldLibrary(root,()=>{if(['home','reserves','gear','rares','faq'].includes(view))render();},navigate);
const studio=new ShareStudio(root);
const atlas=new MapAtlas(root,()=>{if(view==='maps')render();});
function navigate(next,r){if(!views.includes(next))return;if(r!==undefined){reserve=Number(r);picker.value=String(reserve);}view=next;const url=new URL(location.href);url.hash=view;url.searchParams.set('reserve',reserve);history.replaceState(null,'',url);render();window.scrollTo({top:0,behavior:'smooth'});}
function render(){if(view!=='maps')atlas.suspend();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(view==='maps')root.innerHTML=atlas.render(reserve);else if(view==='reference')root.innerHTML=reference.render(reserve);else if(view==='studio')root.innerHTML=studio.render({publicMode:true});else if(view==='career')root.innerHTML=careerView({publicMode:true});else root.innerHTML=library.render(view,reserve);}
root.addEventListener('click',e=>{const b=e.target.closest('[data-action="view-studio"]');if(b)navigate('studio');});
document.querySelector('nav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)navigate(b.dataset.view);});
picker.addEventListener('change',()=>{reserve=Number(picker.value);savePreference('reference-reserve',reserve);navigate(view,reserve);});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(views.includes(v)){view=v;render();}});
try{catalog=await getCatalog('reference');const requested=Number(new URL(location.href).searchParams.get('reserve')??safePreference('reference-reserve',19));reserve=catalog.reserves.some(r=>r.id===requested)?requested:19;picker.innerHTML=catalog.reserves.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');picker.value=String(reserve);render();}catch(e){root.innerHTML=`<section class="panel"><h1>Library unavailable</h1><p>${esc(e.message)}</p><p>Reload the page when your connection is available. No player data has been requested.</p></section>`;}
