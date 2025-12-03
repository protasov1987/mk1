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
const MIN_PASSWORD_LENGTH = 6;
const ADMIN_LOGIN_NAME = 'Abyss';
const ADMIN_PASSWORD = 'ssyba';

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
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

  const adminLevelId = genId('al');
  const accessLevels = [
    {
      id: adminLevelId,
      name: 'Администратор',
      description: 'Полный доступ ко всем разделам',
      permissions: {
        dashboard: { view: true, change: true },
        cards: { view: true, change: true },
        workorders: { view: true, change: true },
        archive: { view: true, change: true },
        workspace: { view: true, change: true },
        users: { view: true, change: true },
        accessLevels: { view: true, change: true },
        attachments: { upload: true, remove: true }
      },
      landingTab: 'dashboard',
      idleTimeoutMinutes: 30,
      isWorker: false
    }
  ];

  const users = [
    {
      id: genId('usr'),
      name: 'Abyss',
      password: 'ssyba',
      accessLevelId: adminLevelId,
      active: true,
      createdAt: Date.now()
    }
  ];

  return { cards, ops, centers, users, accessLevels };
}

// === БЕЗОПАСНОСТЬ ===
const sessions = new Map();

function getAccessLevel(data, id) {
  return (data.accessLevels || []).find(level => level.id === id) || null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return false;
  }
  const hasLetter = /[A-Za-zА-Яа-я]/.test(password);
  const hasDigit = /\d/.test(password);
  return hasLetter && hasDigit;
}

function isPasswordUnique(data, password, excludeUserId = null) {
  return !(data.users || []).some(u => u.password === password && u.id !== excludeUserId);
}

function ensureAdminPresence(data) {
  const accessLevels = Array.isArray(data.accessLevels) ? data.accessLevels : [];
  const users = Array.isArray(data.users) ? data.users : [];
  let adminLevel = accessLevels.find(lvl => lvl.name === 'Администратор');
  if (!adminLevel) {
    adminLevel = {
      id: genId('al'),
      name: 'Администратор',
      description: 'Полный доступ ко всем разделам',
      permissions: {
        dashboard: { view: true, change: true },
        cards: { view: true, change: true },
        workorders: { view: true, change: true },
        archive: { view: true, change: true },
        workspace: { view: true, change: true },
        users: { view: true, change: true },
        accessLevels: { view: true, change: true },
        attachments: { upload: true, remove: true }
      },
      landingTab: 'dashboard',
      idleTimeoutMinutes: 30,
      isWorker: false
    };
    accessLevels.push(adminLevel);
  }

  if (!users.length) {
    users.push({
      id: genId('usr'),
      name: ADMIN_LOGIN_NAME,
      password: ADMIN_PASSWORD,
      accessLevelId: adminLevel.id,
      active: true,
      createdAt: Date.now()
    });
  }

  data.users = users;
  data.accessLevels = accessLevels;
  return data;
}

function createSession(user, level) {
  const token = crypto.randomUUID ? crypto.randomUUID() : genId('sess');
  const idleMs = Math.max(1, level && level.idleTimeoutMinutes ? level.idleTimeoutMinutes : 30) * 60 * 1000;
  const entry = { token, userId: user.id, lastSeen: Date.now(), idleMs };
  sessions.set(token, entry);
  return entry;
}

function getSession(token) {
  if (!token || !sessions.has(token)) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() - sess.lastSeen > sess.idleMs) {
    sessions.delete(token);
    return null;
  }
  sess.lastSeen = Date.now();
  sessions.set(token, sess);
  return sess;
}

function readToken(req) {
  return req.headers['x-session-token'] || req.headers['X-Session-Token'] || req.headers['x-session-token'];
}

async function requireSession(req, res, { permission, allowInactive = false } = {}) {
  const token = readToken(req);
  const sess = getSession(token);
  if (!sess) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  const data = await database.getData();
  const user = (data.users || []).find(u => u.id === sess.userId);
  if (!user || (!allowInactive && user.active === false)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  const level = getAccessLevel(data, user.accessLevelId);
  if (permission && !hasPermission(level, permission)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return null;
  }
  return { user, level, data };
}

function hasPermission(level, permission) {
  if (!permission) return true;
  const perms = (level && level.permissions) || {};
  const area = perms[permission.area] || {};
  return Boolean(area[permission.type]);
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
    users: Array.isArray(payload.users) ? payload.users : [],
    accessLevels: Array.isArray(payload.accessLevels) ? payload.accessLevels : []
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

function sanitizeUser(user) {
  const copy = { ...user };
  delete copy.password;
  return copy;
}

function normalizePermissions(perms = {}) {
  return {
    dashboard: { view: Boolean(perms.dashboard?.view), change: Boolean(perms.dashboard?.change) },
    cards: { view: Boolean(perms.cards?.view), change: Boolean(perms.cards?.change) },
    workorders: { view: Boolean(perms.workorders?.view), change: Boolean(perms.workorders?.change) },
    archive: { view: Boolean(perms.archive?.view), change: Boolean(perms.archive?.change) },
    workspace: { view: Boolean(perms.workspace?.view), change: Boolean(perms.workspace?.change) },
    users: { view: Boolean(perms.users?.view), change: Boolean(perms.users?.change) },
    accessLevels: { view: Boolean(perms.accessLevels?.view), change: Boolean(perms.accessLevels?.change) },
    attachments: { upload: Boolean(perms.attachments?.upload), remove: Boolean(perms.attachments?.remove) }
  };
}

async function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '';

  if (req.method === 'POST' && pathname === '/api/login') {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const password = (payload.password || '').trim();
      const data = await database.update(current => ensureAdminPresence(normalizeData(current)));
      const user = (data.users || []).find(u => u.password === password && u.active !== false);
      if (!user) {
        sendJson(res, 401, { error: 'Неверный пароль' });
        return true;
      }
      const level = getAccessLevel(data, user.accessLevelId);
      const session = createSession(user, level);
      sendJson(res, 200, { token: session.token, user: sanitizeUser(user), accessLevel: level });
    } catch (err) {
      sendJson(res, 400, { error: 'Некорректный запрос' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = readToken(req);
    if (token) sessions.delete(token);
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const session = await requireSession(req, res);
    if (!session) return true;
    sendJson(res, 200, { user: sanitizeUser(session.user), accessLevel: session.level });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/users') {
    const session = await requireSession(req, res, { permission: { area: 'users', type: 'view' } });
    if (!session) return true;
    sendJson(res, 200, { users: session.data.users || [] });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/users') {
    const session = await requireSession(req, res, { permission: { area: 'users', type: 'change' } });
    if (!session) return true;
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const name = (payload.name || '').trim();
      const password = (payload.password || '').trim();
      const accessLevelId = payload.accessLevelId;
      const active = payload.active !== false;
      if (!name || !validatePassword(password)) {
        sendJson(res, 400, { error: 'Некорректные имя или пароль' });
        return true;
      }
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        if (!isPasswordUnique(data, password)) {
          throw new Error('Пароль уже используется');
        }
        data.users.push({
          id: genId('usr'),
          name,
          password,
          accessLevelId,
          active,
          createdAt: Date.now()
        });
        return data;
      });
      sendJson(res, 200, { status: 'ok', users: saved.users || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка сохранения пользователя' });
    }
    return true;
  }

  if (req.method === 'PUT' && pathname.startsWith('/api/users/')) {
    const session = await requireSession(req, res, { permission: { area: 'users', type: 'change' } });
    if (!session) return true;
    const userId = pathname.split('/').pop();
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const password = payload.password != null ? String(payload.password).trim() : null;
      const name = payload.name != null ? String(payload.name).trim() : null;
      const active = payload.active;
      const accessLevelId = payload.accessLevelId;
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        const target = (data.users || []).find(u => u.id === userId);
        if (!target) throw new Error('Пользователь не найден');
        if (target.name === ADMIN_LOGIN_NAME && password && password !== target.password) {
          throw new Error('Пароль администратора нельзя изменить');
        }
        if (password) {
          if (!validatePassword(password)) throw new Error('Некорректный пароль');
          if (!isPasswordUnique(data, password, target.id)) throw new Error('Пароль уже используется');
          target.password = password;
        }
        if (name) target.name = name;
        if (accessLevelId) target.accessLevelId = accessLevelId;
        if (active != null) target.active = Boolean(active);
        return data;
      });
      sendJson(res, 200, { status: 'ok', users: saved.users || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка обновления пользователя' });
    }
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
    const session = await requireSession(req, res, { permission: { area: 'users', type: 'change' } });
    if (!session) return true;
    const userId = pathname.split('/').pop();
    try {
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        const target = (data.users || []).find(u => u.id === userId);
        if (!target) throw new Error('Пользователь не найден');
        if (target.name === ADMIN_LOGIN_NAME) throw new Error('Нельзя удалить администратора');
        data.users = (data.users || []).filter(u => u.id !== userId);
        return data;
      });
      sendJson(res, 200, { status: 'ok', users: saved.users || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка удаления пользователя' });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/access-levels') {
    const session = await requireSession(req, res, { permission: { area: 'accessLevels', type: 'view' } });
    if (!session) return true;
    sendJson(res, 200, { levels: session.data.accessLevels || [] });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/access-levels') {
    const session = await requireSession(req, res, { permission: { area: 'accessLevels', type: 'change' } });
    if (!session) return true;
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const name = (payload.name || '').trim();
      if (!name) throw new Error('Уровень доступа должен иметь название');
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        data.accessLevels = data.accessLevels || [];
        data.accessLevels.push({
          id: genId('al'),
          name,
          description: payload.description || '',
          permissions: normalizePermissions(payload.permissions || {}),
          landingTab: payload.landingTab || 'dashboard',
          idleTimeoutMinutes: payload.idleTimeoutMinutes || 30,
          isWorker: Boolean(payload.isWorker)
        });
        return data;
      });
      sendJson(res, 200, { status: 'ok', levels: saved.accessLevels || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка сохранения уровня доступа' });
    }
    return true;
  }

  if (req.method === 'PUT' && pathname.startsWith('/api/access-levels/')) {
    const session = await requireSession(req, res, { permission: { area: 'accessLevels', type: 'change' } });
    if (!session) return true;
    const levelId = pathname.split('/').pop();
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        const level = (data.accessLevels || []).find(l => l.id === levelId);
        if (!level) throw new Error('Уровень доступа не найден');
        level.name = payload.name ? String(payload.name).trim() : level.name;
        level.description = payload.description != null ? String(payload.description) : (level.description || '');
        level.permissions = normalizePermissions(payload.permissions || level.permissions || {});
        level.landingTab = payload.landingTab || level.landingTab || 'dashboard';
        level.idleTimeoutMinutes = payload.idleTimeoutMinutes || level.idleTimeoutMinutes || 30;
        level.isWorker = payload.isWorker != null ? Boolean(payload.isWorker) : Boolean(level.isWorker);
        return data;
      });
      sendJson(res, 200, { status: 'ok', levels: saved.accessLevels || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка обновления уровня доступа' });
    }
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/access-levels/')) {
    const session = await requireSession(req, res, { permission: { area: 'accessLevels', type: 'change' } });
    if (!session) return true;
    const levelId = pathname.split('/').pop();
    try {
      const saved = await database.update(current => {
        const data = ensureAdminPresence(normalizeData(current));
        const inUse = (data.users || []).some(u => u.accessLevelId === levelId);
        if (inUse) throw new Error('Нельзя удалить уровень, который используется пользователями');
        data.accessLevels = (data.accessLevels || []).filter(l => l.id !== levelId);
        return data;
      });
      sendJson(res, 200, { status: 'ok', levels: saved.accessLevels || [] });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка удаления уровня доступа' });
    }
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/data')) {
    const session = await requireSession(req, res, { permission: { area: 'dashboard', type: 'view' } });
    if (!session) return true;
    const safe = { ...session.data, users: (session.data.users || []).map(sanitizeUser) };
    sendJson(res, 200, safe);
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/data')) {
    const session = await requireSession(req, res, { permission: { area: 'cards', type: 'change' } });
    if (!session) return true;
    try {
      const raw = await parseBody(req);
      const parsedBody = JSON.parse(raw || '{}');
      const saved = await database.update(current => {
        const normalized = normalizeData(parsedBody);
        const merged = mergeSnapshots(current, normalized);
        return ensureAdminPresence(merged);
      });
      const safe = { ...saved, users: (saved.users || []).map(sanitizeUser) };
      sendJson(res, 200, { status: 'ok', data: safe });
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
  const session = await requireSession(req, res, { permission: { area: 'cards', type: req.method === 'GET' ? 'view' : 'change' } });
  if (!session) return true;
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
    if (!hasPermission(session.level, { area: 'attachments', type: 'upload' })) {
      sendJson(res, 403, { error: 'Нет прав на загрузку файлов' });
      return true;
    }
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
  if (await handleApi(req, res)) return;
  if (await handleFileRoutes(req, res)) return;
  serveStatic(req, res);
}

async function startServer() {
  await database.init(buildDefaultData);
  await database.update(current => ensureAdminPresence(normalizeData(current)));
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
