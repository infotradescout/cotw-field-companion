const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class PhoneAccessUI {
  constructor(post){this.request=post;this.info=null;this.pairing=null;this.qr='';this.busy=false;this.error='';this.loading=null;}
  render(remote=false){
    if(remote)return '<section class="panel"><h2>Connected to your PC</h2><p>Keep your PC and companion running while you use your phone.</p><p class="small muted">To disconnect this phone, open Settings on your PC and turn off phone access.</p></section>';
    return `<section class="panel phone-access" id="phoneAccess">${this.content()}</section>`;
  }
  content(){
    const i=this.info,button=(text,action)=>`<button class="button ${action==='phone-enable'?'primary':''}" data-action="${action}" ${this.busy?'disabled':''}>${text}</button>`;
    if(!i)return `<h2>Use your phone</h2><p class="muted">${this.error?esc(this.error):'Checking phone access…'}</p>`;
    if(!i.available)return '<h2>Use your phone</h2><p>Phone access is being set up for this preview.</p><p class="small muted">Once it is ready, scan a code here to open your companion in your phone’s browser.</p>';
    return `<h2>Use your phone</h2><p>Open your map and harvests while you play, or check them away from home.</p><p class="small muted">Your PC and companion must stay on. Your phone connects through ${esc(i.serviceHost)}.</p>${i.enabled?`<p class="phone-connection-status"><span class="pill ${i.status==='connected'?'good':'warn'}">${i.status==='connected'?'Ready to connect':this.busy?'Connecting…':'Reconnecting…'}</span></p><div class="actions">${button(this.pairing?'New connection code':'Connect a phone','phone-pair')}${button('Turn off phone access','phone-disable')}</div>`:button(this.busy?'Connecting…':'Connect my phone','phone-enable')}${this.pairing?`<div class="phone-pairing"><h3>Scan with your phone camera</h3><div class="phone-qr" role="img" aria-label="Scan this code to connect your phone">${this.qr}</div><p>This code works once and expires at ${esc(new Date(this.pairing.expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}.</p><details><summary>Open using a link</summary><label class="form-field">Private connection link<input type="text" readonly value="${esc(this.pairing.url)}"></label><p class="small muted">Only share this link with your own phone.</p></details></div>`:''}${this.error?`<p class="error" role="alert">${esc(this.error)}</p>`:''}`;
  }
  draw(){const node=document.querySelector('#phoneAccess');if(node)node.innerHTML=this.content();}
  async load(){
    if(this.loading)return this.loading;
    this.loading=(async()=>{try{const r=await fetch('/api/phone/status',{cache:'no-store'});if(!r.ok)throw Error('Could not check phone access.');this.info=await r.json();}catch(e){this.error=e.message;}finally{this.loading=null;this.draw();}})();return this.loading;
  }
  async post(action,body={}){return this.request('/api/phone/'+action,body);}
  async run(action){if(this.busy)return;this.busy=true;this.error='';this.draw();try{return await action();}catch(e){this.error=e.message;throw e;}finally{this.busy=false;await this.load();}}
  async enable(){return this.run(async()=>{this.info=await this.post('enable',{consent:true});await this.newPair();});}
  async newPair(){const value=await this.post('pair');const {default:qrcode}=await import('./qrcode.js');const qr=qrcode(0,'M');qr.addData(value.url);qr.make();this.qr=qr.createSvgTag({cellSize:4,margin:16,scalable:true});this.pairing=value;this.draw();}
  async pair(){return this.run(()=>this.newPair());}
  async disable(){return this.run(async()=>{this.info=await this.post('disable');this.pairing=null;this.qr='';});}
}
