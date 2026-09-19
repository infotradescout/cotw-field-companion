import test from 'node:test';
import assert from 'node:assert/strict';
const previous=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {grindTotal,selectedGrind,grindsView}=await import('../public/grinds.js');
if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
test('target counts use retained summaries and preserve unknown versus zero',()=>{
 assert.equal(grindTotal({targetSpecies:'Moose'}),null);
 assert.equal(grindTotal({targetSpecies:'Moose',harvestSummary:{total:702,targetTotal:650}}),650);
 assert.equal(grindTotal({targetSpecies:'Moose',harvestSummary:{total:702,bySpecies:[]}}),0);
});
test('current and selected finished grinds remain distinct and goal completion does not imply finished',()=>{
 const old={id:'old',name:'Old',endedAt:'2026-09-01'},active={id:'current',name:'Current',targetSpecies:'Moose',goal:10,endedAt:null,harvestSummary:{total:25,targetTotal:12}};
 const state={sessions:[old,active],reserves:[],harvests:[{species:'Must not leak to this grind'}]};
 assert.equal(selectedGrind(state).id,'current');assert.equal(selectedGrind(state,'old').id,'old');
 const html=grindsView(state);assert.match(html,/Pause grind/);assert.match(html,/Goal reached/);assert.doesNotMatch(html,/Must not leak/);
 active.name='<img onerror=x>';assert.doesNotMatch(grindsView(state),/<img/);
});
