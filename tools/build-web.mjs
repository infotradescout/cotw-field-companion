/** Deterministic public projection. Never reads the installed app, saves, or private journal. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=path.join(root,'docs');
const files=['public.js','data-client.js','reference.js','reference-core.js','field-library.js','career.js','studio.js','style.css','field-theme.css','icon.svg'];
const outputs={'index.html':readFileSync(path.join(root,'public/public.html'))};
for(const name of files)outputs[name]=readFileSync(path.join(root,'public',name));
outputs['catalog/reference.json']=readFileSync(path.join(root,'lib/rating-data.json'));
outputs['catalog/gear.json']=readFileSync(path.join(root,'lib/gear-data.json'));
outputs['.nojekyll']=Buffer.from('');
const forbidden=/765611\d{11}|[A-Za-z]:\\Users\\|gh[pousr]_[A-Za-z0-9]{20}|github_pat_|journal\.sqlite|"sourceFolder"\s*:|"HarvestHistory"\s*:|"StatsData"\s*:/;
for(const [name,bytes] of Object.entries(outputs)){if(forbidden.test(bytes.toString()))throw Error('Private content in public projection: '+name);}
if(existsSync(out)){const walk=d=>readdirSync(d).flatMap(n=>{const p=path.join(d,n);if(lstatSync(p).isSymbolicLink())throw Error('No public symlinks');return lstatSync(p).isDirectory()?walk(p):[path.relative(out,p).replaceAll('\\','/')];});for(const n of walk(out))if(!Object.hasOwn(outputs,n)&&n!=='build.json')throw Error('Unreviewed public output: '+n);}
mkdirSync(out,{recursive:true});const manifest=[];
for(const [name,bytes]of Object.entries(outputs)){const p=path.join(out,name);mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,bytes);manifest.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
writeFileSync(path.join(out,'build.json'),JSON.stringify({schema:'field.public_build.v1',version:JSON.parse(readFileSync(path.join(root,'package.json'))).version,mode:'public_no_player_data',files:manifest},null,2)+'\n');
console.log(JSON.stringify({publicFiles:manifest.length,bytes:manifest.reduce((s,f)=>s+f.bytes,0),output:'docs',privateDataIncluded:false}));
