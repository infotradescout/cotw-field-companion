import {isGreatOneSpecies} from './species-style.js?v=bb924205995e1365';
import {homeBox,validBox,validBounds,insideBounds,scaleBar} from './map-geometry.js?v=bb924205995e1365';
import {TerrainLayer} from './terrain-layer.js?v=bb924205995e1365';
const NS='http://www.w3.org/2000/svg';
export const needColors={drinking:'#83bfc9',feeding:'#d9ba76',resting:'#c7afd8'};
export const poiKinds={outpost:'Outpost',lookout_point:'Lookout',landmark:'Landmark',hunting_blind:'Hunting structure',machan:'Raised platform',lore:'Point of interest',shooting_range:'Shooting range'};
function el(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
/** Saved 256×256 pressure, in the game's row-major X/Z order. No inferred circles. */
export class HuntingPressureLayer {
 constructor(node=el('image'),createCanvas=()=>document.createElement('canvas')) {
  this.node=node;this.createCanvas=createCanvas;this.cache=new Map();this.state={status:'unavailable'};
  for(const [key,value] of Object.entries({class:'hunting-pressure-layer',preserveAspectRatio:'none','pointer-events':'none','aria-hidden':'true',visibility:'hidden'}))node.setAttribute(key,value);
 }
 clear(){this.node.setAttribute('visibility','hidden');this.node.removeAttribute('href');this.state={status:'unavailable'};return this.state;}
 update(pressure,enabled=true) {
  if(pressure?.status!=='available'||pressure.width!==256||pressure.height!==256||!validBounds(pressure.bounds)||
     !Array.isArray(pressure.values)&&!(pressure.values instanceof Uint8Array)||pressure.values?.length!==65536||
     typeof pressure.sourceHash!=='string'||!/^[a-f0-9]{64}$/i.test(pressure.sourceHash))return this.clear();
  const key=JSON.stringify([pressure.sourceHash,pressure.width,pressure.height,pressure.bounds]);
  let raster=this.cache.get(key);
  if(!raster){
   if(!pressure.values.every(value=>Number.isInteger(value)&&value>=0&&value<=255))return this.clear();
   const hasPressure=pressure.values.some(value=>value>0);
   raster={hasPressure,url:null};
   if(hasPressure){
    try{
     const canvas=this.createCanvas();canvas.width=256;canvas.height=256;
     const context=canvas.getContext('2d');if(!context)return this.clear();
     const image=context.createImageData(256,256);
     // Column zero is minX and row zero is minZ, as in DECA's pressure renderer.
     for(let i=0;i<pressure.values.length;i++){
      const pixel=i*4;image.data[pixel]=209;image.data[pixel+1]=58;image.data[pixel+2]=222;
      image.data[pixel+3]=Math.round(pressure.values[i]*.8);
     }
     context.putImageData(image,0,0);raster.url=canvas.toDataURL('image/png');
    }catch{return this.clear();}
   }
   this.cache.set(key,raster);
   while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value);
  }else{this.cache.delete(key);this.cache.set(key,raster);}
  const [[minX,minZ],[maxX,maxZ]]=pressure.bounds;
  for(const [name,value] of Object.entries({x:minX,y:minZ,width:maxX-minX,height:maxZ-minZ}))this.node.setAttribute(name,String(value));
  if(raster.url){if(this.node.getAttribute('href')!==raster.url)this.node.setAttribute('href',raster.url);}
  else this.node.removeAttribute('href');
  this.node.setAttribute('visibility',enabled&&raster.hasPressure?'visible':'hidden');
  this.state={status:'available',hasPressure:raster.hasPressure,stale:pressure.stale===true,savedAt:pressure.savedAt??null};
  return this.state;
 }
 destroy(){this.cache.clear();this.clear();this.node.remove();}
}
export class FieldMap{
 constructor(svg,onSelect=()=>{},onPoint=()=>{},onStatus=()=>{}){this.svg=svg;this.onSelect=onSelect;this.onPoint=onPoint;this.onStatus=onStatus;this.box=null;this.reserve=null;this.drag=null;this.point=null;this.pointers=new Map();this.pinch=null;this.layers={zones:true,equipment:true,poi:true,grid:false,pressure:true};this.poiFilter='all';this.abort=new AbortController();this.disposed=false;
  this.background=el('rect',{fill:'#17241d'});this.overlay=el('g');this.pressure=new HuntingPressureLayer();this.terrain=new TerrainLayer(s=>{this.status=s;this.svg.dispatchEvent(new CustomEvent('terrainstatus',{detail:s}));this.onStatus(s);});svg.replaceChildren(this.background,this.terrain.node,this.pressure.node,this.overlay);svg.setAttribute('tabindex','0');this.setEvents();
  if(typeof ResizeObserver!=='undefined'){this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(svg);}
 }
 update({reserve,zones=[],pins=[],equipment=[],terrain=true,route=[],selectedZone=null,huntingPressure=null}){this.data={reserve,zones,pins,equipment,terrain,route,selectedZone,huntingPressure:huntingPressure?.reserve===reserve.id?huntingPressure:null};if(this.reserve!==reserve.id){this.reserve=reserve.id;this.point=null;this.home();}else this.draw();}
 destroy(){this.disposed=true;this.abort.abort();this.resize?.disconnect();cancelAnimationFrame(this.frame);this.terrain.destroy();this.pressure.destroy();}
 schedule(){if(this.frame||this.disposed)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});}
 select(id){if(!this.data)return;this.data.selectedZone=id;this.svg.querySelectorAll('[data-zone]').forEach(n=>n.classList.toggle('active-zone',n.getAttribute('data-zone')===id));}
 viewportBox(box,contain=false,cover=false){const rect=this.svg.getBoundingClientRect();if(!rect.width||!rect.height)return box;const aspect=rect.width/rect.height,w=contain?Math.max(box[2],box[3]*aspect):cover?Math.min(box[2],box[3]*aspect):box[2],h=w/aspect;return [box[0]+(box[2]-w)/2,box[1]+(box[3]-h)/2,w,h];}
 home(){const box=homeBox(this.data.reserve),rect=this.svg.getBoundingClientRect(),phone=rect.width>0&&rect.height>rect.width*1.12;this.box=this.viewportBox(box,phone?false:true,phone);this.point=null;this.draw();}
 fitVisible(){const pts=[...this.data.zones,...this.data.equipment,...this.data.pins].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));if(!pts.length)return this.home();const xs=pts.map(p=>p.x),zs=pts.map(p=>p.z),minX=Math.min(...xs),minZ=Math.min(...zs),w=Math.max(600,Math.max(...xs)-minX),h=Math.max(600,Math.max(...zs)-minZ);this.box=this.viewportBox([minX-w*.07,minZ-h*.07,w*1.14,h*1.14],true);this.draw();}
 setLayer(name,enabled){if(!Object.hasOwn(this.layers,name))return;this.layers[name]=!!enabled;this.draw();}
 setPoiFilter(value){this.poiFilter=value;this.draw();}
 zoom(factor,point){if(!validBox(this.box))return;const b=this.box,p=point??[b[0]+b[2]/2,b[1]+b[3]/2],w=Math.max(180,Math.min(32768,b[2]*factor)),f=w/b[2];this.box=[p[0]-(p[0]-b[0])*f,p[1]-(p[1]-b[1])*f,w,b[3]*f];this.draw();}
 focus(x,z){if(!Number.isFinite(x)||!Number.isFinite(z))return;const size=1800;this.box=[x-size/2,z-size/2,size,size];this.point=[x,z];this.draw();}
 toWorld(e){const matrix=this.svg.getScreenCTM();if(!matrix)return null;const p=this.svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const n=p.matrixTransform(matrix.inverse());return [n.x,n.y];}
 setEvents(){const options={signal:this.abort.signal};this.svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?1.2:1/1.2,this.toWorld(e));},{...options,passive:false});
  const gesture=()=>{const [a,b]=[...this.pointers.values()];return a&&b?{distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),center:{clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2}}:null;};
  this.svg.addEventListener('pointerdown',e=>{if(e.button!==0||!this.box)return;const world=this.toWorld(e);if(!world)return;this.pointers.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY});this.svg.setPointerCapture(e.pointerId);if(this.pointers.size>1){this.pinch=gesture();this.drag=null;return;}this.drag={screen:[e.clientX,e.clientY],start:world,id:e.pointerId,zone:e.target.closest('[data-zone]')?.dataset.zone,pin:e.target.closest('[data-pin]')?.dataset.pin,poi:e.target.closest('[data-poi]')?.dataset.poi};},options);
  this.svg.addEventListener('pointermove',e=>{if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY});if(this.pinch){const next=gesture();if(next&&next.distance>0&&this.pinch.distance>0){const anchor=this.toWorld(this.pinch.center),center=this.toWorld(next.center);if(anchor&&center){this.box=[this.box[0]+anchor[0]-center[0],this.box[1]+anchor[1]-center[1],this.box[2],this.box[3]];this.zoom(this.pinch.distance/next.distance,anchor);}this.pinch=next;}return;}const p=this.toWorld(e);if(!p)return;if(!this.drag){this.svg.dispatchEvent(new CustomEvent('mapcursor',{detail:{x:p[0],z:p[1]}}));return;}if(this.drag.id!==e.pointerId)return;this.box=[this.box[0]+this.drag.start[0]-p[0],this.box[1]+this.drag.start[1]-p[1],this.box[2],this.box[3]];this.schedule();},options);
  this.svg.addEventListener('pointerup',e=>{this.pointers.delete(e.pointerId);if(this.svg.hasPointerCapture(e.pointerId))this.svg.releasePointerCapture(e.pointerId);if(this.pinch){if(!this.pointers.size)this.pinch=null;this.drag=null;return;}if(!this.drag||this.drag.id!==e.pointerId)return;const d=this.drag;this.drag=null;if(Math.hypot(e.clientX-d.screen[0],e.clientY-d.screen[1])>=5)return;
   if(d.zone)this.onSelect(d.zone);else if(d.pin){const p=[...this.data.pins,...this.data.equipment].find(p=>p.id===d.pin);if(p){this.point=[p.x,p.z];this.onPoint(this.point,p);this.draw();}}else if(d.poi){const p=(this.data.reserve.poi||[]).find(p=>p.id===d.poi);if(p){this.point=[p.x,p.z];this.onPoint(this.point,p);this.draw();}}else{const p=this.toWorld(e);if(p){this.point=p.map(Math.round);this.onPoint(this.point);this.draw();}}
  },options);
  this.svg.addEventListener('pointercancel',()=>{this.drag=null;this.pinch=null;this.pointers.clear();},options);
  this.svg.addEventListener('keydown',e=>{if(e.target!==this.svg||!this.box)return;const b=this.box,k=e.key;if(['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(k))e.preventDefault();if(k==='+'||k==='=')this.zoom(1/1.4);else if(k==='-')this.zoom(1.4);else if(k==='Home')this.home();else if(k.startsWith('Arrow')){const dx=k==='ArrowLeft'?-.12:k==='ArrowRight'?.12:0,dz=k==='ArrowUp'?-.12:k==='ArrowDown'?.12:0;this.box=[b[0]+b[2]*dx,b[1]+b[3]*dz,b[2],b[3]];this.draw();}},options);
 }
 draw(){if(this.disposed||!this.data||!validBox(this.box))return;this.box=this.viewportBox(this.box);const b=this.box,{reserve,terrain,route}=this.data,rect=this.svg.getBoundingClientRect(),screen=rect.width||850,scale=1/Math.min(screen/b[2],(rect.height||screen)/b[3]);this.svg.setAttribute('viewBox',b.join(' '));for(const [k,v]of Object.entries({x:b[0],y:b[1],width:b[2],height:b[3]}))this.background.setAttribute(k,String(v));
  this.terrain.update(reserve,b,terrain,screen);this.pressure.update(this.data.huntingPressure,this.layers.pressure);this.overlay.replaceChildren();const out=this.overlay;
  if(this.layers.grid||!terrain){const step=b[2]>6000?1000:b[2]>2500?500:200;for(let x=Math.ceil(b[0]/step)*step;x<b[0]+b[2];x+=step){out.append(el('line',{x1:x,y1:b[1],x2:x,y2:b[1]+b[3],stroke:'#b3bdac','stroke-width':scale,opacity:.24}));out.append(el('text',{x:x+5*scale,y:b[1]+20*scale,fill:'#ebeadc','font-size':10*scale,'paint-order':'stroke',stroke:'#172218','stroke-width':2*scale},Math.round(x)));}for(let z=Math.ceil(b[1]/step)*step;z<b[1]+b[3];z+=step)out.append(el('line',{x1:b[0],y1:z,x2:b[0]+b[2],y2:z,stroke:'#b3bdac','stroke-width':scale,opacity:.24}));}
  const visible=p=>p.x>=b[0]-60*scale&&p.x<=b[0]+b[2]+60*scale&&p.z>=b[1]-60*scale&&p.z<=b[1]+b[3]+60*scale;
  const zones=(this.layers.zones?this.data.zones:[]).filter(visible),equipment=this.layers.equipment?this.data.equipment:[],pins=this.layers.equipment?this.data.pins:[];
  // Wide hit areas sit below all visible markers so a neighbor's hit area cannot cover a marker.
  const hit=(p,kind,id)=>out.append(el('circle',{cx:p.x,cy:p.z,r:22*scale,fill:'transparent',stroke:'none','pointer-events':'all',[`data-${kind}`]:id,'aria-hidden':'true'}));
  for(const z of zones)hit(z,'zone',z.id);
  if(this.layers.poi)for(const p of (reserve.poi||[]).filter(p=>visible(p)&&(this.poiFilter==='all'||this.poiFilter===p.kind)))hit(p,'poi',p.id);
  for(const p of [...equipment,...pins].filter(visible))hit(p,'pin',p.id);
  const stops=route.map(id=>this.data.zones.find(z=>z.id===id)).filter(Boolean);if(stops.length>1)out.append(el('polyline',{points:stops.map(z=>`${z.x},${z.z}`).join(' '),fill:'none',stroke:'#f3c563','stroke-width':3*scale,'stroke-dasharray':`${8*scale} ${6*scale}`,'pointer-events':'none'}));
  const labelBoxes=[];const label=(x,z,text,priority=false,color='#fff4db')=>{const area=[x+12*scale,z-12*scale,x+(15+text.length*6.8)*scale,z+6*scale];if(!priority&&labelBoxes.some(a=>area[0]<a[2]&&area[2]>a[0]&&area[1]<a[3]&&area[3]>a[1]))return null;labelBoxes.push(area);return el('text',{x:x+12*scale,y:z+4*scale,fill:color,'font-size':11*scale,'paint-order':'stroke',stroke:'#142017','stroke-width':3*scale,'pointer-events':'none'},text);};
  const same=new Map();for(const z of zones){const key=z.x+':'+z.z;if(!same.has(key))same.set(key,[]);same.get(key).push(z.id);}for(const z of [...zones].sort((a,c)=>Number(c.id===this.data.selectedZone)-Number(a.id===this.data.selectedZone))){const peers=same.get(z.x+':'+z.z),angle=peers.indexOf(z.id)/peers.length*Math.PI*2,dx=peers.length>1?Math.cos(angle)*10*scale:0,dz=peers.length>1?Math.sin(angle)*10*scale:0,x=z.x+dx,y=z.z+dz;
   const g=el('g',{'data-zone':z.id,'data-world-x':z.x,'data-world-z':z.z,tabindex:0,role:'button','aria-label':`${z.species}, ${z.need}, X ${Math.round(z.x)}, Z ${Math.round(z.z)}`});if(peers.length>1)g.append(el('line',{x1:z.x,y1:z.z,x2:x,y2:y,stroke:'#fff','stroke-width':scale,opacity:.65}));g.append(el('circle',{cx:x,cy:y,r:7*scale,fill:needColors[z.need]||'#e4ad50',stroke:'#112018','stroke-width':1.5*scale}));g.append(el('title',{},`${z.species} · ${z.need} · X ${Math.round(z.x)}, Z ${Math.round(z.z)}`));if(b[2]<3500){const t=label(x,y,z.species,z.id===this.data.selectedZone,isGreatOneSpecies(z.species,z.speciesKey)?'#f0c76d':'#fff4db');if(t)g.append(t);}g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();this.onSelect(z.id);}});out.append(g);
  }
  if(this.layers.poi)for(const p of (reserve.poi||[]).filter(p=>visible(p)&&(this.poiFilter==='all'||this.poiFilter===p.kind))){const g=el('g',{'data-poi':p.id,'data-world-x':p.x,'data-world-z':p.z,tabindex:0,role:'button','aria-label':`${poiKinds[p.kind]||'Reference point'}: ${p.label}`});const fill=p.kind==='outpost'?'#e5b459':p.kind==='lookout_point'?'#deebc2':'#cfc5ab';g.append(el('rect',{x:p.x-8*scale,y:p.z-8*scale,width:16*scale,height:16*scale,rx:2*scale,fill,stroke:'#283126','stroke-width':1.5*scale}));g.append(el('text',{x:p.x,y:p.z+4*scale,'text-anchor':'middle',fill:'#182519','font-size':11*scale,'font-weight':'bold','pointer-events':'none'},p.kind==='outpost'?'⌂':p.kind==='lookout_point'?'△':p.kind==='landmark'?'◆':'H'));g.append(el('title',{},`${p.label} · ${poiKinds[p.kind]||p.kind} · reference, not unlock status`));if(b[2]<4200){const t=label(p.x,p.z,p.label);if(t)g.append(t);}g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();this.point=[p.x,p.z];this.onPoint(this.point,p);this.draw();}});out.append(g);}
  for(const p of [...equipment,...pins].filter(visible)){const g=el('g',{'data-pin':p.id,'data-world-x':p.x,'data-world-z':p.z,tabindex:0,role:'button','aria-label':`${p.label||p.kind} X ${Math.round(p.x)} Z ${Math.round(p.z)}`});g.append(el('path',{d:`M${p.x},${p.z-8*scale}l${8*scale},${8*scale}l${-8*scale},${8*scale}l${-8*scale},${-8*scale}Z`,fill:p.source==='save'?'#f5eee0':'#c4d57a',stroke:'#283126','stroke-width':1.5*scale}));g.append(el('title',{},p.label||p.kind));g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();this.onPoint([p.x,p.z],p);}});out.append(g);}
  if(this.point){const [x,z]=this.point;out.append(el('circle',{cx:x,cy:z,r:13*scale,fill:'none',stroke:'#fff','stroke-width':2*scale,'pointer-events':'none'}));out.append(el('path',{d:`M${x-18*scale},${z}h${36*scale} M${x},${z-18*scale}v${36*scale}`,stroke:'#fff','stroke-width':scale,'pointer-events':'none'}));}
  const bar=scaleBar(b,screen);if(bar){out.append(el('line',{x1:b[0]+22*scale,y1:b[1]+b[3]-24*scale,x2:b[0]+22*scale+bar.length,y2:b[1]+b[3]-24*scale,stroke:'#fff','stroke-width':3*scale,'pointer-events':'none'}));out.append(el('text',{x:b[0]+22*scale,y:b[1]+b[3]-34*scale,fill:'#fff','font-size':11*scale,'paint-order':'stroke',stroke:'#172219','stroke-width':2*scale},bar.label));}out.append(el('text',{x:b[0]+b[2]-48*scale,y:b[1]+30*scale,fill:'#fff1ca','font-size':15*scale,'paint-order':'stroke',stroke:'#152116','stroke-width':2*scale},'N ↑'));this.select(this.data.selectedZone);
 }
}
