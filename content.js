(() => {
  'use strict';

  let data = { version: 1, people: {} };
  let status = 'unknown';

  const STATUS_TEXT = {
    ok: 'Guardado en el fichero',
    'no-file': 'Sin fichero configurado: guardado solo en caché',
    permission: 'Sin permiso sobre el fichero: guardado solo en caché',
    invalid: 'El fichero no es JSON válido: no se modifica',
    error: 'Error con el fichero: guardado solo en caché',
  };

  // ---------- Comunicación con el service worker ----------

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return null; // contexto invalidado (extensión recargada)
    }
  }

  function apply(res) {
    if (!res || !res.data) return;
    data = res.data;
    status = res.status;
    refreshBadges();
    if (current) renderPopover();
  }

  const refresh = () => send({ type: 'getAll' }).then(apply);
  const doOp = (payload) => send({ type: 'op', ...payload }).then(apply);

  // ---------- Identificación de personas ----------

  function slugFromHref(href) {
    try {
      const u = new URL(href, location.origin);
      if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/in\/([^/]+)\/?$/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  function nameFromAnchor(a) {
    const hidden = a.querySelector('span[aria-hidden="true"]');
    const raw = (hidden?.textContent || a.innerText || '').trim().split('\n')[0].trim();
    return raw.replace(/^Ver perfil de\s+/i, '').slice(0, 100);
  }

  // ---------- Badges ----------

  function createBadge(slug, name, url, profile) {
    const b = document.createElement('span');
    b.className = 'lnkn-badge' + (profile ? ' lnkn-profile' : '');
    b.dataset.slug = slug;
    b.dataset.name = name;
    b.dataset.url = url;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lnkn-btn';
    const prev = document.createElement('span');
    prev.className = 'lnkn-preview';
    b.append(btn, prev);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPopover(b);
    });
    updateBadge(b);
    return b;
  }

  function updateBadge(b) {
    const comments = data.people[b.dataset.slug]?.comments || [];
    const btn = b.querySelector('.lnkn-btn');
    const prev = b.querySelector('.lnkn-preview');
    b.classList.toggle('lnkn-has', comments.length > 0);
    btn.textContent = comments.length ? `📝 ${comments.length}` : '📝 +';
    btn.title = comments.length ? 'Ver o editar comentarios' : 'Añadir comentario';
    if (comments.length) {
      const last = comments[comments.length - 1].text;
      prev.textContent = last;
      prev.title = last;
      prev.hidden = false;
    } else {
      prev.textContent = '';
      prev.hidden = true;
    }
  }

  function refreshBadges() {
    document.querySelectorAll('.lnkn-badge').forEach(updateBadge);
  }

  function processAnchor(a) {
    if (a.dataset.lnknDone) return;
    const slug = slugFromHref(a.href);
    if (!slug) return;
    const name = nameFromAnchor(a);
    if (name.length < 2) return; // enlaces de imagen/avatar: se ignoran
    a.dataset.lnknDone = '1';

    // Un único badge por persona dentro de cada tarjeta de resultado.
    const card = a.closest('li, article, [role="listitem"], [data-urn], [data-chameleon-result-urn]') || a.parentElement;
    if (card && card.querySelector(`.lnkn-badge[data-slug="${CSS.escape(slug)}"]`)) return;

    const badge = createBadge(slug, name, `${location.origin}/in/${encodeURIComponent(slug)}/`, false);
    placeBadge(a, badge);
  }

  // Coloca el badge en su propia línea, justo después del bloque que contiene el enlace,
  // para que no se mezcle con el texto en línea (cargo, fecha…) de feed y resultados.
  // LinkedIn usa grid/flex con clases ofuscadas: insertar junto al enlace provoca solapes.
  // Se sube mientras el bloque sea pequeño (la cabecera del autor) y se inserta tras el
  // más alto cuyo padre apile a sus hijos en vertical (block o flex en columna).
  function placeBadge(a, badge) {
    badge.classList.add('lnkn-block');
    let child = a;
    let target = null;
    for (let i = 0; i < 8 && child.parentElement; i++) {
      if (child.getBoundingClientRect().height > 200) break;
      const parent = child.parentElement;
      const cs = getComputedStyle(parent);
      const stacks =
        cs.display === 'block' ||
        cs.display === 'list-item' ||
        (cs.display === 'flex' && cs.flexDirection.startsWith('column'));
      if (stacks) target = child;
      child = parent;
    }
    badge.dataset.placed = target ? 'row' : 'fallback'; // diagnóstico
    (target || a).insertAdjacentElement('afterend', badge);
  }

  function processProfileHeader() {
    const m = location.pathname.match(/^\/in\/([^/]+)\/?$/);
    const slug = m ? decodeURIComponent(m[1]) : null;
    document.querySelectorAll('.lnkn-profile').forEach((b) => {
      if (b.dataset.slug !== slug) b.remove();
    });
    if (!slug) return;
    const h1 = document.querySelector('main h1');
    if (!h1) return;
    const exists = h1.parentElement.querySelector(`.lnkn-profile[data-slug="${CSS.escape(slug)}"]`);
    if (exists) return;
    const name = h1.textContent.trim();
    h1.insertAdjacentElement('afterend', createBadge(slug, name, `${location.origin}/in/${m[1]}/`, true));
  }

  function scan() {
    document.querySelectorAll('a[href*="/in/"]').forEach(processAnchor);
    processProfileHeader();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  // ---------- Popover de edición (Shadow DOM para aislar estilos) ----------

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { width: 330px; max-height: 70vh; overflow: auto; background: #fff; color: #1d2226;
             border: 1px solid #c3c9cf; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.25);
             font: 13px/1.45 system-ui, sans-serif; padding: 12px; box-sizing: border-box; }
      header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
      header strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .item { border-top: 1px solid #e3e6e8; padding: 8px 0; }
      .text { white-space: pre-wrap; word-break: break-word; }
      .meta { color: #6b7580; font-size: 11px; margin-top: 2px; }
      .actions { display: flex; gap: 6px; margin-top: 6px; }
      textarea { width: 100%; box-sizing: border-box; min-height: 60px; resize: vertical; font: inherit;
                 padding: 6px; border: 1px solid #b0b7bf; border-radius: 6px; }
      button { font: inherit; padding: 3px 10px; border-radius: 12px; border: 1px solid #0a66c2;
               background: #fff; color: #0a66c2; cursor: pointer; }
      button.primary { background: #0a66c2; color: #fff; }
      button.danger { border-color: #b24020; color: #b24020; }
      button.danger.confirm { background: #b24020; color: #fff; }
      button.ghost { border: none; font-size: 16px; padding: 0 6px; color: #555; }
      .status { margin-top: 8px; font-size: 11px; color: #6b7580; }
      .status.bad { color: #b24020; }
      .status a { color: inherit; text-decoration: underline; cursor: pointer; }
      .empty { color: #6b7580; margin: 6px 0; }
    </style>
    <div class="box"></div>`;
  const box = shadow.querySelector('.box');
  document.documentElement.appendChild(host);

  let current = null; // { slug, name, url, badge }
  let editingId = null;
  let confirmId = null;
  let confirmTimer = null;

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  }

  function openPopover(badge) {
    current = {
      slug: badge.dataset.slug,
      name: badge.dataset.name,
      url: badge.dataset.url,
      badge,
    };
    editingId = null;
    confirmId = null;
    host.style.display = 'block';
    renderPopover();
    position();
    refresh(); // relee el fichero por si se editó fuera
  }

  function closePopover() {
    current = null;
    host.style.display = 'none';
  }

  function position() {
    if (!current) return;
    const r = current.badge.getBoundingClientRect();
    const w = 330;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    host.style.left = left + 'px';
    host.style.top = '0px';
    const h = box.getBoundingClientRect().height;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    host.style.top = top + 'px';
  }

  function renderPopover() {
    if (!current) return;
    const person = data.people[current.slug];
    const comments = person?.comments || [];
    const displayName = person?.name || current.name;

    box.replaceChildren();

    const close = el('button', { className: 'ghost', textContent: '×', title: 'Cerrar' });
    close.addEventListener('click', closePopover);
    box.append(el('header', {}, el('strong', { textContent: displayName, title: displayName }), close));

    if (!comments.length) box.append(el('div', { className: 'empty', textContent: 'Aún no hay comentarios.' }));

    for (const c of comments) {
      const item = el('div', { className: 'item' });
      if (editingId === c.id) {
        const ta = el('textarea', { value: c.text });
        const save = el('button', { className: 'primary', textContent: 'Guardar' });
        const cancel = el('button', { textContent: 'Cancelar' });
        save.addEventListener('click', () => {
          const text = ta.value.trim();
          editingId = null;
          if (text && text !== c.text) doOp({ op: 'edit', slug: current.slug, id: c.id, text });
          else renderPopover();
        });
        cancel.addEventListener('click', () => {
          editingId = null;
          renderPopover();
        });
        item.append(ta, el('div', { className: 'actions' }, save, cancel));
        setTimeout(() => ta.focus(), 0);
      } else {
        const edited = c.updatedAt !== c.createdAt;
        const when = new Date(c.updatedAt).toLocaleString('es-ES');
        const edit = el('button', { textContent: 'Editar' });
        const del = el('button', {
          className: 'danger' + (confirmId === c.id ? ' confirm' : ''),
          textContent: confirmId === c.id ? 'Confirmar' : 'Eliminar',
        });
        edit.addEventListener('click', () => {
          editingId = c.id;
          renderPopover();
        });
        del.addEventListener('click', () => {
          if (confirmId === c.id) {
            confirmId = null;
            doOp({ op: 'delete', slug: current.slug, id: c.id });
          } else {
            confirmId = c.id;
            clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => {
              confirmId = null;
              if (current) renderPopover();
            }, 3000);
            renderPopover();
          }
        });
        item.append(
          el('div', { className: 'text', textContent: c.text }),
          el('div', { className: 'meta', textContent: (edited ? 'Editado ' : '') + when }),
          el('div', { className: 'actions' }, edit, del),
        );
      }
      box.append(item);
    }

    // Nuevo comentario
    const newTa = el('textarea', { placeholder: 'Añadir comentario…' });
    const add = el('button', { className: 'primary', textContent: 'Añadir' });
    const commit = () => {
      const text = newTa.value.trim();
      if (!text) return;
      newTa.value = '';
      doOp({ op: 'add', slug: current.slug, name: current.name, url: current.url, text });
    };
    add.addEventListener('click', commit);
    newTa.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
    });
    box.append(el('div', { className: 'item' }, newTa, el('div', { className: 'actions' }, add)));

    // Estado del fichero
    const st = el('div', { className: 'status' + (status === 'ok' || status === 'unknown' ? '' : ' bad') });
    st.append(STATUS_TEXT[status] || '');
    if (status !== 'ok' && status !== 'unknown') {
      const link = el('a', { textContent: ' Configurar' });
      link.addEventListener('click', () => send({ type: 'openOptions' }));
      st.append(link);
    }
    box.append(st);

    position();
  }

  document.addEventListener(
    'mousedown',
    (e) => {
      if (current && !e.composedPath().includes(host) && !e.composedPath().includes(current.badge)) closePopover();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) closePopover();
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', closePopover, true);

  // ---------- Arranque ----------

  // Cambios hechos desde otras pestañas.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.data) {
      chrome.storage.local.get('data').then(({ data: d }) => {
        if (d && d.people) {
          data = d;
          refreshBadges();
          if (current) renderPopover();
        }
      });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });

  refresh().then(scan);
})();
