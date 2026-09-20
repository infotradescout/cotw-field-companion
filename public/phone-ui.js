const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class PhoneAccessUI {
  constructor(post){this.request=post;this.info=null;this.pairing=null;this.qr='';this.busy=false;this.error='';this.loading=null;this.expiryTimer=null;this.copyStatus='';}
  render(remote=false){
    if(remote)return '<section class="panel"><h2>Connected to your PC</h2><p>Keep your PC and companion running while you use your phone.</p><p class="small muted">To disconnect this phone, open Settings on your PC and turn off phone access.</p></section>';
    return `<section class="panel phone-access" id="phoneAccess">${this.content()}</section>`;
  }
  usablePair(){return !!this.pairing&&Number.isFinite(this.pairing.expiresAt)&&this.pairing.expiresAt>Date.now()&&this.info?.enabled===true&&this.info?.status==='connected';}
  clearPair(){clearTimeout(this.expiryTimer);this.expiryTimer=null;this.pairing=null;this.qr='';this.copyStatus='';}
  content(){
    const i=this.info,button=(text,action)=>`<button class="button ${action==='phone-enable'?'primary':''}" data-action="${action}" ${this.busy?'disabled':''}>${text}</button>`;
    if(!i)return `<h2>Use your phone</h2><p class="muted">${this.error?esc(this.error):'Checking phone access…'}</p>`;
    if(!i.available)return '<h2>Use your phone</h2><p>This running copy does not have a phone-service address.</p><p class="small muted">Close the older copy and open the complete, current GrindZone download. Refreshing this tab does not update the PC app.</p>';
    const pairing=this.usablePair()?`<div class="phone-pairing"><h3>Connect with your camera or a private link</h3><div class="phone-qr" role="img" aria-label="Scan this code to connect your phone">${this.qr}</div><p>Scan with your phone camera, open the link, then tap <strong>Connect this phone</strong>.</p><label class="form-field">Private connection link<input data-phone-link type="text" readonly value="${esc(this.pairing.url)}"></label><button type="button" class="button" data-phone-copy>Copy private link</button><p class="small muted" role="status" aria-live="polite">${esc(this.copyStatus)}</p><p class="small muted">This link pairs one browser once and expires at ${esc(new Date(this.pairing.expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}. Only send it to your own phone.</p><p class="small muted">Use the browser you plan to keep using. Switching browsers or reopening a used link requires a new connection code.</p></div>`:this.pairing?'<p class="phone-pairing" role="status">This connection code has expired or the PC connection changed. Select New connection code. A phone already connected does not need to pair again.</p>':'';
    return `<h2>Use your phone</h2><p>Open your map and harvests while you play, or check them away from home.</p><p class="small muted">Your PC and companion must stay on. Your phone connects through ${esc(i.serviceHost)}.</p>${i.enabled?`<p class="phone-connection-status"><span class="pill ${i.status==='connected'?'good':'warn'}">${i.status==='connected'?'Ready to connect':this.busy?'Connecting…':'Reconnecting…'}</span></p><div class="actions">${button(this.pairing?'New connection code':'Connect a phone','phone-pair')}${button('Turn off phone access','phone-disable')}</div>`:button(this.busy?'Connecting…':'Connect my phone','phone-enable')}${pairing}${this.error?`<p class="error" role="alert">${esc(this.error)}</p>`:''}`;
  }
  draw(){const node=document.querySelector('#phoneAccess');if(node){node.innerHTML=this.content();const copy=node.querySelector('[data-phone-copy]');if(copy)copy.onclick=()=>this.copyLink();}}
  async copyLink(){
    if(!this.usablePair()){this.draw();return;}
    const link=this.pairing.url;
    try{
      if(!globalThis.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      if(this.pairing?.url!==link)return;
      this.copyStatus='Private link copied. Open it on your own phone.';this.draw();
    }catch{
      if(this.pairing?.url!==link)return;
      this.copyStatus='Automatic copy is unavailable. Select and copy the private link above.';this.draw();
      const field=document.querySelector('#phoneAccess [data-phone-link]');field?.focus();field?.select();
    }
  }
  async load(){
    if(this.loading)return this.loading;
    this.loading=(async()=>{try{const r=await fetch('/api/phone/status',{cache:'no-store'});if(!r.ok)throw Error('Could not check phone access.');this.info=await r.json();if(!this.info.enabled||this.info.status!=='connected')this.clearPair();}catch(e){this.error=e.message;}finally{this.loading=null;this.draw();}})();return this.loading;
  }
  async post(action,body={}){return this.request('/api/phone/'+action,body);}
  async run(action){if(this.busy)return;this.busy=true;this.error='';this.draw();try{return await action();}catch(e){this.error=e.message;throw e;}finally{this.busy=false;await this.load();}}
  async enable(){return this.run(async()=>{this.info=await this.post('enable',{consent:true});await this.newPair();});}
  async newPair(){const value=await this.post('pair');const {default:qrcode}=await import('./qrcode.js');const qr=qrcode(0,'M');qr.addData(value.url);qr.make();this.clearPair();this.qr=qr.createSvgTag({cellSize:4,margin:16,scalable:true});this.pairing=value;this.expiryTimer=setTimeout(()=>this.draw(),Math.max(0,value.expiresAt-Date.now())+1);this.expiryTimer.unref?.();this.draw();}
  async pair(){return this.run(()=>this.newPair());}
  async disable(){return this.run(async()=>{this.info=await this.post('disable');this.clearPair();});}
}
