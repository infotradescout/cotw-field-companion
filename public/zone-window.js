export const ZONE_PAGE_SIZE=60;

export function visibleZonePage(zones,{page=0,selectedId=null}={}){
 const pageCount=Math.max(1,Math.ceil(zones.length/ZONE_PAGE_SIZE));
 const currentPage=Math.max(0,Math.min(pageCount-1,Math.floor(page)||0));
 const from=currentPage*ZONE_PAGE_SIZE,to=Math.min(zones.length,from+ZONE_PAGE_SIZE);
 const visible=zones.slice(from,to);
 const selected=selectedId==null?null:zones.find(zone=>zone.id===selectedId);
 const pinned=!!selected&&!visible.some(zone=>zone.id===selectedId);
 if(pinned)visible.unshift(selected);
 return {zones:visible,total:zones.length,shown:visible.length,from,to,page:currentPage,pageCount,hasPrevious:currentPage>0,hasNext:currentPage<pageCount-1,pinnedId:pinned?selectedId:null};
}
