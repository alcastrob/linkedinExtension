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
    const titular = data.people[b.dataset.slug]?.titular || '';
    const btn = b.querySelector('.lnkn-btn');
    const prev = b.querySelector('.lnkn-preview');
    b.classList.toggle('lnkn-has', !!titular);
    btn.textContent = titular ? '📝' : '📝 +';
    btn.title = titular ? 'Ver o editar el titular' : 'Añadir titular';
    prev.textContent = titular;
    prev.title = titular;
    prev.hidden = !titular;
  }

  function refreshBadges() {
    document.querySelectorAll('.lnkn-badge').forEach(updateBadge);
  }

  function processAnchor(a) {
    if (a.dataset.lnknDone) return;
    const slug = slugFromHref(a.href);
    if (!slug) return;
    if (slug === profileSlug()) return; // en su propio perfil solo va el badge de la cabecera
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

  // Sube desde el enlace hasta la fila de ubicación (ubicación · Información de contacto):
  // el último elemento antes de que su padre apile a sus hijos en vertical.
  function locationRow(link) {
    let row = link.closest('p') || link;
    for (let i = 0; i < 4 && row.parentElement; i++) {
      const cs = getComputedStyle(row.parentElement);
      if (cs.display === 'block' || (cs.display === 'flex' && cs.flexDirection.startsWith('column'))) break;
      row = row.parentElement;
    }
    return row;
  }

  function profileSlug() {
    const m = location.pathname.match(/^\/in\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function processProfileHeader() {
    const m = location.pathname.match(/^\/in\/([^/]+)\/?$/);
    const slug = profileSlug();
    document.querySelectorAll('.lnkn-profile').forEach((b) => {
      if (b.dataset.slug !== slug) b.remove();
    });
    if (!slug) return;
    // Badges de enlaces a este mismo perfil creados antes de entrar en él (navegación sin recarga).
    document.querySelectorAll(`.lnkn-badge:not(.lnkn-profile)[data-slug="${CSS.escape(slug)}"]`).forEach((b) => b.remove());
    // El badge va justo debajo de la línea de ubicación, que es la que lleva el enlace
    // "Información de contacto" (se identifica por su href, no por el idioma ni por clases).
    // Si no está, se cuelga del nombre: <h1> o, en perfiles sin <h1>, el <h2> igual al título.
    const title = document.title.replace(/^\(\d+\)\s*/, '').split('|')[0].trim();
    const heading =
      document.querySelector('main h1') ||
      [...document.querySelectorAll('main h2')].find((h) => h.textContent.trim() === title);
    const contact = document.querySelector('main a[href*="/overlay/contact-info"]');
    const anchor = contact ? locationRow(contact) : heading;
    if (!anchor) return;
    const prev = document.querySelector(`.lnkn-profile[data-slug="${CSS.escape(slug)}"]`);
    if (prev && prev.previousElementSibling === anchor) return;
    prev?.remove(); // pudo colocarse antes de que apareciera la línea de ubicación
    const name = heading?.textContent.trim() || title;
    anchor.insertAdjacentElement('afterend', createBadge(slug, name, `${location.origin}/in/${m[1]}/`, true));
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
    </style>
    <div class="box"></div>`;
  const box = shadow.querySelector('.box');
  document.documentElement.appendChild(host);

  let current = null; // { slug, name, url, badge }
  let confirmDelete = false;
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
    confirmDelete = false;
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
    const titular = person?.titular || '';
    const displayName = person?.name || current.name;

    box.replaceChildren();

    const close = el('button', { className: 'ghost', textContent: '×', title: 'Cerrar' });
    close.addEventListener('click', closePopover);
    box.append(el('header', {}, el('strong', { textContent: displayName, title: displayName }), close));

    const ta = el('textarea', { value: titular, placeholder: 'Titular…' });
    const save = el('button', { className: 'primary', textContent: 'Guardar' });
    const commit = () => {
      const text = ta.value.trim();
      if (text && text !== titular) doOp({ op: 'set', slug: current.slug, name: current.name, url: current.url, text });
    };
    save.addEventListener('click', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
    });
    const actions = el('div', { className: 'actions' }, save);

    if (titular) {
      const del = el('button', {
        className: 'danger' + (confirmDelete ? ' confirm' : ''),
        textContent: confirmDelete ? 'Confirmar' : 'Eliminar',
      });
      del.addEventListener('click', () => {
        if (confirmDelete) {
          confirmDelete = false;
          doOp({ op: 'delete', slug: current.slug, oldText: titular });
        } else {
          confirmDelete = true;
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(() => {
            confirmDelete = false;
            if (current) renderPopover();
          }, 3000);
          renderPopover();
        }
      });
      actions.append(del);
    }
    box.append(el('div', { className: 'item' }, ta, actions));

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
