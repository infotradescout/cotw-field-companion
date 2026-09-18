import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildPortable} from '../tools/build-portable.mjs';

const source=fileURLToPath(new URL('../',import.meta.url));
test('public build has identical bytes and verified hashes from LF and CRLF source checkouts',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'cotw-web-build-'));
 try{
  const builds=[];
  for(const style of ['lf','crlf']){
   const checkout=path.join(root,style),receipt=buildPortable(source,checkout);
   for(const item of receipt.files){
    const file=path.join(checkout,item.path),lf=readFileSync(file,'utf8').replace(/\r\n/g,'\n');
    writeFileSync(file,style==='crlf'?lf.replace(/\n/g,'\r\n'):lf);
   }
   mkdirSync(path.join(checkout,'tools'));
   copyFileSync(path.join(source,'tools/build-web.mjs'),path.join(checkout,'tools/build-web.mjs'));
   execFileSync(process.execPath,[path.join(checkout,'tools/build-web.mjs')],{timeout:10000,stdio:'pipe'});
   const manifest=JSON.parse(readFileSync(path.join(checkout,'docs/build.json'),'utf8'));
   for(const item of manifest.files){
    const bytes=readFileSync(path.join(checkout,'docs',item.path));
    assert.equal(bytes.length,item.bytes,item.path+' byte count');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path+' hash');
   }
   builds.push({checkout,manifest});
  }
  assert.equal(builds[0].manifest.buildTag,builds[1].manifest.buildTag,'line endings must not change the public cache identity');
  assert.deepEqual(builds[0].manifest,builds[1].manifest);
  for(const item of builds[0].manifest.files)assert.deepEqual(readFileSync(path.join(builds[0].checkout,'docs',item.path)),readFileSync(path.join(builds[1].checkout,'docs',item.path)),item.path);
 }finally{
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'cotw-web-build-'));
  rmSync(root,{recursive:true,force:true});
 }
});
