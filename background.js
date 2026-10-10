import {
  getHandle,
  emptyData,
  normalize,
  formatDate,
  fileNameFor,
  fileNameWithSlug,
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

// Lee todos los .md. Además de los datos devuelve un índice de la carpeta:
//   files:  slug -> nombre de fichero actual
//   taken:  nombres de fichero ocupados (en minúsculas; Windows no distingue mayúsculas)
//   legacy: slugs cuyo fichero está en el formato antiguo (sin slugLinkedIn)
async function readDir(dir) {
  const data = emptyData();
  const idx = { files: new Map(), taken: new Set(), legacy: new Set() };
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !/\.md$/i.test(entry.name)) continue;
    idx.taken.add(entry.name.toLowerCase());
    const parsed = parsePerson(await (await entry.getFile()).text(), entry.name);
    if (!parsed) continue;
    const { slug, legacy, ...person } = parsed;
    data.people[slug] = person;
    idx.files.set(slug, entry.name);
    if (legacy) idx.legacy.add(slug);
  }
  return { data, idx };
}

async function removeFile(dir, name) {
  try {
    await dir.removeEntry(name);
  } catch (err) {
    if (err.name !== 'NotFoundError') throw err;
  }
}

// Escribe el fichero de una persona, o lo borra si ya no tiene comentarios.
// El nombre de fichero se fija al crearlo (o al migrar el formato antiguo) y después
// se respeta, aunque el usuario lo renombre a mano.
async function syncPerson(dir, slug, person, idx) {
  const current = idx.files.get(slug);

  if (!person || !person.comments.length) {
    if (current) await removeFile(dir, current);
    idx.files.delete(slug);
    if (current) idx.taken.delete(current.toLowerCase());
    return;
  }

  let name = current;
  if (!name || idx.legacy.has(slug)) {
    name = fileNameFor(person.name, slug);
    const mine = current && current.toLowerCase() === name.toLowerCase();
    if (!mine && idx.taken.has(name.toLowerCase())) name = fileNameWithSlug(person.name, slug);
    if (mine) name = current; // solo cambian las mayúsculas: no se toca
  }

  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(serializePerson(person, slug));
  await w.close();

  if (current && current !== name) {
    await removeFile(dir, current);
    idx.taken.delete(current.toLowerCase());
  }
  idx.files.set(slug, name);
  idx.taken.add(name.toLowerCase());
  idx.legacy.delete(slug);
}

// ---------- Carga y sincronización ----------

// Devuelve { data, status, idx? } (idx solo con status 'ok').
async function load() {
  const cache = await readCache();
  const dir = await getHandle();
  if (!dir) return { data: cache.data, status: 'no-file' };

  try {
    let { data, idx } = await readDir(dir);

    if (cache.pending.length) {
      // Cambios hechos sin acceso a la carpeta: se vuelcan a sus ficheros.
      for (const slug of cache.pending) await syncPerson(dir, slug, cache.data.people[slug], idx);
      ({ data, idx } = await readDir(dir));
    } else if (!Object.keys(data.people).length && Object.keys(cache.data.people).length) {
      // Carpeta sin notas y caché con datos: se vuelca la caché completa.
      for (const [slug, person] of Object.entries(cache.data.people)) await syncPerson(dir, slug, person, idx);
      ({ data, idx } = await readDir(dir));
    }

    await writeCache(data, []);
    return { data, status: 'ok', idx };
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
    // El nombre y la URL solo se fijan al crear la persona: así el nombre de fichero es estable.
    const person = data.people[slug] || { name: msg.name || slug, url: msg.url || '', tags: [], comments: [] };
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
  const current = await load(); // { data, status, idx }
  const data = structuredClone(current.data);
  const slug = applyOp(data, msg);
  if (!slug) return { data: current.data, status: current.status }; // el panel se refresca con el estado real

  const dir = await getHandle();
  const cache = await readCache();

  if (dir && current.status === 'ok') {
    try {
      await syncPerson(dir, slug, data.people[slug], current.idx);
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
  if (msg?.type === 'getAll' || msg?.type === 'sync') job = serial(() => load().then(({ data, status }) => ({ data, status })));
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
