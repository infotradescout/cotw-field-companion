const NS='http://www.w3.org/2000/svg';
export const needColors={drinking:'#83bfc9',feeding:'#d9ba76',resting:'#c7afd8'};
function el(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
export class FieldMap {
  constructor(svg,onSelect,onPoint){this.svg=svg;this.onSelect=onSelect;this.onPoint=onPoint;this.box=null;this.reserve=null;this.drag=null;this.point=null;this.setEvents();}
  update({reserve,zones,pins,equipment,terrain,route,selectedZone}) {
    this.data={reserve,zones,pins,equipment,terrain,route,selectedZone};
    if(this.reserve!==reserve.id){this.reserve=reserve.id;this.home();}else this.draw();
  }
  select(id){if(!this.data)return;this.data.selectedZone=id;this.svg.querySelectorAll('[data-zone]').forEach(n=>{n.classList.toggle('active-zone',n.getAttribute('data-zone')===id);});}
  home(){const b=this.data.reserve.bounds??[[0,0],[16384,16384]];const width=b[1][0]-b[0][0],height=b[1][1]-b[0][1];this.box=[b[0][0]-width*.02,b[0][1]-height*.02,width*1.04,height*1.04];this.draw();}
  zoom(factor,point){const b=this.box;const p=point??[b[0]+b[2]/2,b[1]+b[3]/2];const w=Math.max(220,Math.min(32768,b[2]*factor)),f=w/b[2];this.box=[p[0]-(p[0]-b[0])*f,p[1]-(p[1]-b[1])*f,w,b[3]*f];this.draw();}
  focus(x,z){const size=1800;this.box=[x-size/2,z-size/2,size,size];this.point=[x,z];this.draw();}
  toWorld(e){const p=this.svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const n=p.matrixTransform(this.svg.getScreenCTM().inverse());return [n.x,n.y];}
  setEvents(){
    this.svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?1.2:1/1.2,this.toWorld(e));},{passive:false});
    this.svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.drag={screen:[e.clientX,e.clientY],start:this.toWorld(e),box:[...this.box],id:e.target.closest('[data-zone]')?.getAttribute('data-zone'),pin:e.target.closest('[data-pin]')?.getAttribute('data-pin')};this.svg.setPointerCapture(e.pointerId);});
    this.svg.addEventListener('pointermove',e=>{if(!this.drag)return;const [x,z]=this.toWorld(e),d=this.drag;this.box=[this.box[0]+d.start[0]-x,this.box[1]+d.start[1]-z,this.box[2],this.box[3]];this.draw();});
    this.svg.addEventListener('pointerup',e=>{if(!this.drag)return;const d=this.drag;this.drag=null;if(Math.hypot(e.clientX-d.screen[0],e.clientY-d.screen[1])<5){if(d.id)this.onSelect(d.id);else if(d.pin){const p=[...this.data.pins,...this.data.equipment].find(p=>p.id===d.pin);if(p)this.onPoint([p.x,p.z],p);}else{this.point=this.toWorld(e).map(Math.round);this.onPoint(this.point);this.draw();}}});
    this.svg.addEventListener('pointercancel',()=>{this.drag=null;});
  }
  draw(){
    if(!this.data||!this.box)return;const {zones,pins,equipment,reserve,terrain,route}=this.data,b=this.box;
    this.svg.setAttribute('viewBox',b.join(' '));this.svg.replaceChildren();const scale=b[2]/850;
    this.svg.append(el('rect',{x:b[0],y:b[1],width:b[2],height:b[3],fill:'#14241c'}));
    if(terrain&&reserve.mapBounds){
      const level=b[2]<2500?4:3,size=16384/(2**level),origin=reserve.mapBounds[0];
      const x0=Math.max(0,Math.floor((b[0]-origin[0])/size)),x1=Math.min(2**level-1,Math.floor((b[0]+b[2]-origin[0])/size));
      const y0=Math.max(0,Math.floor((b[1]-origin[1])/size)),y1=Math.min(2**level-1,Math.floor((b[1]+b[3]-origin[1])/size));
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)this.svg.append(el('image',{href:`https://mathartbang.com/deca/hp/data/r${reserve.id}/t_topo/${level}/${x}/${y}.png`,x:origin[0]+x*size,y:origin[1]+y*size,width:size,height:size,opacity:.78}));
    }
    const step=b[2]>6000?1000:b[2]>2500?500:200;
    for(let x=Math.ceil(b[0]/step)*step;x<b[0]+b[2];x+=step){this.svg.append(el('line',{x1:x,y1:b[1],x2:x,y2:b[1]+b[3],stroke:'#7f987a','stroke-width':scale,opacity:.18}));this.svg.append(el('text',{x:x+5*scale,y:b[1]+20*scale,fill:'#aec0ab','font-size':11*scale},Math.round(x)));}
    for(let y=Math.ceil(b[1]/step)*step;y<b[1]+b[3];y+=step){this.svg.append(el('line',{x1:b[0],y1:y,x2:b[0]+b[2],y2:y,stroke:'#7f987a','stroke-width':scale,opacity:.18}));this.svg.append(el('text',{x:b[0]+5*scale,y:y-5*scale,fill:'#aec0ab','font-size':11*scale},Math.round(y)));}
    const rs=route.map(id=>zones.find(z=>z.id===id)).filter(Boolean);if(rs.length>1)this.svg.append(el('polyline',{points:rs.map(z=>`${z.x},${z.z}`).join(' '),fill:'none',stroke:'#c4d57a','stroke-width':2*scale,'stroke-dasharray':`${8*scale} ${6*scale}`,opacity:.8}));
    zones.forEach(z=>{const g=el('g',{'data-zone':z.id,tabindex:0,role:'button','aria-label':`${z.species}, ${z.need}, ${z.x}, ${z.z}`});const c=needColors[z.need]||'#c4d57a';g.append(el('circle',{cx:z.x,cy:z.z,r:8*scale,fill:c,stroke:'#0d1810','stroke-width':2*scale}));g.append(el('title',{},`${z.species} · ${z.need} · ${z.start}:00–${z.end}:00`));if(b[2]<3500)g.append(el('text',{x:z.x+12*scale,y:z.z+4*scale,fill:'#fff','font-size':12*scale,'paint-order':'stroke',stroke:'#101710','stroke-width':3*scale},z.species));g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();this.onSelect(z.id);}});this.svg.append(g);});
    [...equipment,...pins].forEach(p=>{const g=el('g',{'data-pin':p.id});g.append(el('rect',{x:p.x-6*scale,y:p.z-6*scale,width:12*scale,height:12*scale,rx:2*scale,fill:p.source==='save'?'#89918a':'#c4d57a',stroke:'#121b12','stroke-width':scale}));g.append(el('title',{},p.label||p.kind));this.svg.append(g);});
    if(this.point){const [x,y]=this.point;this.svg.append(el('path',{d:`M${x-12*scale},${y}h${24*scale} M${x},${y-12*scale}v${24*scale}`,stroke:'#fff','stroke-width':2*scale}));}
    this.select(this.data.selectedZone);
    this.svg.append(el('text',{x:b[0]+b[2]-55*scale,y:b[1]+37*scale,fill:'#c4d57a','font-size':17*scale},'N ↑'));
  }
}
