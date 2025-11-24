const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || 'localhost';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

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

function createRouteOpFromRefs(op, center, executor, plannedMinutes, order) {
  return {
    id: genId('rop'),
    opId: op.id,
    opName: op.name,
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    status: 'NOT_STARTED',
    startedAt: null,
    finishedAt: null,
    actualSeconds: null,
    elapsedSeconds: 0,
    order: order || 1
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function buildDefaultData() {
  const centers = [
    { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
    { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
    { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
  ];

  const ops = [
    { id: genId('op'), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40 },
    { id: genId('op'), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60 },
    { id: genId('op'), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20 }
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
      operations: [
        createRouteOpFromRefs(ops[0], centers[0], 'Иванов И.И.', 40, 1),
        createRouteOpFromRefs(ops[1], centers[1], 'Петров П.П.', 60, 2),
        createRouteOpFromRefs(ops[2], centers[2], 'Сидоров С.С.', 20, 3)
      ]
    }
  ];

  return { cards, ops, centers };
}

function readData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const defaults = buildDefaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.cards || !parsed.ops || !parsed.centers) {
      throw new Error('Некорректный формат данных');
    }
    return parsed;
  } catch (err) {
    console.warn('Не удалось прочитать данные, создаём новые', err);
    const defaults = buildDefaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
}

function writeData(payload) {
  const safeData = {
    cards: Array.isArray(payload.cards) ? payload.cards : [],
    ops: Array.isArray(payload.ops) ? payload.ops : [],
    centers: Array.isArray(payload.centers) ? payload.centers : []
  };
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(safeData, null, 2), 'utf8');
  return safeData;
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

function handleApi(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    sendJson(res, 200, readData());
    return true;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/data')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        res.writeHead(413);
        res.end('Payload too large');
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const saved = writeData(parsed);
        sendJson(res, 200, { status: 'ok', data: saved });
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON' });
      }
    });

    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  if (handleApi(req, res)) return;
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started on http://${HOST}:${PORT}`);
});
