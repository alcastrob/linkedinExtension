// Utilidades compartidas entre el service worker y la página de opciones.
// El handle de la carpeta se guarda en IndexedDB del origen de la extensión.
// Cada persona es un fichero <slug>.md dentro de esa carpeta.

const DB_NAME = 'linkedin-notas';
const STORE = 'kv';
const HANDLE_KEY = 'fileHandle';
const NO_DATE = 'Sin fecha';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Devuelve el handle de la carpeta, o null si no hay (un handle de fichero de una
// versión anterior se ignora).
export async function getHandle() {
  const db = await openDb();
  const handle = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  return handle && handle.kind === 'directory' ? handle : null;
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

// ---------- Modelo en memoria ----------
// { version: 1, people: { [slug]: { name, url, comments: [{ date, text }] } } }

export function emptyData() {
  return { version: 1, people: {} };
}

const pad = (n) => String(n).padStart(2, '0');

export function formatDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Normaliza datos de la caché (incluido el formato antiguo con id/createdAt).
export function normalize(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || !raw.people || typeof raw.people !== 'object') return data;
  for (const [slug, p] of Object.entries(raw.people)) {
    if (!p || !Array.isArray(p.comments)) continue;
    const comments = p.comments
      .filter((c) => c && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({
        date: typeof c.date === 'string' ? c.date : c.createdAt ? formatDate(new Date(c.createdAt)) : '',
        text: c.text.trim(),
      }));
    if (comments.length) {
      data.people[slug] = { name: String(p.name || slug), url: String(p.url || ''), comments };
    }
  }
  return data;
}

// ---------- Nombre de fichero <-> slug ----------

export function fileNameFor(slug) {
  // Los caracteres no seguros en Windows (incluido '*') se codifican como %XX.
  const safe = encodeURIComponent(slug).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return safe + '.md';
}

export function slugFromFileName(name) {
  const base = name.replace(/\.md$/i, '');
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

// ---------- Markdown ----------

function yamlValue(s) {
  return JSON.stringify(String(s)); // cadena entre comillas dobles, válida en YAML
}

function parseYamlValue(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      /* se devuelve tal cual */
    }
  }
  return v;
}

export function serializePerson(person) {
  const out = ['---', `name: ${yamlValue(person.name)}`, `url: ${person.url}`, '---', ''];
  for (const c of person.comments) {
    out.push(`## ${c.date || NO_DATE}`, '');
    // Una línea del texto que empiece por "## " se escapa para no crear otra sección.
    out.push(c.text.replace(/^## /gm, '\\## '), '');
  }
  return out.join('\n');
}

// Devuelve { name, url, comments } o null si no hay ningún comentario.
export function parsePerson(markdown, slug) {
  let text = markdown.replace(/\r\n?/g, '\n');
  let name = '';
  let url = '';

  const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      if (m[1] === 'name') name = parseYamlValue(m[2]);
      else if (m[1] === 'url') url = parseYamlValue(m[2]);
    }
    text = text.slice(fm[0].length);
  }

  const comments = [];
  const parts = text.split(/^## (.*)$/m); // [preámbulo, fecha1, cuerpo1, fecha2, cuerpo2…]
  const push = (date, body) => {
    const t = body.trim().replace(/^\\## /gm, '## ');
    if (t) comments.push({ date: date.trim() === NO_DATE ? '' : date.trim(), text: t });
  };
  push('', parts[0]); // texto escrito a mano antes de la primera sección
  for (let i = 1; i < parts.length; i += 2) push(parts[i], parts[i + 1] || '');

  if (!comments.length) return null;
  return { name: name || slug, url, comments };
}
