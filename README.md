# Ajaia Docs

A small collaborative document editor inspired by Google Docs. Built for the Ajaia take-home assignment.

**Live app:** `PASTE_DEPLOYED_URL_HERE`
**Walkthrough video:** see `video-link.txt`

## What it does

- Create, rename, edit, save and reopen documents
- Rich text: bold, italic, underline, headings (H1-H3), bulleted and numbered lists, clear formatting
- Autosave (1 second after you stop typing) plus a "Saved" indicator
- Upload a file to turn it into a new editable document. **Supported types: `.txt`, `.md`, `.docx` (max 2 MB).** This is also shown in the UI.
- Share a document with another user by email as **Can edit** or **Can view**
- The list is split into **My documents** (owned) and **Shared with me** (with the owner's name and your role)
- Everything is saved in SQLite, so it survives refreshes and restarts

## Demo accounts (for testing sharing)

There are no passwords. On the login screen, click a user.

| Name       | Role                | Email              |
| ---------- | ------------------- | ------------------ |
| Aarchi     | Full-Stack Engineer | aarchi@example.com |
| Andy       | Product Manager     | andy@example.com   |
| Robert | Design Lead         | robert@example.com  |

The first time the app starts, it also adds four sample documents (for example "Welcome to Ajaia Docs", shared with Andy and Robert, and "Sprint Planning Notes", shared with Aarchi) so the owned vs shared views are filled in right away. If you ran an older version before, delete the `data/` folder once so the new users and samples are created.

**Quick sharing test:** log in as Aarchi, create a doc, click **Share**, enter `andy@example.com` with "Can edit". Log out, log in as Andy. The doc appears under "Shared with me".

## Run it locally

You need Node.js 18 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000.

The database file is created automatically at `data/app.db`. To use a different path or port:

```bash
PORT=4000 DB_PATH=/some/path/app.db npm start
```

## Run the tests

```bash
npm test
```

The tests use a temporary in-memory database, so they never touch your real data. They cover: login required, formatting preserved after save and reopen, renaming and title validation, sharing (hidden before sharing, view vs edit, owner-only actions, removing access), unsafe HTML being stripped, and file upload (`.md`, `.txt`, rejected file types).

## Project layout

```
src/db.js          database tables + demo users
src/app.js         all API routes and access rules
src/server.js      starts the server
public/            the browser app (index.html, app.js, style.css)
test/app.test.js   automated tests
```

## Deployed - Render




