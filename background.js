import { getHandle, emptyData, normalize } from './store.js';

// Estados: ok | no-file | permission | invalid | error
// El fichero es la fuente de verdad. chrome.storage.local actúa como caché
// (para pintar rápido y para seguir funcionando si el fichero no es accesible).

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.catch(() => {}).then(fn);
  queue = run;
  return run;
}

async function readCache() {
  const { data, dirty } = await chrome.storage.local.get(['data', 'dirty']);
  return { data: normalize(data), dirty: !!dirty };
}

async function writeCache(data, dirty) {
  await chrome.storage.local.set({ data, dirty });
}

async function writeFile(handle, data) {
  const w = await handle.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

function classify(err) {
  return err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'permission' : 'error';
}

// Devuelve { data, status }. Sincroniza fichero <-> caché.
async function load() {
  const cache = await readCache();
  const handle = await getHandle();
  if (!handle) return { data: cache.data, status: 'no-file' };

  let text;
  try {
    text = await (await handle.getFile()).text();
  } catch (err) {
    return { data: cache.data, status: classify(err) };
  }

  // Cambios hechos sin acceso al fichero: la caché gana y se vuelca al fichero.
  if (cache.dirty || !text.trim()) {
    try {
      await writeFile(handle, cache.data);
      await writeCache(cache.data, false);
      return { data: cache.data, status: 'ok' };
    } catch (err) {
      return { data: cache.data, status: classify(err) };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // No se sobrescribe un fichero que no se puede interpretar.
    return { data: cache.data, status: 'invalid' };
  }
  const data = normalize(parsed);
  await writeCache(data, false);
  return { data, status: 'ok' };
}

function applyOp(data, msg) {
  const now = new Date().toISOString();
  const { slug } = msg;
  if (!slug) throw new Error('slug requerido');

  if (msg.op === 'add') {
    const text = (msg.text || '').trim();
    if (!text) return;
    const person = data.people[slug] || { name: msg.name || slug, url: msg.url || '', comments: [] };
    if (msg.name) person.name = msg.name;
    if (msg.url) person.url = msg.url;
    person.comments.push({ id: crypto.randomUUID(), text, createdAt: now, updatedAt: now });
    data.people[slug] = person;
  } else if (msg.op === 'edit') {
    const c = data.people[slug]?.comments.find((x) => x.id === msg.id);
    const text = (msg.text || '').trim();
    if (!c || !text) return;
    c.text = text;
    c.updatedAt = now;
  } else if (msg.op === 'delete') {
    const person = data.people[slug];
    if (!person) return;
    person.comments = person.comments.filter((x) => x.id !== msg.id);
    if (!person.comments.length) delete data.people[slug];
  }
}

async function runOp(msg) {
  const current = await load();
  if (current.status === 'invalid') return current; // no tocar un fichero ilegible

  const data = structuredClone(current.data);
  applyOp(data, msg);

  const handle = await getHandle();
  if (handle && current.status === 'ok') {
    try {
      await writeFile(handle, data);
      await writeCache(data, false);
      return { data, status: 'ok' };
    } catch (err) {
      await writeCache(data, true);
      return { data, status: classify(err) };
    }
  }
  await writeCache(data, !!handle); // sin handle no hay nada pendiente de volcar
  return { data, status: current.status };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  let job;
  if (msg?.type === 'getAll' || msg?.type === 'sync') job = serial(load);
  else if (msg?.type === 'op') job = serial(() => runOp(msg));
  else if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  } else return false;

  job.then(sendResponse, (err) => sendResponse({ data: emptyData(), status: 'error', error: String(err) }));
  return true; // respuesta asíncrona
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
