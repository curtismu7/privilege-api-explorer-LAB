import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: npm run content-pack)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});
test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));
test('content-pack.json validates against docs/content-pack.schema.json (ajv)', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});
test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
});
test('the pack has the required terms, no story cards, and lists no source it did not fetch', () => {
  const pack = buildPack();
  for (const id of ['privilege-console-api', 'api-key-secret', 'procyon-session-id', 'tenant-id', 'swagger-catalog', 'read-only-by-default', 'mock-console', 'netguard', 'audit-log', 'simulation-honesty']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  assert.deepEqual(pack.sources, []);
  assert.deepEqual(pack.stories, []);
});
test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});
