/** Build-only native WebView2 window. No installer or owner data is accessed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const desktopFiles=Object.freeze([
 'GrindZone.Desktop.exe','GrindZone.Desktop.exe.config',
 'Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll',
 'Microsoft.Web.WebView2.Wpf.dll','WebView2Loader.dll',
]);

export function buildDesktopWindow({sourceRoot,dotnet=process.env.GRINDZONE_DOTNET||'dotnet',exec=execFileSync}={}){
 const root=path.resolve(sourceRoot),project=path.join(root,'desktop','GrindZone.Desktop.csproj');
 if(!fs.statSync(project).isFile()||!fs.statSync(path.join(root,'desktop','packages.lock.json')).isFile())throw Error('Locked desktop source is missing');
 const environment={...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false'};
 const version=exec(dotnet,['--version'],{cwd:path.join(root,'desktop'),env:environment,encoding:'utf8',windowsHide:true}).trim();
 if(version!=='8.0.425')throw Error('GrindZone desktop build requires pinned .NET SDK 8.0.425');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'grindzone-desktop-build-'));
 try{
  exec(dotnet,['publish',project,'--configuration','Release','--runtime','win-x64','--output',work,'--nologo','-v','quiet','-p:RestoreLockedMode=true'],
   {cwd:path.join(root,'desktop'),env:environment,encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
  return desktopFiles.map(name=>{
   const full=path.join(work,name),stat=fs.lstatSync(full);
   if(!stat.isFile()||stat.size<1||stat.size>10*1024*1024)throw Error('Invalid desktop build member: '+name);
   const bytes=fs.readFileSync(full);
   if(/\.(exe|dll)$/i.test(name)&&bytes.toString('ascii',0,2)!=='MZ')throw Error('Desktop build member is not a Windows binary: '+name);
   return {path:'desktop/'+name,bytes};
  });
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}
