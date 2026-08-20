(() => {
  'use strict';

  const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
  const state = { csrf: '', user: '', dashboard: null };

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  async function api(path, options = {}) {
    const response = await fetch(`api/${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(state.csrf && options.method && options.method !== 'GET' ? { 'x-live-edits-csrf': state.csrf } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 330000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showNotice(message, error = false) {
    ui.notice.textContent = message;
    ui.notice.dataset.error = String(error);
    ui.notice.hidden = false;
    if (!error) setTimeout(() => { ui.notice.hidden = true; }, 6000);
  }

  function showOperation(title, content, actions = []) {
    ui['operation-title'].textContent = title;
    ui['operation-content'].replaceChildren(...(Array.isArray(content) ? content : [content]));
    ui['operation-error'].hidden = true;
    ui['operation-actions'].replaceChildren(...actions);
    if (!ui['operation-dialog'].open) ui['operation-dialog'].showModal();
  }

  function operationError(error) {
    ui['operation-error'].textContent = error.message;
    ui['operation-error'].hidden = false;
  }

  function actionButton(label, handler, className = '') {
    const button = element('button', { type: 'button', text: label, ...(className ? { className } : {}) });
    button.addEventListener('click', handler);
    return button;
  }

  function linkButton(label, href) {
    return element('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'button-link', text: label });
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString() : 'Never';
  }

  function projectKey(project) {
    return `${project.site_key}/${encodeURIComponent(project.project_name)}`;
  }

  async function loadDashboard(message) {
    ui['refresh-dashboard'].disabled = true;
    try {
      state.dashboard = await api('dashboard');
      renderDashboard();
      if (message) showNotice(message);
    } catch (error) {
      if (error.status === 401) return signIn();
      showNotice(error.message, true);
    } finally {
      ui['refresh-dashboard'].disabled = false;
    }
  }

  function renderDashboard() {
    const data = state.dashboard;
    ui['project-count'].textContent = data.projects.length;
    ui['archive-count'].textContent = data.archives.length;
    ui['candidate-count'].textContent = data.candidates.length;
    ui['pending-count'].textContent = data.projects.reduce((sum, project) => sum + (project.remote?.unpublished_pages || 0), 0);
    ui['comment-count'].textContent = data.projects.reduce((sum, project) => sum + (project.remote?.unresolved_comments || 0), 0);
    if (!data.api.ok) showNotice(`Azure API unavailable: ${data.api.error}`, true);
    renderProjects();
    renderCandidates();
    renderArchives();
  }

  function renderProjects() {
    const query = ui['project-filter'].value.trim().toLowerCase();
    const projects = state.dashboard.projects.filter((project) =>
      `${project.project_name} ${project.site_key} ${project.project_path}`.toLowerCase().includes(query)
    );
    ui['projects-body'].replaceChildren();
    ui['no-projects'].hidden = projects.length > 0;
    for (const project of projects) {
      const remote = project.remote;
      const nameCell = element('td', {}, [
        element('strong', { text: project.project_name || remote?.name || 'Unknown project' }),
        element('small', { text: `${project.site_key?.toUpperCase() || '?'} · ${project.project_path || 'No local path'}` })
      ]);
      const reviewStatus = remote?.review_status || project.state;
      const reviewCell = element('td', {}, [
        element('span', { className: `badge ${reviewStatus}`, text: reviewStatus.replaceAll('-', ' ') }),
        element('small', { text: remote ? `${remote.page_count} page(s)` : 'Azure registration unavailable' })
      ]);
      const workCell = element('td', {}, [
        element('strong', { text: `${remote?.unpublished_pages || 0} pending` }),
        element('small', { text: `${remote?.unresolved_comments || 0} unresolved comment(s)` }),
        element('small', { text: `Last edit: ${formatDate(remote?.last_edit_at)}` })
      ]);
      const sourceCell = element('td', {}, [
        element('span', { className: `badge ${project.source_state}`, text: project.source_state || 'unknown' }),
        element('small', { text: `Published: ${formatDate(remote?.last_published_at)}` })
      ]);
      const actions = element('div', { className: 'actions' });
      if (project.preview_url) actions.append(linkButton('Open preview', project.preview_url));
      if (project.public_url) actions.append(linkButton('Open live', project.public_url));
      if (project.preview_url && navigator.clipboard) actions.append(actionButton('Copy review link', async () => {
        await navigator.clipboard.writeText(project.preview_url);
        showNotice('Review link copied.');
      }));
      if (project.state === 'ready') {
        actions.append(
          actionButton('Activity', () => showActivity(project)),
          actionButton('Refresh staging', () => confirmRefresh(project)),
          actionButton('Dry run', () => runDryRun(project)),
          actionButton('Publish', () => beginPublish(project), 'primary'),
          actionButton(remote?.review_status === 'open' ? 'Close review' : 'Reopen review', () => changeReview(project)),
          actionButton('Archive', () => confirmArchive(project), 'danger')
        );
      }
      ui['projects-body'].append(element('tr', {}, [nameCell, reviewCell, workCell, sourceCell, element('td', {}, [actions])]));
    }
  }

  function renderCandidates() {
    const query = ui['candidate-filter'].value.trim().toLowerCase();
    const candidates = state.dashboard.candidates.filter((candidate) =>
      `${candidate.folder} ${candidate.site_key}`.toLowerCase().includes(query)
    );
    ui['candidate-list'].replaceChildren();
    ui['no-candidates'].hidden = candidates.length > 0;
    for (const candidate of candidates) {
      const card = element('article', { className: 'candidate' }, [
        element('h3', { text: candidate.folder }),
        element('span', { className: 'badge', text: candidate.site_key.toUpperCase() }),
        element('p', { text: `${candidate.html_files} HTML file(s) · ${candidate.project_path}` })
      ]);
      if (candidate.issue) card.append(element('p', { className: 'error', text: candidate.issue }));
      card.append(actionButton('Add to Live Edits', () => addProject(candidate), 'primary'));
      card.lastElementChild.disabled = !candidate.supported;
      ui['candidate-list'].append(card);
    }
  }

  function renderArchives() {
    const query = ui['archive-filter'].value.trim().toLowerCase();
    const archives = state.dashboard.archives.filter((archive) => (
      `${archive.project_name} ${archive.site_key} ${archive.project_path}`.toLowerCase().includes(query)
    ));
    ui['archives-body'].replaceChildren();
    ui['no-archives'].hidden = archives.length > 0;
    for (const archive of archives) {
      const remote = archive.remote;
      const purgeAt = remote?.purge_available_at || null;
      const purgeReady = purgeAt && Date.now() >= purgeAt;
      const workBlocksPurge = Boolean(remote?.unpublished_pages || remote?.unresolved_comments);
      const retentionText = !remote
        ? 'Azure record unavailable'
        : (!purgeAt
          ? 'Retention date unavailable'
          : (purgeReady
            ? (workBlocksPurge ? 'Resolve preserved work before deletion' : 'Permanent deletion available')
            : `Protected until ${formatDate(purgeAt)}`));
      const actions = element('div', { className: 'actions' });
      if (archive.archive_id) {
        actions.append(actionButton('Restore', () => confirmRestore(archive), 'primary'));
        if (remote) {
          const purge = actionButton('Permanently delete', () => confirmPurge(archive), 'danger');
          purge.disabled = !purgeReady || workBlocksPurge;
          if (workBlocksPurge) {
            purge.title = `${remote.unpublished_pages || 0} pending page(s), ${remote.unresolved_comments || 0} unresolved comment(s)`;
          } else if (!purgeReady && purgeAt) {
            purge.title = `Available ${formatDate(purgeAt)}`;
          }
          actions.append(purge);
        }
      }
      ui['archives-body'].append(element('tr', {}, [
        element('td', {}, [
          element('strong', { text: archive.project_name || remote?.name || 'Unknown project' }),
          element('small', { text: `${archive.site_key?.toUpperCase() || '?'} · ${archive.project_path || 'No path'}` })
        ]),
        element('td', {}, [
          element('span', { className: 'badge archived', text: archive.state.replaceAll('-', ' ') }),
          element('small', { text: formatDate(archive.archived_at) }),
          element('small', { text: archive.archived_by ? `By ${archive.archived_by}` : '' })
        ]),
        element('td', {}, [
          element('span', { className: purgeReady ? 'retention-ready' : 'retention-wait', text: retentionText })
        ]),
        element('td', {}, [
          element('strong', {
            text: archive.state === 'remote-only'
              ? 'No C9 archive record'
              : (archive.source_archived ? 'Archived privately' : 'Retained in web root')
          }),
          element('small', {
            text: archive.state === 'remote-only'
              ? 'Manual recovery is required'
              : (archive.source_archived ? 'Restored with the project' : 'Never removed')
          })
        ]),
        element('td', {}, [actions])
      ]));
    }
  }

  async function addProject(candidate) {
    const text = element('p', { text: `Stage every HTML page in ${candidate.site_key.toUpperCase()}:${candidate.folder} and register it with Azure TEST?` });
    const add = actionButton('Add project', async () => {
      add.disabled = true;
      try {
        const result = await api('projects', {
          method: 'POST', body: { site_key: candidate.site_key, folder: candidate.folder }, timeout: 330000
        });
        ui['operation-dialog'].close();
        await loadDashboard(result.stdout || 'Project added.');
      } catch (error) {
        operationError(error);
      } finally {
        add.disabled = false;
      }
    }, 'primary');
    showOperation(`Add ${candidate.folder}`, text, [actionButton('Cancel', () => ui['operation-dialog'].close()), add]);
  }

  function confirmRefresh(project) {
    const warning = project.remote?.unpublished_pages
      ? `${project.remote.unpublished_pages} page(s) have unpublished edits. Refreshing can make older edits incompatible when the source structure changes.`
      : 'The existing preview will be backed up, rebuilt from the source product, and re-registered.';
    const refresh = actionButton('Refresh staging', async () => {
      refresh.disabled = true;
      try {
        const result = await api(`projects/${projectKey(project)}/refresh`, { method: 'POST', body: {}, timeout: 330000 });
        ui['operation-dialog'].close();
        await loadDashboard(result.stdout || 'Staging refreshed.');
      } catch (error) {
        operationError(error);
      } finally {
        refresh.disabled = false;
      }
    }, 'primary');
    showOperation(`Refresh ${project.project_name}`, element('p', { text: warning }), [
      actionButton('Cancel', () => ui['operation-dialog'].close()), refresh
    ]);
  }

  async function runDryRun(project) {
    showOperation(`Publication dry run: ${project.project_name}`, element('p', { text: 'Building the validated publication plan…' }));
    try {
      const result = await api(`projects/${projectKey(project)}/dry-run`, { method: 'POST', body: {}, timeout: 330000 });
      showOperation(`Publication dry run: ${project.project_name}`, element('pre', { className: 'output', text: result.stdout || 'No output.' }), [
        actionButton('Close', () => ui['operation-dialog'].close())
      ]);
    } catch (error) {
      operationError(error);
    }
  }

  async function beginPublish(project) {
    showOperation(`Publish ${project.project_name}`, element('p', { text: 'Running the required dry run first…' }));
    try {
      const result = await api(`projects/${projectKey(project)}/dry-run`, { method: 'POST', body: {}, timeout: 330000 });
      const confirmation = element('input', {
        type: 'text', autocomplete: 'off', placeholder: project.project_name,
        'aria-label': `Enter ${project.project_name} to confirm`
      });
      const publish = actionButton('Publish changes', async () => {
        publish.disabled = true;
        try {
          const published = await api(`projects/${projectKey(project)}/publish`, {
            method: 'POST', body: { confirmation: confirmation.value }, timeout: 330000
          });
          ui['operation-dialog'].close();
          await loadDashboard(published.stdout || 'Changes published.');
        } catch (error) {
          operationError(error);
        } finally {
          publish.disabled = false;
        }
      }, 'primary');
      showOperation(`Publish ${project.project_name}`, [
        element('p', { text: 'Review the dry run below. Publication writes only validated keyed content and creates a private backup.' }),
        element('pre', { className: 'output', text: result.stdout || 'No output.' }),
        element('label', { text: `Enter ${project.project_name} to confirm` }, [confirmation])
      ], [actionButton('Cancel', () => ui['operation-dialog'].close()), publish]);
    } catch (error) {
      operationError(error);
    }
  }

  function confirmArchive(project) {
    const remote = project.remote || {};
    const confirmation = element('input', {
      type: 'text', autocomplete: 'off', placeholder: project.project_name,
      'aria-label': `Enter ${project.project_name} to confirm archival`
    });
    const archiveSource = element('input', { type: 'checkbox' });
    const archive = actionButton('Archive project', async () => {
      archive.disabled = true;
      try {
        const result = await api(`projects/${projectKey(project)}/archive`, {
          method: 'POST', timeout: 330000,
          body: { confirmation: confirmation.value, archive_source: archiveSource.checked }
        });
        ui['operation-dialog'].close();
        await loadDashboard(`${result.site_key.toUpperCase()}:${result.project_name} archived.`);
      } catch (error) {
        operationError(error);
      } finally {
        archive.disabled = false;
      }
    }, 'danger');
    showOperation(`Archive ${project.project_name}`, [
      element('p', { text: 'Archiving closes review, preserves Azure history, and moves the staged preview and private configuration out of active use.' }),
      element('div', { className: 'warning', text: `${remote.unpublished_pages || 0} pending page(s) and ${remote.unresolved_comments || 0} unresolved comment(s) will be preserved.` }),
      element('label', { text: `Enter ${project.project_name} to confirm` }, [confirmation]),
      element('label', { className: 'check-field' }, [
        archiveSource,
        element('span', { text: 'Also move the source folder into the private archive. Use this only for smoke tests or temporary demonstrations.' })
      ])
    ], [actionButton('Cancel', () => ui['operation-dialog'].close()), archive]);
  }

  function confirmRestore(archive) {
    const confirmation = element('input', {
      type: 'text', autocomplete: 'off', placeholder: archive.project_name,
      'aria-label': `Enter ${archive.project_name} to confirm restoration`
    });
    const restore = actionButton('Restore project', async () => {
      restore.disabled = true;
      try {
        const result = await api(`archives/${archive.archive_id}/restore`, {
          method: 'POST', timeout: 330000, body: { confirmation: confirmation.value }
        });
        ui['operation-dialog'].close();
        await loadDashboard(result.stdout || `${result.site_key.toUpperCase()}:${result.project_name} restored.`);
      } catch (error) {
        operationError(error);
      } finally {
        restore.disabled = false;
      }
    }, 'primary');
    showOperation(`Restore ${archive.project_name}`, [
      element('p', { text: 'Restoration rebuilds staging from the current source, reactivates the Azure registration, and keeps review closed until you reopen it.' }),
      element('label', { text: `Enter ${archive.project_name} to confirm` }, [confirmation])
    ], [actionButton('Cancel', () => ui['operation-dialog'].close()), restore]);
  }

  function confirmPurge(archive) {
    const confirmation = element('input', {
      type: 'text', autocomplete: 'off', placeholder: archive.project_name,
      'aria-label': `Enter ${archive.project_name} to confirm permanent deletion`
    });
    const deleteConfirmation = element('input', {
      type: 'text', autocomplete: 'off', placeholder: 'DELETE',
      'aria-label': 'Enter DELETE to confirm permanent deletion'
    });
    const purge = actionButton('Permanently delete', async () => {
      purge.disabled = true;
      try {
        const result = await api(`archives/${archive.archive_id}/purge`, {
          method: 'POST', timeout: 330000,
          body: { confirmation: confirmation.value, delete_confirmation: deleteConfirmation.value }
        });
        ui['operation-dialog'].close();
        await loadDashboard(`${result.site_key.toUpperCase()}:${result.project_name} permanently deleted.`);
      } catch (error) {
        operationError(error);
      } finally {
        purge.disabled = false;
      }
    }, 'danger');
    showOperation(`Permanently delete ${archive.project_name}`, [
      element('div', { className: 'error', text: 'This deletes the Azure history and the private project archive. It cannot be undone from the Admin Console.' }),
      element('label', { text: `Enter ${archive.project_name}` }, [confirmation]),
      element('label', { text: 'Enter DELETE' }, [deleteConfirmation])
    ], [actionButton('Cancel', () => ui['operation-dialog'].close()), purge]);
  }

  function changeReview(project) {
    const next = project.remote?.review_status === 'open' ? 'closed' : 'open';
    const description = next === 'closed'
      ? 'Closing review immediately blocks reviewer API access while preserving all edits, comments, previews, and backups.'
      : 'Reopening review allows network-authorized reviewers to connect again.';
    const change = actionButton(next === 'closed' ? 'Close review' : 'Reopen review', async () => {
      change.disabled = true;
      try {
        await api(`projects/${projectKey(project)}/review`, { method: 'POST', body: { review_status: next } });
        ui['operation-dialog'].close();
        await loadDashboard(`Review ${next}.`);
      } catch (error) {
        operationError(error);
      } finally {
        change.disabled = false;
      }
    }, next === 'closed' ? 'danger' : 'primary');
    showOperation(`${next === 'closed' ? 'Close' : 'Reopen'} ${project.project_name}`, element('p', { text: description }), [
      actionButton('Cancel', () => ui['operation-dialog'].close()), change
    ]);
  }

  async function showActivity(project) {
    showOperation(`Activity: ${project.project_name}`, element('p', { text: 'Loading activity…' }));
    try {
      const activity = await api(`projects/${projectKey(project)}/activity`);
      const entries = [
        ...activity.edits.map((item) => ({ time: item.created_at, text: `${item.edited_by} saved ${item.page_path} revision ${item.revision}.` })),
        ...activity.comments.map((item) => ({ time: item.created_at, text: `${item.author} added a comment on ${item.page_path}.` })),
        ...activity.publishes.map((item) => ({ time: item.created_at, text: `${item.published_by} published ${item.pages.length} page(s).` }))
      ].sort((a, b) => b.time - a.time).slice(0, 75);
      const list = element('div', { className: 'activity-list' });
      if (!entries.length) list.append(element('p', { text: 'No activity yet.' }));
      for (const entry of entries) list.append(element('div', { className: 'activity-item' }, [
        element('strong', { text: formatDate(entry.time) }), element('div', { text: entry.text })
      ]));
      showOperation(`Activity: ${project.project_name}`, list, [actionButton('Close', () => ui['operation-dialog'].close())]);
    } catch (error) {
      operationError(error);
    }
  }

  function signIn() {
    ui.main.hidden = true;
    ui['login-error'].hidden = true;
    if (!ui['login-dialog'].open) ui['login-dialog'].showModal();
  }

  ui['login-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = ui['login-form'].querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const session = await api('login', {
        method: 'POST', body: { name: ui['admin-name'].value, passphrase: ui['admin-passphrase'].value }
      });
      state.user = session.name;
      state.csrf = session.csrf;
      ui['admin-passphrase'].value = '';
      ui['signed-in-user'].textContent = session.name;
      ui['login-dialog'].close();
      ui.main.hidden = false;
      await loadDashboard();
    } catch (error) {
      ui['login-error'].textContent = error.message;
      ui['login-error'].hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  ui['sign-out'].addEventListener('click', async () => {
    try { await api('logout', { method: 'POST', body: {} }); } catch { /* session is being discarded */ }
    state.csrf = '';
    state.user = '';
    signIn();
  });
  ui['refresh-dashboard'].addEventListener('click', () => loadDashboard('Dashboard refreshed.'));
  ui['project-filter'].addEventListener('input', renderProjects);
  ui['candidate-filter'].addEventListener('input', renderCandidates);
  ui['archive-filter'].addEventListener('input', renderArchives);
  ui['login-dialog'].addEventListener('cancel', (event) => event.preventDefault());

  (async () => {
    try {
      const session = await api('session');
      state.user = session.name;
      state.csrf = session.csrf;
      ui['signed-in-user'].textContent = session.name;
      ui.main.hidden = false;
      await loadDashboard();
    } catch {
      signIn();
    }
  })();
})();
