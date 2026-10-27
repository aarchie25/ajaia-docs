// server.js
// This is the file we run with "npm start". It opens the real database
// and starts listening for requests.

const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./app');

// Where to store the database file. Can be changed with an environment variable.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const port = process.env.PORT || 3000;

// seedDocs: true adds a few sample documents the first time the app runs.
const db = openDb(dbPath, { seedDocs: true });
const app = createApp(db);

app.listen(port, () => {
  console.log(`Ajaia Docs running at http://localhost:${port}`);
});
