// app.js (frontend)
// This file runs in the browser. It talks to our server using fetch().
// Plan:  login -> document list -> editor (with autosave and sharing).

// ---------- Tiny helpers ----------

// Shortcut for document.getElementById
const $ = (id) => document.getElementById(id);

// Turn text into safe HTML (so a title like "<b>hi</b>" can't break the page).
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// One function for all server calls. It sends JSON, and if the server
// replies with an error, it throws an Error with the server's message.
async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// Show one screen and hide the others.
function showView(name) {
  $('login-view').hidden = name !== 'login';
  $('app-view').hidden = name === 'login';
  $('list-view').hidden = name !== 'list';
  $('editor-view').hidden = name !== 'editor';
}

// ---------- Looks: avatars, dates, previews ----------

// Each avatar gets a gradient. The color is picked from the person's name,
// so the same person always gets the same color.
const AVATAR_COLORS = [
  ['#6d5dfc', '#9b8cff'],
  ['#ff7a59', '#ffb199'],
  ['#14b8a6', '#5eead4'],
  ['#f59e0b', '#fcd34d'],
  ['#ec4899', '#f9a8d4'],
  ['#3b82f6', '#93c5fd'],
];

// Make a round avatar with initials. size can be 'sm', 'md' or 'lg'.
function avatar(name, size = 'md') {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  const [c1, c2] = AVATAR_COLORS[sum % AVATAR_COLORS.length];

  const words = name.trim().split(/\s+/);
  const initials = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0][0];

  return `<span class="avatar ${size}" title="${esc(name)}"
    style="background:linear-gradient(135deg,${c1},${c2})">${esc(initials.toUpperCase())}</span>`;
}

// Turn a date into friendly text like "3 hours ago".
function timeAgo(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return new Date(iso).toLocaleDateString();
}

// Take the saved HTML and return just the words (for the card thumbnail).
function previewText(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return (doc.body.textContent || '').trim().slice(0, 160);
}

// "Good morning, Aarchi"
function greetingFor(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(' ')[0]}`;
}

// ---------- Login ----------

let me = null;        // the logged-in user
let allUsers = [];    // everyone on the team (used for quick-share buttons)

async function loadLoginScreen() {
  showView('login');
  const users = await api('GET', '/api/users');
  $('user-buttons').innerHTML = users
    .map(
      (u) => `<button class="user-card" data-email="${esc(u.email)}">
        ${avatar(u.name, 'lg')}
        <span>
          <strong>${esc(u.name)}</strong>
          <small>${esc(u.job_title)}</small>
          <small>${esc(u.email)}</small>
        </span>
      </button>`
    )
    .join('');
}

$('user-buttons').addEventListener('click', async (event) => {
  const button = event.target.closest('.user-card');
  if (!button) return;
  const user = await api('POST', '/api/login', { email: button.dataset.email });
  startApp(user);
});

$('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  loadLoginScreen();
});

async function startApp(user) {
  me = user;
  allUsers = await api('GET', '/api/users');
  $('me-avatar').innerHTML = avatar(user.name);
  $('user-name').textContent = user.name;
  $('user-title').textContent = user.job_title;
  showList();
}

// ---------- Document list ----------

// Build the HTML for one document card.
// "owned" is true for the "My documents" section.
function docCard(d, owned) {
  const tone = d.id % 6; // picks one of six color tones
  let footer;

  if (owned) {
    const people = d.shared_with ? d.shared_with.split('|') : [];
    const who = people.length
      ? `<span class="avatar-stack">${people.map((n) => avatar(n, 'sm')).join('')}</span>`
      : '<span class="private">Only you</span>';
    footer = `<span class="badge owner">Owner</span> ${who}
      <button class="delete-btn" data-id="${d.id}">Delete</button>`;
  } else {
    footer = `<span class="badge ${esc(d.role)}">Can ${esc(d.role)}</span>
      <span class="from">${avatar(d.owner_name, 'sm')} ${esc(d.owner_name)}</span>`;
  }

  return `<article class="doc-card" data-id="${d.id}">
    <div class="doc-thumb tone-${tone}"><p class="doc-preview">${esc(previewText(d.preview))}</p></div>
    <div class="doc-body">
      <h3>${esc(d.title)}</h3>
      <div class="doc-meta">Edited ${timeAgo(d.updated_at)}</div>
      <div class="doc-foot">${footer}</div>
    </div>
  </article>`;
}

async function showList() {
  showView('list');
  $('greeting').textContent = greetingFor(me.name);
  $('list-error').textContent = '';
  try {
    const { owned, shared } = await api('GET', '/api/documents');

    $('owned-count').textContent = owned.length;
    $('shared-count').textContent = shared.length;

    $('owned-list').innerHTML = owned.length
      ? owned.map((d) => docCard(d, true)).join('')
      : '<div class="empty-state">No documents yet. Create one or upload a file to get started.</div>';

    $('shared-list').innerHTML = shared.length
      ? shared.map((d) => docCard(d, false)).join('')
      : '<div class="empty-state">Nothing has been shared with you yet.</div>';
  } catch (err) {
    $('list-error').textContent = err.message;
  }
}

// Click a card to open it (or click Delete to delete it).
document.addEventListener('click', async (event) => {
  const deleteBtn = event.target.closest('.delete-btn');
  if (deleteBtn) {
    event.stopPropagation();
    if (confirm('Delete this document? This cannot be undone.')) {
      try {
        await api('DELETE', '/api/documents/' + deleteBtn.dataset.id);
      } catch (err) {
        $('list-error').textContent = err.message;
      }
      showList();
    }
    return;
  }
  const card = event.target.closest('.doc-card');
  if (card) openDocument(card.dataset.id);
});

$('new-doc-btn').addEventListener('click', async () => {
  try {
    const doc = await api('POST', '/api/documents', { title: 'Untitled document' });
    openDocument(doc.id);
  } catch (err) {
    $('list-error').textContent = err.message;
  }
});

// Upload a file -> server turns it into a new document.
$('upload-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = ''; // reset so the same file can be picked again
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/documents/import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    openDocument(data.id);
  } catch (err) {
    $('list-error').textContent = err.message;
  }
});

// ---------- Editor ----------

// Create the Quill editor once. The toolbar has the formatting buttons.
const quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Start writing...',
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],          // headings (false = normal text)
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['clean'],                               // remove formatting
    ],
  },
});

let current = null;   // the document that is open right now
let saveTimer = null; // used for autosave (we wait a moment after typing stops)

function setStatus(text) {
  $('save-status').textContent = text;
}

// Show the small row of avatars for everyone who can open this document.
function updateCollaborators() {
  const names = [current.owner_name, ...(current.shares || []).map((s) => s.name)];
  $('collab').innerHTML = names.map((n) => avatar(n)).join('');
}

async function openDocument(id) {
  $('editor-error').textContent = '';
  try {
    current = await api('GET', '/api/documents/' + id);
  } catch (err) {
    $('list-error').textContent = err.message;
    return;
  }
  showView('editor');
  window.scrollTo(0, 0);

  // Put the saved HTML into the editor. 'silent' means "don't count this as a user edit".
  quill.clipboard.dangerouslyPasteHTML(current.content, 'silent');
  quill.history.clear();

  $('title-input').value = current.title;
  setStatus('');

  // Viewers can read but not type.
  const canEdit = current.role !== 'view';
  quill.enable(canEdit);
  $('title-input').disabled = !canEdit;
  $('editor-wrap').classList.toggle('readonly', !canEdit);

  // Show who we are in this document.
  const badge = $('role-badge');
  badge.textContent =
    current.role === 'owner' ? 'Owner' : `Shared by ${current.owner_name} · can ${current.role}`;
  badge.className = 'badge ' + current.role;

  // Only the owner sees the Share button.
  $('share-btn').hidden = current.role !== 'owner';
  $('share-panel').hidden = true;
  if (current.role === 'owner') renderShares();
  updateCollaborators();
}

// Autosave: every time the USER changes the text, wait 1 second, then save.
quill.on('text-change', (delta, oldDelta, source) => {
  if (source !== 'user') return; // ignore changes we made in code
  setStatus('Unsaved changes...');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1000);
});

async function saveNow() {
  if (!current || current.role === 'view') return;
  clearTimeout(saveTimer);
  setStatus('Saving...');
  try {
    await api('PUT', '/api/documents/' + current.id, { content: quill.root.innerHTML });
    setStatus('Saved ✓');
  } catch (err) {
    setStatus('');
    $('editor-error').textContent = 'Could not save: ' + err.message;
  }
}

// Rename: save the title when the user finishes typing in the box.
$('title-input').addEventListener('change', async () => {
  try {
    await api('PUT', '/api/documents/' + current.id, { title: $('title-input').value });
    $('editor-error').textContent = '';
    setStatus('Saved ✓');
  } catch (err) {
    $('editor-error').textContent = err.message;
  }
});

$('back-btn').addEventListener('click', async () => {
  await saveNow(); // don't lose changes
  current = null;
  showList();
});

// ---------- Sharing ----------

$('share-btn').addEventListener('click', () => {
  $('share-panel').hidden = !$('share-panel').hidden;
});

// Draw the list of people this document is shared with,
// plus quick-add buttons for teammates who don't have access yet.
function renderShares() {
  $('share-list').innerHTML = current.shares.length
    ? current.shares
        .map(
          (s) => `<li class="person">
            ${avatar(s.name)}
            <div class="person-text">
              <strong>${esc(s.name)}</strong>
              <small>${esc(s.job_title || '')} · ${esc(s.email)}</small>
            </div>
            <span class="badge ${esc(s.role)}">Can ${esc(s.role)}</span>
            <button class="link-btn" data-user="${s.user_id}">Remove</button>
          </li>`
        )
        .join('')
    : '<li class="empty">Not shared with anyone yet.</li>';

  const alreadyShared = new Set(current.shares.map((s) => s.user_id));
  const people = allUsers.filter((u) => u.id !== me.id && !alreadyShared.has(u.id));
  $('share-suggest').innerHTML = people.length
    ? '<small class="muted">Quick add:</small>' +
      people
        .map(
          (u) => `<button type="button" class="chip" data-email="${esc(u.email)}">
            ${avatar(u.name, 'sm')} ${esc(u.name)}</button>`
        )
        .join('')
    : '';

  updateCollaborators();
}

// Clicking a quick-add button fills in the email box.
$('share-suggest').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) $('share-email').value = chip.dataset.email;
});

$('share-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('share-error').textContent = '';
  try {
    const result = await api('POST', `/api/documents/${current.id}/share`, {
      email: $('share-email').value,
      role: $('share-role').value,
    });
    // Update our local list (replace if the person was already in it).
    current.shares = current.shares.filter((s) => s.user_id !== result.user_id);
    current.shares.push(result);
    renderShares();
    $('share-email').value = '';
  } catch (err) {
    $('share-error').textContent = err.message;
  }
});

$('share-list').addEventListener('click', async (event) => {
  const userId = event.target.dataset.user;
  if (!userId) return;
  try {
    await api('DELETE', `/api/documents/${current.id}/share/${userId}`);
    current.shares = current.shares.filter((s) => String(s.user_id) !== userId);
    renderShares();
  } catch (err) {
    $('share-error').textContent = err.message;
  }
});

// ---------- Start ----------
// When the page loads, check if we are already logged in (cookie still valid).
(async function init() {
  try {
    const user = await api('GET', '/api/me');
    startApp(user);
  } catch {
    loadLoginScreen();
  }
})();
