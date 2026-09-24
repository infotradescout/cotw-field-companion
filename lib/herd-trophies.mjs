/** Read-only score/sex reference. Population potential is not an awarded harvest medal. */
export const HERD_REFERENCE_SCHEMA='grindzone.herd-reference.v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const range=v=>finite(v?.weight_low)&&finite(v?.weight_high)&&v.weight_low<=v.weight_high?[v.weight_low,v.weight_high]:null;
export function deriveHerdReference(details,{sourceCommit,sourceBlob}={}){
 if(!details||typeof details!=='object'||Array.isArray(details)||!Object.keys(details).length)throw Error('Animal reference is unavailable');
 const species={};
 for(const [key,row]of Object.entries(details)){
  if(!/^[a-z][a-z0-9_]{0,119}$/.test(key))throw Error('Invalid species key');
  const threshold=row?.trophy?.diamond?.score_low,maleMax=row?.gender?.male?.score_high,femaleMax=row?.gender?.female?.score_high;
  const valid=finite(threshold)&&threshold>0;
  species[key]={diamondScore:valid?threshold:null,maleDiamondCapable:valid&&finite(maleMax)?maleMax>=threshold:null,femaleDiamondCapable:valid&&finite(femaleMax)?femaleMax>=threshold:null,
   truracs:row?.truracs===true,normalMaleWeight:range(row?.gender?.male),greatOneMaleWeight:range(row?.gender?.great_one_male),greatOneFemaleWeight:range(row?.gender?.great_one_female)};
 }
 return {schema:HERD_REFERENCE_SCHEMA,source:{repository:'RyMaxim/apc',commit:sourceCommit??null,blob:sourceBlob??null,path:'apc/config/animal_details.json',authority:'community_extracted_reference',patchVerified:false},species};
}
export function trophyCounts(animals,rule){
 if(!Array.isArray(animals))throw Error('Animal records required');
 const result={animals:animals.length,males:0,females:0,diamonds:rule&&finite(rule.diamondScore)?0:null,greatOnes:0,greatOneCandidates:0,unknownGreatOne:0,unclassified:0,scripted:0,
  diamondBasis:rule?.truracs?'saved_score_potential_truracs':'saved_score_potential',greatOneBasis:'explicit_saved_flag',femaleDiamondCapable:rule?.femaleDiamondCapable??null};
 for(const a of animals){
  if(a?.sex===1)result.males++;else if(a?.sex===2)result.females++;
  if(a?.scripted===true){result.scripted++;continue;}
  if(a?.greatOne===true&&a?.greatOneEvidence==='explicit_IsGreatOne'){result.greatOnes++;continue;}
  // Legacy flag interpretation and weight ranges remain candidates, not confirmed flags.
  const goRange=a?.sex===1?rule?.greatOneMaleWeight:rule?.greatOneFemaleWeight;
  const candidate=a?.greatOneEvidence!=='explicit_IsGreatOne'&&(a?.flags===1||Array.isArray(goRange)&&finite(a?.weight)&&a.weight>=goRange[0]&&a.weight<=goRange[1]);
  if(candidate){result.greatOneCandidates++;continue;}
  if(a?.greatOneEvidence!=='explicit_IsGreatOne')result.unknownGreatOne++;
  const capable=a?.sex===1?rule?.maleDiamondCapable:a?.sex===2?rule?.femaleDiamondCapable:null;
  if(result.diamonds===null||!finite(a?.score)||capable===null||capable===undefined){result.unclassified++;continue;}
  if(capable===true&&a.score>=rule.diamondScore)result.diamonds++;
 }
 return result;
}
export function findHerdRule(reference,key){
 if(reference?.schema!==HERD_REFERENCE_SCHEMA)return null;
 const alias={whitetail:'whitetail_deer',pheasant:'ring_necked_pheasant'};
 return reference.species?.[key]??reference.species?.[alias[key]]??null;
}

/** Add already classified herds, never a page of animal guesses or awarded medals. */
export const HERD_SUMMARY_FIELDS=['herds','animals','males','females','diamonds','greatOnes','greatOneCandidates','unknownGreatOne','unclassified','unclassifiedHerds','scripted'];
export function summarizeHerdCounts(rows){
 const result=Object.fromEntries(HERD_SUMMARY_FIELDS.map(k=>[k,0]));result.herds=rows.length;
 for(const {counts} of rows){
  for(const key of ['animals','males','females','greatOnes','greatOneCandidates','unknownGreatOne','unclassified','scripted'])result[key]+=counts[key];
  if(counts.diamonds===null)result.unclassifiedHerds++;else result.diamonds+=counts.diamonds;
 }
 if(rows.length&&result.unclassifiedHerds===rows.length)result.diamonds=null;
 return result;
}
/** Aggregate the complete filtered set before pagination; unidentified species stay unidentified. */
export function summarizeHerdSpecies(rows){
 const groups=new Map();
 for(const row of rows){const key=row.speciesKey||row.species;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups].map(([key,herds])=>({key,name:herds[0].species,counts:summarizeHerdCounts(herds),
  femaleDiamondCapable:herds.every(r=>r.counts.femaleDiamondCapable===true)?true:herds.every(r=>r.counts.femaleDiamondCapable===false)?false:null
 })).sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
