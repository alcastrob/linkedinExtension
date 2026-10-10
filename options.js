import { getHandle, setHandle } from './store.js';

const $ = (id) => document.getElementById(id);

const MESSAGES = {
  ok: ['Conectado y sincronizado', 'ok'],
  'no-file': ['Sin carpeta seleccionada', 'bad'],
  permission: ['Hace falta volver a conceder permiso a la carpeta', 'bad'],
  error: ['Error al acceder a la carpeta', 'bad'],
};

async function refresh() {
  const handle = await getHandle();
  $('folderName').textContent = handle ? handle.name : '—';

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

$('choose').addEventListener('click', async () => {
  try {
    const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'linkedin-notas' });
    await adopt(handle);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      $('status').textContent = 'No se pudo usar esa carpeta (¿es una carpeta protegida del sistema? Usa una subcarpeta).';
      $('status').className = 'bad';
    }
  }
});

$('reconnect').addEventListener('click', async () => {
  const handle = await getHandle();
  if (handle) await adopt(handle);
});

refresh();
