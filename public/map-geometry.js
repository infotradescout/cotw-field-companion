/** Geometry from reserve metadata, in game X/Z coordinates. No geographic projection or Y flip. */
export function validBounds(b){return Array.isArray(b)&&b.length===2&&b.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&b[1][0]>b[0][0]&&b[1][1]>b[0][1];}
export function validBox(b){return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>0&&b[3]>0;}
export function homeBox(reserve){const b=reserve.bounds;if(!validBounds(b))throw Error('Reserve bounds unavailable');const w=b[1][0]-b[0][0],h=b[1][1]-b[0][1];return [b[0][0]-w*.025,b[0][1]-h*.025,w*1.05,h*1.05];}
export function insideBounds(bounds,x,z){return validBounds(bounds)&&Number.isFinite(x)&&Number.isFinite(z)&&x>=bounds[0][0]&&x<=bounds[1][0]&&z>=bounds[0][1]&&z<=bounds[1][1];}
export function tileUrl(reserve,zoom,x,y){
 if(!Number.isInteger(reserve.id)||reserve.id<0||reserve.id>999)throw Error('Invalid reserve ID');
 const max=Number.isInteger(reserve.maxZoom)?Math.min(5,reserve.maxZoom):5;
 if(![zoom,x,y].every(Number.isInteger)||zoom<0||zoom>max||x<0||y<0||x>=2**zoom||y>=2**zoom)throw Error('Invalid tile address');
 return `https://mathartbang.com/deca/hp/data/r${reserve.id}/t_topo/${zoom}/${x}/${y}.png`;
}
export function tilePlan(reserve,box,screenWidth=850,maxTiles=64){
 if(!validBounds(reserve.mapBounds)||!validBox(box))return [];
 const bounds=reserve.mapBounds,[min,max]=bounds,W=max[0]-min[0],H=max[1]-min[1];
 const pixels=Number.isFinite(screenWidth)?Math.max(256,Math.min(2400,screenWidth)):850;
 let zoom=Math.max(0,Math.min(reserve.maxZoom??5,5,Math.ceil(Math.log2(W/box[2]*pixels/256))));
 function at(z){const count=2**z,w=W/count,h=H/count;
  const x0=Math.max(0,Math.floor((box[0]-min[0])/w)),x1=Math.min(count-1,Math.ceil((box[0]+box[2]-min[0])/w)-1);
  const y0=Math.max(0,Math.floor((box[1]-min[1])/h)),y1=Math.min(count-1,Math.ceil((box[1]+box[3]-min[1])/h)-1);
  const out=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push({key:`${z}/${x}/${y}`,url:tileUrl(reserve,z,x,y),zoom:z,col:x,row:y,x:min[0]+x*w,z:min[1]+y*h,width:w,height:h});return out;
 }
 let plan=at(zoom);while(plan.length>maxTiles&&zoom>0)plan=at(--zoom);return plan;
}
export function formatDistance(m){return m>=1000?(m/1000).toLocaleString(undefined,{maximumFractionDigits:2})+' km':Math.round(m).toLocaleString()+' m';}
export function scaleBar(box,pixels){if(!validBox(box)||!Number.isFinite(pixels)||pixels<=0)return null;const raw=box[2]/pixels*110,pow=10**Math.floor(Math.log10(raw));const length=[1,2,5,10].map(n=>n*pow).filter(n=>n<=raw).at(-1)||pow;return {length,pixels:length/box[2]*pixels,label:formatDistance(length)};}
