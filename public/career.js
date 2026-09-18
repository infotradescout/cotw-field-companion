import {esc,pretty} from './data-client.js';
import {speciesName} from './species-style.js';

const num=n=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:1}):'Not available';
const date=v=>v?new Date(v).toLocaleString():'Not recorded';

export function statValue(c){
 if(!Number.isFinite(c?.value))return 'Not available';
 if(c.display===1)return num(c.value*100)+'%';
 if(c.display===2)return num(c.value)+' m';
 return num(c.value);
}

function card(label,value,detail=''){
 const tone=/diamond/i.test(label)?' diamond':/gold/i.test(label)?' gold':/great one/i.test(label)?' great-one':'';
 return `<article class="career-metric${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</article>`;
}

export function medalCounts(state){
 const value=key=>{
  const count=state?.career?.counters?.find(c=>c.key===key)?.value;
  return Number.isFinite(count)?count:null;
 };
 return {gold:value('harvests_gold'),diamond:value('harvests_platinum')};
}

function moreCareerDetails({c,s,byKey,mapRows,state}){
 const huntingTotals=`<details class="career-subsection"><summary>Shots, tracking and multiplayer</summary><div class="kv">${[['shots_hit','Shots hit'],['shots_missed','Shots missed'],['animals_spooked_hearing','Animals scared by noise'],['animals_spooked_eyesight','Animals scared by sight'],['animals_spooked_scent','Animals scared by scent'],['mp_competitions','Multiplayer competitions won'],['mp_coop_harvests','Cooperative harvests']].map(([key,label])=>`<span>${label}</span><b>${statValue(byKey[key])}</b>`).join('')}</div></details>`;
 const medals=`<details class="career-subsection"><summary>Medals and other totals</summary><div class="kv">${['harvests_greatone','harvests_platinum','harvests_gold','harvests_silver','harvests_bronze','harvests_copper'].map(k=>`<span>${k==='harvests_copper'?'Other harvests':speciesName(byKey[k]?.label||pretty(k))}</span><b>${statValue(byKey[k])}</b>`).join('')}<span>Animals scared away</span><b>${num(s.spooked)}</b><span>Times your hunter died</span><b>${num(s.deaths)}</b></div></details>`;
 const reserves=`<details class="career-subsection all-reserve-career"><summary>Progress across ${c.allMaps.length} reserves</summary><div class="table-wrap"><table><thead><tr><th>Reserve</th><th>Explored</th><th>Distance</th><th>Main / side missions</th><th>Outposts</th><th>Zones</th><th>Equipment</th></tr></thead><tbody>${mapRows}</tbody></table></div><p class="small muted">The game does not provide separate lifetime shots, kills, or harvest totals for each reserve.</p></details>`;
 const reconciliation=`<details class="career-subsection"><summary>Why some totals are different</summary><h2>Harvested and uncollected animals</h2><div class="career-comparison">${card('Career harvests',num(s.lifetimeHarvests),'Animals you collected')}${card('Still uncollected',num(c.unharvested),'From the last game save')}${card('All-time kills','Not available','The game does not provide a confirmed total')}</div><p>The harvest list covers the animals this companion has seen in your saves. It may be shorter than your whole career.</p><h2>Your shots</h2><div class="kv"><span>Hits</span><b>${num(s.hits)}</b><span>Misses</span><b>${num(s.misses)}</b><span>Shots used for accuracy</span><b>${num(c.shotReconciliation.accuracyDenominator)}</b><span>Harvests in this companion</span><b>${num(c.retainedHarvests)}</b></div>${c.shotReconciliation.consistent===false?'<p class="callout warning">The game saved different shot totals for accuracy and for hits plus misses. Both are shown as saved.</p>':''}<p class="small muted">Game stats can update at different times.</p></details>`;
 const technical=`<details class="career-subsection"><summary>Technical details and recent changes</summary><p>${esc(c.killCoverage)} Missing animals are not counted as confirmed kills. The uncollected count is not added to career harvests.</p><p>Uncollected count saved ${esc(date(c.unharvestedSavedAt))}.</p><div class="table-wrap"><table><thead><tr><th>Game stat</th><th>Value</th><th>Source</th></tr></thead><tbody>${c.counters.map(v=>`<tr><td>${speciesName(v.label)}<small class="muted code">${esc(v.key)}</small></td><td>${statValue(v)}</td><td>${v.computed?'Calculated from saved stats':'Saved by the game'}</td></tr>`).join('')}</tbody></table></div><p class="small muted">${c.coverage.conflicts.length} conflicting identifiers withheld. Repeated records are not added together.</p>${(state.careerChanges||[]).slice(0,8).map(e=>`<p class="small">${esc(date(e.at))} · ${esc(e.kind||'Stat change')} ${e.changed?e.changed.length+' stats changed':''}${e.resetPossible?' · possible reset or restore':''}</p>`).join('')}<p class="small muted">Career saved ${esc(date(c.savedAt))}. Profile and world stats may have different save times. Source: ${esc(c.coverage.source)}.</p></details>`;
 return `<details class="panel career-more"><summary>More career details</summary><div class="career-more-content">${huntingTotals}${medals}${reserves}${reconciliation}${technical}</div></details>`;
}

export function careerView(state){
 const c=state?.career;
 if(!c||c.status==='not_available')return `<div class="intro"><div><h1>Your career</h1></div></div><section class="panel"><h2>${state?.publicMode?'Connect your game to see your career':'Waiting for your game'}</h2><p>${state?.publicMode?'The Windows companion reads your game saves. Guides and trophy studio are available without connecting your game.':'Play and save your game. Career totals appear when the companion can read them.'}</p><a class="button primary" href="https://github.com/infotradescout/cotw-field-companion#run-the-local-companion" target="_blank" rel="noopener">Get the Windows companion</a></section>`;
 const s=c.summary,profile=c.profile||{},byKey=Object.fromEntries(c.counters.map(r=>[r.key,r])),medals=medalCounts(state);
 const mapRows=c.allMaps.map(r=>{
  const v=suffix=>r.stats.find(s=>s.key.endsWith('_'+suffix));
  return `<tr><td><button class="button text-button" data-career-reserve="${r.id}">${esc(r.name)}</button><span class="small muted">${r.available?'Save found':'No save found'}</span></td><td>${statValue(v('world_explored'))}</td><td>${statValue(v('distance_walked'))}</td><td>${statValue(v('missions_main'))} / ${statValue(v('missions_side'))}</td><td>${statValue(v('outposts'))}</td><td>${num(r.zoneCount)}</td><td>${num(r.equipmentCount)}</td></tr>`;
 }).join('');
 const demoBanner=state?.demo?'<div class="callout demo-callout"><strong>Fictional sample data.</strong> This public page is a safe preview. It never reads or publishes a player save.</div>':'';
 return `<div class="intro"><div><h1>${state?.demo?'Sample career':'Your career'}</h1></div><button class="button primary" data-action="view-studio">Make a career card</button></div>
 ${demoBanner}
 ${c.sourceStatus!=='ok'?'<div class="callout warning">The latest update is unavailable. These are your last saved totals.</div>':''}
 <div class="career-grid">${card('Animals harvested',num(s.lifetimeHarvests))}${card('Gold',num(medals.gold))}${card('Diamond',num(medals.diamond))}${card('Great Ones',num(s.greatOnes))}${card('Shots fired',num(s.shotsFired))}${card('Accuracy',Number.isFinite(s.accuracy)?num(s.accuracy*100)+'%':'Not available')}${card('Longest shot',Number.isFinite(s.longestShot)?num(s.longestShot)+' m':'Not available')}</div>
 <section class="panel"><h2>Weapon stats</h2><div class="weapon-stats">${['rifles','handguns','shotguns','bows'].map(k=>`<article><h3>${pretty(k)}</h3><strong>${statValue(byKey['accuracy_'+k])}</strong><span class="muted">Accuracy</span><div class="kv"><span>Saved accuracy samples</span><b>${num(byKey['accuracy_'+k]?.accuracySamples)}</b><span>Perk points spent</span><b>${statValue(byKey['perks_'+k])}</b></div></article>`).join('')}</div><p class="small muted career-note">Category totals from the save reader. Individual gun stats are not available in this save.</p></section>
 <section class="panel"><h2>Your hunter</h2><div class="kv"><span>Level</span><b>${num(profile.level)}</b><span>XP</span><b>${num(profile.xp)}</b><span>Game cash</span><b>${num(profile.cash)}</b><span>Stalker points spent</span><b>${statValue(byKey.skills_active)}</b><span>Ambusher points spent</span><b>${statValue(byKey.skills_passive)}</b><span>Unspent skill points</span><b>${num(profile.skillPoints)}</b><span>Unspent perk points</span><b>${num(profile.perkPoints)}</b></div></section>
 ${moreCareerDetails({c,s,byKey,mapRows,state})}`;
}
