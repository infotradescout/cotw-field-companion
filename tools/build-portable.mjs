/** Private release staging from reviewed source only; never inspect the installed app or player data. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const portableFiles = Object.freeze([
  'package.json', 'START.cmd', 'launcher.mjs', 'server.mjs', 'README.md',
  'licenses/APC-MIT.txt', 'licenses/qrcode-generator-MIT.txt',
  ...['career.mjs','core.mjs','decoder.mjs','gear-data.json','hunting-pressure.mjs','maps-data.json','observer.mjs','phone-access.mjs','phone-bridge.mjs','phone-service.json','rating-data.json','reference.json','stat-definitions.json','store.mjs'].map(name => `lib/${name}`),
  ...['app.js','dashboard.js','commands.js','route-stops.js','harvest-view.js','phone-ui.js','phone.css','qrcode.js','species-style.js','career.js','data-client.js','feedback.js','field-library.js','field-theme.css','hunting-workspace.css','icon.svg','index.html','map-atlas.js','map-geometry.js','map.js','maps.css','public.html','public.js','reference-core.js','reference.js','studio.js','style.css','terrain-layer.js'].map(name => `public/${name}`),
]);
const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildPortable(root, destination) {
  const source = realpathSync(root), output = path.resolve(destination);
  if (existsSync(output)) throw Error('Portable destination already exists; use a new release directory.');
  const prepared = portableFiles.map(name => {
    const full = path.join(source, name);
    let part = source;
    for (const segment of name.split('/')) {
      part = path.join(part, segment);
      if (lstatSync(part).isSymbolicLink()) throw Error(`Portable source cannot follow a symlink: ${name}`);
    }
    if (!lstatSync(full).isFile()) throw Error(`Portable source must be a regular file: ${name}`);
    const bytes = readFileSync(full);
    return { name, full, bytes, sha256: hash(bytes) };
  });
  const version = JSON.parse(prepared.find(item => item.name === 'package.json').bytes).version;
  // Snapshot all reviewed input before creating output. Publication is a separate action.
  mkdirSync(output, { recursive: false });
  for (const item of prepared) {
    const target = path.join(output, item.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, item.bytes, { flag: 'wx' });
  }
  const receipt = {
    schema: 'field.portable-package.v1', version,
    productName: 'COTW Companion', finalNamePending: true,
    distribution: 'private-staged-local-preview', targetHub: 'Skill Gaming World',
    platform: 'Windows', requires: 'Node.js 22.13 or newer', entrypoint: 'START.cmd',
    price: 0, paymentRequired: false, donationUrl: null,
    onlineTerrain: 'Optional map imagery is streamed from DECA; images are not bundled.',
    playerDataIncluded: false, published: false,
    files: prepared.map(item => ({ path: item.name, bytes: item.bytes.length, sha256: item.sha256 })),
  };
  writeFileSync(path.join(output, 'PORTABLE-PACKAGE.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('Provide a new output directory: node tools/build-portable.mjs <directory>');
  const receipt = buildPortable(sourceRoot, process.argv[2]);
  console.log(JSON.stringify({ output: path.resolve(process.argv[2]), files: receipt.files.length, bytes: receipt.files.reduce((sum, item) => sum + item.bytes, 0), published: false }));
}
