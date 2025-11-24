const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || 'localhost';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

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

app.get('/api/data', (req, res) => {
  res.json(readData());
});

app.post('/api/data', (req, res) => {
  const saved = writeData(req.body || {});
  res.json({ status: 'ok', data: saved });
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started on http://${HOST}:${PORT}`);
});
