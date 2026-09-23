/** Per-user installation, from a signed complete package. Existing journals and game files stay put. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {acquireLock,installSeed,atomicJson,plainPath,inside,verifyDirectory,signedManifest,loadState} from './engine.mjs';
import {launchContext} from './context.mjs';
export const kernelFiles=['engine.mjs','context.mjs','boot.mjs','trust.json'];
export function install({source,home,context,trust,desktop=false}={}){
 source=plainPath(source);home=plainPath(home);
 if(inside(source,home)||inside(home,source)||inside(home,context.dataDir)||inside(context.dataDir,home)||context.saveDir&&(inside(home,context.saveDir)||inside(context.saveDir,home)))throw Error('Install, source, journal and game-save directories must not overlap.');
 const envelope=JSON.parse(fs.readFileSync(path.join(source,'SIGNED-RELEASE.json'),'utf8')),m=signedManifest(envelope,trust);verifyDirectory(source,m);
 const unlock=acquireLock(home);let result;
 try{
  const oldConfig=path.join(home,'config.json');
  if(fs.existsSync(oldConfig)){
   const prior=JSON.parse(fs.readFileSync(oldConfig,'utf8'));
   if(path.resolve(prior.dataDir)!==path.resolve(context.dataDir)||(prior.saveDir||null)!==(context.saveDir||null)||prior.port!==context.port)throw Error('This installation already uses another journal or game profile. Its configuration was not replaced.');
   const installedTrust=JSON.parse(fs.readFileSync(path.join(home,'kernel/trust.json'),'utf8'));
   if(JSON.stringify(installedTrust)!==JSON.stringify(trust))throw Error('The existing installation uses a different trust policy. It was not replaced.');
  }
  result=installSeed(home,source,envelope,trust);
  // Kernel is immutable after initial bootstrap; signed versioned supervisors carry future updates.
  const kernel=path.join(home,'kernel');fs.mkdirSync(kernel,{recursive:true});
  for(const name of kernelFiles){const target=path.join(kernel,name);plainPath(target);const bytes=fs.readFileSync(path.join(source,'updates',name));if(fs.existsSync(target)){if(!fs.readFileSync(target).equals(bytes)&&!fs.existsSync(oldConfig))throw Error('Interrupted installer kernel differs from the signed seed');}else fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});}
  const runtime=path.join(home,'runtime');fs.mkdirSync(runtime,{recursive:true});
  for(const name of ['node.exe','LICENSE']){const target=plainPath(path.join(runtime,name));if(!fs.existsSync(target))fs.copyFileSync(path.join(source,'runtime',name),target,fs.constants.COPYFILE_EXCL);}
  const config={schema:'grindzone.install-config.v1',dataDir:path.resolve(context.dataDir),saveDir:context.saveDir||null,port:context.port};
  if(!fs.existsSync(oldConfig))atomicJson(oldConfig,config);
  const start='@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0kernel\\boot.mjs"\r\nif errorlevel 1 pause\r\n';
  if(!fs.existsSync(path.join(home,'START.cmd')))fs.writeFileSync(path.join(home,'START.cmd'),start,{flag:'wx'});
 }finally{unlock();}
 let shortcut=false;
 if(desktop&&process.platform==='win32'){
  // Only shortcut creation; no policy bypass, elevated privileges, registry or startup task.
  const ps=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'GrindZone.lnk')); $l.TargetPath=Join-Path $env:GZ_INSTALL_HOME 'START.cmd'; $l.WorkingDirectory=$env:GZ_INSTALL_HOME; $l.Save()"],{env:{...process.env,GZ_INSTALL_HOME:home},encoding:'utf8',timeout:15000,windowsHide:true});shortcut=ps.status===0;
 }
 return {...result,home,shortcut,revision:loadState(home).current};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('This installer requires Windows x64.');
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'GrindZone'),trust=JSON.parse(fs.readFileSync(path.join(source,'updates/trust.json'),'utf8'));
  const result=install({source,home,context:launchContext(),trust,desktop:true});console.log('GrindZone is installed. Use the GrindZone desktop shortcut; future updates download automatically and activate on the next launch.');if(!result.shortcut)console.log('Start GrindZone from '+path.join(home,'START.cmd'));
  if(process.argv.includes('--open')){const child=spawn(path.join(home,'runtime/node.exe'),[path.join(home,'kernel/boot.mjs')],{detached:true,stdio:'ignore',windowsHide:false});child.unref();}
 }catch(e){console.error('GrindZone installation: '+e.message);process.exitCode=1;}
}
