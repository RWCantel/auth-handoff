const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ── API Auth Token ──
const TOKEN_FILE = path.join(__dirname, '.api-token');

function getApiToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  console.log('\n  ⚠️  API token generated (first run):');
  console.log(`  Token: ${token}`);
  console.log('  Save this — it protects your API keys and sessions.');
  console.log('  Set in your bot: AUTH_HANDOFF_TOKEN=<token>\n');
  return token;
}

const API_TOKEN = process.env.API_TOKEN || getApiToken();

// REST API auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Set Authorization: Bearer <token>' });
  }
  next();
}

// Sanitize IDs to prevent path traversal
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function safeFilePath(dir, id, ext = '.json') {
  const sanitized = sanitizeId(id);
  if (!sanitized) return null;
  const fp = path.join(dir, sanitized + ext);
  // Verify resolved path stays within dir
  if (!fp.startsWith(path.resolve(dir) + path.sep)) return null;
  return fp;
}

// ── Key Vault Encryption ──
const KEYS_DIR = path.join(__dirname, 'keys');
const SALT_FILE = path.join(__dirname, '.key-salt');

if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

function getEncryptionKey() {
  let salt;
  if (fs.existsSync(SALT_FILE)) {
    salt = fs.readFileSync(SALT_FILE, 'utf8').trim();
  } else {
    salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SALT_FILE, salt, { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(os.hostname() + salt).digest();
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted.toString('hex') });
}

function decrypt(payload) {
  const key = getEncryptionKey();
  const { iv, tag, data } = JSON.parse(payload);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(Buffer.from(data, 'hex')) + decipher.final('utf8');
}

function maskKey(value) {
  if (!value || value.length < 8) return '****';
  return value.substring(0, 4) + '...' + value.substring(value.length - 4);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3847;
// Bind to localhost by default for security. Set BIND=0.0.0.0 for network access (e.g. Tailscale).
const BIND = process.env.BIND || '127.0.0.1';
const COOKIES_DIR = path.join(__dirname, 'sessions');
const SCREENSHOT_INTERVAL = 350;
const sessions = new Map();

if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });

// ── PWA: serve index.html with token injected as a cookie (not inline script) ──
// The token is set as a secure httpOnly-like session cookie so it's not
// visible in page source, but is sent automatically on API requests.
app.get('/', (req, res) => {
  // Set token as a cookie for the PWA's same-origin requests
  res.cookie('_aht', API_TOKEN, { httpOnly: false, sameSite: 'Strict', path: '/' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Sessions REST API ──

app.get('/api/sessions', requireAuth, (req, res) => {
  const files = fs.readdirSync(COOKIES_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(COOKIES_DIR, f), 'utf8'));
      return { id: data.id, name: data.name, url: data.url, domain: data.domain, capturedAt: data.capturedAt, cookieCount: data.cookies?.length || 0 };
    } catch { return null; }
  }).filter(Boolean);
  res.json(list);
});

app.get('/api/sessions/:id/cookies', requireAuth, (req, res) => {
  const fp = safeFilePath(COOKIES_DIR, req.params.id);
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const fp = safeFilePath(COOKIES_DIR, req.params.id);
  if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ deleted: true });
});

app.get('/api/sessions/:id/cookies.txt', requireAuth, (req, res) => {
  const fp = safeFilePath(COOKIES_DIR, req.params.id);
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of data.cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    lines.push(`${domain}\t${c.domain.startsWith('.') ? 'TRUE' : 'FALSE'}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${c.expires ? Math.floor(c.expires) : '0'}\t${c.name}\t${c.value}`);
  }
  res.setHeader('Content-Type', 'text/plain');
  res.send(lines.join('\n'));
});

// ── API Key Vault ──

app.get('/api/keys', requireAuth, (req, res) => {
  const files = fs.readdirSync(KEYS_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, f), 'utf8'));
      const value = decrypt(raw.encrypted);
      return { service: raw.service, label: raw.label, maskedValue: maskKey(value), savedAt: raw.savedAt };
    } catch { return null; }
  }).filter(Boolean);
  res.json(list);
});

app.get('/api/keys/:service', requireAuth, (req, res) => {
  const fp = safeFilePath(KEYS_DIR, req.params.service);
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Key not found' });
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const value = decrypt(raw.encrypted);
  res.json({ service: raw.service, label: raw.label, value, savedAt: raw.savedAt });
});

app.post('/api/keys', requireAuth, (req, res) => {
  const { service, label, value } = req.body;
  if (!service || !value) return res.status(400).json({ error: 'service and value required' });
  const encrypted = encrypt(value);
  const data = { service, label: label || service, encrypted, savedAt: new Date().toISOString() };
  const safeService = service.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fp = path.join(KEYS_DIR, `${safeService}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), { mode: 0o600 });
  res.json({ saved: true, service, maskedValue: maskKey(value) });
});

app.delete('/api/keys/:service', requireAuth, (req, res) => {
  const fp = safeFilePath(KEYS_DIR, req.params.service);
  if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ deleted: true });
});

// ── WebSocket: browser streaming + input forwarding ──
// Auth handshake: first message must be { type: 'auth', token: '<api-token>' }

wss.on('connection', (ws) => {
  let authenticated = false;
  let sessionId = null;
  let screenshotInterval = null;

  // 5-second auth timeout
  const authTimeout = setTimeout(() => {
    if (!authenticated) ws.close(4001, 'Auth timeout');
  }, 5000);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Auth handshake
    if (!authenticated) {
      if (msg.type === 'auth' && msg.token === API_TOKEN) {
        authenticated = true;
        clearTimeout(authTimeout);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        ws.close(4001, 'Unauthorized');
      }
      return;
    }

    if (msg.type === 'start') {
      sessionId = uuidv4();
      const url = msg.url || 'https://accounts.google.com';
      const name = msg.name || new URL(url).hostname;
      try {
        const browser = await require('puppeteer').connect({
          browserURL: 'http://localhost:9222',
          defaultViewport: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36');
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv81' });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          window.chrome = { runtime: {} };
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (p) =>
            p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : originalQuery(p);
        });

        sessions.set(sessionId, { browser, page, ws, url, name, captured: false });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        screenshotInterval = setInterval(async () => {
          try {
            const s = sessions.get(sessionId);
            if (!s || ws.readyState !== 1) { clearInterval(screenshotInterval); return; }
            const screenshot = await s.page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' });
            ws.send(JSON.stringify({ type: 'frame', data: screenshot, url: s.page.url(), vw: 412, vh: 915 }));
          } catch {}
        }, SCREENSHOT_INTERVAL);

        ws.send(JSON.stringify({ type: 'started', sessionId, url }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: `Failed: ${err.message}` }));
      }
    }

    if (msg.type === 'click' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try {
        await s.page.mouse.move(msg.x, msg.y);
        await new Promise(r => setTimeout(r, 30));
        await s.page.mouse.down();
        await new Promise(r => setTimeout(r, 60));
        await s.page.mouse.up();
      } catch {}
    }

    if (msg.type === 'type' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try { await s.page.keyboard.type(msg.text, { delay: 50 }); } catch {}
    }

    if (msg.type === 'key' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try { await s.page.keyboard.press(msg.key); } catch {}
    }

    if (msg.type === 'scroll' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try { await s.page.mouse.wheel({ deltaY: msg.deltaY }); } catch {}
    }

    if (msg.type === 'navigate' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try { await s.page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
    }

    if (msg.type === 'goBack' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) try { await s.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
    }

    if (msg.type === 'capture' && sessionId) {
      const s = sessions.get(sessionId);
      if (s) {
        try {
          const cookies = await s.page.cookies();
          const currentUrl = s.page.url();
          const domain = new URL(currentUrl).hostname;
          const storage = await s.page.evaluate(() => {
            const ls = {}, ss = {};
            try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); } } catch {}
            try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); } } catch {}
            return { localStorage: ls, sessionStorage: ss };
          });
          const sessionData = { id: sessionId, name: s.name, url: currentUrl, originalUrl: s.url, domain, capturedAt: new Date().toISOString(), cookies, storage };
          fs.writeFileSync(path.join(COOKIES_DIR, `${sessionId}.json`), JSON.stringify(sessionData, null, 2));
          s.captured = true;
          ws.send(JSON.stringify({ type: 'captured', sessionId, domain, cookieCount: cookies.length, url: currentUrl }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: `Capture failed: ${err.message}` }));
        }
      }
    }

    if (msg.type === 'close' && sessionId) {
      await cleanup(sessionId, screenshotInterval);
      sessionId = null;
    }
  });

  ws.on('close', async () => {
    clearTimeout(authTimeout);
    if (sessionId) await cleanup(sessionId, screenshotInterval);
  });
});

async function cleanup(id, interval) {
  if (interval) clearInterval(interval);
  const s = sessions.get(id);
  if (s) { try { await s.browser.close(); } catch {} sessions.delete(id); }
}

server.listen(PORT, BIND, () => {
  const displayHost = BIND === '127.0.0.1' ? 'localhost' : BIND;
  console.log('');
  console.log('  🔐 Auth Handoff running');
  console.log(`  Local:  http://localhost:${PORT}`);
  if (BIND !== '127.0.0.1') console.log(`  Network: http://${displayHost}:${PORT}`);
  console.log(`  Bind:   ${BIND} (set BIND=0.0.0.0 for network access)`);
  console.log('');
});
