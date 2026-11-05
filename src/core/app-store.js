/* Where the app keeps its data.
 * Browser: localStorage. Desktop build (window.MODEPUZZLE_DESKTOP, set by scripts/build_exe.py):
 * a file in the user's AppData, reached through the launcher's js_api, so the data no longer
 * depends on the page origin (the local port may change between runs).
 * Both expose the same synchronous getItem / setItem / removeItem used by core/storage.js. */

/** Max time to wait for the desktop launcher's API before falling back to localStorage. */
export const DESKTOP_API_TIMEOUT_MS = 10000;

/**
 * Synchronous store over an in-memory copy; every change is passed to `sink(op, key, value)`
 * in order (the next write starts after the previous one finished). Returns the store plus
 * `flushed()`, a promise for all pending writes.
 */
export function createWriteThroughStore(initial, sink) {
  const data = new Map(Object.entries(initial || {}).map(([k, v]) => [k, String(v)]));
  let queue = Promise.resolve();
  const push = (op, key, value) => {
    queue = queue.then(() => sink(op, key, value)).catch(err => console.error('storage write failed', err));
  };
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); push('set', key, String(value)); },
    removeItem: key => { data.delete(key); push('remove', key); },
    keys: () => [...data.keys()],
    flushed: () => queue,
  };
}

function waitForDesktopApi() {
  const ready = () => (window.pywebview?.api?.storage_load ? window.pywebview.api : null);
  if (ready()) return Promise.resolve(ready());
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(ready()), DESKTOP_API_TIMEOUT_MS);
    window.addEventListener('pywebviewready', () => { clearTimeout(timer); resolve(ready()); }, {once: true});
  });
}

/** All entries of a localStorage-like object (for the one-time move into the desktop file). */
function entriesOf(storage) {
  const out = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      out[key] = storage.getItem(key);
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** The store to use for this run. Never throws; falls back to localStorage. */
export async function openStore() {
  if (!globalThis.MODEPUZZLE_DESKTOP) return localStorage;
  const api = await waitForDesktopApi();
  if (!api) return localStorage;
  let data = await api.storage_load();
  if (!Object.keys(data).length) {
    // First run with the file store: bring over what an earlier desktop build kept in localStorage.
    const old = entriesOf(localStorage);
    if (Object.keys(old).length) {
      await api.storage_import(old);
      data = old;
    }
  }
  return createWriteThroughStore(data, (op, key, value) => (op === 'set' ? api.storage_set(key, value) : api.storage_remove(key)));
}
