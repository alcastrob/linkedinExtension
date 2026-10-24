// Utilidades compartidas entre el service worker y la página de opciones.
// El handle de la carpeta se guarda en IndexedDB del origen de la extensión.
// Cada persona es un fichero <Nombre>.md dentro de esa carpeta; su identidad es
// el campo `slugLinkedIn` del frontmatter.

const DB_NAME = 'linkedin-notas';
const STORE = 'kv';
const HANDLE_KEY = 'fileHandle';
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
// { version: 1, people: { [slug]: { name, url, tags: [], titular } } }

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

// Último comentario del formato antiguo (lista de { date, text }), usado como titular.
function lastComment(comments) {
  const last = Array.isArray(comments)
    ? comments.filter((c) => c && typeof c.text === 'string' && c.text.trim()).pop()
    : null;
  return last ? last.text.trim() : '';
}

// Normaliza datos de la caché (incluido el formato antiguo con lista de comentarios).
export function normalize(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || !raw.people || typeof raw.people !== 'object') return data;
  for (const [slug, p] of Object.entries(raw.people)) {
    if (!p) continue;
    const titular = typeof p.titular === 'string' ? p.titular.trim() : lastComment(p.comments);
    if (titular) {
      data.people[slug] = {
        name: String(p.name || slug),
        url: String(p.url || ''),
        tags: withBaseTag(p.tags),
        titular,
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

// Nombre de la persona a partir del nombre de fichero.
export function nameFromFileName(fileName, slug) {
  let base = String(fileName || '').replace(/\.md$/i, '');
  const suffix = ` (${sanitize(slug)})`;
  if (base.endsWith(suffix) && base.length > suffix.length) base = base.slice(0, -suffix.length);
  return base || slug;
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
  return [
    '---',
    `slugLinkedIn: ${yamlValue(slug)}`,
    `url: ${person.url}`,
    `type: ${BASE_TYPE}`,
    `titular: ${yamlValue(person.titular)}`,
    'tags:',
    ...withBaseTag(person.tags).map((t) => `  - ${yamlTag(t)}`),
    '---',
    '',
  ].join('\n');
}

// El nombre de la persona es el del fichero (sin .md ni el sufijo " (slug)"); un `name:` en el
// frontmatter, de versiones anteriores, tiene prioridad al leer.
// Devuelve { slug, legacy, name, url, tags, titular } o null si el fichero no es una nota de
// LinkedIn reconocible (sin slug) o no tiene titular.
// `legacy` indica que no traía slugLinkedIn (formato anterior, slug deducido de la URL).
export function parsePerson(markdown, fileName = '') {
  let text = markdown.replace(/\r\n?/g, '\n');
  let name = '';
  let url = '';
  let slug = '';
  let titular = '';
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
      else if (key === 'titular') titular = parseYamlValue(val);
      // slugLinkedId: nombre usado por la versión 1.2.0, se sigue aceptando al leer.
      else if (key === 'slugLinkedIn' || (key === 'slugLinkedId' && !slug)) slug = parseYamlValue(val);
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

  // Ficheros anteriores sin `titular`: se toma el último comentario (sección "## fecha").
  if (!titular.trim()) {
    const parts = text.split(/^## (.*)$/m); // [preámbulo, fecha1, cuerpo1, fecha2, cuerpo2…]
    const bodies = [parts[0], ...parts.filter((_, i) => i > 0 && i % 2 === 0)];
    titular = bodies.map((b) => b.trim().replace(/^\## /gm, '## ')).filter(Boolean).pop() || '';
  }
  titular = titular.trim();

  if (!titular) return null;
  return { slug, legacy, name: name || nameFromFileName(fileName, slug), url, tags: withBaseTag(tags), titular };
}
