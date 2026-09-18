import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildPortable, portableFiles } from '../tools/build-portable.mjs';

test('portable release includes only reviewed runtime and retains current maps', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'field-portable-test-'));
  try {
    const source = path.join(work, 'source'); mkdirSync(source);
    for (const name of portableFiles) {
      mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
      writeFileSync(path.join(source, name), name === 'package.json' ? '{"version":"0.4.1"}' : 'reviewed ' + name);
    }
    for (const name of ['journal.sqlite', '.env', 'player-save.json', 'private-photo.jpg']) writeFileSync(path.join(source, name), 'private sentinel');
    const output = path.join(work, 'release');
    const result = buildPortable(source, output);
    assert.equal(result.published, false); assert.equal(result.donationUrl, null); assert.equal(result.paymentRequired, false);
    assert.equal(result.files.length, portableFiles.length);
    assert.equal(readFileSync(path.join(output, 'public/maps.css'), 'utf8'), 'reviewed public/maps.css');
    for (const name of ['journal.sqlite', '.env', 'player-save.json', 'private-photo.jpg']) assert.equal(existsSync(path.join(output, name)), false);
    for (const entry of result.files) assert.equal(createHash('sha256').update(readFileSync(path.join(output, entry.path))).digest('hex'), entry.sha256);
    const before = readFileSync(path.join(output, 'PORTABLE-PACKAGE.json'));
    assert.throws(() => buildPortable(source, output), /already exists/);
    assert.deepEqual(readFileSync(path.join(output, 'PORTABLE-PACKAGE.json')), before);
  } finally { assert.equal(path.dirname(path.resolve(work)), path.resolve(tmpdir())); assert.match(path.basename(work), /^field-portable-test-/); rmSync(work, { recursive: true, force: true }); }
});

test('missing reviewed input fails before creating a misleading release', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'field-portable-missing-'));
  try {
    const output = path.join(work, 'release');
    assert.throws(() => buildPortable(work, output));
    assert.equal(existsSync(output), false);
  } finally { assert.equal(path.dirname(path.resolve(work)), path.resolve(tmpdir())); assert.match(path.basename(work), /^field-portable-missing-/); rmSync(work, { recursive: true, force: true }); }
});
