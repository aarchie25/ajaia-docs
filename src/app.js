// app.js
// This file builds the web server (all the API routes).
// We keep it separate from server.js so the tests can create the app
// with a throwaway in-memory database.

const express = require('express');
const multer = require('multer');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const mammoth = require('mammoth');
const { marked } = require('marked');

// ---------- Small helper functions ----------

// Only these HTML tags are allowed to be saved. Everything else
// (like <script>) is removed. This protects us from XSS attacks,
// where someone saves malicious code inside a document.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'a', 'span',
  ],
  allowedAttributes: {
    a: ['href'],
    '*': ['class'], // Quill uses classes for things like indentation
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

function cleanHtml(html) {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// Turn plain text into simple HTML paragraphs.
function textToHtml(text) {
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\r?\n\r?\n/) // blank line = new paragraph
    .filter((block) => block.trim() !== '')
    .map((block) => '<p>' + escape(block).replace(/\r?\n/g, '<br>') + '</p>')
    .join('');
}

// Check that a title is a non-empty string of a reasonable length.
// Returns the cleaned title, or null if it is not valid.
function validTitle(title) {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  return trimmed;
}

// Read one cookie value from the request (so we don't need another library).
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// ---------- Build the app ----------

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // File uploads are kept in memory (no files written to disk). Max 2 MB.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
  });

  // --- Login (mocked) ---
  // There are no passwords. You pick one of the seeded users.
  // This is on purpose: real auth would take time away from the core features.

  app.get('/api/users', (req, res) => {
    res.json(db.prepare('SELECT id, name, email, job_title FROM users').all());
  });

  app.post('/api/login', (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const user = db
      .prepare('SELECT id, name, email, job_title FROM users WHERE email = ?')
      .get(email);
    if (!user) return res.status(404).json({ error: 'No user with that email.' });

    // Remember who is logged in using a cookie.
    res.setHeader('Set-Cookie', `uid=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
    res.json(user);
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'uid=; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // Middleware: runs before every route below this line.
  // It finds the logged-in user, or stops the request with a 401 error.
  app.use('/api', (req, res, next) => {
    const id = Number(readCookie(req, 'uid'));
    const user = id
      ? db.prepare('SELECT id, name, email, job_title FROM users WHERE id = ?').get(id)
      : null;
    if (!user) return res.status(401).json({ error: 'Please log in.' });
    req.user = user;
    next();
  });

  app.get('/api/me', (req, res) => res.json(req.user));

  // --- Access check ---
  // Returns the document and the user's role for it:
  //   'owner' | 'edit' | 'view' | null (no access)
  function getAccess(docId, userId) {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
    if (!doc) return { doc: null, role: null };
    if (doc.owner_id === userId) return { doc, role: 'owner' };
    const share = db
      .prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?')
      .get(docId, userId);
    return { doc, role: share ? share.role : null };
  }

  // --- Documents ---

  // List: documents I own, and documents shared with me.
  app.get('/api/documents', (req, res) => {
    // "preview" is the start of the content, used to draw the little page
    // thumbnail on each card. "shared_with" is a list of names joined by "|".
    const owned = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at, substr(d.content, 1, 600) AS preview,
           (SELECT group_concat(u.name, '|')
              FROM shares s JOIN users u ON u.id = s.user_id
              WHERE s.document_id = d.id) AS shared_with
         FROM documents d
         WHERE d.owner_id = ?
         ORDER BY d.updated_at DESC`
      )
      .all(req.user.id);

    const shared = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at, substr(d.content, 1, 600) AS preview,
           u.name AS owner_name, s.role
         FROM documents d
         JOIN shares s ON s.document_id = d.id
         JOIN users u ON u.id = d.owner_id
         WHERE s.user_id = ?
         ORDER BY d.updated_at DESC`
      )
      .all(req.user.id);

    res.json({ owned, shared });
  });

  // Create a new blank document.
  app.post('/api/documents', (req, res) => {
    const title = validTitle((req.body && req.body.title) || 'Untitled document');
    if (!title) return res.status(400).json({ error: 'Title must be 1-120 characters.' });

    const now = new Date().toISOString();
    const result = db
      .prepare(
        'INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(req.user.id, title, '', now, now);

    res.status(201).json({ id: result.lastInsertRowid, title });
  });

  // Import a file (.txt, .md, .docx) as a brand new document.
  // NOTE: this route must be above /api/documents/:id so "import" is not
  // mistaken for an id.
  app.post('/api/documents/import', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Please choose a file.' });

      const ext = path.extname(req.file.originalname).toLowerCase();
      let html;

      if (ext === '.txt') {
        html = textToHtml(req.file.buffer.toString('utf8'));
      } else if (ext === '.md') {
        html = marked.parse(req.file.buffer.toString('utf8'));
      } else if (ext === '.docx') {
        const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
        html = result.value;
      } else {
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Please upload .txt, .md or .docx.' });
      }

      // Use the file name (without extension) as the title.
      const title =
        validTitle(path.basename(req.file.originalname, ext)) || 'Imported document';
      const now = new Date().toISOString();
      const result = db
        .prepare(
          'INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(req.user.id, title, cleanHtml(html), now, now);

      res.status(201).json({ id: result.lastInsertRowid, title });
    } catch (err) {
      next(err); // goes to the error handler at the bottom
    }
  });

  // Open one document.
  app.get('/api/documents/:id', (req, res) => {
    const { doc, role } = getAccess(Number(req.params.id), req.user.id);
    // If there is no access we say "not found" (instead of "forbidden")
    // so people can't discover which document ids exist.
    if (!doc || !role) return res.status(404).json({ error: 'Document not found.' });

    const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(doc.owner_id);
    const response = {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      role,
      owner_name: owner.name,
      updated_at: doc.updated_at,
    };

    // Only the owner gets to see the list of people it is shared with.
    if (role === 'owner') {
      response.shares = db
        .prepare(
          `SELECT u.id AS user_id, u.name, u.email, u.job_title, s.role
           FROM shares s JOIN users u ON u.id = s.user_id
           WHERE s.document_id = ?`
        )
        .all(doc.id);
    }
    res.json(response);
  });

  // Save changes (title and/or content). Owners and editors are allowed.
  app.put('/api/documents/:id', (req, res) => {
    const { doc, role } = getAccess(Number(req.params.id), req.user.id);
    if (!doc || !role) return res.status(404).json({ error: 'Document not found.' });
    if (role === 'view') return res.status(403).json({ error: 'You only have view access.' });

    const body = req.body || {};
    let title = doc.title;
    let content = doc.content;

    if (body.title !== undefined) {
      title = validTitle(body.title);
      if (!title) return res.status(400).json({ error: 'Title must be 1-120 characters.' });
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string') {
        return res.status(400).json({ error: 'Content must be text.' });
      }
      content = cleanHtml(body.content);
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
      title, content, now, doc.id
    );
    res.json({ ok: true, updated_at: now });
  });

  // Delete a document. Owner only.
  app.delete('/api/documents/:id', (req, res) => {
    const { doc, role } = getAccess(Number(req.params.id), req.user.id);
    if (!doc || !role) return res.status(404).json({ error: 'Document not found.' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete.' });

    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id); // shares go too (CASCADE)
    res.json({ ok: true });
  });

  // --- Sharing (owner only) ---

  // Share with someone by email. Calling it again with a different role updates it.
  app.post('/api/documents/:id/share', (req, res) => {
    const { doc, role } = getAccess(Number(req.params.id), req.user.id);
    if (!doc || !role) return res.status(404).json({ error: 'Document not found.' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can share.' });

    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const shareRole = req.body && req.body.role;

    if (!['view', 'edit'].includes(shareRole)) {
      return res.status(400).json({ error: 'Role must be "view" or "edit".' });
    }
    const target = db
      .prepare('SELECT id, name, email, job_title FROM users WHERE email = ?')
      .get(email);
    if (!target) return res.status(404).json({ error: 'No user with that email.' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You already own this document.' });
    }

    // "Upsert": insert, or update the role if the row already exists.
    db.prepare(
      `INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(doc.id, target.id, shareRole);

    res.json({
      user_id: target.id,
      name: target.name,
      email: target.email,
      job_title: target.job_title,
      role: shareRole,
    });
  });

  // Stop sharing with someone.
  app.delete('/api/documents/:id/share/:userId', (req, res) => {
    const { doc, role } = getAccess(Number(req.params.id), req.user.id);
    if (!doc || !role) return res.status(404).json({ error: 'Document not found.' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can do this.' });

    db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?').run(
      doc.id, Number(req.params.userId)
    );
    res.json({ ok: true });
  });

  // --- Error handler ---
  // Any error thrown above ends up here, so the user gets a clear message
  // instead of a crash.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 2 MB).' : err.message;
      return res.status(400).json({ error: message });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
