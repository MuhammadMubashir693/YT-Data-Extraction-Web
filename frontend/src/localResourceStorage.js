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

function readResources(storageKey = DEFAULT_STORAGE_KEY) {
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

function writeResources(channels, storageKey = DEFAULT_STORAGE_KEY) {
  const storage = getStorage();
  if (!storage) return channels;
  try {
    storage.setItem(storageKey, JSON.stringify(channels));
  } catch {
    // ignore storage write failures
  }
  return channels;
}

export function getResource(storageKey = DEFAULT_STORAGE_KEY) {
  return readResources(storageKey);
}

export function addResource(channel, storageKey = DEFAULT_STORAGE_KEY) {
  const existing = readResources(storageKey);
  if (existing.some((entry) => entry.id === channel.id)) {
    const err = new Error("An entry with that id already exists.");
    err.status = 409;
    throw err;
  }
  const next = [...existing, channel];
  return writeResources(next, storageKey);
}

export function updateResource(currentId, updatedResource, storageKey = DEFAULT_STORAGE_KEY) {
  const existing = readResources(storageKey);
  if (!existing.some((entry) => entry.id === currentId)) {
    const err = new Error("Entry not found.");
    err.status = 404;
    throw err;
  }
  if (currentId !== updatedResource.id && existing.some((entry) => entry.id === updatedResource.id)) {
    const err = new Error("An entry with the new id already exists.");
    err.status = 409;
    throw err;
  }
  const next = existing.map((entry) => (entry.id === currentId ? { ...entry, ...updatedResource } : entry));
  return writeResources(next, storageKey);
}

export function deleteResource(id, storageKey = DEFAULT_STORAGE_KEY) {
  const next = readResources(storageKey).filter((entry) => entry.id !== id);
  return writeResources(next, storageKey);
}