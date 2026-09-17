// Numeric reference helpers. Reference potential is never a harvested medal or a GO detector.
export const MEDALS = ['bronze','silver','gold','diamond'];
export const LEVEL_NAMES = ['', 'Trivial','Minor','Very Easy','Easy','Medium','Hard','Very Hard','Mythical','Legendary'];
export function weight(value, unit='kg') {
  if(!Number.isFinite(value)) return 'Not published';
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value*(unit==='lb'?2.2046226218487757:1))+' '+unit;
}
export function score(value) { return Number.isFinite(value)?new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value):'Not published'; }
export function weightRange(values,unit='kg') { return Array.isArray(values)&&values.length===2?weight(values[0],unit)+' – '+weight(values[1],unit):'Not published'; }
export function ratingBand(species, value) {
  if(!Number.isFinite(value)||value<0) throw Error('Enter a non-negative trophy score.');
  const thresholds=species?.thresholds;
  if(!thresholds||MEDALS.some(m=>!Number.isFinite(thresholds[m])))return {band:null,nearBoundary:false};
  const band=[...MEDALS].reverse().find(m=>value>=thresholds[m])||'below_reference';
  // This is a deliberately conservative display warning, not a rule of the game's scoring system.
  const nearBoundary=MEDALS.slice(1).some(m=>Math.abs(value-thresholds[m])<=0.02);
  return {band,nearBoundary};
}
export function evaluateScore(species,low,high=low) {
  if(!Number.isFinite(low)||!Number.isFinite(high)||low<0||high<low)throw Error('Enter a valid trophy-score range; the high estimate must be at least the low estimate.');
  const lo=ratingBand(species,low),hi=ratingBand(species,high);
  if(lo.band===null)return {bands:[],nearBoundary:false,confirmedMedal:false,greatOne:false};
  const all=['below_reference',...MEDALS],bands=all.slice(all.indexOf(lo.band),all.indexOf(hi.band)+1);
  return {bands,nearBoundary:lo.nearBoundary||hi.nearBoundary,confirmedMedal:false,greatOne:false};
}
export function filterSpecies(catalog,{reserve,all=false,query='',goOnly=false,animalClass='all'}={}) {
  const roster=catalog?.reserves?.find(r=>r.id===Number(reserve))?.species||[];
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return (catalog?.species||[]).filter(s=>(all||roster.includes(s.key))&&(!goOnly||s.greatOne?.eligible===true)&&
    (animalClass==='all'||s.animalClass===Number(animalClass))&&terms.every(t=>(s.name+' '+s.key).toLowerCase().includes(t)))
    .sort((a,b)=>a.animalClass-b.animalClass||a.name.localeCompare(b.name));
}
export function resolveSpecies(catalog,keyOrName) {
  const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const alias={whitetail:'whitetaildeer',pronghorn:'pronghorn',ringneckedpheasant:'pheasant',jackrabbit:'jackrabbit',mountainlion:'puma',brownbear:'eurasianbrownbear'};
  const query=normalize(keyOrName),target=alias[query]||query;
  return catalog?.species?.find(s=>[s.key,s.name,...(s.aliases||[])].some(n=>normalize(n)===target||normalize(n)===query))||null;
}
