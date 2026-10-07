/**
 * Small JSON values in `localStorage`. Storage can be missing or refuse writes (private browsing,
 * embedded frames, full quota); the game must keep working, so failures fall back to memory for
 * the rest of the session.
 */

const PREFIX = 'wheelie.';
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string): T | null {
  let text: string | null | undefined = memory.get(key);
  if (text === undefined) {
    try {
      text = storage()?.getItem(PREFIX + key) ?? null;
    } catch {
      text = null;
    }
  }
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  const text = JSON.stringify(value);
  memory.set(key, text);
  try {
    storage()?.setItem(PREFIX + key, text);
  } catch {
    // Kept in memory only.
  }
}

export function remove(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // Nothing to do.
  }
}

/** Removes every value whose key starts with `keyPrefix`. */
export function removeAll(keyPrefix: string): void {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(keyPrefix)) memory.delete(key);
  }
  try {
    const store = storage();
    if (!store) return;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX + keyPrefix)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
