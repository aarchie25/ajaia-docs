// app.test.js
// Automated tests. Run them with:  npm test
// Each test starts the real app with a throwaway in-memory database,
// then sends real HTTP requests to it, like a browser would.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  const app = createApp(openDb(':memory:'));
  // Port 0 = "pick any free port"
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

// Helper: log in as someone and return a function that makes requests as them.
async function loginAs(email) {
  const res = await fetch(baseUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];

  return async (method, url, body) => {
    const options = { method, headers: { Cookie: cookie } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const r = await fetch(baseUrl + url, options);
    return { status: r.status, data: await r.json() };
  };
}

test('requests without login are rejected', async () => {
  const res = await fetch(baseUrl + '/api/documents');
  assert.strictEqual(res.status, 401);
});

test('a saved document keeps its formatting after reopening', async () => {
  const aarchi = await loginAs('aarchi@example.com');
  const created = await aarchi('POST', '/api/documents', { title: 'My notes' });
  assert.strictEqual(created.status, 201);

  const html = '<h1>Title</h1><p><strong>bold</strong> <em>italic</em> <u>under</u></p><ul><li>one</li></ul>';
  await aarchi('PUT', `/api/documents/${created.data.id}`, { content: html });

  const reopened = await aarchi('GET', `/api/documents/${created.data.id}`);
  assert.strictEqual(reopened.data.content, html);
  assert.strictEqual(reopened.data.role, 'owner');
});

test('renaming works and bad titles are rejected', async () => {
  const aarchi = await loginAs('aarchi@example.com');
  const { data } = await aarchi('POST', '/api/documents', {});

  const ok = await aarchi('PUT', `/api/documents/${data.id}`, { title: 'New name' });
  assert.strictEqual(ok.status, 200);

  const bad = await aarchi('PUT', `/api/documents/${data.id}`, { title: '   ' });
  assert.strictEqual(bad.status, 400);
});

test('sharing: others cannot see a doc until it is shared, and roles are enforced', async () => {
  const aarchi = await loginAs('aarchi@example.com');
  const andy = await loginAs('andy@example.com');
  const { data: doc } = await aarchi('POST', '/api/documents', { title: 'Secret plan' });

  // Before sharing, Andy gets "not found".
  assert.strictEqual((await andy('GET', `/api/documents/${doc.id}`)).status, 404);

  // Share as view-only: Andy can read but not edit.
  await aarchi('POST', `/api/documents/${doc.id}/share`, { email: 'andy@example.com', role: 'view' });
  const read = await andy('GET', `/api/documents/${doc.id}`);
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.data.role, 'view');
  assert.strictEqual((await andy('PUT', `/api/documents/${doc.id}`, { content: '<p>hi</p>' })).status, 403);

  // It shows up under "shared", not "owned", in Andy's list.
  const list = await andy('GET', '/api/documents');
  assert.ok(list.data.shared.some((d) => d.id === doc.id));
  assert.ok(!list.data.owned.some((d) => d.id === doc.id));

  // Upgrade to edit: now Andy can save.
  await aarchi('POST', `/api/documents/${doc.id}/share`, { email: 'andy@example.com', role: 'edit' });
  assert.strictEqual((await andy('PUT', `/api/documents/${doc.id}`, { content: '<p>hi</p>' })).status, 200);

  // Andy (not the owner) cannot share or delete.
  assert.strictEqual(
    (await andy('POST', `/api/documents/${doc.id}/share`, { email: 'robert@example.com', role: 'view' })).status, 403
  );
  assert.strictEqual((await andy('DELETE', `/api/documents/${doc.id}`)).status, 403);

  // Removing the share takes Andy's access away again.
  const andyId = read.data && (await aarchi('GET', `/api/documents/${doc.id}`)).data.shares[0].user_id;
  await aarchi('DELETE', `/api/documents/${doc.id}/share/${andyId}`);
  assert.strictEqual((await andy('GET', `/api/documents/${doc.id}`)).status, 404);
});

test('sharing validates input', async () => {
  const aarchi = await loginAs('aarchi@example.com');
  const { data: doc } = await aarchi('POST', '/api/documents', {});
  assert.strictEqual((await aarchi('POST', `/api/documents/${doc.id}/share`, { email: 'nobody@x.com', role: 'view' })).status, 404);
  assert.strictEqual((await aarchi('POST', `/api/documents/${doc.id}/share`, { email: 'andy@example.com', role: 'admin' })).status, 400);
  assert.strictEqual((await aarchi('POST', `/api/documents/${doc.id}/share`, { email: 'aarchi@example.com', role: 'view' })).status, 400);
});

test('dangerous HTML (like <script>) is removed when saving', async () => {
  const aarchi = await loginAs('aarchi@example.com');
  const { data: doc } = await aarchi('POST', '/api/documents', {});
  await aarchi('PUT', `/api/documents/${doc.id}`, {
    content: '<p onclick="evil()">hello</p><script>alert(1)</script>',
  });
  const { data } = await aarchi('GET', `/api/documents/${doc.id}`);
  assert.strictEqual(data.content, '<p>hello</p>');
});

// Helper for upload tests: send a file as multipart form data.
async function upload(email, filename, text) {
  const aarchi = await loginAs(email);
  // We need the cookie, so log in again here to grab it.
  const res = await fetch(baseUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([text]), filename);
  const r = await fetch(baseUrl + '/api/documents/import', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: r.status, data: await r.json(), asUser: aarchi };
}

test('uploading a .md file creates an editable document', async () => {
  const { status, data, asUser } = await upload('aarchi@example.com', 'readme.md', '# Hello\n\nSome **bold** text');
  assert.strictEqual(status, 201);
  assert.strictEqual(data.title, 'readme');

  const doc = await asUser('GET', `/api/documents/${data.id}`);
  assert.match(doc.data.content, /<h1[^>]*>Hello<\/h1>/);
  assert.match(doc.data.content, /<strong>bold<\/strong>/);
});

test('uploading a .txt file works and unsupported types are rejected', async () => {
  const good = await upload('aarchi@example.com', 'note.txt', 'line one\n\nline two');
  assert.strictEqual(good.status, 201);

  const bad = await upload('aarchi@example.com', 'virus.exe', 'nope');
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /Unsupported/);
});
