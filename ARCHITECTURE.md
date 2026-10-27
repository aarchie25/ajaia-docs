# Architecture Note

## Goal

Ship a small but complete slice: create/edit documents, import a file, share with another user, and keep everything saved. I chose to go deep on the core flow rather than add many half-working features.

## Stack and why

| Part      | Choice                          | Why                                                                          |
| --------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Server    | Node.js + Express               | Small, easy to read, quick to deploy                                         |
| Database  | SQLite (`better-sqlite3`)       | One file, no service to set up or pay for, reviewers can run it in one step |
| Editor    | Quill 1.3.7 (loaded from a CDN) | Gives bold/italic/underline/headings/lists with no build step               |
| Frontend  | Plain HTML + JavaScript         | No framework or build tools, so the code is easy to follow                   |
| Import    | `mammoth` (.docx), `marked` (.md) | Reliable, small libraries that turn files into HTML                         |
| Safety    | `sanitize-html`                 | Removes dangerous HTML before it is saved                                    |
| Tests     | Node's built-in test runner     | Nothing extra to install                                                     |

## Data model

- `users` (id, name, email)
- `documents` (id, owner_id, title, content as HTML, timestamps)
- `shares` (document_id, user_id, role = `view` or `edit`)

Each document has exactly one owner. A share row gives one other user access. Deleting a document deletes its shares.

## Key decisions

1. **Documents are stored as HTML.** It is simple, readable in the database, and the editor loads it back with formatting intact. The tradeoff is that HTML is looser than a structured format (like Quill's Delta), so I sanitize it on every save and every import with an allow-list of tags.
2. **Access rules live in one place.** A single `getAccess()` function returns `owner`, `edit`, `view` or nothing. Every route uses it, so permissions are consistent. If you have no access, the server answers "not found" so people cannot guess document ids.
3. **Roles:** owner (everything), edit (change title/content), view (read only; the editor is locked in the UI and the server rejects saves with 403). The server is the real gatekeeper, not the UI.
4. **Mocked login.** Seeded users and a cookie. Real auth is important in production but does not show the product ideas this exercise is about.
5. **Autosave with a 1 second delay** instead of a Save button, because it matches what people expect from a document editor. The status text tells them what is happening.
6. **Upload creates a new document.** This is the simplest product-relevant behavior: bring an existing draft in and keep editing it. Limited to `.txt`, `.md`, `.docx` and 2 MB, with clear errors.

## Known risks

- Last save wins if two people edit at once.
- Free-tier hosting resets the SQLite file on restart.
- The editor library is loaded from a CDN, so the page needs internet access.
