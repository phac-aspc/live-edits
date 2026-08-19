(() => {
  'use strict';

  const bootstrap = document.currentScript;
  if (!bootstrap?.hasAttribute('data-live-edits-bootstrap') || window.__liveEditsV4) return;
  window.__liveEditsV4 = true;

  const config = {
    apiBase: bootstrap.dataset.apiBase?.replace(/\/$/, ''),
    siteKey: bootstrap.dataset.siteKey,
    projectPath: bootstrap.dataset.projectPath,
    pagePath: bootstrap.dataset.pagePath
  };
  if (!config.apiBase || !config.siteKey || !config.projectPath || !config.pagePath) {
    console.error('Live Edits: bootstrap configuration is incomplete.');
    return;
  }

  const isFrench = config.siteKey === 'fr' || document.documentElement.lang?.toLowerCase().startsWith('fr');
  const copy = isFrench ? {
    title: 'Édition en direct', access: 'Code d’accès', name: 'Votre nom', connect: 'Se connecter',
    edit: 'Modifier', stop: 'Terminer', save: 'Enregistrer', history: 'Historique', comment: 'Commenter',
    connected: 'Connecté', disconnected: 'Hors ligne', saved: 'Enregistré', unsaved: 'Modifications non enregistrées',
    selectComment: 'Sélectionnez un bloc de contenu à commenter.', commentText: 'Commentaire', add: 'Ajouter',
    cancel: 'Annuler', resolve: 'Résoudre', reopen: 'Rouvrir', noHistory: 'Aucun historique.',
    restore: 'Restaurer', editors: 'personne(s) présente(s)', authFailed: 'Code d’accès invalide.',
    conflict: 'Une autre personne a enregistré une nouvelle version. Vos changements sont conservés dans cette page.',
    merged: 'Les changements distants ont été fusionnés. Vérifiez puis enregistrez de nouveau.',
    conflictBlocks: 'Conflit dans ces blocs', loadServer: 'Charger la version serveur', close: 'Fermer',
    saveError: 'Échec de l’enregistrement', loadError: 'Impossible de charger l’éditeur.',
    leaveWarning: 'Des modifications ne sont pas enregistrées.', emptyName: 'Veuillez saisir votre nom et le code d’accès.'
  } : {
    title: 'Live Edits', access: 'Access code', name: 'Your name', connect: 'Connect',
    edit: 'Edit', stop: 'Done', save: 'Save', history: 'History', comment: 'Comment',
    connected: 'Connected', disconnected: 'Offline', saved: 'Saved', unsaved: 'Unsaved changes',
    selectComment: 'Select a content block to comment on.', commentText: 'Comment', add: 'Add',
    cancel: 'Cancel', resolve: 'Resolve', reopen: 'Reopen', noHistory: 'No history yet.',
    restore: 'Restore', editors: 'editor(s) present', authFailed: 'The access code is not valid.',
    conflict: 'Another editor saved a newer version. Your changes remain on this page.',
    merged: 'Remote changes were merged. Review the page and save again.',
    conflictBlocks: 'Conflicts in these blocks', loadServer: 'Load server version', close: 'Close',
    saveError: 'Save failed', loadError: 'The editor could not be loaded.',
    leaveWarning: 'There are unsaved changes.', emptyName: 'Enter your name and access code.'
  };

  const tokenKey = `live-edits-token:${new URL(config.apiBase).host}`;
  const nameKey = 'live-edits-editor-name';
  const regions = [...document.querySelectorAll('[data-live-edits-key]')];
  const regionByKey = new Map(regions.map((element) => [element.dataset.liveEditsKey, element]));
  if (!regions.length) {
    console.warn('Live Edits: no keyed editable regions were found.');
    return;
  }

  const state = {
    token: sessionStorage.getItem(tokenKey) || '',
    name: sessionStorage.getItem(nameKey) || '',
    project: null,
    revision: 0,
    baseElements: {},
    dirty: false,
    editing: false,
    commentMode: false,
    comments: [],
    history: [],
    socket: null
  };

  const host = document.createElement('div');
  host.id = 'live-edits-v4';
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483646;color:#222;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
      *,*::before,*::after{box-sizing:border-box}button,input,textarea{font:inherit}button{border:1px solid #aab3bd;border-radius:5px;background:#fff;color:#222;padding:7px 10px;cursor:pointer}button:hover{background:#edf4fb}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}.primary{background:#1769aa;border-color:#1769aa;color:#fff}.primary:hover{background:#0e568e}button:disabled{cursor:not-allowed;opacity:.5}.bar{display:flex;align-items:center;gap:7px;max-width:calc(100vw - 32px);padding:9px;border:1px solid #8b949e;border-radius:8px;background:#f8f9fa;box-shadow:0 4px 18px #0004}.brand{font-weight:700;margin-right:3px}.status{min-width:74px;font-size:12px}.status[data-error=true]{color:#a00}.presence{font-size:12px;color:#4b5563}.panel{position:absolute;right:0;bottom:58px;width:min(390px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 90px));overflow:auto;border:1px solid #8b949e;border-radius:8px;background:#fff;box-shadow:0 4px 18px #0004;padding:14px}.hidden{display:none!important}.panel h2{font-size:18px;margin:0 0 10px}.panel h3{font-size:15px;margin:14px 0 7px}.field{display:grid;gap:4px;margin:0 0 11px}.field input,.field textarea{width:100%;border:1px solid #68737d;border-radius:4px;padding:8px}.field textarea{min-height:86px;resize:vertical}.actions{display:flex;justify-content:flex-end;gap:8px}.message{padding:9px;border-left:4px solid #1769aa;background:#eaf5ff;margin:8px 0}.error{border-color:#a00;background:#fff0f0}.list{display:grid;gap:8px}.card{border:1px solid #d2d7dc;border-radius:5px;padding:9px}.meta{font-size:12px;color:#59636e}.card p{white-space:pre-wrap}.auth{inset:auto 0 0 auto}.conflicts{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}
    </style>
    <div class="bar" role="toolbar" aria-label="${copy.title}">
      <span class="brand">${copy.title}</span>
      <button id="edit" type="button">${copy.edit}</button>
      <button id="save" class="primary" type="button" disabled>${copy.save}</button>
      <button id="comment" type="button">${copy.comment}</button>
      <button id="history" type="button">${copy.history}</button>
      <span id="presence" class="presence"></span>
      <span id="status" class="status" role="status" aria-live="polite">${copy.disconnected}</span>
    </div>
    <section id="auth-panel" class="panel auth" aria-labelledby="auth-title">
      <h2 id="auth-title">${copy.title}</h2>
      <div id="auth-error" class="message error hidden" role="alert"></div>
      <label class="field">${copy.name}<input id="name" maxlength="100" autocomplete="name"></label>
      <label class="field">${copy.access}<input id="token" type="password" autocomplete="current-password"></label>
      <div class="actions"><button id="connect" class="primary" type="button">${copy.connect}</button></div>
    </section>
    <section id="history-panel" class="panel hidden" aria-labelledby="history-title">
      <h2 id="history-title">${copy.history}</h2><div id="history-list" class="list"></div>
      <div class="actions"><button data-close="history-panel" type="button">${copy.close}</button></div>
    </section>
    <section id="comment-panel" class="panel hidden" aria-labelledby="comment-title">
      <h2 id="comment-title">${copy.comment}</h2><div id="comments-list" class="list"></div>
      <div class="actions"><button data-close="comment-panel" type="button">${copy.close}</button><button id="new-comment" class="primary" type="button">${copy.add}</button></div>
    </section>
    <section id="new-comment-panel" class="panel hidden" aria-labelledby="new-comment-title">
      <h2 id="new-comment-title">${copy.comment}</h2>
      <label class="field">${copy.commentText}<textarea id="comment-text" maxlength="2000"></textarea></label>
      <div class="actions"><button id="cancel-comment" type="button">${copy.cancel}</button><button id="add-comment" class="primary" type="button">${copy.add}</button></div>
    </section>
    <section id="conflict-panel" class="panel hidden" aria-labelledby="conflict-title">
      <h2 id="conflict-title">${copy.saveError}</h2><div id="conflict-message" class="message error"></div>
      <div class="actions"><button id="load-server" type="button">${copy.loadServer}</button><button data-close="conflict-panel" type="button">${copy.close}</button></div>
    </section>`;

  const ui = Object.fromEntries([...shadow.querySelectorAll('[id]')].map((element) => [element.id, element]));
  ui.name.value = state.name;
  ui.token.value = state.token;

  const pageStyle = document.createElement('style');
  pageStyle.dataset.liveEditsUi = '';
  pageStyle.textContent = `
    [data-live-edits-key][data-live-edits-active]{outline:2px dashed #1769aa!important;outline-offset:3px;cursor:text}
    [data-live-edits-key][data-live-edits-comment-target]{outline:3px solid #f4a000!important;outline-offset:3px;cursor:crosshair!important}
    .live-edits-comment-pin{position:absolute;z-index:2147483645;width:25px;height:25px;border:2px solid #fff;border-radius:50%;background:#b04a00;color:#fff;font:700 13px/20px system-ui;box-shadow:0 1px 5px #0008;cursor:pointer}
  `;
  document.head.append(pageStyle);

  function showPanel(id) {
    for (const panel of shadow.querySelectorAll('.panel')) panel.classList.toggle('hidden', panel.id !== id);
    shadow.getElementById(id)?.querySelector('button,input,textarea')?.focus();
  }

  function closePanel(id) {
    shadow.getElementById(id)?.classList.add('hidden');
  }

  function setStatus(message, error = false) {
    ui.status.textContent = message;
    ui.status.dataset.error = String(error);
  }

  function setDirty(value) {
    state.dirty = value;
    ui.save.disabled = !value;
    setStatus(value ? copy.unsaved : copy.saved);
  }

  function api(path, options = {}) {
    return fetch(`${config.apiBase}${path}`, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${state.token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000)
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    });
  }

  function currentElements() {
    return Object.fromEntries(regions.map((element) => [element.dataset.liveEditsKey, element.innerHTML]));
  }

  function applyElements(elements) {
    for (const [key, fragment] of Object.entries(elements || {})) {
      const element = regionByKey.get(key);
      if (element) element.innerHTML = fragment;
    }
    positionPins();
  }

  function toggleEditing(force) {
    state.editing = force ?? !state.editing;
    for (const element of regions) {
      if (state.editing) {
        element.setAttribute('contenteditable', 'true');
        element.dataset.liveEditsActive = '';
      } else {
        element.removeAttribute('contenteditable');
        delete element.dataset.liveEditsActive;
      }
    }
    ui.edit.textContent = state.editing ? copy.stop : copy.edit;
  }

  async function loadPage() {
    const lookup = new URLSearchParams({ site_key: config.siteKey, project_path: config.projectPath });
    state.project = await api(`/api/v1/projects/lookup?${lookup}`);
    const query = new URLSearchParams({ page_path: config.pagePath });
    const [latest, comments, history] = await Promise.all([
      api(`/api/v1/projects/${state.project.id}/pages/latest?${query}`),
      api(`/api/v1/projects/${state.project.id}/comments?${query}`),
      api(`/api/v1/projects/${state.project.id}/pages/history?${query}`)
    ]);
    state.revision = latest.revision;
    state.baseElements = { ...latest.payload.elements };
    applyElements(latest.payload.elements);
    state.comments = comments;
    state.history = history;
    renderComments();
    renderHistory();
    setDirty(false);
    connectSocket();
  }

  async function connect() {
    state.name = ui.name.value.trim();
    state.token = ui.token.value;
    if (!state.name || !state.token) {
      ui['auth-error'].textContent = copy.emptyName;
      ui['auth-error'].classList.remove('hidden');
      return;
    }
    ui.connect.disabled = true;
    try {
      await loadPage();
      sessionStorage.setItem(nameKey, state.name);
      sessionStorage.setItem(tokenKey, state.token);
      closePanel('auth-panel');
      setStatus(copy.connected);
    } catch (error) {
      ui['auth-error'].textContent = error.status === 401 ? copy.authFailed : `${copy.loadError} ${error.message}`;
      ui['auth-error'].classList.remove('hidden');
      sessionStorage.removeItem(tokenKey);
    } finally {
      ui.connect.disabled = false;
    }
  }

  async function save() {
    if (!state.dirty || !state.project) return;
    ui.save.disabled = true;
    const localElements = currentElements();
    try {
      const saved = await api(`/api/v1/projects/${state.project.id}/edits`, {
        method: 'POST',
        body: {
          page_path: config.pagePath,
          base_revision: state.revision,
          edited_by: state.name,
          payload: { version: 1, elements: localElements }
        }
      });
      state.revision = saved.revision;
      state.baseElements = { ...saved.payload.elements };
      state.history.unshift(saved);
      renderHistory();
      setDirty(false);
    } catch (error) {
      if (error.status === 409 && error.body.latest) {
        handleConflict(localElements, error.body.latest);
      } else {
        setStatus(`${copy.saveError}: ${error.message}`, true);
        ui.save.disabled = false;
      }
    }
  }

  function handleConflict(localElements, latest) {
    const remote = latest.payload.elements;
    const keys = new Set([...Object.keys(state.baseElements), ...Object.keys(localElements), ...Object.keys(remote)]);
    const merged = {};
    const conflicts = [];
    for (const key of keys) {
      const base = state.baseElements[key] ?? '';
      const local = localElements[key] ?? '';
      const distant = remote[key] ?? '';
      if (local === base) merged[key] = distant;
      else if (distant === base || local === distant) merged[key] = local;
      else {
        merged[key] = local;
        conflicts.push(key);
      }
    }
    state.revision = latest.revision;
    state.baseElements = { ...remote };
    if (!conflicts.length) {
      applyElements(merged);
      setDirty(true);
      setStatus(copy.merged);
      return;
    }
    ui['conflict-message'].replaceChildren(document.createTextNode(`${copy.conflict} ${copy.conflictBlocks}: `));
    const keyList = document.createElement('div');
    keyList.className = 'conflicts';
    keyList.textContent = conflicts.join(', ');
    ui['conflict-message'].append(keyList);
    ui['load-server'].onclick = () => {
      applyElements(remote);
      setDirty(false);
      closePanel('conflict-panel');
    };
    showPanel('conflict-panel');
    ui.save.disabled = false;
  }

  function renderHistory() {
    ui['history-list'].replaceChildren();
    if (!state.history.length) {
      ui['history-list'].textContent = copy.noHistory;
      return;
    }
    for (const edit of state.history) {
      const card = document.createElement('article');
      card.className = 'card';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `r${edit.revision} · ${edit.edited_by || ''} · ${new Date(edit.created_at).toLocaleString()}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = copy.restore;
      button.addEventListener('click', () => {
        applyElements(edit.payload.elements);
        setDirty(true);
        closePanel('history-panel');
      });
      card.append(meta, button);
      ui['history-list'].append(card);
    }
  }

  function renderComments() {
    for (const pin of document.querySelectorAll('.live-edits-comment-pin')) pin.remove();
    ui['comments-list'].replaceChildren();
    for (const comment of state.comments) {
      const card = document.createElement('article');
      card.className = 'card';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${comment.author} · ${new Date(comment.created_at).toLocaleString()}`;
      const text = document.createElement('p');
      text.textContent = comment.comment_text;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = comment.resolved ? copy.reopen : copy.resolve;
      button.addEventListener('click', () => updateComment(comment, !comment.resolved));
      card.append(meta, text, button);
      ui['comments-list'].append(card);
      if (!comment.resolved && regionByKey.has(comment.element_key)) createPin(comment);
    }
    positionPins();
  }

  function createPin(comment) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'live-edits-comment-pin';
    pin.dataset.commentId = comment.id;
    pin.textContent = String(state.comments.filter((item) => !item.resolved).indexOf(comment) + 1);
    pin.title = `${comment.author}: ${comment.comment_text}`;
    pin.addEventListener('click', () => showPanel('comment-panel'));
    document.body.append(pin);
  }

  function positionPins() {
    for (const pin of document.querySelectorAll('.live-edits-comment-pin')) {
      const comment = state.comments.find((item) => item.id === pin.dataset.commentId);
      const element = comment && regionByKey.get(comment.element_key);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      pin.style.left = `${window.scrollX + rect.left + (rect.width * comment.offset_x) - 12}px`;
      pin.style.top = `${window.scrollY + rect.top + (rect.height * comment.offset_y) - 12}px`;
    }
  }

  async function updateComment(comment, resolved) {
    try {
      const updated = await api(`/api/v1/projects/${state.project.id}/comments/${comment.id}`, {
        method: 'PATCH', body: { resolved }
      });
      state.comments = state.comments.map((item) => item.id === updated.id ? updated : item);
      renderComments();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  let pendingComment = null;
  function startComment() {
    state.commentMode = true;
    setStatus(copy.selectComment);
    for (const element of regions) element.dataset.liveEditsCommentTarget = '';
  }

  function stopComment() {
    state.commentMode = false;
    pendingComment = null;
    for (const element of regions) delete element.dataset.liveEditsCommentTarget;
  }

  async function addComment() {
    const text = ui['comment-text'].value.trim();
    if (!pendingComment || !text) return;
    try {
      const comment = await api(`/api/v1/projects/${state.project.id}/comments`, {
        method: 'POST',
        body: { page_path: config.pagePath, author: state.name, comment_text: text, ...pendingComment }
      });
      if (!state.comments.some((item) => item.id === comment.id)) state.comments.push(comment);
      ui['comment-text'].value = '';
      stopComment();
      closePanel('new-comment-panel');
      renderComments();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function loadSocketClient() {
    if (window.io) return Promise.resolve();
    return new Promise((resolvePromise, reject) => {
      const script = document.createElement('script');
      script.src = `${config.apiBase}/socket.io/socket.io.js`;
      script.onload = resolvePromise;
      script.onerror = () => reject(new Error('Socket client failed to load.'));
      document.head.append(script);
    });
  }

  async function connectSocket() {
    try {
      await loadSocketClient();
      const apiUrl = new URL(config.apiBase);
      state.socket?.disconnect();
      state.socket = window.io(apiUrl.origin, {
        path: `${apiUrl.pathname.replace(/\/$/, '')}/socket.io`,
        auth: { token: state.token },
        transports: ['websocket', 'polling']
      });
      state.socket.on('connect', () => {
        state.socket.emit('join-page', {
          project_id: state.project.id, page_path: config.pagePath, name: state.name
        });
      });
      state.socket.on('presence', (users) => {
        ui.presence.textContent = `${users.length} ${copy.editors}`;
      });
      state.socket.on('comment-created', (comment) => {
        if (!state.comments.some((item) => item.id === comment.id)) state.comments.push(comment);
        renderComments();
      });
      state.socket.on('comment-updated', (comment) => {
        state.comments = state.comments.map((item) => item.id === comment.id ? comment : item);
        renderComments();
      });
      state.socket.on('edit-saved', (edit) => {
        if (edit.edited_by !== state.name && edit.revision > state.revision) setStatus(copy.conflict, true);
      });
      state.socket.on('disconnect', () => setStatus(copy.disconnected, true));
    } catch (error) {
      console.warn('Live Edits realtime connection unavailable:', error.message);
    }
  }

  ui.connect.addEventListener('click', connect);
  ui.token.addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
  ui.edit.addEventListener('click', () => toggleEditing());
  ui.save.addEventListener('click', save);
  ui.history.addEventListener('click', () => showPanel('history-panel'));
  ui.comment.addEventListener('click', () => showPanel('comment-panel'));
  ui['new-comment'].addEventListener('click', () => { closePanel('comment-panel'); startComment(); });
  ui['cancel-comment'].addEventListener('click', () => { stopComment(); closePanel('new-comment-panel'); });
  ui['add-comment'].addEventListener('click', addComment);
  shadow.addEventListener('click', (event) => {
    const id = event.target.dataset?.close;
    if (id) {
      closePanel(id);
      if (id === 'comment-panel') stopComment();
    }
  });

  document.addEventListener('input', (event) => {
    if (state.editing && event.target.closest?.('[data-live-edits-key]')) setDirty(true);
  });
  document.addEventListener('paste', (event) => {
    if (!state.editing || !event.target.closest?.('[data-live-edits-key]')) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  });
  document.addEventListener('click', (event) => {
    const region = event.target.closest?.('[data-live-edits-key]');
    if (state.editing && event.target.closest?.('a') && region) event.preventDefault();
    if (!state.commentMode || !region) return;
    event.preventDefault();
    const rect = region.getBoundingClientRect();
    pendingComment = {
      element_key: region.dataset.liveEditsKey,
      offset_x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      offset_y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
    showPanel('new-comment-panel');
  }, true);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.project) {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape' && state.commentMode) stopComment();
  });
  window.addEventListener('scroll', positionPins, { passive: true });
  window.addEventListener('resize', positionPins);
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = copy.leaveWarning;
  });

  if (state.token && state.name) connect();
  else showPanel('auth-panel');
})();
