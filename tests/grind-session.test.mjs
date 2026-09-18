import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionHarvestSummary} from '../lib/career.mjs';
import {projectPhoneState} from '../lib/phone-bridge.mjs';

test('finished grind totals retain more than 500 receipts when the browser window moves',()=>{
 const session={id:'sample-session',startedAt:new Date(1000000).toISOString(),endedAt:new Date(2000000).toISOString()};
 const receipts=Array.from({length:650},(_,i)=>({timestamp:1001+i,species:i%2?'Moose':'Whitetail Deer'}));
 const later=Array.from({length:600},(_,i)=>({timestamp:3000+i,species:'Gray Wolf'}));
 const summary=sessionHarvestSummary(session,[...later,...receipts]);
 assert.equal(summary.total,650);assert.deepEqual(summary.bySpecies,[{species:'Whitetail Deer',count:325},{species:'Moose',count:325}]);
 const phone=projectPhoneState({sessions:[{...session,harvestSummary:summary}],harvests:later.slice(0,500)});
 assert.deepEqual(phone.sessions[0].harvestSummary,summary);assert.equal(phone.harvests.length,500);
});

test('invalid windows remain unavailable; real zero and boundaries are preserved',()=>{
 assert.equal(sessionHarvestSummary({startedAt:'invalid'},[]),null);
 const session={startedAt:new Date(1000000).toISOString(),endedAt:new Date(2000000).toISOString()};
 assert.equal(sessionHarvestSummary(session,[]).total,0);
 assert.equal(sessionHarvestSummary(session,[{timestamp:999,species:'Moose'},{timestamp:1000,species:'Moose'},{timestamp:2000,species:'Moose'},{timestamp:2001,species:'Moose'}]).total,2);
});
