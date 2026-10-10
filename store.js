// Utilidades compartidas entre el service worker y la página de opciones.
// El handle del fichero se guarda en IndexedDB del origen de la extensión.

const DB_NAME = 'linkedin-notas';
const STORE = 'kv';
const HANDLE_KEY = 'fileHandle';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function emptyData() {
  return { version: 1, people: {} };
}

// Normaliza el contenido leído del fichero para que siempre tenga la forma esperada.
export function normalize(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || typeof raw.people !== 'object' || !raw.people) return data;
  for (const [slug, p] of Object.entries(raw.people)) {
    if (!p || !Array.isArray(p.comments)) continue;
    const comments = p.comments
      .filter((c) => c && typeof c.text === 'string')
      .map((c) => ({
        id: String(c.id || crypto.randomUUID()),
        text: c.text,
        createdAt: c.createdAt || new Date().toISOString(),
        updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
      }));
    if (comments.length) {
      data.people[slug] = { name: String(p.name || slug), url: String(p.url || ''), comments };
    }
  }
  return data;
}
