import test from 'node:test';
import assert from 'node:assert/strict';
import {selectHarvests,harvestView,harvestFeed} from '../public/harvest-view.js';

const now=new Date(2026,8,18,15).getTime();
const row=(id,days=0,species='Whitetail Deer',score=214.96)=>({id,species,score,timestamp:new Date(2026,8,18-days,12).getTime()/1000});
test('animal and local calendar filters select real records without changing lifetime totals or source order',()=>{
  const rows=[row('old',8),row('yesterday',1,'Gray Wolf'),row('today',0),row('edge',6)];
  assert.deepEqual(selectHarvests(rows,{query:'  DEER ',range:'week',now}).groups.flatMap(g=>g.harvests.map(h=>h.id)),['today','edge']);
  assert.deepEqual(selectHarvests(rows,{range:'today',now}).groups[0].harvests.map(h=>h.id),['today']);
  assert.equal(selectHarvests(rows,{now}).groups[1].label,'Yesterday');
  assert.deepEqual(rows.map(h=>h.id),['old','yesterday','today','edge']);
});
test('bounded feed retains complete match count and expands without duplicated records',()=>{
  const rows=Array.from({length:66},(_,i)=>row(String(i)));
  const selected=selectHarvests(rows,{now,limit:50});assert.equal(selected.total,66);assert.equal(selected.shown,50);
  const expanded=selectHarvests(rows,{now,limit:100});assert.equal(expanded.shown,66);assert.equal(new Set(expanded.groups.flatMap(g=>g.harvests.map(h=>h.id))).size,66);
  const feed=harvestFeed({harvests:rows},{now,limit:50});assert.equal(feed.count,'50 of 66 harvests');assert.equal(feed.more,true);
  assert.match(feed.html,/50 of 66 harvests<\/span>/);
});
test('view distinguishes missing scores and medals from zero and escapes saved names and queries',()=>{
  const state={harvestCount:3,harvests:[row('zero',0,'Whitetail Deer',0),row('none',0,'Wood Bison',null),row('unsafe',0,'<script>bad</script>')],encounters:[]};
  const html=harvestView(state,{now,query:''});
  assert.match(html,/great-one-name/);assert.match(html,/>0\.00<\/strong>/);assert.match(html,/>—<\/strong>/);assert.match(html,/aria-label="Not available"/);
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/Lifetime Gold/);assert.match(html,/Lifetime Diamond/);
  assert.ok(!harvestView(state,{query:'" onfocus="bad'}).includes('value="" onfocus='));
  assert.match(harvestView(state,{}, {gold:0,diamond:7}),/<strong>0<\/strong><span class="harvest-total-label">Lifetime Gold/);
});

test('a newly saved harvest does not push the current reading anchor out of the loaded page',()=>{
  const rows=Array.from({length:66},(_,i)=>({...row(String(i)),timestamp:now/1000-i*60}));
  const anchor=selectHarvests(rows,{now}).groups.flatMap(g=>g.harvests).at(-1).id;
  const updated=[{...row('arrival'),timestamp:now/1000+1},...rows];
  const selected=selectHarvests(updated,{now:now+2000,keepVisibleId:anchor});
  assert.equal(selected.shown,51);assert.ok(selected.groups.flatMap(g=>g.harvests).some(h=>h.id===anchor));
});
