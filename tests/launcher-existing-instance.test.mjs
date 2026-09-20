/** Runs the actual launcher against disposable loopback responses, never a real game save. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../launcher.mjs', import.meta.url));

async function fixture(t, name, { otherSource = false, customData = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'grindzone-launch-regression-'));
  const save = path.join(root, 'synthetic-save');
  const appData = path.join(root, 'app-data');
  await mkdir(save);
  await mkdir(appData);
  const marker = path.join(save, 'test-sentinel.txt');
  await writeFile(marker, 'Synthetic fixture, not a game save.');
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      app: name === null ? {} : { name },
      observer: { sourceFolder: otherSource ? path.join(root, 'another-player') : save },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true });
  });
  const env = {
    PATH: process.env.PATH || '',
    HOME: root,
    LOCALAPPDATA: appData,
    COTW_SAVE_DIR: save,
    COMPANION_PORT: String(server.address().port),
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(customData ? { COMPANION_DATA_DIR: path.join(root, 'explicit-journal') } : {}),
  };
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`Launcher terminated with ${signal}`));
      else resolve({ code, stdout, stderr });
    });
  });
  const assertUntouched = async (readCount = 1) => {
    assert.equal(await readFile(marker, 'utf8'), 'Synthetic fixture, not a game save.');
    assert.deepEqual(await readdir(save), ['test-sentinel.txt']);
    assert.deepEqual(await readdir(appData), [], 'Opening an existing app must not create another journal');
    assert.deepEqual(requests, Array.from({ length: readCount }, () => ({
      method: 'GET', path: '/api/state?reserve=19',
    })), 'The existing-app path must perform reads only');
  };
  return { run, assertUntouched };
}

test('the legacy installed name remains recognizable', async t => {
  const f = await fixture(t, 'COTW Field Companion');
  const r = await f.run();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /already running/);
  await f.assertUntouched();
});

test('the approved GrindZone name reopens without an unrelated-app error', async t => {
  const f = await fixture(t, 'GrindZone');
  const r = await f.run();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /GrindZone is already running/);
  await f.assertUntouched();
});

test('an unrelated application is still rejected', async t => {
  const f = await fixture(t, 'Other Application');
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /already in use by another application/);
  await f.assertUntouched();
});

test('a similar name is not treated as the approved application', async t => {
  const f = await fixture(t, 'GrindZone Unrecognized');
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /already in use by another application/);
  await f.assertUntouched();
});

test('a recognized GrindZone on another save is not reused', async t => {
  const f = await fixture(t, 'GrindZone', { otherSource: true });
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Another companion instance is running/);
  await f.assertUntouched();
});

test('a legacy companion on another save is still rejected', async t => {
  const f = await fixture(t, 'COTW Field Companion', { otherSource: true });
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Another companion instance is running/);
  await f.assertUntouched();
});

test('an explicit alternate journal retains the existing conflict guard', async t => {
  const f = await fixture(t, 'GrindZone', { customData: true });
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Another companion instance is running/);
  await f.assertUntouched();
});

test('repeated launches of GrindZone reuse the app without writes', async t => {
  const f = await fixture(t, 'GrindZone');
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await f.run();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /GrindZone is already running/);
  }
  await f.assertUntouched(2);
});

test('missing application identity is still rejected', async t => {
  const f = await fixture(t, null);
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /already in use by another application/);
  await f.assertUntouched();
});
