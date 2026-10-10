import {
  getHandle,
  emptyData,
  normalize,
  formatDate,
  fileNameFor,
  slugFromFileName,
  serializePerson,
  parsePerson,
} from './store.js';

// Estados: ok | no-file | permission | error
// La carpeta de ficheros .md es la fuente de verdad. chrome.storage.local actúa como caché
// (para pintar rápido y para seguir funcionando si la carpeta no es accesible).
// Mientras no hay acceso, los slugs modificados se anotan en `pending` y se vuelcan después.

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.catch(() => {}).then(fn);
  queue = run;
  return run;
}

async function readCache() {
  const { data, pending } = await chrome.storage.local.get(['data', 'pending']);
  return { data: normalize(data), pending: Array.isArray(pending) ? pending : [] };
}

async function writeCache(data, pending) {
  await chrome.storage.local.set({ data, pending });
}

function classify(err) {
  return err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'permission' : 'error';
}

// ---------- Carpeta de ficheros ----------

async function readDir(dir) {
  const data = emptyData();
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !/\.md$/i.test(entry.name)) continue;
    const slug = slugFromFileName(entry.name);
    const person = parsePerson(await (await entry.getFile()).text(), slug);
    if (person) data.people[slug] = person;
  }
  return data;
}

// Escribe el fichero de una persona, o lo borra si ya no tiene comentarios.
async function syncPerson(dir, slug, person) {
  const name = fileNameFor(slug);
  if (person && person.comments.length) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(serializePerson(person));
    await w.close();
  } else {
    try {
      await dir.removeEntry(name);
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
    }
  }
}

// ---------- Carga y sincronización ----------

// Devuelve { data, status }.
async function load() {
  const cache = await readCache();
  const dir = await getHandle();
  if (!dir) return { data: cache.data, status: 'no-file' };

  try {
    let data = await readDir(dir);

    if (cache.pending.length) {
      // Cambios hechos sin acceso a la carpeta: se vuelcan a sus ficheros.
      for (const slug of cache.pending) await syncPerson(dir, slug, cache.data.people[slug]);
      data = await readDir(dir);
    } else if (!Object.keys(data.people).length && Object.keys(cache.data.people).length) {
      // Carpeta vacía y caché con datos: se vuelca la caché completa.
      for (const [slug, person] of Object.entries(cache.data.people)) await syncPerson(dir, slug, person);
      data = await readDir(dir);
    }

    await writeCache(data, []);
    return { data, status: 'ok' };
  } catch (err) {
    return { data: cache.data, status: classify(err) };
  }
}

// ---------- Operaciones ----------

// Devuelve el slug modificado, o null si la operación no procede (conflicto o vacía).
function applyOp(data, msg) {
  const { slug } = msg;
  if (!slug) throw new Error('slug requerido');
  const text = (msg.text || '').trim();

  if (msg.op === 'add') {
    if (!text) return null;
    const person = data.people[slug] || { name: msg.name || slug, url: msg.url || '', comments: [] };
    if (msg.name) person.name = msg.name;
    if (msg.url) person.url = msg.url;
    person.comments.push({ date: formatDate(), text });
    data.people[slug] = person;
    return slug;
  }

  // edit / delete: el comentario se identifica por posición y se comprueba su texto,
  // por si el fichero cambió (p. ej. edición manual) desde que se pintó el panel.
  const person = data.people[slug];
  const c = person?.comments[msg.index];
  if (!c || c.text !== msg.oldText) return null;

  if (msg.op === 'edit') {
    if (!text) return null;
    c.text = text;
  } else if (msg.op === 'delete') {
    person.comments.splice(msg.index, 1);
    if (!person.comments.length) delete data.people[slug];
  } else return null;
  return slug;
}

async function runOp(msg) {
  const current = await load();
  const data = structuredClone(current.data);
  const slug = applyOp(data, msg);
  if (!slug) return current; // sin cambios: el panel se refresca con el estado real

  const dir = await getHandle();
  const cache = await readCache();

  if (dir && current.status === 'ok') {
    try {
      await syncPerson(dir, slug, data.people[slug]);
      await writeCache(data, []);
      return { data, status: 'ok' };
    } catch (err) {
      await writeCache(data, [...new Set([...cache.pending, slug])]);
      return { data, status: classify(err) };
    }
  }
  // Sin acceso: se guarda en la caché y, si hay carpeta, se anota para volcarlo luego.
  await writeCache(data, dir ? [...new Set([...cache.pending, slug])] : []);
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
