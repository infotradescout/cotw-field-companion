/** The hosted app already has URL binding. This adds cache hooks only to that hosted entry;
 * local PC code and its durable journal remain untouched. Each replacement is exact/unique.
 */
export function bindPhoneCacheClient(input){
 let source=input;
 const replace=(before,after)=>{
  const parts=source.split(before);
  if(parts.length!==2)throw Error('Phone cache binding requires one canonical anchor: '+before.slice(0,70));
  source=parts[0]+after+parts[1];
 };
 if(typeof source!=='string'||source.includes('new PhoneSnapshotCache('))throw Error('Invalid or already bound phone client');
 source="import {PhoneSnapshotCache} from './phone-cache.js';\nconst phoneCache=new PhoneSnapshotCache();\n"+source;
 replace("async function get(url){const r=await fetch(url,{cache:'no-store',headers:token?{'X-Companion-Token':token}:{}});const data=await r.json();if(!r.ok){const error=Error(data.error||'Request failed');error.status=r.status;throw error;}return data;}","async function get(url){return phoneCache.get(url,{token});}");
 replace("function warning(){const failed=", "function warning(){if(phoneCache.readOnly)return phoneCache.warning();const failed=");
 replace("if(notice)notice.hidden=ready;", "if(notice){notice.hidden=ready;notice.textContent=phoneCache.notice();}");
 replace("querySelectorAll('#submitDialog,#terrainSetting,#spoilerSetting,'", "querySelectorAll('#rescan,#submitDialog,#terrainSetting,#spoilerSetting,'");
 replace("state=next;connectionState(true);refreshPressureLayer();", "state=next;connectionState(!phoneCache.readOnly);refreshPressureLayer();");
 replace("?'warn':'good');updateHuntStatus();", "?'warn':'good');phoneCache.updateStatus(badge);updateHuntStatus();");
 replace("return viewSignature;}", "return JSON.stringify([phoneCache.readOnly,phoneCache.cachedAt,viewSignature]);}");
 replace("+phoneUI.render(isPhone)+", "+phoneUI.render(isPhone)+phoneCache.settings()+");
 replace("async function act(action,target){", `async function act(action,target){
 if(action==='cache-enable')return openDialog('Keep private progress on this phone', '<p>Save the current and recently viewed reserves in this paired browser for up to seven days. Copies include the permitted zones, notes and progress shown here, including spoilers when enabled. Anyone using this browser may read them. Your PC keeps the original saves and durable journal.</p><p>Live access on the PC and these local copies are separate. Turning off live access does not erase a saved copy; use Delete saved copies on this phone. The phone needs internet to reopen the app and verify its pairing.</p><label class="checkline"><input type="checkbox" name="consent" required><span>This is a trusted device. Keep private progress in this browser.</span></label>',async v=>{if(v.consent!=='on')throw Error('Consent is required.');await phoneCache.enable(state);},'Keep private copy');
 if(action==='cache-delete'){await phoneCache.forget();state=null;signature='';clearZoneSelection();$('#content').innerHTML='';await refresh(true);toast('Phone copies deleted. Your PC history is unchanged.');return;}
`);
 replace("connectionState(false);$('#connection').textContent='Companion disconnected';", "if(e.cacheDenied||state&&state.selectedReserve!==requestedReserve){state=null;signature='';clearZoneSelection();$('#content').innerHTML='';}connectionState(false);$('#connection').textContent='Companion disconnected';");
 return source;
}
