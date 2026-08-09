const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'sendy.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,          -- Hangi cihazdan gönderildi
    type TEXT NOT NULL DEFAULT 'text', -- text | link
    text TEXT,               -- düz mesaj içeriği (type=text)
    url TEXT,                -- link (type=link)
    title TEXT,
    description TEXT,
    image TEXT,               -- yerelde saklanan görselin yolu, örn: /uploads/abc.jpg
    site_name TEXT,
    status TEXT DEFAULT 'ready', -- pending | ready | failed
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    last_active TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, device_id)
  );
`);

try {
  db.exec("ALTER TABLE messages ADD COLUMN device_id TEXT");
} catch (e) {
  // Sütun zaten varsa hata verir, yoksay
}

module.exports = db;
