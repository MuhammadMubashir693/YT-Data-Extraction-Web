const DEFAULT_STORAGE_KEY = "yt-data-saved-channels";

function getStorage() {
  const storage = typeof window !== "undefined" ? window.localStorage : null;
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readChannels(storageKey = DEFAULT_STORAGE_KEY) {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChannels(channels, storageKey = DEFAULT_STORAGE_KEY) {
  const storage = getStorage();
  if (!storage) return channels;
  try {
    storage.setItem(storageKey, JSON.stringify(channels));
  } catch {
    // ignore storage write failures
  }
  return channels;
}

export function getStoredChannels(storageKey = DEFAULT_STORAGE_KEY) {
  return readChannels(storageKey);
}

export function addStoredChannel(channel, storageKey = DEFAULT_STORAGE_KEY) {
  const existing = readChannels(storageKey);
  if (existing.some((entry) => entry.id === channel.id)) {
    const err = new Error("An entry with that id already exists.");
    err.status = 409;
    throw err;
  }
  const next = [...existing, channel];
  return writeChannels(next, storageKey);
}

export function updateStoredChannel(currentId, updatedChannel, storageKey = DEFAULT_STORAGE_KEY) {
  const existing = readChannels(storageKey);
  if (!existing.some((entry) => entry.id === currentId)) {
    const err = new Error("Entry not found.");
    err.status = 404;
    throw err;
  }
  if (currentId !== updatedChannel.id && existing.some((entry) => entry.id === updatedChannel.id)) {
    const err = new Error("An entry with the new id already exists.");
    err.status = 409;
    throw err;
  }
  const next = existing.map((entry) => (entry.id === currentId ? { ...entry, ...updatedChannel } : entry));
  return writeChannels(next, storageKey);
}

export function deleteStoredChannel(id, storageKey = DEFAULT_STORAGE_KEY) {
  const next = readChannels(storageKey).filter((entry) => entry.id !== id);
  return writeChannels(next, storageKey);
}