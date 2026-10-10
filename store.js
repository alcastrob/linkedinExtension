// Utilidades compartidas entre el service worker y la página de opciones.
// El handle de la carpeta se guarda en IndexedDB del origen de la extensión.
// Cada persona es un fichero <Nombre>.md dentro de esa carpeta; su identidad es
// el campo `slugLinkedId` del frontmatter.

const DB_NAME = 'linkedin-notas';
const STORE = 'kv';
const HANDLE_KEY = 'fileHandle';
const NO_DATE = 'Sin fecha';
export const BASE_TAG = 'linkedIn';
export const BASE_TYPE = 'contacto';

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
// { version: 1, people: { [slug]: { name, url, tags: [], comments: [{ date, text }] } } }

export function emptyData() {
  return { version: 1, people: {} };
}

const pad = (n) => String(n).padStart(2, '0');

export function formatDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function withBaseTag(tags) {
  const list = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  return list.some((t) => t.toLowerCase() === BASE_TAG.toLowerCase()) ? list : [...list, BASE_TAG];
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
      data.people[slug] = {
        name: String(p.name || slug),
        url: String(p.url || ''),
        tags: withBaseTag(p.tags),
        comments,
      };
    }
  }
  return data;
}

// ---------- Nombres de fichero ----------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitize(s) {
  let base = String(s || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, '');
  if (RESERVED.test(base)) base = '_' + base;
  return base;
}

// Nombre de fichero a partir del nombre real; si queda vacío se usa el slug.
export function fileNameFor(name, slug) {
  return (sanitize(name) || sanitize(slug) || 'sin-nombre') + '.md';
}

// Variante con el slug, para cuando otra persona ya ocupa "<Nombre>.md".
export function fileNameWithSlug(name, slug) {
  return `${sanitize(name) || 'sin-nombre'} (${sanitize(slug)}).md`;
}

// Slug que se deducía del nombre de fichero en el formato antiguo (<slug>.md codificado).
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

function yamlTag(t) {
  return /^[\w-]+$/.test(t) ? t : yamlValue(t);
}

export function serializePerson(person, slug) {
  const out = [
    '---',
    `name: ${yamlValue(person.name)}`,
    `slugLinkedId: ${yamlValue(slug)}`,
    `url: ${person.url}`,
    `type: ${BASE_TYPE}`,
    'tags:',
    ...withBaseTag(person.tags).map((t) => `  - ${yamlTag(t)}`),
    '---',
    '',
  ];
  for (const c of person.comments) {
    out.push(`## ${c.date || NO_DATE}`, '');
    // Una línea del texto que empiece por "## " se escapa para no crear otra sección.
    out.push(c.text.replace(/^## /gm, '\\## '), '');
  }
  return out.join('\n');
}

// Devuelve { slug, legacy, name, url, tags, comments } o null si el fichero no es una
// nota de LinkedIn reconocible (sin slug) o no tiene ningún comentario.
// `legacy` indica que no traía slugLinkedId (formato anterior, slug deducido de la URL).
export function parsePerson(markdown) {
  let text = markdown.replace(/\r\n?/g, '\n');
  let name = '';
  let url = '';
  let slug = '';
  let tags = [];

  const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (fm) {
    const lines = fm[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (key === 'name') name = parseYamlValue(val);
      else if (key === 'url') url = parseYamlValue(val);
      else if (key === 'slugLinkedId') slug = parseYamlValue(val);
      else if (key === 'tags') {
        if (val.trim()) {
          tags = val
            .trim()
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(parseYamlValue)
            .filter(Boolean);
        } else {
          let item;
          while (i + 1 < lines.length && (item = lines[i + 1].match(/^\s*-\s*(.+)$/))) {
            tags.push(parseYamlValue(item[1]));
            i++;
          }
        }
      }
    }
    text = text.slice(fm[0].length);
  }

  const legacy = !slug;
  if (legacy) {
    const m = url.match(/\/in\/([^/?#]+)/);
    if (m) {
      try {
        slug = decodeURIComponent(m[1]);
      } catch {
        slug = m[1];
      }
    }
  }
  if (!slug) return null;

  const comments = [];
  const parts = text.split(/^## (.*)$/m); // [preámbulo, fecha1, cuerpo1, fecha2, cuerpo2…]
  const push = (date, body) => {
    const t = body.trim().replace(/^\\## /gm, '## ');
    if (t) comments.push({ date: date.trim() === NO_DATE ? '' : date.trim(), text: t });
  };
  push('', parts[0]); // texto escrito a mano antes de la primera sección
  for (let i = 1; i < parts.length; i += 2) push(parts[i], parts[i + 1] || '');

  if (!comments.length) return null;
  return { slug, legacy, name: name || slug, url, tags: withBaseTag(tags), comments };
}
