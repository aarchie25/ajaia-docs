// db.js
// This file sets up our database. We use SQLite because it is just one file,
// so there is nothing extra to install or pay for.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// The demo team. Reviewers can log in as any of them to test sharing.
const SEED_USERS = [
  { name: 'Aarchi', email: 'aarchi@example.com', job_title: 'Full-Stack Engineer' },
  { name: 'Andy', email: 'andy@example.com', job_title: 'Product Manager' },
  { name: 'Robert', email: 'robert@example.com', job_title: 'Design Lead' },
];

// filePath can be a real file path, or ':memory:' (used by the tests so
// they never touch the real database).
// options.seedDocs = true adds a few sample documents on first run.
function openDb(filePath, options = {}) {
  // Make sure the folder exists (only matters for real files).
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);

  // Turn on foreign keys so deleting a document also deletes its shares.
  db.pragma('foreign_keys = ON');

  // "IF NOT EXISTS" means it is safe to run this every time the app starts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      email     TEXT NOT NULL UNIQUE,
      job_title TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS documents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   INTEGER NOT NULL REFERENCES users(id),
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',   -- the document body, stored as HTML
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- One row = "this user can open this document".
    -- role is either 'view' (read only) or 'edit'.
    CREATE TABLE IF NOT EXISTS shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL CHECK (role IN ('view', 'edit')),
      PRIMARY KEY (document_id, user_id)
    );
  `);

  // Small upgrade step: older databases did not have the job_title column.
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columns.includes('job_title')) {
    db.exec("ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
  }

  seedUsers(db);
  if (options.seedDocs) seedDocuments(db);
  return db;
}

// Add any demo users that are missing. "OR IGNORE" skips ones that already exist.
function seedUsers(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO users (name, email, job_title) VALUES (?, ?, ?)');
  for (const u of SEED_USERS) {
    insert.run(u.name, u.email, u.job_title);
  }
}

// Sample documents so the app does not look empty the first time you open it.
// Only runs when there are no documents at all.
function seedDocuments(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM documents').get();
  if (count > 0) return;

  const idOf = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  const aarchi = idOf('aarchi@example.com');
  const andy = idOf('andy@example.com');
  const robert = idOf('robert@example.com');

  // Helper: a time some hours in the past, so "Edited 3 hours ago" looks real.
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

  const addDoc = db.prepare(
    'INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const addShare = db.prepare('INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)');

  const welcome = addDoc.run(
    aarchi,
    'Welcome to Ajaia Docs',
    '<h1>Welcome to Ajaia Docs</h1>' +
      '<p>This is a small workspace for writing and sharing documents with your team. Here is a quick tour.</p>' +
      '<h2>Format your text</h2>' +
      '<p>Use the toolbar to make text <strong>bold</strong>, <em>italic</em> or <u>underlined</u>, and to add headings.</p>' +
      '<h2>Things you can do</h2>' +
      '<ul><li>Create a new document, or upload a .txt, .md or .docx file</li>' +
      '<li>Rename a document by clicking its title</li>' +
      '<li>Share it with a teammate as an editor or a viewer</li></ul>' +
      '<h2>Try sharing</h2>' +
      '<ol><li>Log out and log in as Andy</li>' +
      '<li>Find this document under "Shared with me"</li>' +
      '<li>Come back as Aarchi and change Andy to view-only</li></ol>',
    hoursAgo(50),
    hoursAgo(2)
  ).lastInsertRowid;
  addShare.run(welcome, andy, 'edit');
  addShare.run(welcome, robert, 'view');

  addDoc.run(
    aarchi,
    'Q4 Launch Plan',
    '<h1>Q4 Launch Plan</h1>' +
      '<p>Goal: ship the new sharing experience to all teams before the end of the quarter.</p>' +
      '<h2>Milestones</h2>' +
      '<ol><li><strong>Week 1:</strong> finish the editor and autosave</li>' +
      '<li><strong>Week 2:</strong> file import and sharing permissions</li>' +
      '<li><strong>Week 3:</strong> internal beta with two teams</li>' +
      '<li><strong>Week 4:</strong> fix feedback and launch</li></ol>' +
      '<h2>Risks</h2>' +
      '<ul><li>Two people editing the same document at once</li><li>Large files slowing down import</li></ul>',
    hoursAgo(30),
    hoursAgo(26)
  );

  const sprint = addDoc.run(
    andy,
    'Sprint Planning Notes',
    '<h1>Sprint Planning Notes</h1>' +
      '<p>Attendees: Andy, Aarchi, Robert</p>' +
      '<h2>Priorities</h2>' +
      '<ul><li>Polish the document list and empty states</li>' +
      '<li>Add role-based sharing (view and edit)</li>' +
      '<li>Write setup instructions for new teammates</li></ul>' +
      '<h2>Open questions</h2>' +
      '<p>Do we need comments before the first beta? <em>Decision: not yet.</em></p>',
    hoursAgo(80),
    hoursAgo(5)
  ).lastInsertRowid;
  addShare.run(sprint, aarchi, 'edit');
  addShare.run(sprint, robert, 'view');

  const brand = addDoc.run(
    robert,
    'Brand Guidelines v2',
    '<h1>Brand Guidelines v2</h1>' +
      '<p>A short guide to how our product looks and sounds.</p>' +
      '<h2>Colors</h2>' +
      '<ul><li>Primary: deep violet</li><li>Accent: soft coral</li><li>Neutrals: warm greys</li></ul>' +
      '<h2>Voice</h2>' +
      '<p>Friendly, clear and short. Say <strong>what happened</strong> and <strong>what to do next</strong>.</p>',
    hoursAgo(120),
    hoursAgo(20)
  ).lastInsertRowid;
  addShare.run(brand, aarchi, 'view');
}

module.exports = { openDb };
