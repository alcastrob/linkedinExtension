import { getHandle, setHandle } from './store.js';

const $ = (id) => document.getElementById(id);
const PICKER_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

const MESSAGES = {
  ok: ['Conectado y sincronizado', 'ok'],
  'no-file': ['Sin fichero seleccionado', 'bad'],
  permission: ['Hace falta volver a conceder permiso al fichero', 'bad'],
  invalid: ['El fichero no contiene JSON válido (no se sobrescribe)', 'bad'],
  error: ['Error al acceder al fichero', 'bad'],
};

async function refresh() {
  const handle = await getHandle();
  $('fileName').textContent = handle ? handle.name : '—';

  let status = 'no-file';
  let data = null;
  try {
    ({ status, data } = await chrome.runtime.sendMessage({ type: 'sync' }));
  } catch {
    status = 'error';
  }
  const [text, cls] = MESSAGES[status] || MESSAGES.error;
  $('status').textContent = text;
  $('status').className = cls;
  $('reconnect').hidden = status !== 'permission';
  $('count').textContent = data ? Object.keys(data.people).length : 0;
}

async function adopt(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return;
  await setHandle(handle);
  await refresh();
}

$('create').addEventListener('click', async () => {
  try {
    const handle = await showSaveFilePicker({ suggestedName: 'linkedin-comentarios.json', types: PICKER_TYPES });
    await adopt(handle);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
});

$('open').addEventListener('click', async () => {
  try {
    const [handle] = await showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    await adopt(handle);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
});

$('reconnect').addEventListener('click', async () => {
  const handle = await getHandle();
  if (handle) await adopt(handle);
});

refresh();
