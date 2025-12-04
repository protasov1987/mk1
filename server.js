const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { JsonDatabase, deepClone } = require('./db');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || 'localhost';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
const MAX_BODY_SIZE = 20 * 1024 * 1024; // 20 MB to allow attachments
const FILE_SIZE_LIMIT = 15 * 1024 * 1024; // 15 MB per attachment
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip', '.rar', '.7z'];
const DEFAULT_ADMIN_PASSWORD = 'ssyba';
const DEFAULT_ADMIN = { name: 'Abyss', role: 'admin' };
const SESSION_COOKIE = 'session';
const sessions = new Map();
const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/session']);

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hashed = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  return { hash: hashed.toString('hex'), salt: salt.toString('hex') };
}

function verifyPassword(password, user) {
  if (!user) return false;
  if (user.passwordHash && user.passwordSalt) {
    const hashed = crypto.pbkdf2Sync(password, Buffer.from(user.passwordSalt, 'hex'), 310000, 32, 'sha256');
    return crypto.timingSafeEqual(hashed, Buffer.from(user.passwordHash, 'hex'));
  }
  if (typeof user.password === 'string') {
    return user.password === password;
  }
  return false;
}

function computeEAN13CheckDigit(base12) {
  let sumEven = 0;
  let sumOdd = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(base12.charAt(i), 10);
    if ((i + 1) % 2 === 0) {
      sumEven += digit;
    } else {
      sumOdd += digit;
    }
  }
  const total = sumOdd + sumEven * 3;
  const mod = total % 10;
  return String((10 - mod) % 10);
}

function buildEAN13FromSequence(sequenceNumber) {
  const base = String(Math.max(0, parseInt(sequenceNumber, 10) || 0)).padStart(12, '0');
  return base + computeEAN13CheckDigit(base);
}

function getNextEANSequence(cards) {
  let maxSeq = 0;
  cards.forEach(card => {
    if (!card || !card.barcode || !/^\d{13}$/.test(card.barcode)) return;
    const seq = parseInt(card.barcode.slice(0, 12), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  });
  return maxSeq + 1;
}

function generateUniqueEAN13(cards) {
  let seq = getNextEANSequence(cards);
  let attempt = 0;
  while (attempt < 1000) {
    const code = buildEAN13FromSequence(seq);
    if (!cards.some(c => c.barcode === code)) return code;
    seq++;
    attempt++;
  }
  return buildEAN13FromSequence(seq);
}

function generateRawOpCode() {
  return `OP-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function generateUniqueOpCode(used = new Set()) {
  let code = generateRawOpCode();
  let attempt = 0;
  while (used.has(code) && attempt < 1000) {
    code = generateRawOpCode();
    attempt++;
  }
  return code;
}

function createRouteOpFromRefs(op, center, executor, plannedMinutes, order, options = {}) {
  const { quantity = '', autoCode = false, code } = options;
  return {
    id: genId('rop'),
    opId: op.id,
    opCode: code || op.code || op.opCode || generateUniqueOpCode(),
    opName: op.name,
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    quantity: quantity === '' || quantity == null ? '' : parseInt(quantity, 10) || 0,
    autoCode,
    additionalExecutors: Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.slice(0, 2)
      : [],
    status: 'NOT_STARTED',
    firstStartedAt: null,
    startedAt: null,
    lastPausedAt: null,
    finishedAt: null,
    actualSeconds: null,
    elapsedSeconds: 0,
    order: order || 1,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0
  };
}

function buildDefaultUser() {
  const { hash, salt } = hashPassword(DEFAULT_ADMIN_PASSWORD);
  return { id: genId('user'), ...DEFAULT_ADMIN, passwordHash: hash, passwordSalt: salt };
}

function buildDefaultData() {
  const centers = [
    { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
    { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
    { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
  ];

  const used = new Set();
  const ops = [
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40 },
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60 },
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20 }
  ];

  const cardId = genId('card');
  const cards = [
    {
      id: cardId,
      barcode: generateUniqueEAN13([]),
      name: 'Вал привода Ø60',
      orderNo: 'DEMO-001',
      desc: 'Демонстрационная карта для примера.',
      status: 'NOT_STARTED',
      archived: false,
      createdAt: Date.now(),
      logs: [],
      initialSnapshot: null,
      attachments: [],
      operations: [
        createRouteOpFromRefs(ops[0], centers[0], 'Иванов И.И.', 40, 1),
        createRouteOpFromRefs(ops[1], centers[1], 'Петров П.П.', 60, 2),
        createRouteOpFromRefs(ops[2], centers[2], 'Сидоров С.С.', 20, 3)
      ]
    }
  ];

  const users = [buildDefaultUser()];

  return { cards, ops, centers, users };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const parsedUrl = url.parse(req.url);
  let pathname = path.join(__dirname, decodeURIComponent(parsedUrl.pathname));

  if (pathname.endsWith(path.sep)) {
    pathname = path.join(pathname, 'index.html');
  }

  if (!pathname.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(pathname, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(pathname).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';

    fs.readFile(pathname, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function recalcCardStatus(card) {
  const opsArr = card.operations || [];
  if (!opsArr.length) {
    card.status = 'NOT_STARTED';
    return;
  }
  const hasActive = opsArr.some(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  if (hasActive) {
    card.status = 'IN_PROGRESS';
  } else if (allDone && !hasNotStarted) {
    card.status = 'DONE';
  } else {
    card.status = 'NOT_STARTED';
  }
}

function normalizeCard(card) {
  const safeCard = deepClone(card);
  const qtyNumber = parseInt(safeCard.quantity, 10);
  safeCard.quantity = Number.isFinite(qtyNumber) ? qtyNumber : '';
  safeCard.name = safeCard.name || 'Карта';
  safeCard.orderNo = safeCard.orderNo || '';
  safeCard.contractNumber = safeCard.contractNumber || '';
  safeCard.desc = safeCard.desc || '';
  safeCard.drawing = safeCard.drawing || '';
  safeCard.material = safeCard.material || '';
  safeCard.operations = (safeCard.operations || []).map(op => ({
    ...op,
    opCode: op.opCode || '',
    elapsedSeconds: typeof op.elapsedSeconds === 'number' ? op.elapsedSeconds : (op.actualSeconds || 0),
    firstStartedAt: typeof op.firstStartedAt === 'number' ? op.firstStartedAt : (op.startedAt || null),
    startedAt: op.startedAt || null,
    lastPausedAt: typeof op.lastPausedAt === 'number' ? op.lastPausedAt : null,
    finishedAt: op.finishedAt || null,
    status: op.status || 'NOT_STARTED',
    comment: typeof op.comment === 'string' ? op.comment : '',
    goodCount: Number.isFinite(parseInt(op.goodCount, 10)) ? Math.max(0, parseInt(op.goodCount, 10)) : 0,
    scrapCount: Number.isFinite(parseInt(op.scrapCount, 10)) ? Math.max(0, parseInt(op.scrapCount, 10)) : 0,
    holdCount: Number.isFinite(parseInt(op.holdCount, 10)) ? Math.max(0, parseInt(op.holdCount, 10)) : 0,
    quantity: Number.isFinite(parseInt(op.quantity, 10)) ? Math.max(0, parseInt(op.quantity, 10)) : '',
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.map(name => (name || '').toString()).slice(0, 2)
      : []
  })).map(op => ({
    ...op,
    quantity: op.quantity === '' && safeCard.quantity !== '' ? safeCard.quantity : op.quantity
  }));
  safeCard.archived = Boolean(safeCard.archived);
  safeCard.createdAt = typeof safeCard.createdAt === 'number' ? safeCard.createdAt : Date.now();
  safeCard.logs = Array.isArray(safeCard.logs)
    ? safeCard.logs.map(entry => ({
      id: entry.id || genId('log'),
      ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
      action: entry.action || 'update',
      object: entry.object || '',
      targetId: entry.targetId || null,
      field: entry.field || null,
      oldValue: entry.oldValue != null ? entry.oldValue : '',
      newValue: entry.newValue != null ? entry.newValue : ''
    }))
    : [];
  safeCard.initialSnapshot = safeCard.initialSnapshot || null;
  safeCard.attachments = Array.isArray(safeCard.attachments)
    ? safeCard.attachments.map(file => ({
      id: file.id || genId('file'),
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
      size: Number(file.size) || 0,
      content: typeof file.content === 'string' ? file.content : '',
      createdAt: file.createdAt || Date.now()
    }))
    : [];
  recalcCardStatus(safeCard);
  return safeCard;
}

function ensureOperationCodes(data) {
  const used = new Set();

  data.ops = data.ops.map(op => {
    const next = { ...op };
    if (!next.code || used.has(next.code)) {
      next.code = generateUniqueOpCode(used);
    }
    used.add(next.code);
    return next;
  });

  const opMap = Object.fromEntries(data.ops.map(op => [op.id, op]));

  data.cards = data.cards.map(card => {
    const nextCard = { ...card };
    nextCard.operations = (nextCard.operations || []).map(op => {
      const nextOp = { ...op };
      const source = nextOp.opId ? opMap[nextOp.opId] : null;
      if (source && source.code) {
        nextOp.opCode = source.code;
      }
      if (!nextOp.opCode) {
        nextOp.opCode = generateUniqueOpCode();
      }
      return nextOp;
    });
    recalcCardStatus(nextCard);
    return nextCard;
  });
}

function normalizeData(payload) {
  const safe = {
    cards: Array.isArray(payload.cards) ? payload.cards.map(normalizeCard) : [],
    ops: Array.isArray(payload.ops) ? payload.ops : [],
    centers: Array.isArray(payload.centers) ? payload.centers : [],
    users: Array.isArray(payload.users) ? payload.users : []
  };
  ensureOperationCodes(safe);
  safe.cards = safe.cards.map(card => {
    if (!card.barcode || !/^\d{13}$/.test(card.barcode)) {
      card.barcode = generateUniqueEAN13(safe.cards);
    }
    return card;
  });
  return safe;
}

function mergeSnapshots(existingData, incomingData) {
  const currentMap = Object.fromEntries((existingData.cards || []).map(card => [card.id, card]));

  const mergedCards = (incomingData.cards || []).map(card => {
    const existing = currentMap[card.id];
    const next = deepClone(card);

    // Сохраняем дату создания, если она уже была сохранена
    next.createdAt = existing && existing.createdAt ? existing.createdAt : (next.createdAt || Date.now());

    // Не перезаписываем изначальный снимок, если он уже был сохранён ранее
    if (existing && existing.initialSnapshot) {
      next.initialSnapshot = existing.initialSnapshot;
    } else if (!next.initialSnapshot) {
      const snapshot = deepClone(next);
      snapshot.logs = [];
      next.initialSnapshot = snapshot;
    }

    return next;
  });

  return { ...incomingData, cards: mergedCards };
}

const database = new JsonDatabase(DATA_FILE);

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

async function resolveUserBySession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return null;
  const session = sessions.get(token);
  const data = await database.getData();
  const user = (data.users || []).find(u => u.id === session.userId);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return user;
}

async function ensureAuthenticated(req, res) {
  const user = await resolveUserBySession(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return null;
  }
  return user;
}

async function ensureDefaultUser() {
  await database.update(data => {
    const draft = { ...deepClone(data) };
    draft.users = Array.isArray(draft.users) ? draft.users.map(user => {
      const next = { ...user };
      const isAbyss = (next.name || next.username) === DEFAULT_ADMIN.name;
      if (!next.passwordHash || !next.passwordSalt || isAbyss) {
        const sourcePassword = isAbyss ? DEFAULT_ADMIN_PASSWORD : next.password;
        const { hash, salt } = hashPassword(sourcePassword || DEFAULT_ADMIN_PASSWORD);
        next.passwordHash = hash;
        next.passwordSalt = salt;
      }
      delete next.password;
      if (isAbyss && !next.role) {
        next.role = DEFAULT_ADMIN.role;
      }
      return next;
    }) : [];

    if (!draft.users.length) {
      draft.users.push(buildDefaultUser());
    }
    return draft;
  });
}

async function handleAuth(req, res) {
  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const raw = await parseBody(req);
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      let password = '';

      if (contentType.includes('application/json')) {
        const payload = JSON.parse(raw || '{}');
        password = (payload.password || '').toString();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw || '');
        password = (params.get('password') || '').toString();
      } else if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
        const boundary = boundaryMatch ? boundaryMatch[1] : null;
        if (boundary) {
          const parts = raw.split(`--${boundary}`);
          for (const part of parts) {
            if (part.includes('name="password"')) {
              const segment = part.split('\r\n\r\n')[1] || '';
              password = segment.trim();
              break;
            }
          }
        }
      }

      const data = await database.getData();
      const user = (data.users || []).find(u => verifyPassword(password, u));
      if (!user) {
        sendJson(res, 401, { success: false, error: 'Неверный пароль' });
        return true;
      }

      const token = genId('sess');
      sessions.set(token, { userId: user.id, createdAt: Date.now() });
      res.writeHead(200, {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax`,
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({ success: true, user: user.name || user.username || 'Пользователь' }));
    } catch (err) {
      sendJson(res, 400, { success: false, error: 'Некорректный запрос' });
    }
    return true;
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE];
    if (token) {
      sessions.delete(token);
    }
    res.writeHead(200, {
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`,
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }

  if (req.method === 'GET' && req.url === '/api/session') {
    const user = await resolveUserBySession(req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }
    sendJson(res, 200, { user: { name: user.name, role: user.role || 'user' } });
    return true;
  }

  return false;
}

async function handleApi(req, res) {
  const pathname = url.parse(req.url).pathname;
  if (!pathname.startsWith('/api/')) return false;
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  if (!pathname.startsWith('/api/data')) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;

  if (req.method === 'GET' && pathname.startsWith('/api/data')) {
    const data = await database.getData();
    sendJson(res, 200, data);
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/data')) {
    try {
      const raw = await parseBody(req);
      const parsed = JSON.parse(raw || '{}');
      const saved = await database.update(current => {
        const normalized = normalizeData(parsed);
        normalized.users = current.users || [];
        return mergeSnapshots(current, normalized);
      });
      sendJson(res, 200, { status: 'ok', data: saved });
    } catch (err) {
      const status = err.message === 'Payload too large' ? 413 : 400;
      sendJson(res, status, { error: err.message || 'Invalid JSON' });
    }
    return true;
  }

  return false;
}

function findAttachment(data, attachmentId) {
  for (const card of data.cards || []) {
    const found = (card.attachments || []).find(f => f.id === attachmentId);
    if (found) {
      return { card, attachment: found };
    }
  }
  return null;
}

async function handleFileRoutes(req, res) {
  const parsed = url.parse(req.url, true);
  const isFileDownload = req.method === 'GET' && parsed.pathname.startsWith('/files/');
  const isCardFiles = parsed.pathname.startsWith('/api/cards/') && parsed.pathname.endsWith('/files');
  if (!isFileDownload && !isCardFiles) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;
  if (req.method === 'GET' && parsed.pathname.startsWith('/files/')) {
    const attachmentId = parsed.pathname.replace('/files/', '');
    const data = await database.getData();
    const match = findAttachment(data, attachmentId);
    if (!match) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const { attachment } = match;
    if (!attachment.content) {
      res.writeHead(404);
      res.end('File missing');
      return true;
    }
    const base64 = attachment.content.split(',').pop();
    const buffer = Buffer.from(base64, 'base64');
    res.writeHead(200, {
      'Content-Type': attachment.type || 'application/octet-stream',
      'Content-Length': buffer.length,
      'Content-Disposition': `attachment; filename="${attachment.name || 'file'}"`
    });
    res.end(buffer);
    return true;
  }

  if (req.method === 'GET' && parsed.pathname.startsWith('/api/cards/') && parsed.pathname.endsWith('/files')) {
    const cardId = parsed.pathname.split('/')[3];
    const data = await database.getData();
    const card = (data.cards || []).find(c => c.id === cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }
    sendJson(res, 200, { files: card.attachments || [] });
    return true;
  }

  if (req.method === 'POST' && parsed.pathname.startsWith('/api/cards/') && parsed.pathname.endsWith('/files')) {
    const cardId = parsed.pathname.split('/')[3];
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const { name, type, content, size } = payload || {};
      if (!name || !content) {
        sendJson(res, 400, { error: 'Invalid payload' });
        return true;
      }
      const ext = path.extname(name || '').toLowerCase();
      if (ALLOWED_EXTENSIONS.length && ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        sendJson(res, 400, { error: 'Недопустимый тип файла' });
        return true;
      }
      const base64 = content.split(',').pop();
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > FILE_SIZE_LIMIT) {
        sendJson(res, 413, { error: 'Файл слишком большой' });
        return true;
      }

      const saved = await database.update(data => {
        const draft = normalizeData(data);
        const card = (draft.cards || []).find(c => c.id === cardId);
        if (!card) {
          throw new Error('Card not found');
        }
        const file = {
          id: genId('file'),
          name,
          type: type || 'application/octet-stream',
          size: size || buffer.length,
          content,
          createdAt: Date.now()
        };
        card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
        card.attachments.push(file);
        return draft;
      });
      const card = (saved.cards || []).find(c => c.id === cardId);
      sendJson(res, 200, { status: 'ok', files: card ? card.attachments || [] : [] });
    } catch (err) {
      const status = err.message === 'Payload too large' ? 413 : 400;
      sendJson(res, status, { error: err.message || 'Upload error' });
    }
    return true;
  }

  return false;
}

async function requestHandler(req, res) {
  if (await handleAuth(req, res)) return;
  if (await handleApi(req, res)) return;
  if (await handleFileRoutes(req, res)) return;
  serveStatic(req, res);
}

async function startServer() {
  await database.init(buildDefaultData);
  await ensureDefaultUser();
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch(err => {
      // eslint-disable-next-line no-console
      console.error('Request error', err);
      res.writeHead(500);
      res.end('Server error');
    });
  });

  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Server started on http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
