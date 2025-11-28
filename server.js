const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { JsonDatabase, deepClone } = require('./db');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || 'localhost';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
const MAX_BODY_SIZE = 20 * 1024 * 1024; // 20 MB to allow attachments
const FILE_SIZE_LIMIT = 15 * 1024 * 1024; // 15 MB per attachment
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip', '.rar', '.7z'];
const DEFAULT_LOGOUT_MINUTES = 30;
const DEFAULT_ACCESS_LEVEL_ID = 'level_admin';
const DEFAULT_USER_ID = 'user_abyss';

const sessions = new Map();

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

function generateEAN13() {
  let base = '';
  for (let i = 0; i < 12; i++) {
    base += Math.floor(Math.random() * 10);
  }
  return base + computeEAN13CheckDigit(base);
}

function generateUniqueEAN13(cards) {
  let attempt = 0;
  while (attempt < 500) {
    const code = generateEAN13();
    if (!cards.some(c => c.barcode === code)) return code;
    attempt++;
  }
  return generateEAN13();
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

function createRouteOpFromRefs(op, center, executor, plannedMinutes, order) {
  return {
    id: genId('rop'),
    opId: op.id,
    opCode: op.code || op.opCode || generateUniqueOpCode(),
    opName: op.name,
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
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

  const auth = ensureDefaultAccounts({ cards, ops, centers, users: [], accessLevels: [] });
  return { cards, ops, centers, users: auth.users, accessLevels: auth.levels };
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
    holdCount: Number.isFinite(parseInt(op.holdCount, 10)) ? Math.max(0, parseInt(op.holdCount, 10)) : 0
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
      if (!nextOp.opCode || used.has(nextOp.opCode)) {
        nextOp.opCode = generateUniqueOpCode(used);
      }
      used.add(nextOp.opCode);
      return nextOp;
    });
    recalcCardStatus(nextCard);
    return nextCard;
  });
}

function normalizeAccessLevel(level) {
  const tabs = level && typeof level === 'object' ? level.tabs : level.permissions?.tabs;
  const perms = level && typeof level === 'object' ? level.permissions || {} : {};
  const baseTabs = tabs || {};
  const normalizedTabs = {
    dashboard: { view: true, edit: true },
    cards: { view: true, edit: true },
    workorders: { view: true, edit: true },
    archive: { view: true, edit: true },
    users: { view: true, edit: false },
    access: { view: true, edit: false }
  };

  Object.keys(normalizedTabs).forEach(key => {
    const src = baseTabs[key] || perms?.[key] || {};
    normalizedTabs[key] = {
      view: src.view !== false,
      edit: src.edit === true
    };
  });

  const attachments = level && level.permissions && level.permissions.attachments
    ? level.permissions.attachments
    : level.attachments || {};

  return {
    id: level.id || genId('level'),
    name: level.name || 'Уровень',
    description: level.description || level.desc || '',
    permissions: {
      tabs: normalizedTabs,
      attachments: {
        upload: attachments.upload !== false,
        remove: attachments.remove !== false
      }
    },
    landingTab: level.landingTab || 'dashboard',
    autoLogoutMinutes: Number.isFinite(level.autoLogoutMinutes) && level.autoLogoutMinutes > 0
      ? level.autoLogoutMinutes
      : DEFAULT_LOGOUT_MINUTES
  };
}

function buildDefaultAccessLevels() {
  const admin = normalizeAccessLevel({
    id: DEFAULT_ACCESS_LEVEL_ID,
    name: 'Администратор',
    description: 'Полный доступ ко всем разделам',
    permissions: {
      tabs: {
        dashboard: { view: true, edit: true },
        cards: { view: true, edit: true },
        workorders: { view: true, edit: true },
        archive: { view: true, edit: true },
        users: { view: true, edit: true },
        access: { view: true, edit: true }
      },
      attachments: { upload: true, remove: true }
    },
    landingTab: 'dashboard',
    autoLogoutMinutes: DEFAULT_LOGOUT_MINUTES
  });
  return [admin];
}

function normalizeUsers(list, accessLevels, cardsList) {
  const passwords = new Set();
  const cardPasswords = new Set((cardsList || []).map(c => c.barcode).filter(Boolean));
  return (Array.isArray(list) ? list : []).map(user => {
    const password = typeof user.password === 'string' ? user.password : '';
    const normalized = {
      id: user.id || genId('user'),
      name: user.name || 'Пользователь',
      password,
      accessLevelId: user.accessLevelId || DEFAULT_ACCESS_LEVEL_ID,
      active: user.active !== false,
      immutable: Boolean(user.immutable)
    };
    if (!normalized.password || passwords.has(normalized.password) || cardPasswords.has(normalized.password)) {
      normalized.password = genId('pw').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'secret1';
    }
    passwords.add(normalized.password);
    if (!accessLevels.some(level => level.id === normalized.accessLevelId)) {
      normalized.accessLevelId = DEFAULT_ACCESS_LEVEL_ID;
    }
    return normalized;
  });
}

function ensureDefaultAccounts(data) {
  const normalizedLevels = (data.accessLevels && data.accessLevels.length)
    ? data.accessLevels.map(normalizeAccessLevel)
    : buildDefaultAccessLevels();

  let normalizedUsers = normalizeUsers(data.users, normalizedLevels, data.cards);
  if (!normalizedUsers.length) {
    normalizedUsers = [
      {
        id: DEFAULT_USER_ID,
        name: 'Abyss',
        password: 'ssyba',
        accessLevelId: DEFAULT_ACCESS_LEVEL_ID,
        active: true,
        immutable: true
      }
    ];
  }

  const hasAbyss = normalizedUsers.some(u => u.name === 'Abyss');
  if (!hasAbyss) {
    normalizedUsers.unshift({
      id: DEFAULT_USER_ID,
      name: 'Abyss',
      password: 'ssyba',
      accessLevelId: DEFAULT_ACCESS_LEVEL_ID,
      active: true,
      immutable: true
    });
  } else {
    normalizedUsers = normalizedUsers.map(u => {
      if (u.name === 'Abyss') {
        return { ...u, password: 'ssyba', accessLevelId: DEFAULT_ACCESS_LEVEL_ID, active: true, immutable: true };
      }
      return u;
    });
  }

  return { levels: normalizedLevels, users: normalizedUsers };
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

  const authData = ensureDefaultAccounts(safe);
  safe.accessLevels = authData.levels;
  safe.users = authData.users;
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

function parseAuthToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  const parsed = url.parse(req.url, true);
  return parsed.query && parsed.query.token ? String(parsed.query.token) : null;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function createSession(user, accessLevel) {
  const token = genId('sess');
  const timeout = accessLevel?.autoLogoutMinutes || DEFAULT_LOGOUT_MINUTES;
  const expiresAt = Date.now() + timeout * 60 * 1000;
  sessions.set(token, { userId: user.id, expiresAt, timeout });
  return { token, expiresAt };
}

function refreshSession(token, accessLevel) {
  const session = sessions.get(token);
  if (!session) return null;
  const timeout = accessLevel?.autoLogoutMinutes || session.timeout || DEFAULT_LOGOUT_MINUTES;
  session.expiresAt = Date.now() + timeout * 60 * 1000;
  session.timeout = timeout;
  sessions.set(token, session);
  return session;
}

async function requireAuth(req, res) {
  const token = parseAuthToken(req);
  const session = getSession(token);
  if (!session) {
    sendJson(res, 401, { error: 'Необходима авторизация' });
    return null;
  }
  const data = await database.getData();
  const user = (data.users || []).find(u => u.id === session.userId);
  if (!user || user.active === false) {
    sessions.delete(token);
    sendJson(res, 401, { error: 'Сессия недействительна' });
    return null;
  }
  const access = (data.accessLevels || []).find(l => l.id === user.accessLevelId) || (data.accessLevels || [])[0];
  refreshSession(token, access);
  return { token, user, access };
}

function canManageUsers(access) {
  return Boolean(access && access.permissions && access.permissions.tabs && access.permissions.tabs.users && access.permissions.tabs.users.edit);
}

function canManageAccess(access) {
  return Boolean(access && access.permissions && access.permissions.tabs && access.permissions.tabs.access && access.permissions.tabs.access.edit);
}

function hasAnyEditPermission(access) {
  const tabs = access?.permissions?.tabs || {};
  return Object.values(tabs).some(p => p && p.edit);
}

function isPasswordUnique(data, password, excludeUserId) {
  if (!password) return false;
  const trimmed = String(password).trim();
  const users = data.users || [];
  const duplicate = users.some(u => u.password === trimmed && u.id !== excludeUserId);
  if (duplicate) return false;
  const cardMatch = (data.cards || []).some(card => card.barcode === trimmed || card.orderNo === trimmed);
  return !cardMatch;
}

async function handleApi(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return true;
  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    const data = await database.getData();
    sendJson(res, 200, data);
    return true;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/data')) {
    try {
      const raw = await parseBody(req);
      const parsed = JSON.parse(raw || '{}');
      if (!hasAnyEditPermission(auth.access)) {
        sendJson(res, 403, { error: 'Нет прав на изменение данных' });
        return true;
      }
      const saved = await database.update(current => {
        const normalized = normalizeData(parsed);
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

async function handleAuthRoutes(req, res) {
  if (req.method === 'POST' && req.url.startsWith('/api/auth/login')) {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const password = (payload.password || '').trim();
      let data = await database.getData();

      // Перестраховываемся на случай повреждённых или пустых данных: нормализуем
      // и убеждаемся, что учётная запись Abyss с паролем ssyba существует.
      const needsNormalization =
        !Array.isArray(data.users) ||
        !Array.isArray(data.accessLevels) ||
        !data.users.some(u => u.name === 'Abyss' && u.password === 'ssyba');
      if (needsNormalization) {
        data = await database.update(current => normalizeData(current));
      }

      const user = (data.users || []).find(u => u.password === password && u.active !== false);
      if (!user) {
        sendJson(res, 401, { error: 'Неверный пароль' });
        return true;
      }
      const access = (data.accessLevels || []).find(l => l.id === user.accessLevelId) || (data.accessLevels || [])[0];
      const session = createSession(user, access);
      sendJson(res, 200, { token: session.token, user, accessLevel: access, expiresAt: session.expiresAt });
    } catch (err) {
      sendJson(res, 400, { error: 'Ошибка авторизации' });
    }
    return true;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/auth/session')) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    sendJson(res, 200, { user: auth.user, accessLevel: auth.access, token: auth.token });
    return true;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/auth/logout')) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    sessions.delete(auth.token);
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  return false;
}

async function handleUsersApi(req, res) {
  if (!req.url.startsWith('/api/users')) return false;
  const auth = await requireAuth(req, res);
  if (!auth) return true;
  if (!canManageUsers(auth.access)) {
    sendJson(res, 403, { error: 'Нет прав для управления пользователями' });
    return true;
  }
  const parsedUrl = url.parse(req.url, true);
  const userId = parsedUrl.pathname.split('/')[3];

  if (req.method === 'GET' && parsedUrl.pathname === '/api/users') {
    const data = await database.getData();
    sendJson(res, 200, { users: data.users, accessLevels: data.accessLevels });
    return true;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/users') {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const trimmedPassword = (payload.password || '').trim();
        if (!trimmedPassword || trimmedPassword.length < 6 || !/[A-Za-z]/.test(trimmedPassword) || !/\d/.test(trimmedPassword)) {
          throw new Error('Пароль должен быть не короче 6 символов и содержать буквы и цифры');
        }
        if (!isPasswordUnique(normalized, trimmedPassword)) {
          throw new Error('Пароль уже используется в системе');
        }
        const user = {
          id: genId('user'),
          name: payload.name || 'Пользователь',
          password: trimmedPassword,
          accessLevelId: payload.accessLevelId || DEFAULT_ACCESS_LEVEL_ID,
          active: payload.active !== false,
          immutable: false
        };
        normalized.users.push(user);
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', users: data.users });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка сохранения пользователя' });
    }
    return true;
  }

  if (req.method === 'PUT' && parsedUrl.pathname.startsWith('/api/users/')) {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const target = (normalized.users || []).find(u => u.id === userId);
        if (!target) throw new Error('Пользователь не найден');
        if (target.immutable) {
          payload.password = target.password;
          payload.accessLevelId = DEFAULT_ACCESS_LEVEL_ID;
        }
        if (payload.password) {
          const trimmedPassword = String(payload.password || '').trim();
          if (trimmedPassword.length < 6 || !/[A-Za-z]/.test(trimmedPassword) || !/\d/.test(trimmedPassword)) {
            throw new Error('Пароль должен быть не короче 6 символов и содержать буквы и цифры');
          }
          if (!isPasswordUnique(normalized, trimmedPassword, target.id)) {
            throw new Error('Пароль уже используется в системе');
          }
          target.password = target.immutable ? target.password : trimmedPassword;
        }
        if (payload.name) target.name = payload.name;
        if (payload.accessLevelId && !target.immutable) target.accessLevelId = payload.accessLevelId;
        if (payload.active !== undefined) target.active = payload.active !== false;
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', users: data.users });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка обновления пользователя' });
    }
    return true;
  }

  if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/api/users/')) {
    try {
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const target = (normalized.users || []).find(u => u.id === userId);
        if (!target) throw new Error('Пользователь не найден');
        if (target.immutable) throw new Error('Нельзя удалить администратора Abyss');
        normalized.users = (normalized.users || []).filter(u => u.id !== userId);
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', users: data.users });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка удаления пользователя' });
    }
    return true;
  }

  return false;
}

async function handleAccessLevelsApi(req, res) {
  if (!req.url.startsWith('/api/access-levels')) return false;
  const auth = await requireAuth(req, res);
  if (!auth) return true;
  if (!canManageAccess(auth.access)) {
    sendJson(res, 403, { error: 'Нет прав на изменение уровней доступа' });
    return true;
  }
  const parsedUrl = url.parse(req.url, true);
  const levelId = parsedUrl.pathname.split('/')[3];

  if (req.method === 'GET' && parsedUrl.pathname === '/api/access-levels') {
    const data = await database.getData();
    sendJson(res, 200, { accessLevels: data.accessLevels });
    return true;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/access-levels') {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const level = normalizeAccessLevel(payload);
        normalized.accessLevels.push(level);
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', accessLevels: data.accessLevels });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка создания уровня' });
    }
    return true;
  }

  if (req.method === 'PUT' && parsedUrl.pathname.startsWith('/api/access-levels/')) {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const idx = (normalized.accessLevels || []).findIndex(l => l.id === levelId);
        if (idx === -1) throw new Error('Уровень не найден');
        const nextLevel = normalizeAccessLevel({ ...normalized.accessLevels[idx], ...payload, id: levelId });
        normalized.accessLevels[idx] = nextLevel;
        normalized.users = (normalized.users || []).map(u => {
          if (u.accessLevelId === levelId) {
            return { ...u, accessLevelId: levelId };
          }
          return u;
        });
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', accessLevels: data.accessLevels });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка обновления уровня' });
    }
    return true;
  }

  if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/api/access-levels/')) {
    try {
      const data = await database.update(current => {
        const normalized = normalizeData(current);
        const level = (normalized.accessLevels || []).find(l => l.id === levelId);
        if (!level) throw new Error('Уровень не найден');
        if (level.id === DEFAULT_ACCESS_LEVEL_ID) throw new Error('Нельзя удалить базовый уровень');
        const hasUsers = (normalized.users || []).some(u => u.accessLevelId === levelId);
        if (hasUsers) throw new Error('Удалите или измените пользователей этого уровня');
        normalized.accessLevels = (normalized.accessLevels || []).filter(l => l.id !== levelId);
        return normalized;
      });
      sendJson(res, 200, { status: 'ok', accessLevels: data.accessLevels });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Ошибка удаления уровня' });
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
  const auth = await requireAuth(req, res);
  if (!auth) return true;
  const parsed = url.parse(req.url, true);
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
      if (!auth.access?.permissions?.attachments?.upload) {
        sendJson(res, 403, { error: 'Нет прав на загрузку файлов' });
        return true;
      }
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
  if (await handleAuthRoutes(req, res)) return;
  if (await handleUsersApi(req, res)) return;
  if (await handleAccessLevelsApi(req, res)) return;
  if (await handleApi(req, res)) return;
  if (await handleFileRoutes(req, res)) return;
  serveStatic(req, res);
}

async function startServer() {
  await database.init(buildDefaultData);
  await database.update(current => normalizeData(current));
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
