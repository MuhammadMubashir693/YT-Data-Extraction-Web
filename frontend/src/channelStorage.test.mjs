import test from 'node:test';
import assert from 'node:assert/strict';
import { addStoredChannel, deleteStoredChannel, getStoredChannels, updateStoredChannel } from './channelStorage.js';

test('stores and updates channels locally', () => {
  const storageKey = 'yt-data-test-channels';
  globalThis.localStorage = {
    store: {},
    getItem(key) { return this.store[key] ?? null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
  };

  const initial = getStoredChannels(storageKey);
  assert.deepEqual(initial, []);

  const created = addStoredChannel({ name: 'Example', id: 'UC123' }, storageKey);
  assert.deepEqual(created, [{ name: 'Example', id: 'UC123' }]);

  const updated = updateStoredChannel('UC123', { name: 'Updated', id: 'UC999' }, storageKey);
  assert.deepEqual(updated, [{ name: 'Updated', id: 'UC999' }]);

  const deleted = deleteStoredChannel('UC999', storageKey);
  assert.deepEqual(deleted, []);
});
