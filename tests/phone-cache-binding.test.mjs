import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {bindPhoneCacheClient} from '../cloud/phone-cache-client.mjs';
import {mountClientSource} from '../cloud/mount.mjs';
const original=()=>readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('hosted cache hooks bind the actual canonical app and retain its original write guard',()=>{
 const input=original(),output=bindPhoneCacheClient(input);
 assert.notEqual(output,input);assert.equal((output.match(/new PhoneSnapshotCache\(/g)||[]).length,1);
 assert.match(output,/if\(!connectionReady\)throw Object\.assign\(Error\('Reconnect to your PC before saving\.'/);
 assert.match(output,/connectionState\(!phoneCache.readOnly\)/);
 assert.match(output,/phoneCache\.updateStatus\(badge\)/);
 assert.match(output,/phoneCache\.settings\(\)/);
 assert.match(output,/e\.cacheDenied\|\|state&&state\.selectedReserve!==requestedReserve/);
 const mounted=mountClientSource(output,'/grindzone');
 const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:mounted,encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr);
 assert.equal(original(),input);
});
test('client binding fails closed on missing, duplicated or already applied hooks',()=>{
 const input=original();assert.throws(()=>bindPhoneCacheClient(bindPhoneCacheClient(input)));
 assert.throws(()=>bindPhoneCacheClient(input.replace('async function get(url){','async function movedGet(url){')));
 assert.throws(()=>bindPhoneCacheClient(input+"\nfunction warning(){const failed=0;}"));
});
