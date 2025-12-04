// === КОНСТАНТЫ И ГЛОБАЛЬНЫЕ МАССИВЫ ===
const API_ENDPOINT = '/api/data';

let cards = [];
let ops = [];
let centers = [];
let workorderSearchTerm = '';
let workorderStatusFilter = 'ALL';
let workorderMissingExecutorFilter = 'ALL';
let workorderAutoScrollEnabled = true;
let suppressWorkorderAutoscroll = false;
let archiveSearchTerm = '';
let archiveStatusFilter = 'ALL';
let apiOnline = false;
const workorderOpenCards = new Set();
const workorderOpenGroups = new Set();
let activeCardDraft = null;
let activeCardOriginalId = null;
let activeCardIsNew = false;
let cardsSearchTerm = '';
let attachmentContext = null;
let routeQtyManual = false;
const ATTACH_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip,.rar,.7z';
const ATTACH_MAX_SIZE = 15 * 1024 * 1024; // 15 MB
let logContextCardId = null;
let clockIntervalId = null;
const cardsGroupOpen = new Set();
let groupExecutorContext = null;
let dashboardStatusSnapshot = null;
let dashboardEligibleCache = [];
let workspaceSearchTerm = '';
let workspaceStopContext = null;
let workspaceActiveModalInput = null;
let sessionToken = null;
let currentUser = null;
let currentAccessLevel = null;
let usersDirectory = [];
let accessLevelsDirectory = [];
let idleTimerId = null;

function setConnectionStatus(message, variant = 'info') {
  const banner = document.getElementById('server-status');
  if (!banner) return;

  if (!message) {
    banner.classList.add('hidden');
    return;
  }

  banner.textContent = message;
  banner.className = `status-banner status-${variant}`;
}

function startRealtimeClock() {
  const el = document.getElementById('realtime-clock');
  if (!el) return;
  const update = () => {
    const now = new Date();
    const date = now.toLocaleDateString('ru-RU');
    const time = now.toLocaleTimeString('ru-RU');
    el.textContent = `${date} ${time}`;
  };
  update();
  if (clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId = setInterval(update, 1000);
}

function hasAccess(area, type = 'view') {
  if (!currentAccessLevel || !currentAccessLevel.permissions) return false;
  const perms = currentAccessLevel.permissions[area] || {};
  return Boolean(perms[type]);
}

function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {}, sessionToken ? { 'x-session-token': sessionToken } : {});
  return fetch(url, { ...options, headers });
}

function resetIdleTimer() {
  if (idleTimerId) clearTimeout(idleTimerId);
  const minutes = currentAccessLevel && currentAccessLevel.idleTimeoutMinutes ? currentAccessLevel.idleTimeoutMinutes : 30;
  idleTimerId = setTimeout(() => {
    logout();
  }, minutes * 60 * 1000);
}

// === УТИЛИТЫ ===
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function generateRawOpCode() {
  return 'OP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateUniqueOpCode(used = new Set()) {
  let code = generateRawOpCode();
  let attempt = 0;
  const taken = new Set(used);
  while ((taken.has(code) || !code) && attempt < 1000) {
    code = generateRawOpCode();
    attempt++;
  }
  return code;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSecondsToHMS(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return '-';
  }
}

function formatStartEnd(op) {
  const start = op.firstStartedAt || op.startedAt;
  let endLabel = '-';
  if (op.status === 'PAUSED') {
    const pauseTs = op.lastPausedAt || Date.now();
    endLabel = formatDateTime(pauseTs) + ' (П)';
  } else if (op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'DONE' && op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'IN_PROGRESS') {
    endLabel = '-';
  }

  return '<div class="nk-lines"><div>Н: ' + escapeHtml(formatDateTime(start)) + '</div><div>К: ' + escapeHtml(endLabel) + '</div></div>';
}

// Время операции с учётом пауз / продолжений
function getOperationElapsedSeconds(op) {
  const base = typeof op.elapsedSeconds === 'number' ? op.elapsedSeconds : 0;
  if (op.status === 'IN_PROGRESS' && op.startedAt) {
    return base + (Date.now() - op.startedAt) / 1000;
  }
  return base;
}

function autoResizeComment(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function cloneCard(card) {
  return JSON.parse(JSON.stringify(card));
}

function isGroupCard(card) {
  return Boolean(card && card.isGroup);
}

function getGroupChildren(group) {
  if (!group) return [];
  return cards.filter(c => c.groupId === group.id);
}

function toSafeCount(val) {
  const num = parseInt(val, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function formatCardNameWithGroupPosition(card, { includeArchivedSiblings = false } = {}) {
  if (!card) return '';

  const baseName = card.name || card.id || '';
  if (!card.groupId) return escapeHtml(baseName);

  const siblings = cards.filter(c => c.groupId === card.groupId && (includeArchivedSiblings || !c.archived));
  let displayName = baseName;
  let position = null;

  const nameMatch = /^\s*(\d+)\.\s*(.*)$/.exec(displayName || '');
  if (nameMatch) {
    position = toSafeCount(nameMatch[1]);
    displayName = nameMatch[2] || '';
  }

  if (!position && siblings.length) {
    const idx = siblings.findIndex(c => c.id === card.id);
    position = idx >= 0 ? idx + 1 : null;
  }

  const total = siblings.length || null;
  const prefix = position && total ? '<span class="group-position">' + position + '/' + total + '</span> ' : '';

  return prefix + escapeHtml(displayName.trim());
}

function getCardPlannedQuantity(card) {
  if (!card) return { qty: null, hasValue: false };
  const rawQty = card.quantity !== '' && card.quantity != null
    ? card.quantity
    : (card.initialSnapshot && card.initialSnapshot.quantity);

  if (rawQty !== '' && rawQty != null) {
    return { qty: toSafeCount(rawQty), hasValue: true };
  }

  const snapshotItems = Array.isArray(card.initialSnapshot && card.initialSnapshot.items)
    ? card.initialSnapshot.items.length
    : null;
  if (snapshotItems) {
    return { qty: snapshotItems, hasValue: true };
  }

  const itemsCount = Array.isArray(card.items) ? card.items.length : null;
  if (itemsCount) {
    return { qty: itemsCount, hasValue: true };
  }

  return { qty: null, hasValue: false };
}

function formatStepCode(step) {
  return String(step * 5).padStart(3, '0');
}

function getOperationQuantity(op, card) {
  if (op && (op.quantity || op.quantity === 0)) {
    const q = toSafeCount(op.quantity);
    return Number.isFinite(q) ? q : '';
  }
  if (card && (card.quantity || card.quantity === 0)) {
    const q = toSafeCount(card.quantity);
    return Number.isFinite(q) ? q : '';
  }
  return '';
}

function sumItemCounts(items = []) {
  return items.reduce((acc, item) => {
    acc.good += toSafeCount(item && item.goodCount != null ? item.goodCount : 0);
    acc.scrap += toSafeCount(item && item.scrapCount != null ? item.scrapCount : 0);
    acc.hold += toSafeCount(item && item.holdCount != null ? item.holdCount : 0);
    return acc;
  }, { good: 0, scrap: 0, hold: 0 });
}

function calculateFinalResults(operations = [], initialQty = 0) {
  const total = toSafeCount(initialQty);
  const opsSorted = Array.isArray(operations)
    ? operations.filter(Boolean).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];

  const lastOp = opsSorted[opsSorted.length - 1];
  const goodFinal = toSafeCount(lastOp && lastOp.goodCount != null ? lastOp.goodCount : 0);
  const scrapFinal = toSafeCount(lastOp && lastOp.scrapCount != null ? lastOp.scrapCount : 0);
  const delayedFinal = toSafeCount(lastOp && lastOp.holdCount != null ? lastOp.holdCount : 0);

  return {
    good_final: goodFinal,
    scrap_final: scrapFinal,
    delayed_final: delayedFinal,
    summary_ok: total === 0 || goodFinal + scrapFinal + delayedFinal === total
  };
}

function buildItemsFromTemplate(template = [], qty = 0) {
  const items = [];
  const targetQty = Number.isFinite(qty) ? qty : 0;
  for (let i = 0; i < targetQty; i++) {
    const source = template[i] || {};
    items.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: 0,
      scrapCount: 0,
      holdCount: 0
    });
  }
  return items;
}

function renumberAutoCodesForCard(card) {
  if (!card || !Array.isArray(card.operations)) return;
  const opsSorted = [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0));
  let autoIndex = 0;
  opsSorted.forEach(op => {
    if (op.autoCode) {
      autoIndex++;
      op.opCode = formatStepCode(autoIndex);
    }
  });
}

function normalizeOperationItems(card, op) {
  if (!op || !card) return;
  op.items = Array.isArray(op.items) ? op.items : [];
  const useList = Boolean(card.useItemList);
  const opQty = getOperationQuantity(op, card);
  if (!useList) {
    const totals = sumItemCounts(op.items);
    op.goodCount = toSafeCount(op.goodCount || totals.good);
    op.scrapCount = toSafeCount(op.scrapCount || totals.scrap);
    op.holdCount = toSafeCount(op.holdCount || totals.hold);
    op.items = op.items.map(item => ({
      id: item.id || genId('item'),
      name: typeof item.name === 'string' ? item.name : '',
      quantity: 1,
      goodCount: toSafeCount(item.goodCount || 0),
      scrapCount: toSafeCount(item.scrapCount || 0),
      holdCount: toSafeCount(item.holdCount || 0)
    }));
    return;
  }

  const targetQty = Number.isFinite(opQty) ? opQty : 0;
  const normalized = [];
  for (let i = 0; i < targetQty; i++) {
    const source = op.items[i] || {};
    normalized.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: toSafeCount(source.goodCount || 0),
      scrapCount: toSafeCount(source.scrapCount || 0),
      holdCount: toSafeCount(source.holdCount || 0)
    });
  }
  op.items = normalized;
  const totals = sumItemCounts(normalized);
  op.goodCount = totals.good;
  op.scrapCount = totals.scrap;
  op.holdCount = totals.hold;
}

function ensureAttachments(card) {
  if (!card) return;
  if (!Array.isArray(card.attachments)) card.attachments = [];
  card.attachments = card.attachments.map(file => ({
    id: file.id || genId('file'),
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: typeof file.size === 'number' ? file.size : 0,
    content: typeof file.content === 'string' ? file.content : '',
    createdAt: file.createdAt || Date.now()
  }));
}

function ensureCardMeta(card, options = {}) {
  if (!card) return;
  const { skipSnapshot = false } = options;
  if (card.quantity == null) card.quantity = '';
  if (typeof card.drawing !== 'string') card.drawing = card.drawing ? String(card.drawing) : '';
  if (typeof card.material !== 'string') card.material = card.material ? String(card.material) : '';
  if (typeof card.contractNumber !== 'string') card.contractNumber = card.contractNumber ? String(card.contractNumber) : '';
  card.useItemList = Boolean(card.useItemList);
  if (typeof card.createdAt !== 'number') {
    card.createdAt = Date.now();
  }
  if (!Array.isArray(card.logs)) {
    card.logs = [];
  }
  if (!card.initialSnapshot && !skipSnapshot) {
    const snapshot = cloneCard(card);
    snapshot.logs = [];
    card.initialSnapshot = snapshot;
  }
  card.operations = card.operations || [];
  card.operations.forEach(op => {
    op.goodCount = toSafeCount(op.goodCount || 0);
    op.scrapCount = toSafeCount(op.scrapCount || 0);
    op.holdCount = toSafeCount(op.holdCount || 0);
    op.quantity = getOperationQuantity(op, card);
    op.autoCode = Boolean(op.autoCode);
    op.additionalExecutors = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.map(name => (name || '').toString()).slice(0, 2)
      : [];
    normalizeOperationItems(card, op);
  });
  renumberAutoCodesForCard(card);
}

function formatLogValue(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch (err) {
    return String(val);
  }
}

function recordCardLog(card, { action, object, field = null, targetId = null, oldValue = '', newValue = '' }) {
  if (!card) return;
  ensureCardMeta(card);
  card.logs.push({
    id: genId('log'),
    ts: Date.now(),
    action: action || 'update',
    object: object || '',
    field,
    targetId,
    oldValue: formatLogValue(oldValue),
    newValue: formatLogValue(newValue)
  });
}

function opLogLabel(op) {
  return formatOpLabel(op) || 'Операция';
}

function dataUrlToBlob(dataUrl, fallbackType = 'application/octet-stream') {
  const parts = (dataUrl || '').split(',');
  if (parts.length < 2) return new Blob([], { type: fallbackType });
  const match = parts[0].match(/data:(.*);base64/);
  const mime = match ? match[1] : fallbackType;
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function formatBytes(size) {
  if (!size) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let idx = 0;
  let s = size;
  while (s >= 1024 && idx < units.length - 1) {
    s /= 1024;
    idx++;
  }
  return s.toFixed(Math.min(1, idx)).replace(/\.0$/, '') + ' ' + units[idx];
}

// === EAN-13: генерация и прорисовка ===
function computeEAN13CheckDigit(base12) {
  if (!/^\d{12}$/.test(base12)) {
    throw new Error('Базовый код для EAN-13 должен содержать 12 цифр');
  }
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
  const check = (10 - mod) % 10;
  return String(check);
}

function buildEAN13FromSequence(sequenceNumber) {
  const base = String(Math.max(0, parseInt(sequenceNumber, 10) || 0)).padStart(12, '0');
  const check = computeEAN13CheckDigit(base);
  return base + check;
}

function getNextEANSequence() {
  let maxSeq = 0;
  cards.forEach(card => {
    if (!card || !card.barcode || !/^\d{13}$/.test(card.barcode)) return;
    const seq = parseInt(card.barcode.slice(0, 12), 10);
    if (Number.isFinite(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  });
  return maxSeq + 1;
}

function generateUniqueEAN13() {
  let seq = getNextEANSequence();
  let attempt = 0;
  while (attempt < 1000) {
    const code = buildEAN13FromSequence(seq);
    if (!cards.some(c => c.barcode === code)) return code;
    seq++;
    attempt++;
  }
  return buildEAN13FromSequence(seq);
}

function drawBarcodeEAN13(canvas, code) {
  if (!canvas || !code || !/^\d{13}$/.test(code)) return;
  const ctx = canvas.getContext('2d');

  const patternsA = {
    0: '0001101', 1: '0011001', 2: '0010011', 3: '0111101', 4: '0100011',
    5: '0110001', 6: '0101111', 7: '0111011', 8: '0110111', 9: '0001011'
  };
  const patternsB = {
    0: '0100111', 1: '0110011', 2: '0011011', 3: '0100001', 4: '0011101',
    5: '0111001', 6: '0000101', 7: '0010001', 8: '0001001', 9: '0010111'
  };
  const patternsC = {
    0: '1110010', 1: '1100110', 2: '1101100', 3: '1000010', 4: '1011100',
    5: '1001110', 6: '1010000', 7: '1000100', 8: '1001000', 9: '1110100'
  };
  const parityMap = {
    0: 'AAAAAA',
    1: 'AABABB',
    2: 'AABBAB',
    3: 'AABBBA',
    4: 'ABAABB',
    5: 'ABBAAB',
    6: 'ABBBAA',
    7: 'ABABAB',
    8: 'ABABBA',
    9: 'ABBABA'
  };

  const digits = code.split('').map(d => parseInt(d, 10));
  const first = digits[0];
  const parity = parityMap[first];
  let bits = '101'; // левая рамка

  for (let i = 1; i <= 6; i++) {
    const d = digits[i];
    const p = parity[i - 1];
    bits += (p === 'A' ? patternsA[d] : patternsB[d]);
  }

  bits += '01010'; // центральная рамка

  for (let i = 7; i <= 12; i++) {
    const d = digits[i];
    bits += patternsC[d];
  }

  bits += '101'; // правая рамка

  const barWidth = 2;
  const barHeight = 80;
  const fontHeight = 16;
  const width = bits.length * barWidth;
  const height = barHeight + fontHeight + 10;

  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') {
      ctx.fillRect(i * barWidth, 0, barWidth, barHeight);
    }
  }

  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(code, width / 2, barHeight + fontHeight);
}

function getBarcodeDataUrl(code) {
  const canvas = document.createElement('canvas');
  drawBarcodeEAN13(canvas, code || '');
  return canvas.toDataURL('image/png');
}

function openBarcodeModal(card) {
  const modal = document.getElementById('barcode-modal');
  const canvas = document.getElementById('barcode-canvas');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  if (!modal || !canvas || !codeSpan) return;

  const isGroup = isGroupCard(card);
  if (title) {
    title.textContent = isGroup ? 'Штрихкод группы карт' : 'Штрихкод технологической карты';
  }

  if (!card.barcode || !/^\d{13}$/.test(card.barcode)) {
    card.barcode = generateUniqueEAN13();
    saveData();
    renderCardsTable();
    renderWorkordersTable();
  }

  drawBarcodeEAN13(canvas, card.barcode);
  codeSpan.textContent = card.barcode;
  modal.style.display = 'flex';
}

function closeBarcodeModal() {
  const modal = document.getElementById('barcode-modal');
  if (modal) modal.style.display = 'none';
}

function setupBarcodeModal() {
  const modal = document.getElementById('barcode-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('btn-close-barcode');
  const printBtn = document.getElementById('btn-print-barcode');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeBarcodeModal);
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const canvas = document.getElementById('barcode-canvas');
      const codeSpan = document.getElementById('barcode-modal-code');
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      const code = codeSpan ? codeSpan.textContent : '';
      const win = window.open('', '_blank');
      if (!win) return;
      win.document.write('<html><head><title>Печать штрихкода</title></head><body style="text-align:center;">');
      win.document.write('<img src="' + dataUrl + '" style="max-width:100%;"><br>');
      win.document.write('<div style="margin-top:8px; font-size:16px;">' + code + '</div>');
      win.document.write('</body></html>');
      win.document.close();
      win.focus();
      win.print();
    });
  }
}

// === МОДЕЛЬ ОПЕРАЦИИ МАРШРУТА ===
function createRouteOpFromRefs(op, center, executor, plannedMinutes, order, options = {}) {
  const { code, autoCode = false, quantity, items = [] } = options;
  return {
    id: genId('rop'),
    opId: op.id,
    opCode: code || op.code || op.opCode || generateUniqueOpCode(collectUsedOpCodes()),
    opName: op.name,
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    quantity: quantity === '' || quantity == null ? '' : toSafeCount(quantity),
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
    holdCount: 0,
    items
  };
}

function recalcCardStatus(card) {
  if (isGroupCard(card)) {
    const children = getGroupChildren(card);
    if (!children.length) {
      card.status = 'NOT_STARTED';
      return;
    }
    const childStatuses = children.map(c => c.status || 'NOT_STARTED');
    const allDone = childStatuses.every(s => s === 'DONE');
    const anyInProgress = childStatuses.some(s => s === 'IN_PROGRESS');
    const anyPaused = childStatuses.some(s => s === 'PAUSED');
    const anyDone = childStatuses.some(s => s === 'DONE');
    const anyNotStarted = childStatuses.some(s => s === 'NOT_STARTED');
    if (anyInProgress) {
      card.status = 'IN_PROGRESS';
    } else if (anyPaused) {
      card.status = 'PAUSED';
    } else if (allDone) {
      card.status = 'DONE';
    } else if (anyDone && anyNotStarted) {
      card.status = 'PAUSED';
    } else {
      card.status = 'NOT_STARTED';
    }
    return;
  }
  const opsArr = card.operations || [];
  if (!opsArr.length) {
    card.status = 'NOT_STARTED';
    return;
  }
  const hasActive = opsArr.some(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  const hasDone = opsArr.some(o => o.status === 'DONE');
  if (hasActive) {
    card.status = 'IN_PROGRESS';
  } else if (hasDone && hasNotStarted) {
    card.status = 'PAUSED';
  } else if (allDone && !hasNotStarted) {
    card.status = 'DONE';
  } else {
    card.status = 'NOT_STARTED';
  }
}

function statusBadge(status) {
  if (status === 'IN_PROGRESS') return '<span class="badge status-in-progress">В работе</span>';
  if (status === 'PAUSED') return '<span class="badge status-paused">Пауза</span>';
  if (status === 'DONE') return '<span class="badge status-done">Завершена</span>';
  return '<span class="badge status-not-started">Не начата</span>';
}

function cardStatusText(card) {
  if (isGroupCard(card)) {
    const children = getGroupChildren(card);
    if (!children.length) return 'Не запущена';
    const anyInProgress = children.some(c => c.status === 'IN_PROGRESS');
    const anyPaused = children.some(c => c.status === 'PAUSED');
    const anyPausedOp = children.some(ch => (ch.operations || []).some(op => op.status === 'PAUSED'));
    const allDone = children.length > 0 && children.every(c => c.status === 'DONE');
    const anyDone = children.some(c => c.status === 'DONE');
    const anyNotStarted = children.some(c => c.status === 'NOT_STARTED' || !c.status);

    if (anyPausedOp) return 'Смешанно';
    if (anyInProgress) return 'Выполняется';
    if (anyPaused) return 'Пауза';
    if (allDone) return 'Завершена';
    if (anyDone && anyNotStarted) return 'Пауза';
    return 'Не запущена';
  }
  const opsArr = card.operations || [];

  const hasStartedOrDoneOrPaused = opsArr.some(o =>
    o.status === 'IN_PROGRESS' || o.status === 'DONE' || o.status === 'PAUSED'
  );
  if (!opsArr.length || !hasStartedOrDoneOrPaused) {
    return 'Не запущена';
  }

  const inProgress = opsArr.find(o => o.status === 'IN_PROGRESS');
  if (inProgress) {
    const sec = getOperationElapsedSeconds(inProgress);
    return formatOpLabel(inProgress) + ' (' + formatSecondsToHMS(sec) + ')';
  }

  const paused = opsArr.find(o => o.status === 'PAUSED');
  if (paused) {
    const sec = getOperationElapsedSeconds(paused);
    return formatOpLabel(paused) + ' (пауза ' + formatSecondsToHMS(sec) + ')';
  }

  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  if (allDone) {
    return 'Завершена';
  }

  const hasDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  if (hasDone && hasNotStarted) {
    return 'Пауза';
  }

  const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
  if (notStartedOps.length) {
    let next = notStartedOps[0];
    notStartedOps.forEach(o => {
      const curOrder = typeof next.order === 'number' ? next.order : 999999;
      const newOrder = typeof o.order === 'number' ? o.order : 999999;
      if (newOrder < curOrder) next = o;
    });
    return formatOpLabel(next) + ' (ожидание)';
  }

  return 'Не запущена';
}

function getCardProcessState(card, { includeArchivedChildren = false } = {}) {
  if (isGroupCard(card)) {
    const children = getGroupChildren(card).filter(c => includeArchivedChildren || !c.archived);
    if (!children.length) return { key: 'NOT_STARTED', label: 'Не запущено', className: 'not-started' };
    const childStates = children.map(c => getCardProcessState(c, { includeArchivedChildren }));
    const hasPausedOp = children.some(ch => (ch.operations || []).some(op => op.status === 'PAUSED'));
    const hasInProgress = childStates.some(s => s.key === 'IN_PROGRESS');
    const hasPaused = childStates.some(s => s.key === 'PAUSED' || s.key === 'MIXED');
    const allDone = childStates.length > 0 && childStates.every(s => s.key === 'DONE');
    const hasDone = childStates.some(s => s.key === 'DONE');
    const hasNotStarted = childStates.some(s => s.key === 'NOT_STARTED');
    if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
    if (hasPausedOp) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
    if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
    if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
    if (hasDone && hasNotStarted) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
    return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  }
  const opsArr = card.operations || [];
  const hasInProgress = opsArr.some(o => o.status === 'IN_PROGRESS');
  const hasPaused = opsArr.some(o => o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const allNotStarted = opsArr.length > 0 && opsArr.every(o => o.status === 'NOT_STARTED' || !o.status);
  const hasAnyDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);

  if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
  if (hasInProgress && hasPaused) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
  if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (hasAnyDone && hasNotStarted) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (allNotStarted) return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  if (hasAnyDone) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
}

function cardHasMissingExecutors(card) {
  const opsArr = card.operations || [];
  return opsArr.some(op => {
    const mainMissing = !op.executor || !String(op.executor).trim();
    const additionalMissing = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.some(ex => !ex || !String(ex).trim())
      : false;
    return mainMissing || additionalMissing;
  });
}

function groupHasMissingExecutors(group) {
  if (!isGroupCard(group)) return false;
  const children = getGroupChildren(group).filter(c => !c.archived);
  return children.some(cardHasMissingExecutors);
}

function renderCardStateBadge(card, options) {
  const state = getCardProcessState(card, options);
  if (state.key === 'DONE') {
    return '<span class="status-pill status-pill-done" title="Выполнено">✓</span>';
  }
  if (state.key === 'MIXED') {
    return '<span class="status-pill status-pill-mixed" title="Смешанный статус">Смешанно</span>';
  }
  return '<span class="status-pill status-pill-' + state.className + '">' + state.label + '</span>';
}

function getCardComment(card) {
  const opsArr = card.operations || [];
  const priority = ['IN_PROGRESS', 'PAUSED', 'DONE', 'NOT_STARTED'];
  for (const status of priority) {
    const found = opsArr.find(o => o.status === status && o.comment);
    if (found) return found.comment;
  }
  const fallback = opsArr.find(o => o.comment);
  return fallback ? fallback.comment : '';
}

function formatOpLabel(op) {
  const code = op.opCode || op.code || '';
  const name = op.opName || op.name || '';
  return code ? `[${code}] ${name}` : name;
}

function renderOpLabel(op) {
  return escapeHtml(formatOpLabel(op));
}

function renderOpName(op) {
  const name = op.opName || op.name || '';
  return escapeHtml(name);
}

function collectUsedOpCodes() {
  const used = new Set();
  ops.forEach(o => {
    if (o.code) used.add(o.code);
  });
  cards.forEach(card => {
    (card.operations || []).forEach(op => {
      if (op.opCode) used.add(op.opCode);
    });
  });
  return used;
}

function ensureOperationCodes() {
  const used = collectUsedOpCodes();
  ops = ops.map(op => {
    const next = { ...op };
    if (!next.code || used.has(next.code)) {
      next.code = generateUniqueOpCode(used);
    }
    used.add(next.code);
    return next;
  });

  const opMap = Object.fromEntries(ops.map(op => [op.id, op]));
  cards = cards.map(card => {
    const clonedCard = { ...card };
    clonedCard.operations = (clonedCard.operations || []).map(op => {
      const next = { ...op };
      const source = next.opId ? opMap[next.opId] : null;
      if (source && source.code) {
        next.opCode = source.code;
      }
      if (!next.opCode || used.has(next.opCode)) {
        next.opCode = generateUniqueOpCode(used);
      }
      used.add(next.opCode);
      return next;
    });
    return clonedCard;
  });
}

// === ХРАНИЛИЩЕ ===
async function saveData() {
  try {
    if (!apiOnline) {
      setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
      return;
    }

    const res = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, ops, centers, users: usersDirectory, accessLevels: accessLevelsDirectory })
    });
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    setConnectionStatus('', 'info');
  } catch (err) {
    apiOnline = false;
    setConnectionStatus('Не удалось сохранить данные на сервер: ' + err.message, 'error');
    console.error('Ошибка сохранения данных на сервер', err);
  }
}

function ensureDefaults() {
  if (!centers.length) {
    centers = [
      { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
      { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
      { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
    ];
  }

  if (!ops.length) {
    const used = new Set();
    ops = [
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40 },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60 },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20 }
    ];
  }

  if (!cards.length) {
    const demoId = genId('card');
    const op1 = ops[0];
    const op2 = ops[1];
    const op3 = ops[2];
    const wc1 = centers[0];
    const wc2 = centers[1];
    const wc3 = centers[2];
    cards = [
      {
        id: demoId,
        barcode: generateUniqueEAN13(),
        name: 'Вал привода Ø60',
        quantity: 1,
        drawing: 'DWG-001',
        material: 'Сталь',
        orderNo: 'DEMO-001',
        desc: 'Демонстрационная карта для примера.',
        status: 'NOT_STARTED',
        archived: false,
        attachments: [],
        operations: [
          createRouteOpFromRefs(op1, wc1, 'Иванов И.И.', 40, 1),
          createRouteOpFromRefs(op2, wc2, 'Петров П.П.', 60, 2),
          createRouteOpFromRefs(op3, wc3, 'Сидоров С.С.', 20, 3)
        ]
      }
    ];
  }
}

async function loadData() {
  try {
    const res = await apiFetch(API_ENDPOINT);
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    cards = Array.isArray(payload.cards) ? payload.cards : [];
    ops = Array.isArray(payload.ops) ? payload.ops : [];
    centers = Array.isArray(payload.centers) ? payload.centers : [];
    usersDirectory = Array.isArray(payload.users) ? payload.users : [];
    accessLevelsDirectory = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    apiOnline = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
    usersDirectory = [];
    accessLevelsDirectory = [];
  }

  ensureDefaults();
  ensureOperationCodes();

  cards.forEach(c => {
    if (!c.barcode || !/^\d{13}$/.test(c.barcode)) {
      c.barcode = generateUniqueEAN13();
    }
    c.archived = Boolean(c.archived);
    ensureAttachments(c);
    ensureCardMeta(c);
    c.operations = c.operations || [];
    c.operations.forEach(op => {
      if (typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = 0;
      }
      op.goodCount = toSafeCount(op.goodCount || 0);
      op.scrapCount = toSafeCount(op.scrapCount || 0);
      op.holdCount = toSafeCount(op.holdCount || 0);
      if (typeof op.firstStartedAt !== 'number') {
        op.firstStartedAt = op.startedAt || null;
      }
      if (typeof op.lastPausedAt !== 'number') {
        op.lastPausedAt = null;
      }
      if (typeof op.comment !== 'string') {
        op.comment = '';
      }
      if (op.status === 'DONE' && op.actualSeconds != null && !op.elapsedSeconds) {
        op.elapsedSeconds = op.actualSeconds;
      }
    });
    recalcCardStatus(c);
  });

  if (apiOnline) {
    await saveData();
  }
}

// === РЕНДЕРИНГ ДАШБОРДА ===
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const activeCards = cards.filter(c => !c.archived && !isGroupCard(c));
  const cardsCount = activeCards.length;
  const inWork = activeCards.filter(c => c.status === 'IN_PROGRESS').length;
  const done = activeCards.filter(c => c.status === 'DONE').length;
  const notStarted = cardsCount - inWork - done;

  statsContainer.innerHTML = '';
  const stats = [
    { label: 'Всего карт', value: cardsCount },
    { label: 'Не запущено', value: notStarted },
    { label: 'В работе', value: inWork },
    { label: 'Завершено', value: done }
  ];
  stats.forEach(st => {
    const div = document.createElement('div');
    div.className = 'stat-block';
    div.innerHTML = '<span>' + st.label + '</span><strong>' + st.value + '</strong>';
    statsContainer.appendChild(div);
  });

  const dashTableWrapper = document.getElementById('dashboard-cards');
  const currentStatusSnapshot = (() => {
    const map = new Map();
    cards.forEach(card => {
      if (card && !card.archived) {
        map.set(card.id, card.status || 'NOT_STARTED');
      }
    });
    return map;
  })();

  const statusChanged = (() => {
    if (!dashboardStatusSnapshot) return true;
    if (dashboardStatusSnapshot.size !== currentStatusSnapshot.size) return true;
    for (const [id, status] of currentStatusSnapshot.entries()) {
      if (dashboardStatusSnapshot.get(id) !== status) return true;
    }
    return false;
  })();

  dashboardStatusSnapshot = currentStatusSnapshot;
  if (statusChanged) {
    dashboardEligibleCache = activeCards.filter(c => c.status !== 'NOT_STARTED');
  }
  const eligibleCards = dashboardEligibleCache;
  const emptyMessage = '<p>Карт для отображения пока нет.</p>';
  const tableHeader = '<thead><tr><th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус / операции</th><th>Сделано деталей</th><th>Выполнено операций</th><th>Комментарии</th></tr></thead>';

  if (!eligibleCards.length) {
    if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
      window.dashboardPager.render({
        headerHtml: tableHeader,
        rowsHtml: [],
        emptyMessage
      });
    } else if (dashTableWrapper) {
      dashTableWrapper.innerHTML = emptyMessage;
    }
    return;
  }

  if (!statusChanged) {
    updateDashboardTimers();
    return;
  }

  const rowsHtml = eligibleCards.map(card => {
    const opsArr = card.operations || [];
    const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
    let statusHtml = '';

    let opsForDisplay = [];
    if (card.status === 'DONE') {
      statusHtml = '<span class="dash-card-completed">Завершена</span>';
    } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
      statusHtml = 'Не запущена';
    } else if (activeOps.length) {
      opsForDisplay = activeOps;
      activeOps.forEach(op => {
        const elapsed = getOperationElapsedSeconds(op);
        const plannedSec = (op.plannedMinutes || 0) * 60;
        let cls = 'dash-op';
        if (op.status === 'PAUSED') {
          cls += ' dash-op-paused';
        }
        if (plannedSec && elapsed > plannedSec) {
          cls += ' dash-op-overdue';
        }
        statusHtml += '<span class="' + cls + '" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
          '<span class="dash-op-label">' + renderOpLabel(op) + '</span>' +
          ' — <span class="dash-op-time">' + formatSecondsToHMS(elapsed) + '</span>' +
          '</span>';
      });
    } else {
      const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
      if (notStartedOps.length) {
        let next = notStartedOps[0];
        notStartedOps.forEach(o => {
          const curOrder = typeof next.order === 'number' ? next.order : 999999;
          const newOrder = typeof o.order === 'number' ? o.order : 999999;
          if (newOrder < curOrder) next = o;
        });
        opsForDisplay = [next];
        statusHtml = renderOpLabel(next) + ' (ожидание)';
      } else {
        statusHtml = 'Не запущена';
      }
    }

    const { qty: qtyTotal, hasValue: hasQty } = getCardPlannedQuantity(card);
    let qtyCell = '—';

    if (card.status === 'DONE' && hasQty) {
      const batchResult = calculateFinalResults(opsArr, qtyTotal || 0);
      const qtyText = (batchResult.good_final || 0) + ' из ' + qtyTotal;
      qtyCell = '<div class="dash-qty-line">' + qtyText + '</div>';
    } else if (opsForDisplay.length && hasQty) {
      const qtyLines = opsForDisplay.map(op => {
        const good = toSafeCount(op.goodCount || 0);
        const qtyText = good + ' из ' + qtyTotal;
        return '<div class="dash-qty-line">' + qtyText + '</div>';
      });
      qtyCell = qtyLines.length ? qtyLines.join('') : '—';
    }

    const completedCount = opsArr.filter(o => o.status === 'DONE').length;
    const commentLines = opsForDisplay
      .filter(o => o.comment)
      .map(o => '<div class="dash-comment-line"><span class="dash-comment-op">' + renderOpLabel(o) + ':</span> ' + escapeHtml(o.comment) + '</div>');
    const commentCell = commentLines.join('');

    const nameCell = formatCardNameWithGroupPosition(card);
    return '<tr>' +
      '<td>' + escapeHtml(card.barcode || '') + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
      '<td>' + qtyCell + '</td>' +
      '<td>' + completedCount + ' из ' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td>' + commentCell + '</td>' +
      '</tr>';
  });

  if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
    window.dashboardPager.render({
      headerHtml: tableHeader,
      rowsHtml,
      emptyMessage
    });
  } else if (dashTableWrapper) {
    dashTableWrapper.innerHTML = '<table>' + tableHeader + '<tbody>' + rowsHtml.join('') + '</tbody></table>';
  }
}

function updateDashboardTimers() {
  const nodes = document.querySelectorAll('.dashboard-card-status .dash-op[data-card-id][data-op-id]');
  nodes.forEach(node => {
    const cardId = node.getAttribute('data-card-id');
    const opId = node.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    const elapsed = getOperationElapsedSeconds(op);
    const plannedSec = (op.plannedMinutes || 0) * 60;
    const timeSpan = node.querySelector('.dash-op-time');

    if (timeSpan) {
      timeSpan.textContent = formatSecondsToHMS(elapsed);
    }

    node.classList.toggle('dash-op-paused', op.status === 'PAUSED');
    node.classList.toggle('dash-op-overdue', plannedSec && elapsed > plannedSec);
  });
}

// === РЕНДЕРИНГ ТЕХ.КАРТ ===
function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  const visibleCards = cards.filter(c => !c.archived && !c.groupId);
  if (!visibleCards.length) {
    wrapper.innerHTML = '<p>Список технологических карт пуст. Нажмите «Создать карту».</p>';
    return;
  }

  const termRaw = cardsSearchTerm.trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };

  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      return cardMatches(card) || children.some(ch => cardMatches(ch));
    }
    return cardMatches(card);
  });

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '<table><thead><tr>' +
    '<th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус</th><th>Операций</th><th>Файлы</th><th>Действия</th>' +
    '</tr></thead><tbody>';

  filteredCards.forEach(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      const filesCount = (card.attachments || []).length;
      const opened = cardsGroupOpen.has(card.id);
      const opsTotal = children.reduce((acc, c) => acc + ((c.operations || []).length), 0);
      const toggleLabel = opened ? 'Закрыть' : 'Открыть';
      html += '<tr class="group-row" data-group-id="' + card.id + '">' +
        '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(card.barcode || '') + '</button></td>' +
        '<td><span class="group-marker">(Г)</span>' + escapeHtml(card.name) + '</td>' +
        '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
        '<td></td>' +
        '<td>' + opsTotal + '</td>' +
        '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small group-toggle-btn" data-action="toggle-group" data-id="' + card.id + '">' + toggleLabel + '</button>' +
        '<button class="btn-small" data-action="print-group" data-id="' + card.id + '">Печать</button>' +
        '<button class="btn-small" data-action="copy-group" data-id="' + card.id + '">Копировать</button>' +
        '<button class="btn-small btn-danger" data-action="delete-group" data-id="' + card.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';

      if (opened) {
        children.forEach(child => {
          const childFiles = (child.attachments || []).length;
          html += '<tr class="group-child-row" data-parent="' + card.id + '">' +
            '<td><button class="btn-link barcode-link" data-id="' + child.id + '">' + escapeHtml(child.barcode || '') + '</button></td>' +
            '<td class="group-indent">' + formatCardNameWithGroupPosition(child) + '</td>' +
            '<td>' + escapeHtml(child.orderNo || '') + '</td>' +
            '<td>' + cardStatusText(child) + '</td>' +
            '<td>' + ((child.operations || []).length) + '</td>' +
            '<td><button class="btn-small clip-btn" data-attach-card="' + child.id + '">📎 <span class="clip-count">' + childFiles + '</span></button></td>' +
            '<td><div class="table-actions">' +
            '<button class="btn-small" data-action="edit-card" data-id="' + child.id + '">Открыть</button>' +
            '<button class="btn-small" data-action="print-card" data-id="' + child.id + '">Печать</button>' +
            '<button class="btn-small" data-action="copy-card" data-id="' + child.id + '">Копировать</button>' +
            '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + child.id + '">Удалить</button>' +
            '</div></td>' +
            '</tr>';
        });
      }
      return;
    }

    const filesCount = (card.attachments || []).length;
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(card.barcode || '') + '</button></td>' +
      '<td>' + escapeHtml(card.name) + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td>' + cardStatusText(card) + '</td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
      '<button class="btn-small" data-action="copy-card" data-id="' + card.id + '">Копировать</button>' +
      '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + card.id + '">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openCardModal(btn.getAttribute('data-id'));
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      duplicateCard(btn.getAttribute('data-id'));
    });
  });

  wrapper.querySelectorAll('button[data-action="toggle-group"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (cardsGroupOpen.has(id)) {
        cardsGroupOpen.delete(id);
      } else {
        cardsGroupOpen.add(id);
      }
      renderCardsTable();
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-group"]').forEach(btn => {
    btn.addEventListener('click', () => duplicateGroup(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="delete-group"]').forEach(btn => {
    btn.addEventListener('click', () => deleteGroup(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="print-group"]').forEach(btn => {
    btn.addEventListener('click', () => printGroupList(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  wrapper.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === id);
      const parentId = card ? card.groupId : null;
      cards = cards.filter(c => c.id !== id);
      if (parentId) {
        const parent = cards.find(c => c.id === parentId);
        if (parent) recalcCardStatus(parent);
      }
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.barcode-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });
}

function buildCardCopy(template, { nameOverride, groupId = null } = {}) {
  const copy = cloneCard(template);
  copy.id = genId('card');
  copy.barcode = generateUniqueEAN13();
  copy.name = nameOverride || template.name || '';
  copy.groupId = groupId;
  copy.isGroup = false;
  copy.status = 'NOT_STARTED';
  copy.archived = false;
  copy.useItemList = Boolean(template.useItemList);
  copy.logs = [];
  copy.createdAt = Date.now();
  copy.initialSnapshot = null;
  copy.attachments = (copy.attachments || []).map(file => ({
    ...file,
    id: genId('file'),
    createdAt: Date.now()
  }));
  copy.operations = (copy.operations || []).map((op) => ({
    ...op,
    id: genId('rop'),
    status: 'NOT_STARTED',
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: null,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0,
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        ...item,
        id: genId('item'),
        goodCount: 0,
        scrapCount: 0,
        holdCount: 0,
        quantity: toSafeCount(item.quantity || 0) || 1
      }))
      : [],
    order: typeof op.order === 'number' ? op.order : undefined
  }));
  renumberAutoCodesForCard(copy);
  return copy;
}

function duplicateCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const copy = buildCardCopy(card, { nameOverride: (card.name || '') + ' (копия)' });
  recalcCardStatus(copy);
  ensureCardMeta(copy);
  if (!copy.initialSnapshot) {
    const snapshot = cloneCard(copy);
    snapshot.logs = [];
    copy.initialSnapshot = snapshot;
  }
  recordCardLog(copy, { action: 'Создание копии', object: 'Карта', oldValue: card.barcode || '', newValue: copy.barcode || '' });
  cards.push(copy);
  saveData();
  renderEverything();
}

function duplicateGroup(groupId, { includeArchivedChildren = false } = {}) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => includeArchivedChildren || !c.archived);
  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: (group.name || '') + ' (копия)',
    barcode: generateUniqueEAN13(),
    orderNo: group.orderNo || '',
    contractNumber: group.contractNumber || '',
    status: 'NOT_STARTED',
    archived: false,
    attachments: (group.attachments || []).map(file => ({
      ...file,
      id: genId('file'),
      createdAt: Date.now()
    })),
    createdAt: Date.now()
  };

  cards.push(newGroup);

  children.forEach((child, idx) => {
    const baseName = child.name ? child.name.replace(/^\d+\.\s*/, '') : group.name || 'Карта';
    const copy = buildCardCopy(child, { nameOverride: (idx + 1) + '. ' + baseName, groupId: newGroup.id });
    ensureCardMeta(copy);
    recalcCardStatus(copy);
    cards.push(copy);
  });

  recalcCardStatus(newGroup);
  saveData();
  renderEverything();
  return newGroup;
}

function openGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
}

function closeGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function deleteGroup(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  cards = cards.filter(c => c.id !== groupId && c.groupId !== groupId);
  cardsGroupOpen.delete(groupId);
  saveData();
  renderEverything();
}

function printGroupList(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => !c.archived);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write('<html><head><title>Список карт группы</title><style> .print-meta { margin: 12px 0; } .print-meta div { margin: 4px 0; font-size: 14px; } </style></head><body>');
  win.document.write('<h3>Группа: ' + escapeHtml(group.name || '') + '</h3>');

  if (children.length > 0) {
    const firstCard = children[0];
    win.document.write('<div class="print-meta">');
    win.document.write('<div><strong>Номер / код заказа:</strong> ' + escapeHtml(firstCard.orderNo || '') + '</div>');
    win.document.write('<div><strong>Чертёж / обозначение детали:</strong> ' + escapeHtml(firstCard.drawing || '') + '</div>');
    win.document.write('<div><strong>Материал:</strong> ' + escapeHtml(firstCard.material || '') + '</div>');
    win.document.write('<div><strong>Номер договора:</strong> ' + escapeHtml(firstCard.contractNumber || '') + '</div>');
    win.document.write('<div><strong>Описание:</strong> ' + escapeHtml(firstCard.desc || '') + '</div>');
    win.document.write('</div>');
  }

  win.document.write('<ol>');
  children.forEach(child => {
    win.document.write('<li>' + escapeHtml(child.name || '') + ' — ' + escapeHtml(child.barcode || '') + '</li>');
  });
  win.document.write('</ol>');
  win.document.close();
  win.print();
}

function openGroupModal() {
  const modal = document.getElementById('group-modal');
  if (!modal || !activeCardDraft) return;
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  if (nameInput) nameInput.value = activeCardDraft.name || '';
  if (qtyInput) qtyInput.value = activeCardDraft.quantity || 2;
  modal.classList.remove('hidden');
}

function closeGroupModal() {
  const modal = document.getElementById('group-modal');
  if (modal) modal.classList.add('hidden');
}

function createGroupFromDraft() {
  if (!activeCardDraft) return;
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  const groupName = nameInput ? nameInput.value.trim() : '';
  const qty = qtyInput ? Math.max(1, toSafeCount(qtyInput.value)) : 1;
  const baseName = activeCardDraft.name || 'Техкарта';
  const finalGroupName = groupName || baseName;

  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: finalGroupName,
    barcode: generateUniqueEAN13(),
    orderNo: activeCardDraft.orderNo || '',
    contractNumber: activeCardDraft.contractNumber || '',
    status: 'NOT_STARTED',
    archived: false,
    attachments: [],
    createdAt: Date.now()
  };

  cards.push(newGroup);

  for (let i = 0; i < qty; i++) {
    const child = buildCardCopy(activeCardDraft, { nameOverride: (i + 1) + '. ' + baseName, groupId: newGroup.id });
    recalcCardStatus(child);
    ensureCardMeta(child);
    cards.push(child);
  }

  recalcCardStatus(newGroup);
  saveData();
  closeGroupModal();
  closeCardModal();
  renderEverything();
}

function createEmptyCardDraft() {
  return {
    id: genId('card'),
    barcode: generateUniqueEAN13(),
    name: 'Новая карта',
    quantity: '',
    useItemList: false,
    drawing: '',
    material: '',
    contractNumber: '',
    orderNo: '',
    desc: '',
    status: 'NOT_STARTED',
    archived: false,
    createdAt: Date.now(),
    logs: [],
    initialSnapshot: null,
    attachments: [],
    operations: []
  };
}

function openCardModal(cardId) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  focusCardsSection();
  activeCardOriginalId = cardId || null;
  if (cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    activeCardDraft = cloneCard(card);
    activeCardIsNew = false;
  } else {
    activeCardDraft = createEmptyCardDraft();
    activeCardIsNew = true;
  }
  ensureCardMeta(activeCardDraft, { skipSnapshot: activeCardIsNew });
  document.getElementById('card-modal-title').textContent = activeCardIsNew ? 'Создание карты' : 'Редактирование карты';
  document.getElementById('card-id').value = activeCardDraft.id;
  document.getElementById('card-name').value = activeCardDraft.name || '';
  document.getElementById('card-qty').value = activeCardDraft.quantity != null ? activeCardDraft.quantity : '';
  const useItemsCheckbox = document.getElementById('card-use-items');
  if (useItemsCheckbox) {
    useItemsCheckbox.checked = Boolean(activeCardDraft.useItemList);
  }
  document.getElementById('card-order').value = activeCardDraft.orderNo || '';
  document.getElementById('card-drawing').value = activeCardDraft.drawing || '';
  document.getElementById('card-material').value = activeCardDraft.material || '';
  document.getElementById('card-contract').value = activeCardDraft.contractNumber || '';
  document.getElementById('card-desc').value = activeCardDraft.desc || '';
  document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
  const attachBtn = document.getElementById('card-attachments-btn');
  if (attachBtn) {
    attachBtn.innerHTML = '📎 Файлы (' + (activeCardDraft.attachments ? activeCardDraft.attachments.length : 0) + ')';
  }
  const routeCodeInput = document.getElementById('route-op-code');
  if (routeCodeInput) routeCodeInput.value = '';
  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) routeOpInput.value = '';
  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) routeCenterInput.value = '';
  const routeQtyInput = document.getElementById('route-qty');
  routeQtyManual = false;
  if (routeQtyInput) routeQtyInput.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
  renderRouteTableDraft();
  fillRouteSelectors();
  modal.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeCardModal() {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.getElementById('card-form').reset();
  document.getElementById('route-form').reset();
  document.getElementById('route-table-wrapper').innerHTML = '';
  activeCardDraft = null;
  activeCardOriginalId = null;
  activeCardIsNew = false;
  routeQtyManual = false;
  focusCardsSection();
}

function saveCardDraft() {
  if (!activeCardDraft) return;
  const draft = cloneCard(activeCardDraft);
  draft.useItemList = Boolean(draft.useItemList);
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1,
    goodCount: toSafeCount(op.goodCount || 0),
    scrapCount: toSafeCount(op.scrapCount || 0),
    holdCount: toSafeCount(op.holdCount || 0),
    quantity: getOperationQuantity(op, draft),
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors) ? op.additionalExecutors.slice(0, 2) : [],
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        id: item.id || genId('item'),
        name: typeof item.name === 'string' ? item.name : '',
        quantity: 1,
        goodCount: toSafeCount(item.goodCount || 0),
        scrapCount: toSafeCount(item.scrapCount || 0),
        holdCount: toSafeCount(item.holdCount || 0)
      }))
      : []
  }));
  renumberAutoCodesForCard(draft);
  recalcCardStatus(draft);

  if (activeCardIsNew || activeCardOriginalId == null) {
    ensureCardMeta(draft);
    if (!draft.initialSnapshot) {
      const snapshot = cloneCard(draft);
      snapshot.logs = [];
      draft.initialSnapshot = snapshot;
    }
    recordCardLog(draft, { action: 'Создание карты', object: 'Карта', oldValue: '', newValue: draft.name || draft.barcode });
    cards.push(draft);
  } else {
    const idx = cards.findIndex(c => c.id === activeCardOriginalId);
    if (idx >= 0) {
      const original = cloneCard(cards[idx]);
      ensureCardMeta(original);
      ensureCardMeta(draft);
      draft.createdAt = original.createdAt || draft.createdAt;
      draft.initialSnapshot = original.initialSnapshot || draft.initialSnapshot;
      draft.logs = Array.isArray(original.logs) ? original.logs : [];
      logCardDifferences(original, draft);
      cards[idx] = draft;
    }
  }
  saveData();
  renderEverything();
  closeCardModal();
}

function syncCardDraftFromForm() {
  if (!activeCardDraft) return;
  activeCardDraft.name = document.getElementById('card-name').value.trim();
  const qtyRaw = document.getElementById('card-qty').value.trim();
  const qtyVal = qtyRaw === '' ? '' : Math.max(0, parseInt(qtyRaw, 10) || 0);
  activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
  activeCardDraft.orderNo = document.getElementById('card-order').value.trim();
  activeCardDraft.drawing = document.getElementById('card-drawing').value.trim();
  activeCardDraft.material = document.getElementById('card-material').value.trim();
  activeCardDraft.contractNumber = document.getElementById('card-contract').value.trim();
  activeCardDraft.desc = document.getElementById('card-desc').value.trim();
  const useItemsCheckbox = document.getElementById('card-use-items');
  const prevUseList = Boolean(activeCardDraft.useItemList);
  activeCardDraft.useItemList = useItemsCheckbox ? useItemsCheckbox.checked : false;
  if (prevUseList !== activeCardDraft.useItemList && Array.isArray(activeCardDraft.operations)) {
    activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
  }
}

function logCardDifferences(original, updated) {
  if (!original || !updated) return;
  const cardRef = updated;
  const fields = ['name', 'orderNo', 'desc', 'quantity', 'drawing', 'material', 'contractNumber', 'useItemList'];
  fields.forEach(field => {
    if ((original[field] || '') !== (updated[field] || '')) {
      recordCardLog(cardRef, { action: 'Изменение поля', object: 'Карта', field, oldValue: original[field] || '', newValue: updated[field] || '' });
    }
  });

  if (original.status !== updated.status) {
    recordCardLog(cardRef, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: original.status, newValue: updated.status });
  }

  if (original.archived !== updated.archived) {
    recordCardLog(cardRef, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: original.archived, newValue: updated.archived });
  }

  const originalAttachments = Array.isArray(original.attachments) ? original.attachments.length : 0;
  const updatedAttachments = Array.isArray(updated.attachments) ? updated.attachments.length : 0;
  if (originalAttachments !== updatedAttachments) {
    recordCardLog(cardRef, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: originalAttachments, newValue: updatedAttachments });
  }

  const originalOps = Array.isArray(original.operations) ? original.operations : [];
  const updatedOps = Array.isArray(updated.operations) ? updated.operations : [];
  const originalMap = new Map(originalOps.map(op => [op.id, op]));
  const updatedMap = new Map(updatedOps.map(op => [op.id, op]));

  updatedOps.forEach(op => {
    const prev = originalMap.get(op.id);
    if (!prev) {
      recordCardLog(cardRef, { action: 'Добавление операции', object: opLogLabel(op), targetId: op.id, oldValue: '', newValue: `${op.centerName || ''} / ${op.executor || ''}`.trim() });
      return;
    }

    if ((prev.centerName || '') !== (op.centerName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'centerName', targetId: op.id, oldValue: prev.centerName || '', newValue: op.centerName || '' });
    }
    if ((prev.opCode || '') !== (op.opCode || '') || (prev.opName || '') !== (op.opName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'operation', targetId: op.id, oldValue: opLogLabel(prev), newValue: opLogLabel(op) });
    }
    if ((prev.executor || '') !== (op.executor || '')) {
      recordCardLog(cardRef, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev.executor || '', newValue: op.executor || '' });
    }
    if ((prev.plannedMinutes || 0) !== (op.plannedMinutes || 0)) {
      recordCardLog(cardRef, { action: 'Плановое время', object: opLogLabel(op), field: 'plannedMinutes', targetId: op.id, oldValue: prev.plannedMinutes || 0, newValue: op.plannedMinutes || 0 });
    }
    if ((prev.order || 0) !== (op.order || 0)) {
      recordCardLog(cardRef, { action: 'Порядок операции', object: opLogLabel(op), field: 'order', targetId: op.id, oldValue: prev.order || 0, newValue: op.order || 0 });
    }
  });

  originalOps.forEach(op => {
    if (!updatedMap.has(op.id)) {
      recordCardLog(cardRef, { action: 'Удаление операции', object: opLogLabel(op), targetId: op.id, oldValue: `${op.centerName || ''} / ${op.executor || ''}`.trim(), newValue: '' });
    }
  });
}

function getAttachmentTargetCard() {
  if (!attachmentContext) return null;
  if (attachmentContext.source === 'draft') {
    return activeCardDraft;
  }
  return cards.find(c => c.id === attachmentContext.cardId);
}

function renderAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal || !attachmentContext) return;
  const card = getAttachmentTargetCard();
  const title = document.getElementById('attachments-title');
  const list = document.getElementById('attachments-list');
  const uploadHint = document.getElementById('attachments-upload-hint');
  if (!card || !list || !title || !uploadHint) return;
  ensureAttachments(card);
  title.textContent = card.name || card.barcode || 'Файлы карты';
  const files = card.attachments || [];
  if (!files.length) {
    list.innerHTML = '<p>Файлы ещё не добавлены.</p>';
  } else {
    let html = '<table class="attachments-table"><thead><tr><th>Имя файла</th><th>Размер</th><th>Дата</th><th>Действия</th></tr></thead><tbody>';
    files.forEach(file => {
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      html += '<tr>' +
        '<td>' + escapeHtml(file.name || 'файл') + '</td>' +
        '<td>' + escapeHtml(formatBytes(file.size)) + '</td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small" data-preview-id="' + file.id + '">Открыть</button>' +
        '<button class="btn-small" data-download-id="' + file.id + '">Скачать</button>' +
        '<button class="btn-small btn-danger" data-delete-id="' + file.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
  }
  uploadHint.textContent = 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';

  list.querySelectorAll('button[data-preview-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-preview-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      previewAttachment(file);
    });
  });

  list.querySelectorAll('button[data-download-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-download-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      downloadAttachment(file);
    });
  });

  list.querySelectorAll('button[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      deleteAttachment(id);
    });
  });
}

function downloadAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name || 'file';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

function previewAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

async function deleteAttachment(fileId) {
  const card = getAttachmentTargetCard();
  if (!card) return;
  ensureAttachments(card);
  const before = card.attachments.length;
  const idx = card.attachments.findIndex(f => f.id === fileId);
  if (idx < 0) return;
  card.attachments.splice(idx, 1);
  recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: before, newValue: card.attachments.length });
  if (attachmentContext && attachmentContext.source === 'live') {
    await saveData();
    renderEverything();
  }
  renderAttachmentsModal();
  updateAttachmentCounters(card.id);
}

async function addAttachmentsFromFiles(fileList) {
  const card = getAttachmentTargetCard();
  if (!card || !fileList || !fileList.length) return;
  ensureAttachments(card);
  const beforeCount = card.attachments.length;
  const filesArray = Array.from(fileList);
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const newFiles = [];

  for (const file of filesArray) {
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (allowed.length && !allowed.includes(ext)) {
      alert('Тип файла не поддерживается: ' + file.name);
      continue;
    }
    if (file.size > ATTACH_MAX_SIZE) {
      alert('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    newFiles.push({
      id: genId('file'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      content: dataUrl,
      createdAt: Date.now()
    });
  }

  if (newFiles.length) {
    card.attachments.push(...newFiles);
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: beforeCount, newValue: card.attachments.length });
    if (attachmentContext.source === 'live') {
      await saveData();
      renderEverything();
    }
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
  }
}

function openAttachmentsModal(cardId, source = 'live') {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  const card = source === 'draft' ? activeCardDraft : cards.find(c => c.id === cardId);
  if (!card) return;
  attachmentContext = { cardId: card.id, source };
  renderAttachmentsModal();
  modal.classList.remove('hidden');
}

function closeAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const input = document.getElementById('attachments-input');
  if (input) input.value = '';
  attachmentContext = null;
}

function updateAttachmentCounters(cardId) {
  const count = (() => {
    if (activeCardDraft && activeCardDraft.id === cardId) {
      return (activeCardDraft.attachments || []).length;
    }
    const card = cards.find(c => c.id === cardId);
    return card ? (card.attachments || []).length : 0;
  })();

  const cardBtn = document.getElementById('card-attachments-btn');
  if (cardBtn && activeCardDraft && activeCardDraft.id === cardId) {
    cardBtn.innerHTML = '📎 Файлы (' + count + ')';
  }
}

function openGroupExecutorModal(groupId) {
  const modal = document.getElementById('group-executor-modal');
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!modal || !group) return;
  groupExecutorContext = { groupId };
  if (executorInput) {
    executorInput.innerHTML = '<option value=""></option>' + usersDirectory
      .filter(u => u.active !== false)
      .map(u => '<option value="' + escapeHtml(u.name || '') + '">' + escapeHtml(u.name || '') + '</option>')
      .join('');
    executorInput.value = '';
  }
  if (opCodeInput) opCodeInput.value = '';
  modal.classList.remove('hidden');
  if (executorInput) executorInput.focus();
}

function closeGroupExecutorModal() {
  const modal = document.getElementById('group-executor-modal');
  if (modal) modal.classList.add('hidden');
  groupExecutorContext = null;
}

function applyGroupExecutorToGroup() {
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  if (!groupExecutorContext) return;

  const executor = (executorInput ? executorInput.value : '').trim();
  const opCodeRaw = (opCodeInput ? opCodeInput.value : '').trim();
  const group = cards.find(c => c.id === groupExecutorContext.groupId && isGroupCard(c));

  if (!group) {
    closeGroupExecutorModal();
    return;
  }

  if (!executor || !opCodeRaw) {
    alert('Укажите группового исполнителя и код операции.');
    return;
  }

  const targetCode = opCodeRaw.toUpperCase();
  const children = getGroupChildren(group).filter(c => !c.archived);
  let matched = 0;
  let updated = 0;

  children.forEach(card => {
    (card.operations || []).forEach(op => {
      const opCodeValue = (op.opCode || '').trim().toUpperCase();
      if (opCodeValue !== targetCode) return;
      matched++;
      const prevExecutor = op.executor || '';
      const prevExtras = Array.isArray(op.additionalExecutors) ? [...op.additionalExecutors] : [];
      const extrasChanged = prevExtras.length > 0;
      const executorChanged = prevExecutor !== executor;
      op.executor = executor;
      op.additionalExecutors = [];
      if (executorChanged) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prevExecutor, newValue: executor });
      }
      if (extrasChanged) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prevExtras.join(', '), newValue: 'очищено' });
      }
      if (executorChanged || extrasChanged) {
        updated++;
      }
    });
    recalcCardStatus(card);
  });

  recalcCardStatus(group);

  if (!matched) {
    alert('В группе нет операций с указанным кодом.');
    return;
  }

  if (updated) {
    saveData();
    renderDashboard();
  }
  renderWorkordersTable();
  closeGroupExecutorModal();
}

function buildLogHistoryTable(card) {
  const logs = (card.logs || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!logs.length) return '<p>История изменений пока отсутствует.</p>';
  let html = '<table><thead><tr><th>Дата/время</th><th>Тип действия</th><th>Объект</th><th>Старое значение</th><th>Новое значение</th></tr></thead><tbody>';
  logs.forEach(entry => {
    const date = new Date(entry.ts || Date.now()).toLocaleString();
    html += '<tr>' +
      '<td>' + escapeHtml(date) + '</td>' +
      '<td>' + escapeHtml(entry.action || '') + '</td>' +
      '<td>' + escapeHtml(entry.object || '') + (entry.field ? ' (' + escapeHtml(entry.field) + ')' : '') + '</td>' +
      '<td>' + escapeHtml(entry.oldValue || '') + '</td>' +
      '<td>' + escapeHtml(entry.newValue || '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildExecutorHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'executor')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!entries.length) {
    return op.executor || '';
  }
  const chain = [];
  entries.forEach((entry, idx) => {
    if (idx === 0 && entry.oldValue) chain.push(entry.oldValue);
    if (entry.newValue) chain.push(entry.newValue);
  });
  if (!chain.length && op.executor) chain.push(op.executor);
  return chain.filter(Boolean).join(' → ');
}

function buildAdditionalExecutorsHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'additionalExecutors')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lines = [];
  const seen = new Set();

  entries.forEach(entry => {
    const oldVal = (entry.oldValue || '').trim();
    const newVal = (entry.newValue || '').trim();
    const isCountChange = /^\d+$/.test(newVal) && (!oldVal || /^\d+$/.test(oldVal));
    if (isCountChange) return;

    if (oldVal && newVal && newVal !== oldVal && newVal !== 'удален') {
      lines.push(escapeHtml(oldVal) + ' → ' + escapeHtml(newVal));
      seen.add(oldVal);
      seen.add(newVal);
    } else if (!oldVal && newVal && newVal !== 'удален') {
      lines.push(escapeHtml(newVal));
      seen.add(newVal);
    } else if (oldVal && (!newVal || newVal === 'удален')) {
      lines.push(escapeHtml(oldVal) + ' (удален)');
      seen.add(oldVal);
    }
  });

  const currentExtras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  currentExtras.forEach(name => {
    const clean = (name || '').trim();
    if (!clean || seen.has(clean)) return;
    lines.push(escapeHtml(clean));
    seen.add(clean);
  });

  return lines.filter(Boolean);
}

function buildExecutorHistoryCell(card, op) {
  const mainHistory = buildExecutorHistory(card, op) || '';
  const extraHistory = buildAdditionalExecutorsHistory(card, op);
  if (!mainHistory && !extraHistory.length) return '';

  let html = '';
  if (mainHistory) {
    html += '<div class="executor-history-main">' + escapeHtml(mainHistory) + '</div>';
  }
  if (extraHistory.length) {
    html += '<div class="executor-history-extras">' +
      extraHistory.map(line => '<div class="executor-history-line">' + line + '</div>').join('') +
      '</div>';
  }
  return html;
}

function buildSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Дата и время Н/К</th><th>Текущее / факт. время</th><th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    const rowId = card.id + '::' + op.id;
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');
    const startEndCell = formatStartEnd(op);

    html += '<tr data-row-id="' + rowId + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + startEndCell + '</td>' +
      '<td>' + timeCell + '</td>' +
      '<td>' + escapeHtml(op.comment || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 10 });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th><th>Исполнитель</th><th>План (мин)</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 6, blankForPrint: true });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSnapshotHtml(card) {
  if (!card) return '';
  const snapshot = card.initialSnapshot || card;
  const qtyText = formatQuantityValue(snapshot.quantity);
  const metaHtml = '<div class="log-initial-meta">' +
    '<div><strong>Наименование:</strong> ' + escapeHtml(snapshot.name || '') + '</div>' +
    '<div><strong>Количество, шт:</strong> ' + escapeHtml(qtyText || '') + '</div>' +
    '<div><strong>Заказ:</strong> ' + escapeHtml(snapshot.orderNo || '') + '</div>' +
    '<div><strong>Чертёж / обозначение:</strong> ' + escapeHtml(snapshot.drawing || '') + '</div>' +
    '<div><strong>Материал:</strong> ' + escapeHtml(snapshot.material || '') + '</div>' +
    '<div><strong>Описание:</strong> ' + escapeHtml(snapshot.desc || '') + '</div>' +
    '</div>';
  const opsHtml = buildInitialSummaryTable(snapshot);
  return metaHtml + opsHtml;
}

function renderInitialSnapshot(card) {
  const container = document.getElementById('log-initial-view');
  if (!container || !card) return;
  container.innerHTML = buildInitialSnapshotHtml(card);
}

function renderLogModal(cardId) {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  logContextCardId = card.id;
  const barcodeCanvas = document.getElementById('log-barcode-canvas');
  drawBarcodeEAN13(barcodeCanvas, card.barcode || '');
  const barcodeNum = document.getElementById('log-barcode-number');
  if (barcodeNum) {
    if (barcodeCanvas && card.barcode) {
      barcodeNum.textContent = '';
      barcodeNum.classList.add('hidden');
    } else {
      barcodeNum.textContent = card.barcode || '';
      barcodeNum.classList.remove('hidden');
    }
  }
  const nameEl = document.getElementById('log-card-name');
  if (nameEl) nameEl.textContent = card.name || '';
  const orderEl = document.getElementById('log-card-order');
  if (orderEl) orderEl.textContent = card.orderNo || '';
  const statusEl = document.getElementById('log-card-status');
  if (statusEl) statusEl.textContent = cardStatusText(card);
  const createdEl = document.getElementById('log-card-created');
  if (createdEl) createdEl.textContent = new Date(card.createdAt || Date.now()).toLocaleString();

  renderInitialSnapshot(card);
  const historyContainer = document.getElementById('log-history-table');
  if (historyContainer) historyContainer.innerHTML = buildLogHistoryTable(card);
  const summaryContainer = document.getElementById('log-summary-table');
  if (summaryContainer) summaryContainer.innerHTML = buildSummaryTable(card);

  modal.classList.remove('hidden');
}

function openLogModal(cardId) {
  renderLogModal(cardId);
}

function closeLogModal() {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  logContextCardId = null;
}

function printCardView(card, { blankQuantities = false } = {}) {
  if (!card) return;
  const barcodeData = getBarcodeDataUrl(card.barcode || '');
  const opsHtml = buildOperationsTable(card, { readonly: true, quantityPrintBlanks: blankQuantities });
  const qtyText = formatQuantityValue(card.quantity);
  const win = window.open('', '_blank');
  if (!win) return;
  const styles = `
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    thead { background: #f3f4f6; }
    .print-header { display: flex; gap: 16px; align-items: flex-start; }
    .barcode-box { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .barcode-box img { max-height: 80px; }
    .meta-stack { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px 16px; margin-top: 6px; }
    .meta-item { font-size: 13px; }
    .op-qty-row td { background: #f9fafb; }
    .qty-row-content { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .qty-row-content label { font-weight: 600; }
  `;
  win.document.write('<html><head><title>Маршрутная карта</title><style>' + styles + '</style></head><body>');
  win.document.write('<div class="print-header">');
  win.document.write('<div class="barcode-box">');
  if (barcodeData) {
    win.document.write('<img src="' + barcodeData + '" alt="barcode" />');
  } else if (card.barcode) {
    win.document.write('<strong>' + escapeHtml(card.barcode) + '</strong>');
  }
  win.document.write('</div>');
  win.document.write('<div class="meta-stack">');
  if (!barcodeData && card.barcode) {
    win.document.write('<div class="meta-item"><strong>№ карты:</strong> ' + escapeHtml(card.barcode) + '</div>');
  }
  win.document.write('<div class="meta-item"><strong>Наименование:</strong> ' + escapeHtml(card.name || '') + '</div>');
  win.document.write('<div class="meta-item"><strong>Количество, шт:</strong> ' + escapeHtml(qtyText || '') + '</div>');
  win.document.write('<div class="meta-item"><strong>Заказ:</strong> ' + escapeHtml(card.orderNo || '') + '</div>');
  win.document.write('<div class="meta-item"><strong>Чертёж / обозначение:</strong> ' + escapeHtml(card.drawing || '') + '</div>');
  win.document.write('<div class="meta-item"><strong>Материал:</strong> ' + escapeHtml(card.material || '') + '</div>');
  win.document.write('<div class="meta-item"><strong>Описание:</strong> ' + escapeHtml(card.desc || '') + '</div>');
  win.document.write('</div>');
  win.document.write('</div>');
  win.document.write('<h3>Маршрут выполнения операций</h3>');
  win.document.write(opsHtml);
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  win.print();
}

function printSummaryTable() {
  if (!logContextCardId) return;
  const card = cards.find(c => c.id === logContextCardId);
  if (!card) return;
  const summaryHtml = buildSummaryTable(card);
  const barcodeData = getBarcodeDataUrl(card.barcode || '');
  const win = window.open('', '_blank');
  if (!win) return;
  const styles = `
    @page { size: A4 landscape; margin: 20mm; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    thead { background: #f3f4f6; }
    .op-qty-row td { background: #f9fafb; }
    .qty-row-content { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .qty-row-content label { font-weight: 600; }
    .items-row-content { display: flex; flex-wrap: wrap; gap: 8px; }
    .item-block { border: 1px solid #d1d5db; padding: 6px; border-radius: 6px; background: #f3f4f6; min-width: 180px; }
    .item-name { font-weight: 700; }
    .item-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .barcode-print { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
    .meta-print { margin: 2px 0; font-size: 13px; }
    .meta-stack { display: flex; flex-direction: column; gap: 2px; }
    .summary-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .summary-header .meta-stack { align-items: flex-end; text-align: right; }
  `;
  win.document.write('<html><head><title>Сводная таблица</title><style>' + styles + '</style></head><body>');
  win.document.write('<h2>' + escapeHtml(card.name || '') + '</h2>');
  win.document.write('<div class="summary-header">');
  win.document.write('<div class="barcode-print">');
  if (barcodeData) {
    win.document.write('<img src="' + barcodeData + '" style="max-height:80px;" />');
  }
  win.document.write('<div class="meta-stack">');
  if (!barcodeData && card.barcode) {
    win.document.write('<div class="meta-print"><strong>№ карты:</strong> ' + escapeHtml(card.barcode) + '</div>');
  }
  win.document.write('<div class="meta-print"><strong>Заказ:</strong> ' + escapeHtml(card.orderNo || '') + '</div>');
  win.document.write('</div></div>');
  win.document.write('<div class="meta-stack">');
  win.document.write('<div class="meta-print"><strong>Количество, шт:</strong> ' + escapeHtml(formatQuantityValue(card.quantity)) + '</div>');
  win.document.write('<div class="meta-print"><strong>Чертёж / обозначение:</strong> ' + escapeHtml(card.drawing || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Материал:</strong> ' + escapeHtml(card.material || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Описание:</strong> ' + escapeHtml(card.desc || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Статус:</strong> ' + escapeHtml(cardStatusText(card)) + '</div>');
  win.document.write('</div>');
  win.document.write('</div>');
  win.document.write(summaryHtml);
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  win.print();
}

function printFullLog() {
  if (!logContextCardId) return;
  const card = cards.find(c => c.id === logContextCardId);
  if (!card) return;
  const barcodeData = getBarcodeDataUrl(card.barcode || '');
  const initialHtml = buildInitialSnapshotHtml(card);
  const historyHtml = buildLogHistoryTable(card);
  const summaryHtml = buildSummaryTable(card);
  const win = window.open('', '_blank');
  if (!win) return;
  const styles = `
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h2, h3, h4 { margin: 8px 0; }
    .meta-print { margin: 6px 0; font-size: 13px; }
    .barcode-print { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    thead { background: #f3f4f6; }
    .op-qty-row td { background: #f9fafb; }
    .qty-row-content { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .qty-row-content label { font-weight: 600; }
    .items-row-content { display: flex; flex-wrap: wrap; gap: 8px; }
    .item-block { border: 1px solid #d1d5db; padding: 6px; border-radius: 6px; background: #f3f4f6; min-width: 180px; }
    .item-name { font-weight: 700; }
    .item-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .section-spacer { margin-top: 12px; }
  `;
  win.document.write('<html><head><title>История изменений</title><style>' + styles + '</style></head><body>');
  win.document.write('<h2>' + escapeHtml(card.name || '') + '</h2>');
  win.document.write('<div class="meta-print"><strong>Заказ:</strong> ' + escapeHtml(card.orderNo || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Количество, шт:</strong> ' + escapeHtml(formatQuantityValue(card.quantity)) + '</div>');
  win.document.write('<div class="meta-print"><strong>Чертёж / обозначение:</strong> ' + escapeHtml(card.drawing || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Материал:</strong> ' + escapeHtml(card.material || '') + '</div>');
  win.document.write('<div class="meta-print"><strong>Статус:</strong> ' + escapeHtml(cardStatusText(card)) + '</div>');
  win.document.write('<div class="meta-print"><strong>Создана:</strong> ' + escapeHtml(new Date(card.createdAt || Date.now()).toLocaleString()) + '</div>');
  if (barcodeData) {
    win.document.write('<div class="barcode-print"><img src="' + barcodeData + '" style="max-height:80px;" /></div>');
  } else if (card.barcode) {
    win.document.write('<div class="barcode-print"><strong>' + escapeHtml(card.barcode) + '</strong></div>');
  }
  win.document.write('<div class="section-spacer"><h3>Вид карты при создании</h3>' + initialHtml + '</div>');
  win.document.write('<div class="section-spacer"><h3>История изменений</h3>' + historyHtml + '</div>');
  win.document.write('<div class="section-spacer"><h3>Сводная таблица операций</h3>' + summaryHtml + '</div>');
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  win.print();
}

function setupLogModal() {
  const modal = document.getElementById('log-modal');
  const closeBtn = document.getElementById('log-close');
  const printBtn = document.getElementById('log-print-summary');
  const printAllBtn = document.getElementById('log-print-all');
  const closeBottomBtn = document.getElementById('log-close-bottom');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeLogModal());
  }
  if (closeBottomBtn) {
    closeBottomBtn.addEventListener('click', () => closeLogModal());
  }
  if (printBtn) {
    printBtn.addEventListener('click', () => printSummaryTable());
  }
  if (printAllBtn) {
    printAllBtn.addEventListener('click', () => printFullLog());
  }
}

// === МАРШРУТ КАРТЫ (ЧЕРЕЗ МОДАЛЬНОЕ ОКНО) ===
function renderDraftItemsRow(op, colspan = 8) {
  const items = Array.isArray(op.items) ? op.items : [];
  const content = items.length
    ? items.map((item, idx) => '<label class="item-name-field">' +
        '<span class="item-name-index">' + (idx + 1) + '.</span>' +
        '<input class="item-name-input" data-op-id="' + op.id + '" data-item-id="' + (item.id || '') + '" placeholder="Изделие ' + (idx + 1) + '" value="' + escapeHtml(item.name || '') + '">' +
        '<span class="item-qty-tag">1 шт</span>' +
      '</label>').join('')
    : '<span class="items-empty">Укажите количество изделий для операции, чтобы задать их список.</span>';

  return '<tr class="op-qty-row op-items-row"><td colspan="' + colspan + '">' +
    '<div class="items-row-header">Список изделий</div>' +
    '<div class="items-row-content editable">' + content + '</div>' +
    '</td></tr>';
}

function updateRouteTableScrollState() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper) return;
  wrapper.style.removeProperty('--route-table-max-height');
  wrapper.classList.remove('route-table-scrollable');
}

function scrollRouteAreaToLatest() {
  const wrapper = document.getElementById('route-table-wrapper');
  const modalBody = document.querySelector('#card-modal .modal-body');
  if (!wrapper || !modalBody) return;
  const lastRow = wrapper.querySelector('tbody tr:last-child');
  if (!lastRow) {
    modalBody.scrollTop = modalBody.scrollHeight;
    return;
  }
  const addPanel = document.querySelector('#route-editor .route-add-panel');
  const bodyRect = modalBody.getBoundingClientRect();
  const rowRect = lastRow.getBoundingClientRect();
  const stickyBottomOffset = addPanel ? addPanel.getBoundingClientRect().height : 0;
  const visibleBottom = bodyRect.bottom - stickyBottomOffset - 12;
  const visibleTop = bodyRect.top + 12;

  if (rowRect.bottom > visibleBottom) {
    modalBody.scrollTop += rowRect.bottom - visibleBottom;
  } else if (rowRect.top < visibleTop) {
    modalBody.scrollTop += rowRect.top - visibleTop;
  }
}

function renderRouteTableDraft() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper || !activeCardDraft) return;
  const opsArr = activeCardDraft.operations || [];
  renumberAutoCodesForCard(activeCardDraft);
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    requestAnimationFrame(() => updateRouteTableScrollState());
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th><th>Кол-во изделий</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    normalizeOperationItems(activeCardDraft, o);
    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td><input class="route-code-input" data-rop-id="' + o.id + '" value="' + escapeHtml(o.opCode || '') + '" /></td>' +
      '<td>' + renderOpName(o) + '</td>' +
      '<td><input type="number" min="0" class="route-qty-input" data-rop-id="' + o.id + '" value="' + escapeHtml(getOperationQuantity(o, activeCardDraft)) + '"></td>' +
      '<td>' + (o.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(o.status) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="move-up">↑</button>' +
      '<button class="btn-small" data-action="move-down">↓</button>' +
      '<button class="btn-small btn-danger" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';

    if (activeCardDraft.useItemList) {
      html += renderDraftItemsRow(o, 8);
    }
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('tr[data-rop-id]').forEach(row => {
    const ropId = row.getAttribute('data-rop-id');
    row.querySelectorAll('button[data-action]').forEach(btn => {
      const action = btn.getAttribute('data-action');
      btn.addEventListener('click', () => {
        if (!activeCardDraft) return;
        if (action === 'delete') {
          activeCardDraft.operations = activeCardDraft.operations.filter(o => o.id !== ropId);
          renumberAutoCodesForCard(activeCardDraft);
        } else if (action === 'move-up' || action === 'move-down') {
          moveRouteOpInDraft(ropId, action === 'move-up' ? -1 : 1);
        }
        document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  });

  wrapper.querySelectorAll('.route-code-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      const prev = op.opCode || '';
      const value = (e.target.value || '').trim();
      if (!value) {
        op.autoCode = true;
      } else {
        op.autoCode = false;
        op.opCode = value;
      }
      renumberAutoCodesForCard(activeCardDraft);
      if (prev !== op.opCode && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Код операции', object: opLogLabel(op), field: 'opCode', targetId: op.id, oldValue: prev, newValue: op.opCode });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.route-qty-input').forEach(input => {
    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      const prev = getOperationQuantity(op, activeCardDraft);
      const raw = e.target.value;
      if (raw === '') {
        op.quantity = '';
      } else {
        op.quantity = toSafeCount(raw);
      }
      normalizeOperationItems(activeCardDraft, op);
      if (prev !== op.quantity && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Количество изделий', object: opLogLabel(op), field: 'operationQuantity', targetId: op.id, oldValue: prev, newValue: op.quantity });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.item-name-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const prev = item.name || '';
      const value = (e.target.value || '').trim();
      item.name = value;
      if (prev !== value && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Список изделий', object: opLogLabel(op), field: 'itemName', targetId: item.id, oldValue: prev, newValue: value });
      }
    });
  });

  requestAnimationFrame(() => {
    updateRouteTableScrollState();
    scrollRouteAreaToLatest();
  });
}

function moveRouteOpInDraft(ropId, delta) {
  if (!activeCardDraft) return;
  const opsArr = [...(activeCardDraft.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = opsArr.findIndex(o => o.id === ropId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= opsArr.length) return;
  const tmpOrder = opsArr[idx].order;
  opsArr[idx].order = opsArr[newIdx].order;
  opsArr[newIdx].order = tmpOrder;
  activeCardDraft.operations = opsArr;
  renumberAutoCodesForCard(activeCardDraft);
}

function fillRouteSelectors() {
  const opInput = document.getElementById('route-op');
  const centerInput = document.getElementById('route-center');
  const opList = document.getElementById('route-op-options');
  const centerList = document.getElementById('route-center-options');
  if (!opList || !centerList) return;

  const opFilter = (opInput ? opInput.value : '').toLowerCase();
  const centerFilter = (centerInput ? centerInput.value : '').toLowerCase();

  const filteredOps = ops.filter(o => {
    if (!opFilter) return true;
    const label = formatOpLabel(o).toLowerCase();
    const desc = (o.desc || '').toLowerCase();
    return label.includes(opFilter) || desc.includes(opFilter);
  });
  const filteredCenters = centers.filter(c => {
    if (!centerFilter) return true;
    const name = (c.name || '').toLowerCase();
    const desc = (c.desc || '').toLowerCase();
    return name.includes(centerFilter) || desc.includes(centerFilter);
  });

  opList.innerHTML = '';
  filteredOps.forEach(o => {
    const opt = document.createElement('option');
    opt.value = formatOpLabel(o);
    opt.dataset.id = o.id;
    opList.appendChild(opt);
  });

  centerList.innerHTML = '';
  filteredCenters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.dataset.id = c.id;
    centerList.appendChild(opt);
  });
}

// === СПРАВОЧНИКИ ===
function renderCentersTable() {
  const wrapper = document.getElementById('centers-table-wrapper');
  if (!centers.length) {
    wrapper.innerHTML = '<p>Список участков пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Действия</th></tr></thead><tbody>';
  centers.forEach(center => {
    html += '<tr>' +
      '<td>' + escapeHtml(center.name) + '</td>' +
      '<td>' + escapeHtml(center.desc || '') + '</td>' +
      '<td><button class="btn-small btn-danger" data-id="' + center.id + '">Удалить</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Удалить участок? Он останется в уже созданных маршрутах как текст.')) {
        centers = centers.filter(c => c.id !== id);
        saveData();
        renderCentersTable();
        fillRouteSelectors();
      }
    });
  });
}

function renderOpsTable() {
  const wrapper = document.getElementById('ops-table-wrapper');
  if (!ops.length) {
    wrapper.innerHTML = '<p>Список операций пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Рек. время (мин)</th><th>Действия</th></tr></thead><tbody>';
  ops.forEach(o => {
    html += '<tr>' +
      '<td>' + escapeHtml(o.name) + '</td>' +
      '<td>' + escapeHtml(o.desc || '') + '</td>' +
      '<td>' + (o.recTime || '') + '</td>' +
      '<td><button class="btn-small btn-danger" data-id="' + o.id + '">Удалить</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Удалить операцию? Она останется в уже созданных маршрутах как текст.')) {
        ops = ops.filter(o => o.id !== id);
        saveData();
        renderOpsTable();
        fillRouteSelectors();
      }
    });
  });
}

// === МАРШРУТНЫЕ КВИТАНЦИИ ===
function getAllRouteRows() {
  const rows = [];
  cards.forEach(card => {
    (card.operations || []).forEach(op => {
      rows.push({ card, op });
    });
  });
  return rows;
}

function cardSearchScore(card, term) {
  if (!term) return 0;
  const t = term.toLowerCase();
  const digits = term.replace(/\s+/g, '');
  let score = 0;
  if (card.barcode) {
    if (card.barcode === digits) score += 200;
    else if (card.barcode.indexOf(digits) !== -1) score += 100;
  }
  if (card.name && card.name.toLowerCase().includes(t)) score += 50;
  if (card.orderNo && card.orderNo.toLowerCase().includes(t)) score += 50;
  if (card.contractNumber && card.contractNumber.toLowerCase().includes(t)) score += 50;
  return score;
}

function cardSearchScoreWithChildren(card, term, { includeArchivedChildren = false } = {}) {
  if (!term) return 0;
  const selfScore = cardSearchScore(card, term);
  if (!isGroupCard(card)) return selfScore;
  const children = getGroupChildren(card).filter(c => includeArchivedChildren || !c.archived);
  const childScore = children.reduce((max, child) => Math.max(max, cardSearchScore(child, term)), 0);
  return Math.max(selfScore, childScore);
}

function buildWorkorderCardDetails(card, { opened = false, allowArchive = true, showLog = true } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const missingBadge = cardHasMissingExecutors(card)
    ? '<span class="status-pill status-pill-missing-executor" title="Есть операции без исполнителя">Нет исполнителя</span>'
    : '';
  const canArchive = allowArchive && card.status === 'DONE';
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = showLog ? ' <button type="button" class="btn-small btn-secondary log-btn" data-log-card="' + card.id + '">Log</button>' : '';
  const nameLabel = formatCardNameWithGroupPosition(card);

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeButton + filesButton + logButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    (missingBadge ? missingBadge + ' ' : '') + stateBadge +
    (canArchive ? ' <button type="button" class="btn-small btn-secondary archive-move-btn" data-card-id="' + card.id + '">Перенести в архив</button>' : '') +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: false, showQuantityColumn: false });
  html += '</details>';
  return html;
}

function buildWorkspaceCardDetails(card, { opened = true } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const nameLabel = formatCardNameWithGroupPosition(card);

  let html = '<details class="wo-card workspace-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeButton + filesButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: false, showQuantityColumn: false, lockExecutors: true, lockQuantities: true });
  html += '</details>';
  return html;
}

function buildWorkspaceGroupDetails(group) {
  const children = getGroupChildren(group).filter(c => !c.archived);
  const stateBadge = renderCardStateBadge(group);
  const contractText = group.contractNumber ? ' (Договор: ' + escapeHtml(group.contractNumber) + ')' : '';
  const filesCount = (group.attachments || []).length;
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + group.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + group.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';

  const childrenHtml = children.length
    ? children.map(child => buildWorkspaceCardDetails(child, { opened: true })).join('')
    : '<p class="group-empty">В группе нет карт для отображения.</p>';

  return '<details class="wo-card group-wo-card" data-group-id="' + group.id + '" open>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong><span class="group-marker">(Г)</span>' + escapeHtml(group.name || group.id) + '</strong>' +
    ' <span class="summary-sub">' +
    (group.orderNo ? ' (Заказ: ' + escapeHtml(group.orderNo) + ')' : '') + contractText +
    barcodeButton + filesButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>' +
    '</div>' +
    '</summary>' +
    '<div class="group-children">' + childrenHtml + '</div>' +
    '</details>';
}

function scrollWorkorderDetailsIntoViewIfNeeded(detailsEl) {
  if (!detailsEl || !workorderAutoScrollEnabled || suppressWorkorderAutoscroll) return;

  // Автоскролл существует только для удобного просмотра именно что раскрытой карточки/группы.
  requestAnimationFrame(() => {
    if (suppressWorkorderAutoscroll) return;
    const rect = detailsEl.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerOffset = header ? header.getBoundingClientRect().height : 0;
    const offset = headerOffset + 16;

    const needsScrollDown = rect.bottom > window.innerHeight;
    const needsScrollUp = rect.top < offset;
    if (!needsScrollDown && !needsScrollUp) return;
    const targetTop = window.scrollY + rect.top - offset;

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });
  });
}

function markWorkorderToggleState(detail) {
  detail.dataset.wasOpen = detail.open ? 'true' : 'false';
}

function shouldScrollAfterWorkorderToggle(detail) {
  const wasOpen = detail.dataset.wasOpen === 'true';
  const nowOpen = detail.open;
  detail.dataset.wasOpen = nowOpen ? 'true' : 'false';
  // Скроллим только при переходе «было закрыто → стало открыто».
  return nowOpen && !wasOpen;
}

function findWorkorderDetail({ cardId = null, groupId = null } = {}) {
  if (cardId) {
    return document.querySelector('.wo-card[data-card-id="' + cardId + '"]');
  }
  if (groupId) {
    return document.querySelector('.wo-card[data-group-id="' + groupId + '"]');
  }
  return null;
}

function withWorkorderScrollLock(cb, { anchorCardId = null, anchorGroupId = null } = {}) {
  const anchorEl = anchorCardId || anchorGroupId ? findWorkorderDetail({ cardId: anchorCardId, groupId: anchorGroupId }) : null;
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  cb();
  if (!suppressWorkorderAutoscroll) return;
  requestAnimationFrame(() => {
    if (anchorTop != null) {
      const freshAnchor = findWorkorderDetail({ cardId: anchorCardId, groupId: anchorGroupId });
      if (freshAnchor) {
        const newTop = freshAnchor.getBoundingClientRect().top;
        const delta = newTop - anchorTop;
        window.scrollTo({ left: prevX, top: window.scrollY + delta });
        return;
      }
    }
    window.scrollTo({ left: prevX, top: prevY });
  });
}

function renderExecutorSelect(value, { className = '', attrs = '' } = {}) {
  const options = usersDirectory.map(user => {
    const name = user.name || '';
    const selected = name === value ? ' selected' : '';
    return '<option value="' + escapeHtml(name) + '"' + selected + '>' + escapeHtml(name) + '</option>';
  }).join('');
  return '<select class="' + className + '" ' + attrs + '><option value=""></option>' + options + '</select>';
}

function renderExecutorCell(op, card, { readonly = false } = {}) {
  const extras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  if (readonly) {
    const extrasText = extras.filter(Boolean).length
      ? '<div class="additional-executor-list">' + extras.map(name => '<span class="executor-chip">' + escapeHtml(name) + '</span>').join('') + '</div>'
      : '';
    return '<div class="executor-cell readonly">' +
      '<div class="executor-name">' + escapeHtml(op.executor || '') + '</div>' +
      extrasText +
      '</div>';
  }

  const cardId = card ? card.id : '';
  let html = '<div class="executor-cell" data-card-id="' + cardId + '" data-op-id="' + op.id + '">';
  html += '<div class="executor-row primary">' +
    renderExecutorSelect(op.executor || '', { className: 'executor-main-input', attrs: 'data-card-id="' + cardId + '" data-op-id="' + op.id + '"' }) +
    (extras.length < 2 ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
    '</div>';

  extras.forEach((name, idx) => {
    const canAddMore = extras.length < 2 && idx === extras.length - 1;
    html += '<div class="executor-row extra" data-extra-index="' + idx + '">' +
      renderExecutorSelect(name || '', { className: 'additional-executor-input', attrs: 'data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '"' }) +
      (canAddMore ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
      '<button type="button" class="icon-btn remove-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '">-</button>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

function buildOperationsTable(card, { readonly = false, quantityPrintBlanks = false, showQuantityColumn = true, lockExecutors = false, lockQuantities = false, allowActions = !readonly } = {}) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const hasActions = allowActions && !readonly;
  const baseColumns = hasActions ? 10 : 9;
  const totalColumns = baseColumns + (showQuantityColumn ? 1 : 0);
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th>' +
    (showQuantityColumn ? '<th>Количество изделий</th>' : '') +
    '<th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Текущее / факт. время</th>' +
    (hasActions ? '<th>Действия</th>' : '') +
    '<th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    const rowId = card.id + '::' + op.id;
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    let actionsHtml = '';
    if (hasActions) {
      if (op.status === 'NOT_STARTED' || !op.status) {
        actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Начать</button>';
      } else if (op.status === 'IN_PROGRESS') {
        actionsHtml =
          '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Пауза</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'PAUSED') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'DONE') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>';
      }
    }

    const commentCell = readonly || op.status === 'DONE'
      ? '<div class="comment-readonly">' + escapeHtml(op.comment || '') + '</div>'
      : '<textarea class="comment-input" data-card-id="' + card.id + '" data-op-id="' + op.id + '" maxlength="40" rows="1" placeholder="Комментарий">' + escapeHtml(op.comment || '') + '</textarea>';

    const actionsCell = hasActions
      ? '<td><div class="table-actions">' + actionsHtml + '</div></td>'
      : '';

    html += '<tr data-row-id="' + rowId + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      (showQuantityColumn ? '<td>' + escapeHtml(getOperationQuantity(op, card)) + '</td>' : '') +
      '<td>' + renderExecutorCell(op, card, { readonly: readonly || lockExecutors }) + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + timeCell + '</td>' +
      actionsCell +
      '<td>' + commentCell + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: readonly || lockQuantities, colspan: totalColumns, blankForPrint: quantityPrintBlanks });
  });

  html += '</tbody></table>';
  return html;
}

function formatQuantityValue(val) {
  if (val === '' || val == null) return '';
  return val + ' шт';
}

function buildCardInfoBlock(card) {
  if (!card) return '';
  const items = [
    { label: 'Количество', value: formatQuantityValue(card.quantity) },
    { label: 'Чертёж / обозначение детали', value: card.drawing },
    { label: 'Материал', value: card.material },
    { label: 'Номер договора', value: card.contractNumber },
    { label: 'Описание', value: card.desc }
  ];

  let html = '<div class="card-info-block">';
  items.forEach(item => {
    const value = item.value ? escapeHtml(item.value) : '—';
    html += '<div class="info-row">' +
      '<strong>' + escapeHtml(item.label) + ':</strong>' +
      '<span>' + value + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

function renderQuantityRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  if (card && card.useItemList) {
    return renderItemListRow(card, op, { readonly, colspan, blankForPrint });
  }
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : opQty + ' шт';
  const base = '<span class="qty-total">Количество изделий: ' + escapeHtml(totalLabel) + '</span>';
  const lockRow = readonly || op.status === 'DONE';
  const goodVal = op.goodCount != null ? op.goodCount : 0;
  const scrapVal = op.scrapCount != null ? op.scrapCount : 0;
  const holdVal = op.holdCount != null ? op.holdCount : 0;

  if (lockRow) {
    const chipGood = blankForPrint ? '____' : escapeHtml(goodVal);
    const chipScrap = blankForPrint ? '____' : escapeHtml(scrapVal);
    const chipHold = blankForPrint ? '____' : escapeHtml(holdVal);

    return '<tr class="op-qty-row"><td colspan="' + colspan + '">' +
      '<div class="qty-row-content readonly">' +
      base +
      '<span class="qty-chip">Годные: ' + chipGood + '</span>' +
      '<span class="qty-chip">Брак: ' + chipScrap + '</span>' +
      '<span class="qty-chip">Задержано: ' + chipHold + '</span>' +
      '</div>' +
      '</td></tr>';
  }

  return '<tr class="op-qty-row" data-card-id="' + card.id + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="qty-row-content">' +
    base +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + goodVal + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + scrapVal + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + holdVal + '"></label>' +
    '</div>' +
    '</td></tr>';
}

function renderItemListRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  const items = Array.isArray(op.items) ? op.items : [];
  const lockRow = readonly || op.status === 'DONE';
  const itemBlocks = items.length
    ? items.map((item, idx) => {
      const goodVal = item.goodCount != null ? item.goodCount : 0;
      const scrapVal = item.scrapCount != null ? item.scrapCount : 0;
      const holdVal = item.holdCount != null ? item.holdCount : 0;
      const qtyVal = item.quantity != null ? toSafeCount(item.quantity) : 1;
      if (lockRow) {
        const goodText = blankForPrint ? '____' : escapeHtml(goodVal);
        const scrapText = blankForPrint ? '____' : escapeHtml(scrapVal);
        const holdText = blankForPrint ? '____' : escapeHtml(holdVal);
        return '<div class="item-block readonly">' +
          '<div class="item-name">' + escapeHtml(item.name || ('Изделие ' + (idx + 1))) + '</div>' +
          '<div class="item-qty">' + escapeHtml(qtyVal) + ' шт</div>' +
          '<div class="item-chips">' +
          '<span class="qty-chip">Годные: ' + goodText + '</span>' +
          '<span class="qty-chip">Брак: ' + scrapText + '</span>' +
          '<span class="qty-chip">Задержано: ' + holdText + '</span>' +
          '</div>' +
          '</div>';
      }

      return '<div class="item-block" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-item-id="' + (item.id || '') + '">' +
        '<div class="item-name">' + escapeHtml(item.name || ('Изделие ' + (idx + 1))) + '</div>' +
        '<div class="item-qty">' + escapeHtml(qtyVal) + ' шт</div>' +
        '<div class="item-inputs">' +
        '<label>Годные <input type="number" class="item-status-input" data-qty-type="good" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + goodVal + '"></label>' +
        '<label>Брак <input type="number" class="item-status-input" data-qty-type="scrap" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + scrapVal + '"></label>' +
        '<label>Задержано <input type="number" class="item-status-input" data-qty-type="hold" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + holdVal + '"></label>' +
        '</div>' +
        '</div>';
    }).join('')
    : '<span class="items-empty">Список изделий пуст</span>';

  const cardId = card ? card.id : '';
  return '<tr class="op-qty-row op-items-row" data-card-id="' + cardId + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="items-row-header">Список изделий</div>' +
    '<div class="items-row-content">' + itemBlocks + '</div>' +
    '</td></tr>';
}

function applyOperationAction(action, card, op, { anchorGroupId = null, useWorkorderScrollLock = true } = {}) {
  if (!card || !op) return;

  const execute = () => {
    const prevStatus = op.status;
    const prevElapsed = op.elapsedSeconds || 0;
    const prevCardStatus = card.status;

    if (action === 'start') {
      const now = Date.now();
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
      op.actualSeconds = null;
      op.elapsedSeconds = 0;
    } else if (action === 'pause') {
      if (op.status === 'IN_PROGRESS') {
        const now = Date.now();
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
        op.lastPausedAt = now;
        op.startedAt = null;
        op.status = 'PAUSED';
      }
    } else if (action === 'resume') {
      const now = Date.now();
      if (op.status === 'DONE' && typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = op.actualSeconds || 0;
      }
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
    } else if (action === 'stop') {
      const now = Date.now();
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      const qtyTotal = getOperationQuantity(op, card);
      if (card.useItemList) {
        normalizeOperationItems(card, op);
        const wrongItem = (op.items || []).find(item => {
          const expected = item.quantity != null ? item.quantity : 1;
          const total = toSafeCount(item.goodCount || 0) + toSafeCount(item.scrapCount || 0) + toSafeCount(item.holdCount || 0);
          return expected > 0 && total !== expected;
        });
        if (wrongItem) {
          alert('Количество по изделию "' + (wrongItem.name || 'Изделие') + '" не совпадает');
          return;
        }
      } else if (qtyTotal > 0) {
        const sum = toSafeCount(op.goodCount || 0) + toSafeCount(op.scrapCount || 0) + toSafeCount(op.holdCount || 0);
        if (sum !== qtyTotal) {
          alert('Количество деталей не совпадает');
          return;
        }
      }
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';
    }

    recalcCardStatus(card);
    if (prevStatus !== op.status) {
      recordCardLog(card, { action: 'Статус операции', object: opLogLabel(op), field: 'status', targetId: op.id, oldValue: prevStatus, newValue: op.status });
    }
    if (prevElapsed !== op.elapsedSeconds && op.status === 'DONE') {
      recordCardLog(card, { action: 'Факт. время', object: opLogLabel(op), field: 'elapsedSeconds', targetId: op.id, oldValue: Math.round(prevElapsed), newValue: Math.round(op.elapsedSeconds || 0) });
    }
    if (prevCardStatus !== card.status) {
      recordCardLog(card, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: prevCardStatus, newValue: card.status });
    }
    saveData();
    renderEverything();
  };

  suppressWorkorderAutoscroll = true;
  try {
    if (useWorkorderScrollLock) {
      withWorkorderScrollLock(execute, { anchorCardId: card.id, anchorGroupId });
    } else {
      execute();
    }
  } finally {
    suppressWorkorderAutoscroll = false;
  }
}

function renderWorkordersTable({ collapseAll = false } = {}) {
  const wrapper = document.getElementById('workorders-table-wrapper');
  const rootCards = cards.filter(c => !c.archived && !c.groupId);
  const hasOperations = rootCards.some(card => {
    if (isGroupCard(card)) {
      return getGroupChildren(card).some(ch => !ch.archived && ch.operations && ch.operations.length);
    }
    return card.operations && card.operations.length;
  });
  if (!hasOperations) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  if (collapseAll) {
    workorderOpenCards.clear();
    workorderOpenGroups.clear();
  }

  const termRaw = workorderSearchTerm.trim();
  const filteredByStatus = rootCards.filter(card => {
    const state = getCardProcessState(card);
    return workorderStatusFilter === 'ALL' || state.key === workorderStatusFilter;
  });

  const filteredByMissingExecutor = workorderMissingExecutorFilter === 'NO_EXECUTOR'
    ? filteredByStatus.filter(card => isGroupCard(card) ? groupHasMissingExecutors(card) : cardHasMissingExecutors(card))
    : filteredByStatus;

  if (!filteredByMissingExecutor.length) {
    wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScoreWithChildren(card, termRaw);
  let sortedCards = [...filteredByMissingExecutor];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      const opened = !collapseAll && workorderOpenGroups.has(card.id);
      const stateBadge = renderCardStateBadge(card);
      const missingBadge = groupHasMissingExecutors(card)
        ? '<span class="status-pill status-pill-missing-executor" title="Есть операции без исполнителя">Нет исполнителя</span>'
        : '';
      const groupExecutorBtn = '<button type="button" class="btn-small group-executor-btn" data-group-id="' + card.id + '"><span class="group-executor-label">Групповой<br>исполнитель</span></button>';
      const filesCount = (card.attachments || []).length;
      const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
      const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
      const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
      const childrenHtml = children.length
        ? children.map(child => buildWorkorderCardDetails(child, { opened: !collapseAll && workorderOpenCards.has(child.id), allowArchive: false })).join('')
        : '<p class="group-empty">В группе нет карт для отображения.</p>';

      html += '<details class="wo-card group-wo-card" data-group-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
        '<summary>' +
        '<div class="summary-line">' +
        '<div class="summary-text">' +
        '<strong><span class="group-marker">(Г)</span>' + escapeHtml(card.name || card.id) + '</strong>' +
        ' <span class="summary-sub">' +
        (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
        barcodeButton + filesButton +
        '</span>' +
        '</div>' +
        '<div class="summary-actions">' +
        groupExecutorBtn + ' ' + (missingBadge ? missingBadge + ' ' : '') + stateBadge +
        (card.status === 'DONE' ? ' <button type="button" class="btn-small btn-secondary archive-group-btn" data-group-id="' + card.id + '">Перенести в архив</button>' : '') +
        '</div>' +
        '</div>' +
        '</summary>' +
        '<div class="group-children">' + childrenHtml + '</div>' +
        '</details>';
    } else if (card.operations && card.operations.length) {
      const opened = !collapseAll && workorderOpenCards.has(card.id);
      html += buildWorkorderCardDetails(card, { opened });
    }
  });

  wrapper.innerHTML = html;

  wrapper.querySelectorAll('.group-wo-card').forEach(detail => {
    const groupId = detail.getAttribute('data-group-id');
    if (detail.open && groupId) {
      workorderOpenGroups.add(groupId);
    }
    markWorkorderToggleState(detail);
    detail.addEventListener('toggle', () => {
      if (!groupId) return;
      if (detail.open) {
        workorderOpenGroups.add(groupId);
        if (shouldScrollAfterWorkorderToggle(detail)) {
          // Автоскролл только после раскрытия ранее закрытой группы.
          scrollWorkorderDetailsIntoViewIfNeeded(detail);
        }
      } else {
        workorderOpenGroups.delete(groupId);
        markWorkorderToggleState(detail);
      }
    });
  });

  wrapper.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    const cardId = detail.getAttribute('data-card-id');
    if (detail.open && cardId) {
      workorderOpenCards.add(cardId);
    }
    markWorkorderToggleState(detail);
    detail.addEventListener('toggle', () => {
      if (!cardId) return;
      if (detail.open) {
        workorderOpenCards.add(cardId);
        if (shouldScrollAfterWorkorderToggle(detail)) {
          // Скроллим только в момент раскрытия закрытой карточки.
          scrollWorkorderDetailsIntoViewIfNeeded(detail);
        }
      } else {
        workorderOpenCards.delete(cardId);
        markWorkorderToggleState(detail);
      }
    });
  });

  wrapper.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.group-executor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const groupId = btn.getAttribute('data-group-id');
      openGroupExecutorModal(groupId);
    });
  });

  wrapper.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  wrapper.querySelectorAll('.archive-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-group-id');
      const group = cards.find(c => c.id === id && isGroupCard(c));
      if (!group) return;
      const related = [group, ...getGroupChildren(group)];
      related.forEach(card => {
        if (!card.archived) {
          recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
        }
        card.archived = true;
      });
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.archive-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card || card.groupId) return;
      if (!card.archived) {
        recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
      }
      card.archived = true;
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.comment-input').forEach(input => {
    autoResizeComment(input);
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    input.addEventListener('focus', () => {
      input.dataset.prevComment = op.comment || '';
    });

    input.addEventListener('input', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      op.comment = value;
      autoResizeComment(e.target);
    });

    input.addEventListener('blur', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      const prev = input.dataset.prevComment || '';
      if (prev !== value) {
        recordCardLog(card, { action: 'Комментарий', object: opLogLabel(op), field: 'comment', targetId: op.id, oldValue: prev, newValue: value });
      }
      op.comment = value;
      saveData();
      renderDashboard();
    });
  });

  wrapper.querySelectorAll('.executor-main-input').forEach(input => {
    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
    });
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      op.executor = (e.target.value || '').trim();
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op || !card) return;
      const value = (e.target.value || '').trim();
      const prev = input.dataset.prevVal || '';
      op.executor = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
    });
  });

  wrapper.querySelectorAll('.add-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (!Array.isArray(op.additionalExecutors)) op.additionalExecutors = [];
      if (op.additionalExecutors.length >= 2) return;
      const anchorGroupId = btn.closest('.wo-card') ? btn.closest('.wo-card').getAttribute('data-group-id') : null;
      suppressWorkorderAutoscroll = true;
      try {
        withWorkorderScrollLock(() => {
          op.additionalExecutors.push('');
          recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: op.additionalExecutors.length - 1, newValue: op.additionalExecutors.length });
          saveData();
          workorderOpenCards.add(cardId);
          renderWorkordersTable();
        }, { anchorCardId: cardId, anchorGroupId });
      } finally {
        suppressWorkorderAutoscroll = false;
      }
    });
  });

  wrapper.querySelectorAll('.remove-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const idx = parseInt(btn.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const anchorGroupId = btn.closest('.wo-card') ? btn.closest('.wo-card').getAttribute('data-group-id') : null;
      suppressWorkorderAutoscroll = true;
      try {
        withWorkorderScrollLock(() => {
          const removed = op.additionalExecutors.splice(idx, 1)[0];
          recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: removed, newValue: 'удален' });
          saveData();
          workorderOpenCards.add(cardId);
          renderWorkordersTable();
        }, { anchorCardId: cardId, anchorGroupId });
      } finally {
        suppressWorkorderAutoscroll = false;
      }
    });
  });

  wrapper.querySelectorAll('.additional-executor-input').forEach(input => {
    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      const value = (e.target.value || '').trim();
      const prev = input.dataset.prevVal || '';
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      op.additionalExecutors[idx] = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
    });
  });

  wrapper.querySelectorAll('.item-status-input').forEach(input => {
    input.addEventListener('input', e => {
      const maxVal = toSafeCount(input.getAttribute('data-item-qty'));
      e.target.value = Math.min(maxVal, toSafeCount(e.target.value));
    });

    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const type = input.getAttribute('data-qty-type');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const maxVal = item.quantity != null ? item.quantity : 1;
      const val = Math.min(maxVal, toSafeCount(e.target.value));
      const prev = toSafeCount(item[field] || 0);
      if (prev === val) return;
      item[field] = val;
      normalizeOperationItems(card, op);
      recordCardLog(card, { action: 'Количество изделия', object: opLogLabel(op), field: 'item.' + field, targetId: item.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
      renderWorkordersTable();
    });
  });

  wrapper.querySelectorAll('.qty-input').forEach(input => {
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const type = input.getAttribute('data-qty-type');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op || !card) return;

    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });

    input.addEventListener('blur', e => {
      const val = toSafeCount(e.target.value);
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
    });
  });

  wrapper.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const op = (card.operations || []).find(o => o.id === opId);
      if (!op) return;
      const detail = btn.closest('.wo-card');
      if (detail && detail.open) {
        workorderOpenCards.add(cardId);
      }

      const anchorGroupId = detail ? detail.getAttribute('data-group-id') : null;
      applyOperationAction(action, card, op, { anchorGroupId });
    });
  });
}

function renderWorkspaceView() {
  const wrapper = document.getElementById('workspace-results');
  if (!wrapper) return;

  const termRaw = workspaceSearchTerm.trim();
  const digitsOnly = termRaw.replace(/\D/g, '');
  if (!digitsOnly) {
    wrapper.innerHTML = '<p>Введите номер техкарты или группы.</p>';
    return;
  }

  if (!/^\d{13}$/.test(digitsOnly)) {
    wrapper.innerHTML = '<p>Введите номер карты в формате EAN-13 (13 цифр).</p>';
    return;
  }

  const candidates = cards.filter(card => !card.archived && (card.barcode || '') === digitsOnly);

  if (!candidates.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  candidates.forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildWorkspaceCardDetails(card);
    }
  });

  if (!html) {
    wrapper.innerHTML = '<p>Нет карт с маршрутами для отображения.</p>';
    return;
  }

  wrapper.innerHTML = html;

  wrapper.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.wo-card button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;

      if (action === 'stop') {
        openWorkspaceStopModal(card, op);
      } else {
        applyOperationAction(action, card, op, { useWorkorderScrollLock: false });
      }
    });
  });
}

function getWorkspaceModalInputs() {
  return [
    document.getElementById('workspace-stop-good'),
    document.getElementById('workspace-stop-scrap'),
    document.getElementById('workspace-stop-hold')
  ].filter(Boolean);
}

function setWorkspaceActiveInput(input) {
  workspaceActiveModalInput = input || null;
  if (workspaceActiveModalInput) {
    workspaceActiveModalInput.focus();
    workspaceActiveModalInput.select();
  }
}

function focusWorkspaceNextInput() {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const active = document.activeElement && inputs.includes(document.activeElement)
    ? document.activeElement
    : workspaceActiveModalInput;
  const idx = Math.max(0, inputs.indexOf(active));
  const next = inputs[(idx + 1) % inputs.length];
  setWorkspaceActiveInput(next);
}

function openWorkspaceStopModal(card, op) {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;
  workspaceStopContext = { cardId: card.id, opId: op.id };
  const totalEl = document.getElementById('workspace-stop-total');
  if (totalEl) {
    const qty = getOperationQuantity(op, card);
    totalEl.textContent = qty === '' ? '–' : toSafeCount(qty);
  }
  const [goodInput, scrapInput, holdInput] = getWorkspaceModalInputs();
  if (goodInput) goodInput.value = toSafeCount(op.goodCount || 0);
  if (scrapInput) scrapInput.value = toSafeCount(op.scrapCount || 0);
  if (holdInput) holdInput.value = toSafeCount(op.holdCount || 0);
  modal.classList.remove('hidden');
  setWorkspaceActiveInput(goodInput || scrapInput || holdInput || null);
}

function closeWorkspaceStopModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (modal) modal.classList.add('hidden');
  workspaceStopContext = null;
  workspaceActiveModalInput = null;
}

function applyWorkspaceKeypad(key) {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const target = (document.activeElement && inputs.includes(document.activeElement))
    ? document.activeElement
    : workspaceActiveModalInput || inputs[0];
  if (!target) return;

  let value = target.value || '';
  if (key === 'back') {
    value = value.slice(0, -1);
  } else if (key === 'clear') {
    value = '';
  } else if (/^\d$/.test(key)) {
    value = value + key;
  }
  target.value = value.replace(/^0+(?=\d)/, '');
  setWorkspaceActiveInput(target);
}

function submitWorkspaceStopModal() {
  if (!workspaceStopContext) {
    closeWorkspaceStopModal();
    return;
  }
  const card = cards.find(c => c.id === workspaceStopContext.cardId);
  const op = card ? (card.operations || []).find(o => o.id === workspaceStopContext.opId) : null;
  if (!card || !op) {
    closeWorkspaceStopModal();
    return;
  }

  const inputs = getWorkspaceModalInputs();
  const [goodInput, scrapInput, holdInput] = inputs;
  const goodVal = toSafeCount(goodInput ? goodInput.value : 0);
  const scrapVal = toSafeCount(scrapInput ? scrapInput.value : 0);
  const holdVal = toSafeCount(holdInput ? holdInput.value : 0);

  const prevGood = toSafeCount(op.goodCount || 0);
  const prevScrap = toSafeCount(op.scrapCount || 0);
  const prevHold = toSafeCount(op.holdCount || 0);

  op.goodCount = goodVal;
  op.scrapCount = scrapVal;
  op.holdCount = holdVal;

  if (prevGood !== goodVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'goodCount', targetId: op.id, oldValue: prevGood, newValue: goodVal });
  }
  if (prevScrap !== scrapVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'scrapCount', targetId: op.id, oldValue: prevScrap, newValue: scrapVal });
  }
  if (prevHold !== holdVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'holdCount', targetId: op.id, oldValue: prevHold, newValue: holdVal });
  }

  closeWorkspaceStopModal();
  applyOperationAction('stop', card, op, { useWorkorderScrollLock: false });
}

function buildArchiveCardDetails(card, { opened = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const barcodeInline = card.barcode
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(card.barcode) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button></span>'
    : '';
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = ' <button type="button" class="btn-small btn-secondary log-btn" data-log-card="' + card.id + '">Log</button>';
  const nameLabel = formatCardNameWithGroupPosition(card, { includeArchivedSiblings: true });

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton + logButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-card-id="' + card.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: true });
  html += '</details>';
  return html;
}

function buildArchiveGroupDetails(group) {
  const stateBadge = renderCardStateBadge(group, { includeArchivedChildren: true });
  const filesCount = (group.attachments || []).length;
  const contractText = group.contractNumber ? ' (Договор: ' + escapeHtml(group.contractNumber) + ')' : '';
  const barcodeInline = group.barcode
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(group.barcode) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + group.id + '">Штрихкод</button></span>'
    : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + group.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const children = getGroupChildren(group).filter(c => c.archived);
  const childrenHtml = children.length
    ? children.map(child => buildArchiveCardDetails(child, { opened: false })).join('')
    : '<p class="group-empty">В группе нет карт для отображения.</p>';

  let html = '<details class="wo-card group-archive-card" data-group-id="' + group.id + '">' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong><span class="group-marker">(Г)</span>' + escapeHtml(group.name || group.id) + '</strong>' +
    ' <span class="summary-sub">' +
    (group.orderNo ? ' (Заказ: ' + escapeHtml(group.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-group-id="' + group.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>' +
    '<div class="group-children">' + childrenHtml + '</div>' +
    '</details>';
  return html;
}

function renderArchiveTable() {
  const wrapper = document.getElementById('archive-table-wrapper');
  const archivedCards = cards.filter(c => c.archived && !c.groupId);
  if (!archivedCards.length) {
    wrapper.innerHTML = '<p>В архиве пока нет карт.</p>';
    return;
  }

  const termRaw = archiveSearchTerm.trim();
  const filteredByStatus = archivedCards.filter(card => {
    const state = getCardProcessState(card, { includeArchivedChildren: true });
    return archiveStatusFilter === 'ALL' || state.key === archiveStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScoreWithChildren(card, termRaw, { includeArchivedChildren: true });
  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Архивные карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (isGroupCard(card)) {
      html += buildArchiveGroupDetails(card);
    } else if (card.operations && card.operations.length) {
      html += buildArchiveCardDetails(card);
    }
  });

  wrapper.innerHTML = html || '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';

  wrapper.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  wrapper.querySelectorAll('.repeat-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.getAttribute('data-group-id');
      if (groupId) {
        const newGroup = duplicateGroup(groupId, { includeArchivedChildren: true });
        if (newGroup) {
          openGroupTransferModal();
        }
        return;
      }
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      const cloneOps = (card.operations || []).map(op => ({
        ...op,
        id: genId('rop'),
        status: 'NOT_STARTED',
        startedAt: null,
        finishedAt: null,
        actualSeconds: null,
        elapsedSeconds: 0,
        comment: ''
      }));
      const newCard = {
        ...card,
        id: genId('card'),
        barcode: generateUniqueEAN13(),
        name: (card.name || '') + ' (копия)',
        status: 'NOT_STARTED',
        archived: false,
        attachments: (card.attachments || []).map(file => ({
          ...file,
          id: genId('file'),
          createdAt: Date.now()
        })),
        operations: cloneOps
      };
      ensureCardMeta(newCard);
      recalcCardStatus(newCard);
      cards.push(newCard);
      saveData();
      renderEverything();
    });
  });
}

// === ТАЙМЕР ===
function tickTimers() {
  const rows = getAllRouteRows().filter(r => r.op.status === 'IN_PROGRESS' && r.op.startedAt);
  rows.forEach(row => {
    const card = row.card;
    const op = row.op;
    const rowId = card.id + '::' + op.id;
    const span = document.querySelector('.wo-timer[data-row-id="' + rowId + '"]');
    if (span) {
      const elapsedSec = getOperationElapsedSeconds(op);
      span.textContent = formatSecondsToHMS(elapsedSec);
    }
  });

  refreshCardStatuses();
  renderDashboard();
}

// === НАВИГАЦИЯ ===
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (!target) return;

      closeCardModal();

      document.querySelectorAll('main section').forEach(sec => {
        sec.classList.remove('active');
      });
      const section = document.getElementById(target);
      if (section) {
        section.classList.add('active');
      }

      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (target === 'workorders') {
        renderWorkordersTable({ collapseAll: true });
      } else if (target === 'archive') {
        renderArchiveTable();
      } else if (target === 'workspace') {
        renderWorkspaceView();
        focusWorkspaceSearch();
      } else if (target === 'dashboard' && window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
        requestAnimationFrame(() => window.dashboardPager.updatePages());
      }
    });
  });
}

function openDirectoryModal() {
  const modal = document.getElementById('directory-modal');
  if (!modal) return;
  renderCentersTable();
  renderOpsTable();
  modal.classList.remove('hidden');
}

function closeDirectoryModal() {
  const modal = document.getElementById('directory-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function setCardsTab(tabKey) {
  const listPanel = document.getElementById('cards-list-panel');
  if (listPanel) listPanel.classList.toggle('hidden', tabKey !== 'list');
  if (tabKey === 'directory') {
    openDirectoryModal();
    if (listPanel) listPanel.classList.remove('hidden');
  }
}

function setupCardsTabs() {
  const directoryBtn = document.getElementById('btn-directory-modal');
  if (directoryBtn) {
    directoryBtn.addEventListener('click', () => openDirectoryModal());
  }
  const modal = document.getElementById('directory-modal');
  const closeBtn = document.getElementById('directory-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeDirectoryModal());
  }
}

function focusCardsSection() {
  document.querySelectorAll('main section').forEach(sec => {
    sec.classList.toggle('active', sec.id === 'cards');
  });
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    btn.classList.toggle('active', target === 'cards');
  });
  setCardsTab('list');
}

function focusWorkspaceSearch() {
  const input = document.getElementById('workspace-search');
  if (input) {
    input.focus();
    input.select();
  }
}

function focusCardsSection() {
  document.querySelectorAll('main section').forEach(sec => {
    sec.classList.toggle('active', sec.id === 'cards');
  });
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    btn.classList.toggle('active', target === 'cards');
  });
  setCardsTab('list');
}

// === ФОРМЫ ===
function setupForms() {
  document.getElementById('btn-new-card').addEventListener('click', () => {
    openCardModal();
  });

  const cardForm = document.getElementById('card-form');
  if (cardForm) {
    cardForm.addEventListener('submit', e => e.preventDefault());
  }

  const cardQtyInput = document.getElementById('card-qty');
  if (cardQtyInput) {
    cardQtyInput.addEventListener('input', e => {
      if (!activeCardDraft) return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
      if (!routeQtyManual) {
        const qtyField = document.getElementById('route-qty');
        if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
      if (activeCardDraft.useItemList && Array.isArray(activeCardDraft.operations)) {
        activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
      }
      renderRouteTableDraft();
    });
  }

  const useItemsCheckbox = document.getElementById('card-use-items');
  if (useItemsCheckbox) {
    useItemsCheckbox.addEventListener('change', e => {
      if (!activeCardDraft) return;
      activeCardDraft.useItemList = e.target.checked;
      if (Array.isArray(activeCardDraft.operations)) {
        activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
      }
      renderRouteTableDraft();
    });
  }

  const saveBtn = document.getElementById('card-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
      saveCardDraft();
    });
  }

  const createGroupBtn = document.getElementById('card-create-group-btn');
  if (createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
      syncCardDraftFromForm();
      openGroupModal();
    });
  }

  const printDraftBtn = document.getElementById('card-print-btn');
  if (printDraftBtn) {
    printDraftBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      printCardView(activeCardDraft, { blankQuantities: true });
    });
  }

  const cancelBtn = document.getElementById('card-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeCardModal();
    });
  }

  const groupConfirmBtn = document.getElementById('group-create-confirm');
  if (groupConfirmBtn) {
    groupConfirmBtn.addEventListener('click', () => {
      syncCardDraftFromForm();
      createGroupFromDraft();
    });
  }

  const groupCancelBtn = document.getElementById('group-create-cancel');
  if (groupCancelBtn) {
    groupCancelBtn.addEventListener('click', () => closeGroupModal());
  }

  document.getElementById('route-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!activeCardDraft) return;
    const opInput = document.getElementById('route-op');
    const opList = document.getElementById('route-op-options');
    const centerInput = document.getElementById('route-center');
    const centerList = document.getElementById('route-center-options');
    const opMatch = Array.from(opList ? opList.options : []).find(opt => opt.value === (opInput ? opInput.value.trim() : ''));
    const centerMatch = Array.from(centerList ? centerList.options : []).find(opt => opt.value === (centerInput ? centerInput.value.trim() : ''));
    const opId = opMatch ? opMatch.dataset.id : null;
    const centerId = centerMatch ? centerMatch.dataset.id : null;
    const planned = parseInt(document.getElementById('route-planned').value, 10) || 30;
    const codeValue = document.getElementById('route-op-code').value.trim();
    const qtyInput = document.getElementById('route-qty').value.trim();
    const qtyValue = qtyInput === '' ? activeCardDraft.quantity : qtyInput;
    const qtyNumeric = qtyValue === '' ? '' : toSafeCount(qtyValue);
    const prevSameQtyOp = activeCardDraft.useItemList
      ? [...(activeCardDraft.operations || [])]
        .sort((a, b) => (b.order || 0) - (a.order || 0))
        .find(o => getOperationQuantity(o, activeCardDraft) === qtyNumeric)
      : null;
    const items = activeCardDraft.useItemList
      ? buildItemsFromTemplate(prevSameQtyOp ? prevSameQtyOp.items : [], qtyNumeric)
      : [];
    let opRef = ops.find(o => o.id === opId);
    let centerRef = centers.find(c => c.id === centerId);
    const opTerm = (opInput ? opInput.value : '').trim().toLowerCase();
    const centerTerm = (centerInput ? centerInput.value : '').trim().toLowerCase();
    if (!opRef && opTerm) {
      opRef = ops.find(o => formatOpLabel(o).toLowerCase() === opTerm) || ops.find(o => formatOpLabel(o).toLowerCase().includes(opTerm));
    }
    if (!centerRef && centerTerm) {
      centerRef = centers.find(c => (c.name || '').toLowerCase() === centerTerm) || centers.find(c => (c.name || '').toLowerCase().includes(centerTerm));
    }
    if (!opRef || !centerRef) {
      alert('Выберите операцию и участок из списка.');
      return;
    }
    const maxOrder = activeCardDraft.operations && activeCardDraft.operations.length
      ? Math.max.apply(null, activeCardDraft.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, '', planned, maxOrder + 1, {
      code: codeValue,
      autoCode: !codeValue,
      quantity: qtyValue,
      items
    });
    activeCardDraft.operations = activeCardDraft.operations || [];
    activeCardDraft.operations.push(rop);
    normalizeOperationItems(activeCardDraft, rop);
    renumberAutoCodesForCard(activeCardDraft);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    renderRouteTableDraft();
    const tableWrapper = document.getElementById('route-table-wrapper');
    if (tableWrapper) {
      tableWrapper.scrollTop = tableWrapper.scrollHeight;
    }
    document.getElementById('route-form').reset();
    routeQtyManual = false;
    const qtyField = document.getElementById('route-qty');
    if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
    if (opInput) opInput.value = '';
    if (centerInput) centerInput.value = '';
    fillRouteSelectors();
  });

  const routeQtyField = document.getElementById('route-qty');
  if (routeQtyField) {
    routeQtyField.addEventListener('input', e => {
      const raw = e.target.value;
      routeQtyManual = raw !== '';
      if (raw !== '') {
        e.target.value = toSafeCount(raw);
      } else if (activeCardDraft) {
        e.target.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
    });
  }

  const opFilterInput = document.getElementById('route-op-filter');
  const centerFilterInput = document.getElementById('route-center-filter');
  if (opFilterInput) {
    opFilterInput.addEventListener('input', () => fillRouteSelectors());
  }
  if (centerFilterInput) {
    centerFilterInput.addEventListener('input', () => fillRouteSelectors());
  }

  const cardModalBody = document.querySelector('#card-modal .modal-body');
  if (cardModalBody) {
    cardModalBody.addEventListener('scroll', () => updateRouteTableScrollState());
  }
  window.addEventListener('resize', () => updateRouteTableScrollState());

  document.getElementById('center-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('center-name').value.trim();
    const desc = document.getElementById('center-desc').value.trim();
    if (!name) return;
    centers.push({ id: genId('wc'), name: name, desc: desc });
    saveData();
    renderCentersTable();
    fillRouteSelectors();
    e.target.reset();
  });

      document.getElementById('op-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('op-name').value.trim();
        const desc = document.getElementById('op-desc').value.trim();
        const time = parseInt(document.getElementById('op-time').value, 10) || 30;
        if (!name) return;
        const used = collectUsedOpCodes();
        const code = generateUniqueOpCode(used);
        ops.push({ id: genId('op'), code, name: name, desc: desc, recTime: time });
        saveData();
        renderOpsTable();
        fillRouteSelectors();
        e.target.reset();
      });

  const cardsSearchInput = document.getElementById('cards-search');
  const cardsSearchClear = document.getElementById('cards-search-clear');
  if (cardsSearchInput) {
    cardsSearchInput.addEventListener('input', e => {
      cardsSearchTerm = e.target.value || '';
      renderCardsTable();
    });
  }
  if (cardsSearchClear) {
    cardsSearchClear.addEventListener('click', () => {
      cardsSearchTerm = '';
      if (cardsSearchInput) cardsSearchInput.value = '';
      renderCardsTable();
    });
  }

  const workorderAutoscrollCheckbox = document.getElementById('workorder-autoscroll');
  if (workorderAutoscrollCheckbox) {
    workorderAutoscrollCheckbox.checked = workorderAutoScrollEnabled;
    workorderAutoscrollCheckbox.addEventListener('change', (e) => {
      workorderAutoScrollEnabled = !!e.target.checked;
    });
  }

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  const statusSelect = document.getElementById('workorder-status');
  const missingExecutorSelect = document.getElementById('workorder-missing-executor');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      workorderSearchTerm = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      workorderSearchTerm = '';
      if (searchInput) searchInput.value = '';
      if (statusSelect) statusSelect.value = 'ALL';
      workorderStatusFilter = 'ALL';
      workorderMissingExecutorFilter = 'ALL';
      if (missingExecutorSelect) missingExecutorSelect.value = 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', e => {
      workorderStatusFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (missingExecutorSelect) {
    missingExecutorSelect.addEventListener('change', e => {
      workorderMissingExecutorFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  const archiveSearchInput = document.getElementById('archive-search');
  const archiveSearchClear = document.getElementById('archive-search-clear');
  const archiveStatusSelect = document.getElementById('archive-status');
  if (archiveSearchInput) {
    archiveSearchInput.addEventListener('input', e => {
      archiveSearchTerm = e.target.value || '';
      renderArchiveTable();
    });
  }
  if (archiveStatusSelect) {
    archiveStatusSelect.addEventListener('change', e => {
      archiveStatusFilter = e.target.value || 'ALL';
      renderArchiveTable();
    });
  }
  if (archiveSearchClear) {
    archiveSearchClear.addEventListener('click', () => {
      archiveSearchTerm = '';
      if (archiveSearchInput) archiveSearchInput.value = '';
      archiveStatusFilter = 'ALL';
      if (archiveStatusSelect) archiveStatusSelect.value = 'ALL';
      renderArchiveTable();
    });
  }

  const workspaceSearchInput = document.getElementById('workspace-search');
  const workspaceSearchSubmit = document.getElementById('workspace-search-submit');
  const workspaceSearchClear = document.getElementById('workspace-search-clear');
  const sanitizeWorkspaceTerm = (value = '') => (value || '').replace(/\D/g, '').slice(0, 13);
  const triggerWorkspaceSearch = () => {
    workspaceSearchTerm = workspaceSearchInput ? sanitizeWorkspaceTerm(workspaceSearchInput.value || '') : '';
    if (workspaceSearchInput) {
      workspaceSearchInput.value = workspaceSearchTerm;
    }
    renderWorkspaceView();
  };

  if (workspaceSearchInput) {
    workspaceSearchInput.addEventListener('input', e => {
      const sanitized = sanitizeWorkspaceTerm(e.target.value || '');
      if (sanitized !== e.target.value) {
        e.target.value = sanitized;
      }
      workspaceSearchTerm = sanitized;
    });
    workspaceSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerWorkspaceSearch();
      }
    });
  }
  if (workspaceSearchSubmit) {
    workspaceSearchSubmit.addEventListener('click', triggerWorkspaceSearch);
  }
  if (workspaceSearchClear) {
    workspaceSearchClear.addEventListener('click', () => {
      workspaceSearchTerm = '';
      if (workspaceSearchInput) {
        workspaceSearchInput.value = '';
        focusWorkspaceSearch();
      }
      renderWorkspaceView();
    });
  }
}

// === ОБЩИЙ РЕНДЕР ===
function refreshCardStatuses() {
  cards.forEach(card => recalcCardStatus(card));
}

function renderEverything() {
  refreshCardStatuses();
  renderDashboard();
  renderCardsTable();
  renderCentersTable();
  renderOpsTable();
  fillRouteSelectors();
  renderWorkordersTable();
  renderArchiveTable();
  renderWorkspaceView();
}

function setupGroupTransferModal() {
  const closeBtn = document.getElementById('group-transfer-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeGroupTransferModal());
  }
}

function setupGroupExecutorModal() {
  const createBtn = document.getElementById('group-executor-submit');
  const cancelBtn = document.getElementById('group-executor-cancel');

  if (createBtn) {
    createBtn.addEventListener('click', () => applyGroupExecutorToGroup());
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeGroupExecutorModal());
  }
}

function setupAttachmentControls() {
  const modal = document.getElementById('attachments-modal');
  const closeBtn = document.getElementById('attachments-close');
  const addBtn = document.getElementById('attachments-add-btn');
  const input = document.getElementById('attachments-input');
  const cardBtn = document.getElementById('card-attachments-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeAttachmentsModal());
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      addAttachmentsFromFiles(e.target.files);
      input.value = '';
    });
  }
  if (cardBtn) {
    cardBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      openAttachmentsModal(activeCardDraft.id, 'draft');
    });
  }
}

function setupWorkspaceModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;

  const keypadButtons = modal.querySelectorAll('.workspace-keypad button[data-key]');
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => applyWorkspaceKeypad(btn.getAttribute('data-key')));
  });

  const enterBtn = document.getElementById('workspace-stop-enter');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const nextBtn = document.getElementById('workspace-stop-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => focusWorkspaceNextInput());
  }

  const confirmBtn = document.getElementById('workspace-stop-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const cancelBtn = document.getElementById('workspace-stop-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeWorkspaceStopModal());
  }

  getWorkspaceModalInputs().forEach(input => {
    input.addEventListener('focus', () => setWorkspaceActiveInput(input));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitWorkspaceStopModal();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        focusWorkspaceNextInput();
      }
    });
  });
}

function updateUserBadge() {
  const label = document.getElementById('current-user-label');
  const btn = document.getElementById('logout-btn');
  if (currentUser) {
    label.textContent = currentUser.name || 'Пользователь';
    if (btn) btn.disabled = false;
  } else {
    label.textContent = 'Не авторизован';
    if (btn) btn.disabled = true;
  }
}

function refreshUserOptionsList() {
  const list = document.getElementById('user-options');
  if (!list) return;
  list.innerHTML = '';
  (usersDirectory || [])
    .filter(u => u.active !== false)
    .forEach(user => {
      const opt = document.createElement('option');
      opt.value = user.name || '';
      list.appendChild(opt);
    });
}

function applyAccessVisibility() {
  const map = [
    { id: 'dashboard', area: 'dashboard' },
    { id: 'cards', area: 'cards' },
    { id: 'workorders', area: 'workorders' },
    { id: 'archive', area: 'archive' },
    { id: 'workspace', area: 'workspace' },
    { id: 'users', area: 'users' },
    { id: 'access-levels', area: 'accessLevels' }
  ];
  map.forEach(entry => {
    const allowed = hasAccess(entry.area, 'view');
    const btn = document.querySelector('.nav-btn[data-target="' + entry.id + '"]');
    const section = document.getElementById(entry.id);
    if (btn) btn.classList.toggle('hidden', !allowed);
    if (section) section.classList.toggle('hidden', !allowed);
  });
}

function populateAccessLevelSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  accessLevelsDirectory.forEach(level => {
    const opt = document.createElement('option');
    opt.value = level.id;
    opt.textContent = level.name || level.id;
    selectEl.appendChild(opt);
  });
}

function renderUsersTable() {
  const container = document.getElementById('users-table');
  if (!container) return;
  if (!usersDirectory.length) {
    container.innerHTML = '<p class="muted">Пользователи отсутствуют.</p>';
    return;
  }
  let html = '<table class="simple-table"><thead><tr><th>Имя</th><th>Уровень</th><th>Статус</th></tr></thead><tbody>';
  usersDirectory.forEach(user => {
    const level = accessLevelsDirectory.find(l => l.id === user.accessLevelId);
    html += '<tr class="user-row" data-user-id="' + user.id + '">' +
      '<td>' + escapeHtml(user.name || '') + '</td>' +
      '<td>' + escapeHtml(level ? level.name : '') + '</td>' +
      '<td>' + (user.active === false ? 'Отключен' : 'Активен') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('.user-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-user-id');
      const user = usersDirectory.find(u => u.id === id);
      fillUserForm(user);
    });
  });
}

function fillUserForm(user) {
  const idInput = document.getElementById('user-id');
  const nameInput = document.getElementById('user-name');
  const passInput = document.getElementById('user-password');
  const levelSelect = document.getElementById('user-access-level');
  const activeInput = document.getElementById('user-active');
  const deleteBtn = document.getElementById('delete-user');
  const printBtn = document.getElementById('print-barcode');
  if (!user) {
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (passInput) passInput.value = '';
    if (levelSelect) levelSelect.value = accessLevelsDirectory[0] ? accessLevelsDirectory[0].id : '';
    if (activeInput) activeInput.checked = true;
    if (deleteBtn) deleteBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;
    return;
  }
  if (idInput) idInput.value = user.id;
  if (nameInput) nameInput.value = user.name || '';
  if (passInput) passInput.value = user.password || '';
  if (levelSelect) levelSelect.value = user.accessLevelId || '';
  if (activeInput) activeInput.checked = user.active !== false;
  if (deleteBtn) deleteBtn.disabled = user.name === 'Abyss';
  if (printBtn) printBtn.disabled = false;
}

function renderAccessLevelsTable() {
  const container = document.getElementById('access-levels-table');
  if (!container) return;
  if (!accessLevelsDirectory.length) {
    container.innerHTML = '<p class="muted">Уровни доступа отсутствуют.</p>';
    return;
  }
  let html = '<table class="simple-table"><thead><tr><th>Название</th><th>Описание</th><th>Автовыход</th><th>Рабочий</th></tr></thead><tbody>';
  accessLevelsDirectory.forEach(level => {
    html += '<tr class="level-row" data-level-id="' + level.id + '">' +
      '<td>' + escapeHtml(level.name || '') + '</td>' +
      '<td>' + escapeHtml(level.description || '') + '</td>' +
      '<td>' + escapeHtml(level.idleTimeoutMinutes || 0) + ' мин</td>' +
      '<td>' + (level.isWorker ? 'Да' : 'Нет') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('.level-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-level-id');
      const level = accessLevelsDirectory.find(l => l.id === id);
      fillAccessLevelForm(level);
    });
  });
}

function fillAccessLevelForm(level) {
  const idInput = document.getElementById('level-id');
  const nameInput = document.getElementById('level-name');
  const descInput = document.getElementById('level-desc');
  const landingSelect = document.getElementById('level-landing');
  const timeoutInput = document.getElementById('level-timeout');
  const workerInput = document.getElementById('level-worker');
  const deleteBtn = document.getElementById('level-delete');
  if (!level) {
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (landingSelect) landingSelect.value = 'dashboard';
    if (timeoutInput) timeoutInput.value = 30;
    if (workerInput) workerInput.checked = false;
    if (deleteBtn) deleteBtn.disabled = true;
    document.querySelectorAll('.perm-toggle').forEach(chk => { chk.checked = false; });
    return;
  }
  if (idInput) idInput.value = level.id;
  if (nameInput) nameInput.value = level.name || '';
  if (descInput) descInput.value = level.description || '';
  if (landingSelect) landingSelect.value = level.landingTab || 'dashboard';
  if (timeoutInput) timeoutInput.value = level.idleTimeoutMinutes || 30;
  if (workerInput) workerInput.checked = Boolean(level.isWorker);
  if (deleteBtn) deleteBtn.disabled = false;
  const permissions = level.permissions || {};
  document.querySelectorAll('.perm-toggle').forEach(chk => {
    const area = chk.getAttribute('data-perm-area');
    const type = chk.getAttribute('data-perm-type');
    chk.checked = Boolean(permissions[area] && permissions[area][type]);
  });
}

function collectPermissionsFromForm() {
  const perms = {};
  document.querySelectorAll('.perm-toggle').forEach(chk => {
    const area = chk.getAttribute('data-perm-area');
    const type = chk.getAttribute('data-perm-type');
    perms[area] = perms[area] || {};
    perms[area][type] = chk.checked;
  });
  return perms;
}

function setupPermissionGrid() {
  const container = document.getElementById('permissions-grid');
  if (!container) return;
  const entries = [
    { key: 'dashboard', title: 'Дашборд' },
    { key: 'cards', title: 'Тех. карты' },
    { key: 'workorders', title: 'Трекер' },
    { key: 'archive', title: 'Архив' },
    { key: 'workspace', title: 'Рабочее место' },
    { key: 'attachments', title: 'Вложения', custom: ['upload', 'remove'] },
    { key: 'users', title: 'Пользователи' },
    { key: 'accessLevels', title: 'Уровни доступа' }
  ];
  container.innerHTML = entries.map(entry => {
    const hasCustom = Array.isArray(entry.custom);
    const checks = hasCustom
      ? entry.custom.map(type => '<label class="toggle-row"><input type="checkbox" class="perm-toggle" data-perm-area="' + entry.key + '" data-perm-type="' + type + '"><span>' + (type === 'upload' ? 'Загрузка' : 'Удаление') + '</span></label>').join('')
      : ['view', 'change'].map(type => '<label class="toggle-row"><input type="checkbox" class="perm-toggle" data-perm-area="' + entry.key + '" data-perm-type="' + type + '"><span>' + (type === 'view' ? 'Просмотр' : 'Изменение') + '</span></label>').join('');
    return '<div class="perm-card"><h4>' + escapeHtml(entry.title) + '</h4>' + checks + '</div>';
  }).join('');
}

async function refreshUsersDirectory() {
  try {
    const res = await apiFetch('/api/users');
    if (!res.ok) throw new Error('Ошибка загрузки пользователей');
    const payload = await res.json();
    usersDirectory = Array.isArray(payload.users) ? payload.users : [];
    refreshUserOptionsList();
    renderUsersTable();
    populateAccessLevelSelect(document.getElementById('user-access-level'));
  } catch (err) {
    console.error(err);
  }
}

async function refreshAccessLevelsDirectory() {
  try {
    const res = await apiFetch('/api/access-levels');
    if (!res.ok) throw new Error('Ошибка загрузки уровней');
    const payload = await res.json();
    accessLevelsDirectory = Array.isArray(payload.levels) ? payload.levels : [];
    populateAccessLevelSelect(document.getElementById('user-access-level'));
    renderAccessLevelsTable();
  } catch (err) {
    console.error(err);
  }
}

async function saveUserFromForm(evt) {
  evt.preventDefault();
  const id = document.getElementById('user-id').value;
  const name = document.getElementById('user-name').value.trim();
  const password = document.getElementById('user-password').value.trim();
  const accessLevelId = document.getElementById('user-access-level').value;
  const active = document.getElementById('user-active').checked;
  if (!name || password.length < 6) return;
  const payload = { name, password, accessLevelId, active };
  const method = id ? 'PUT' : 'POST';
  const url = id ? '/api/users/' + id : '/api/users';
  const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Ошибка сохранения пользователя');
    return;
  }
  usersDirectory = data.users || usersDirectory;
  refreshUserOptionsList();
  renderUsersTable();
  fillUserForm(null);
}

async function deleteUser() {
  const id = document.getElementById('user-id').value;
  if (!id) return;
  const res = await apiFetch('/api/users/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Не удалось удалить пользователя');
    return;
  }
  usersDirectory = data.users || usersDirectory;
  refreshUserOptionsList();
  renderUsersTable();
  fillUserForm(null);
}

async function saveAccessLevel(evt) {
  evt.preventDefault();
  const id = document.getElementById('level-id').value;
  const name = document.getElementById('level-name').value.trim();
  const description = document.getElementById('level-desc').value.trim();
  const landingTab = document.getElementById('level-landing').value;
  const idleTimeoutMinutes = parseInt(document.getElementById('level-timeout').value, 10) || 30;
  const isWorker = document.getElementById('level-worker').checked;
  const permissions = collectPermissionsFromForm();
  const payload = { name, description, landingTab, idleTimeoutMinutes, isWorker, permissions };
  const method = id ? 'PUT' : 'POST';
  const url = id ? '/api/access-levels/' + id : '/api/access-levels';
  const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Ошибка сохранения уровня доступа');
    return;
  }
  accessLevelsDirectory = data.levels || accessLevelsDirectory;
  populateAccessLevelSelect(document.getElementById('user-access-level'));
  renderAccessLevelsTable();
  fillAccessLevelForm(null);
}

async function deleteAccessLevel() {
  const id = document.getElementById('level-id').value;
  if (!id) return;
  const res = await apiFetch('/api/access-levels/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Ошибка удаления уровня доступа');
    return;
  }
  accessLevelsDirectory = data.levels || accessLevelsDirectory;
  populateAccessLevelSelect(document.getElementById('user-access-level'));
  renderAccessLevelsTable();
  fillAccessLevelForm(null);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  let pwd = '';
  while (pwd.length < 8) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  const input = document.getElementById('user-password');
  if (input) input.value = pwd;
}

function printBarcodeForCurrentUser() {
  const name = document.getElementById('user-name').value || '';
  const password = document.getElementById('user-password').value || '';
  if (!password) return;
  const win = window.open('', '_blank', 'width=400,height=220');
  if (!win) return;
  win.document.write('<html><head><title>Штрихкод</title></head><body style="text-align:center; font-family:sans-serif;">');
  win.document.write('<svg id="barcode"></svg>');
  win.document.write('<div style="margin-top:8px; font-size:16px;">' + escapeHtml(name) + '</div>');
  win.document.write('</body></html>');
  if (win.JsBarcode) {
    win.JsBarcode('#barcode', password, { format: 'CODE128', displayValue: true, fontSize: 16 });
  } else if (window.JsBarcode) {
    window.JsBarcode(win.document.querySelector('#barcode'), password, { format: 'CODE128', displayValue: true, fontSize: 16 });
  }
  win.print();
}

function setupUserManagement() {
  const form = document.getElementById('user-form');
  const resetBtn = document.getElementById('user-form-reset');
  const deleteBtn = document.getElementById('delete-user');
  const genBtn = document.getElementById('generate-password');
  const printBtn = document.getElementById('print-barcode');
  if (form) form.addEventListener('submit', saveUserFromForm);
  if (resetBtn) resetBtn.addEventListener('click', () => fillUserForm(null));
  if (deleteBtn) deleteBtn.addEventListener('click', deleteUser);
  if (genBtn) genBtn.addEventListener('click', generatePassword);
  if (printBtn) printBtn.addEventListener('click', printBarcodeForCurrentUser);
  populateAccessLevelSelect(document.getElementById('user-access-level'));
  renderUsersTable();
}

function setupAccessLevelManagement() {
  setupPermissionGrid();
  const form = document.getElementById('access-level-form');
  const resetBtn = document.getElementById('level-reset');
  const deleteBtn = document.getElementById('level-delete');
  if (form) form.addEventListener('submit', saveAccessLevel);
  if (resetBtn) resetBtn.addEventListener('click', () => fillAccessLevelForm(null));
  if (deleteBtn) deleteBtn.addEventListener('click', deleteAccessLevel);
}

function showAuthModal(message = '') {
  const modal = document.getElementById('auth-modal');
  const main = document.querySelector('main');
  const error = document.getElementById('auth-error');
  if (error) error.textContent = message || '';
  if (modal) modal.classList.remove('hidden');
  if (main) main.classList.add('hidden');
  if (document.body) document.body.classList.add('unauth');
  const input = document.getElementById('auth-password');
  if (input) input.focus();
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  const main = document.querySelector('main');
  if (modal) modal.classList.add('hidden');
  if (main) main.classList.remove('hidden');
  if (document.body) document.body.classList.remove('unauth');
}

async function logout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  sessionToken = null;
  currentUser = null;
  currentAccessLevel = null;
  usersDirectory = [];
  accessLevelsDirectory = [];
  updateUserBadge();
  showAuthModal();
}

async function performLogin(password) {
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await res.json();
    if (!res.ok) {
      showAuthModal(data.error || 'Ошибка входа');
      return;
    }
    sessionToken = data.token;
    currentUser = data.user;
    currentAccessLevel = data.accessLevel;
    updateUserBadge();
    hideAuthModal();
    applyAccessVisibility();
    resetIdleTimer();
    ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    await loadData();
    refreshUserOptionsList();
    renderEverything();
    if (window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
      requestAnimationFrame(() => window.dashboardPager.updatePages());
    }
    if (!window.__appTimersStarted) {
      setInterval(tickTimers, 1000);
      window.__appTimersStarted = true;
    }
    await refreshAccessLevelsDirectory();
    await refreshUsersDirectory();
    setupUserManagement();
    setupAccessLevelManagement();
    const targetTab = currentUser && currentUser.name === 'Abyss' ? 'dashboard' : (currentAccessLevel && currentAccessLevel.landingTab) || 'dashboard';
    const btn = document.querySelector('.nav-btn[data-target="' + targetTab + '"]');
    if (btn && !btn.classList.contains('hidden')) {
      btn.click();
    }
  } catch (err) {
    showAuthModal('Ошибка соединения');
  }
}

function setupAuthFlow() {
  const form = document.getElementById('auth-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const pwd = document.getElementById('auth-password').value;
      performLogin(pwd.trim());
    });
  }
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
  showAuthModal();
}

function safeInitStep(fn, label) {
  try {
    fn();
  } catch (err) {
    console.error(`Init step failed: ${label}`, err);
  }
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  showAuthModal();
  safeInitStep(startRealtimeClock, 'clock');
  safeInitStep(setupNavigation, 'navigation');
  safeInitStep(setupCardsTabs, 'card tabs');
  safeInitStep(setupForms, 'forms');
  safeInitStep(setupBarcodeModal, 'barcode modal');
  safeInitStep(setupGroupTransferModal, 'group transfer modal');
  safeInitStep(setupGroupExecutorModal, 'group executor modal');
  safeInitStep(setupAttachmentControls, 'attachments');
  safeInitStep(setupWorkspaceModal, 'workspace modal');
  safeInitStep(setupLogModal, 'log modal');
  safeInitStep(setupAuthFlow, 'auth flow');
});
