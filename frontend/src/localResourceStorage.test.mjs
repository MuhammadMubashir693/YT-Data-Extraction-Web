import test from 'node:test';
import assert from 'node:assert/strict';
import { addResource, deleteResource, getResource, updateResource } from './localResourceStorage.js';

test('stores and updates channels locally', () => {
  const storageKey = 'yt-data-test-channels';
  globalThis.localStorage = {
    store: {},
    getItem(key) { return this.store[key] ?? null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
  };

  const initial = getResource(storageKey);
  assert.deepEqual(initial, []);

  const created = addResource({ name: 'Example', id: 'UC123' }, storageKey);
  assert.deepEqual(created, [{ name: 'Example', id: 'UC123' }]);

  const updated = updateResource('UC123', { name: 'Updated', id: 'UC999' }, storageKey);
  assert.deepEqual(updated, [{ name: 'Updated', id: 'UC999' }]);

  const deleted = deleteResource('UC999', storageKey);
  assert.deepEqual(deleted, []);
});
