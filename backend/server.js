require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');
const AdmZip = require('adm-zip');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-degistir';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
// app.use('/uploads', express.static(UPLOADS_DIR)); // Protected later after auth is defined

const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clientsByUser = new Map();

function broadcastToUser(userId, payload) {
  const set = clientsByUser.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let userId;
  try {
    userId = jwt.verify(token, JWT_SECRET).id;
  } catch {
    ws.close(4001, 'unauthorized');
    return;
  }
  if (!clientsByUser.has(userId)) clientsByUser.set(userId, new Set());
  clientsByUser.get(userId).add(ws);
  ws.on('close', () => clientsByUser.get(userId)?.delete(ws));
});

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.device_id) {
      const session = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND device_id = ?').get(req.user.id, req.user.device_id);
      if (!session) return res.status(401).json({ error: 'Session terminated' });
      db.prepare('UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(session.id);
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use('/uploads', auth, express.static(UPLOADS_DIR));

// ---- Auth ----
app.post('/api/register', async (req, res) => {
  const { email, password, deviceId, deviceName } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email and at least 6-character password required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'This email is already registered' });
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  const userId = info.lastInsertRowid;
  
  if (deviceId && deviceName) {
    db.prepare('INSERT INTO sessions (user_id, device_id, device_name) VALUES (?, ?, ?)').run(userId, deviceId, deviceName);
  }
  
  const token = jwt.sign({ id: userId, email, device_id: deviceId }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, email });
});

app.post('/api/login', async (req, res) => {
  const { email, password, deviceId, deviceName } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  
  if (deviceId && deviceName) {
    db.prepare('INSERT INTO sessions (user_id, device_id, device_name) VALUES (?, ?, ?) ON CONFLICT(user_id, device_id) DO UPDATE SET device_name=excluded.device_name, last_active=CURRENT_TIMESTAMP').run(user.id, deviceId, deviceName);
  }

  const token = jwt.sign({ id: user.id, email: user.email, device_id: deviceId }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, email: user.email });
});

// ---- Sessions ----
app.get('/api/sessions', auth, (req, res) => {
  const sessions = db.prepare('SELECT id, device_id, device_name, last_active FROM sessions WHERE user_id = ? ORDER BY last_active DESC').all(req.user.id);
  res.json(sessions);
});

app.post('/api/sessions/logout', auth, (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'device_id is required' });
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND device_id = ?').run(req.user.id, deviceId);
  res.json({ ok: true });
});

// ---- Messages ----
app.get('/api/messages', auth, (req, res) => {
  const { all, limit, offset } = req.query;
  
  if (all === 'true') {
    const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
    return res.json(rows);
  }
  
  const l = parseInt(limit) || 100;
  const o = parseInt(offset) || 0;
  
  const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, l, o);
  res.json(rows.reverse());
});

function isUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/messages', auth, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Cannot send an empty message' });
  const trimmed = text.trim();

  if (isUrl(trimmed)) {
    const info = db.prepare(
      'INSERT INTO messages (user_id, device_id, type, url, status) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, req.user.device_id || null, 'link', trimmed, 'pending');
    const msgId = info.lastInsertRowid;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    broadcastToUser(req.user.id, { type: 'message:created', message: msg });
    res.json(msg);

    fetchMetadata(trimmed)
      .then(async (meta) => {
        let localImage = null;
        if (meta.image) {
          localImage = await downloadImage(meta.image).catch(() => null);
        }
        db.prepare(
          'UPDATE messages SET title = ?, description = ?, image = ?, site_name = ?, status = ? WHERE id = ?'
        ).run(meta.title, meta.description, localImage, meta.siteName, 'ready', msgId);
        const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
        broadcastToUser(req.user.id, { type: 'message:updated', message: updated });
      })
      .catch(() => {
        db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('failed', msgId);
        const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
        broadcastToUser(req.user.id, { type: 'message:updated', message: updated });
      });
  } else {
    const info = db.prepare(
      'INSERT INTO messages (user_id, device_id, type, text, status) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, req.user.device_id || null, 'text', trimmed, 'ready');
    const msgId = info.lastInsertRowid;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    broadcastToUser(req.user.id, { type: 'message:created', message: msg });
    res.json(msg);
  }
});

app.post('/api/messages/:id/refresh', auth, async (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.type !== 'link') return res.status(400).json({ error: 'Only links can be refreshed' });
  
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('pending', msg.id);
  const pendingMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  broadcastToUser(req.user.id, { type: 'message:updated', message: pendingMsg });

  fetchMetadata(msg.url)
    .then(async (meta) => {
      let localImage = msg.image;
      if (meta.image) {
        localImage = await downloadImage(meta.image).catch(() => msg.image);
      }
      db.prepare(
        'UPDATE messages SET title = ?, description = ?, image = ?, site_name = ?, status = ? WHERE id = ?'
      ).run(meta.title || msg.title, meta.description || msg.description, localImage, meta.siteName || msg.site_name, 'ready', msg.id);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
      broadcastToUser(req.user.id, { type: 'message:updated', message: updated });
    })
    .catch(() => {
      db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('failed', msg.id);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
      broadcastToUser(req.user.id, { type: 'message:updated', message: updated });
    });
    
  res.json({ ok: true });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.image) {
    const filePath = path.join(UPLOADS_DIR, path.basename(msg.image));
    fs.unlink(filePath, () => {});
  }
  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
  broadcastToUser(req.user.id, { type: 'message:deleted', id: msg.id });
  res.json({ ok: true });
});

app.delete('/api/messages', auth, (req, res) => {
  const msgs = db.prepare('SELECT image FROM messages WHERE user_id = ? AND image IS NOT NULL').all(req.user.id);
  for (const m of msgs) {
    if (m.image) {
      const filePath = path.join(UPLOADS_DIR, path.basename(m.image));
      fs.unlink(filePath, () => {});
    }
  }
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(req.user.id);
  broadcastToUser(req.user.id, { type: 'import:done' }); // reload list
  res.json({ ok: true });
});

app.get('/api/messages/export/zip', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
  const zip = new AdmZip();
  
  zip.addFile("messages.json", Buffer.from(JSON.stringify(rows, null, 2), "utf8"));
  
  for (const row of rows) {
    if (row.image) {
      const filename = path.basename(row.image);
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        zip.addLocalFile(filePath, "uploads");
      }
    }
  }
  
  const zipBuffer = zip.toBuffer();
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename=sendy-export-${new Date().toISOString().slice(0,10)}.zip`);
  res.send(zipBuffer);
});

app.post('/api/messages/import/zip', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File not found' });

  let inserted = 0;
  try {
    const zip = new AdmZip(req.file.buffer);
    const zipEntries = zip.getEntries();
    
    // JSON dosyasını bul ve oku
    const jsonEntry = zipEntries.find(e => e.entryName === 'messages.json');
    if (!jsonEntry) return res.status(400).json({ error: 'messages.json not found' });
    
    const messages = JSON.parse(jsonEntry.getData().toString('utf8'));
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'Invalid data format' });

    // Uploads klasöründeki resimleri çıkar
    zipEntries.forEach(entry => {
      if (!entry.isDirectory && entry.entryName.startsWith('uploads/')) {
        const data = entry.getData();
        const filename = path.basename(entry.entryName);
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), data);
      }
    });

    const insertStmt = db.prepare(
      'INSERT INTO messages (user_id, device_id, type, text, url, title, description, image, site_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    
    const processImport = db.transaction((msgs) => {
      for (const m of msgs) {
        const isDuplicate = db.prepare('SELECT id FROM messages WHERE user_id = ? AND created_at = ? AND (text = ? OR url = ?)').get(req.user.id, m.created_at, m.text || null, m.url || null);
        if (isDuplicate) continue;
        
        insertStmt.run(
          req.user.id, m.device_id || req.user.device_id || null, m.type || 'text', m.text || null, m.url || null,
          m.title || null, m.description || null, m.image || null, m.site_name || null, m.status || 'ready', m.created_at
        );
        inserted++;
      }
    });

    processImport(messages);
    broadcastToUser(req.user.id, { type: 'import:done' });
    res.json({ ok: true, inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred during import' });
  }
});

async function fetchMetadata(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    timeout: 10000,
  });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const get = (selectors) => {
    for (const sel of selectors) {
      const val = $(sel).attr('content') || $(sel).text();
      if (val) return val.trim();
    }
    return null;
  };
  const title = get(['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']);
  const description = get(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']);
  let image = get(['meta[property="og:image"]', 'meta[name="twitter:image"]']);
  const siteName = get(['meta[property="og:site_name"]']);
  if (image && !image.startsWith('http')) {
    try { image = new URL(image, url).href; } catch { image = null; }
  }
  return { title, description, image, siteName };
}

async function downloadImage(imageUrl) {
  const resp = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    timeout: 10000,
  });
  if (!resp.ok) throw new Error('failed to download image');
  const contentType = resp.headers.get('content-type') || '';
  let ext = '.jpg';
  if (contentType.includes('png')) ext = '.png';
  else if (contentType.includes('webp')) ext = '.webp';
  else if (contentType.includes('gif')) ext = '.gif';
  else if (contentType.includes('svg')) ext = '.svg';
  const filename = crypto.randomUUID() + ext;
  const buffer = await resp.buffer();
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sendy backend is running on http://0.0.0.0:${PORT}`);
  console.warn('\x1b[33m%s\x1b[0m', 'WARNING: You are running Sendy over HTTP. For security reasons, please consider using HTTPS.');
});
