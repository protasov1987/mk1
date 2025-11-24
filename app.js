// === КОНСТАНТЫ И ГЛОБАЛЬНЫЕ МАССИВЫ ===
const API_ENDPOINT = '/api/data';

let cards = [];
let ops = [];
let centers = [];
let workorderSearchTerm = '';
let workorderStatusFilter = 'ALL';
let archiveSearchTerm = '';
let archiveStatusFilter = 'ALL';
let apiOnline = false;
const workorderOpenCards = new Set();
let activeCardDraft = null;
let activeCardOriginalId = null;
let activeCardIsNew = false;
let routeOpCodeFilter = '';
let cardsSearchTerm = '';

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

function generateEAN13() {
  let base = '';
  for (let i = 0; i < 12; i++) {
    base += Math.floor(Math.random() * 10);
  }
  const check = computeEAN13CheckDigit(base);
  return base + check;
}

function generateUniqueEAN13() {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateEAN13();
    if (!cards.some(c => c.barcode === code)) return code;
    attempt++;
  }
  return generateEAN13();
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

function openBarcodeModal(card) {
  const modal = document.getElementById('barcode-modal');
  const canvas = document.getElementById('barcode-canvas');
  const codeSpan = document.getElementById('barcode-modal-code');
  if (!modal || !canvas || !codeSpan) return;

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

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeBarcodeModal();
    }
  });

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
function createRouteOpFromRefs(op, center, executor, plannedMinutes, order) {
  return {
    id: genId('rop'),
    opId: op.id,
    opCode: op.code || op.opCode || generateUniqueOpCode(collectUsedOpCodes()),
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
    order: order || 1,
    comment: ''
  };
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

function statusBadge(status) {
  if (status === 'IN_PROGRESS') return '<span class="badge status-in-progress">В работе</span>';
  if (status === 'PAUSED') return '<span class="badge status-paused">Пауза</span>';
  if (status === 'DONE') return '<span class="badge status-done">Завершена</span>';
  return '<span class="badge status-not-started">Не начата</span>';
}

function cardStatusText(card) {
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

function getCardProcessState(card) {
  const opsArr = card.operations || [];
  const hasInProgress = opsArr.some(o => o.status === 'IN_PROGRESS');
  const hasPaused = opsArr.some(o => o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const allNotStarted = opsArr.length > 0 && opsArr.every(o => o.status === 'NOT_STARTED' || !o.status);
  const hasAnyDone = opsArr.some(o => o.status === 'DONE');

  if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
  if (hasInProgress && hasPaused) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
  if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (allNotStarted) return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  if (hasAnyDone) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
}

function renderCardStateBadge(card) {
  const state = getCardProcessState(card);
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

    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, ops, centers })
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
        orderNo: 'DEMO-001',
        desc: 'Демонстрационная карта для примера.',
        status: 'NOT_STARTED',
        archived: false,
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
    const res = await fetch(API_ENDPOINT);
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    cards = Array.isArray(payload.cards) ? payload.cards : [];
    ops = Array.isArray(payload.ops) ? payload.ops : [];
    centers = Array.isArray(payload.centers) ? payload.centers : [];
    apiOnline = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
  }

  ensureDefaults();
  ensureOperationCodes();

  cards.forEach(c => {
    if (!c.barcode || !/^\d{13}$/.test(c.barcode)) {
      c.barcode = generateUniqueEAN13();
    }
    c.archived = Boolean(c.archived);
    c.operations = c.operations || [];
    c.operations.forEach(op => {
      if (typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = 0;
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
  const activeCards = cards.filter(c => !c.archived);
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
  const eligibleCards = activeCards.filter(card => card.status !== 'DONE' && (card.operations || []).some(o => o.status && o.status !== 'NOT_STARTED'));
  if (!eligibleCards.length) {
    dashTableWrapper.innerHTML = '<p>Ещё нет незавершённых карт с выполненными операциями.</p>';
    return;
  }

  const limited = eligibleCards.slice(0, 5);
  let html = '<table><thead><tr><th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус / операции</th><th>Выполнено операций</th><th>Комментарии</th></tr></thead><tbody>';

  limited.forEach(card => {
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
        statusHtml += '<span class="' + cls + '">' +
          renderOpLabel(op) + ' — ' + formatSecondsToHMS(elapsed) +
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

    const completedCount = opsArr.filter(o => o.status === 'DONE').length;
    const commentLines = opsForDisplay
      .filter(o => o.comment)
      .map(o => '<div class="dash-comment-line"><span class="dash-comment-op">' + renderOpLabel(o) + ':</span> ' + escapeHtml(o.comment) + '</div>');
    const commentCell = commentLines.join('');

    html += '<tr>' +
      '<td>' + escapeHtml(card.barcode || '') + '</td>' +
      '<td>' + escapeHtml(card.name) + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
      '<td>' + completedCount + ' из ' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td>' + commentCell + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  dashTableWrapper.innerHTML = html;
}

// === РЕНДЕРИНГ ТЕХ.КАРТ ===
function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  const visibleCards = cards.filter(c => !c.archived);
  if (!visibleCards.length) {
    wrapper.innerHTML = '<p>Список технологических карт пуст. Нажмите «Создать карту».</p>';
    return;
  }

  const termRaw = cardsSearchTerm.trim();
  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }
  const filteredCards = termRaw
    ? sortedCards.filter(card => cardSearchScore(card, termRaw) > 0)
    : sortedCards;

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '<table><thead><tr>' +
    '<th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус</th><th>Операций</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  filteredCards.forEach(card => {
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(card.barcode || '') + '</button></td>' +
      '<td>' + escapeHtml(card.name) + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td>' + cardStatusText(card) + '</td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
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

  wrapper.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      cards = cards.filter(c => c.id !== id);
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
}

function duplicateCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const copy = cloneCard(card);
  copy.id = genId('card');
  copy.barcode = generateUniqueEAN13();
  copy.name = (card.name || '') + ' (копия)';
  copy.status = 'NOT_STARTED';
  copy.archived = false;
  copy.operations = (copy.operations || []).map((op, idx) => ({
    ...op,
    id: genId('rop'),
    status: 'NOT_STARTED',
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: null,
    comment: '',
    order: typeof op.order === 'number' ? op.order : idx + 1
  }));
  recalcCardStatus(copy);
  cards.push(copy);
  saveData();
  renderEverything();
}

function createEmptyCardDraft() {
  return {
    id: genId('card'),
    barcode: generateUniqueEAN13(),
    name: 'Новая карта',
    orderNo: '',
    desc: '',
    status: 'NOT_STARTED',
    archived: false,
    operations: []
  };
}

function openCardModal(cardId) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
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
  document.getElementById('card-modal-title').textContent = activeCardIsNew ? 'Создание карты' : 'Редактирование карты';
  document.getElementById('card-id').value = activeCardDraft.id;
  document.getElementById('card-name').value = activeCardDraft.name || '';
  document.getElementById('card-order').value = activeCardDraft.orderNo || '';
  document.getElementById('card-desc').value = activeCardDraft.desc || '';
  document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
  routeOpCodeFilter = '';
  const routeFilterInput = document.getElementById('route-op-code-filter');
  if (routeFilterInput) {
    routeFilterInput.value = '';
  }
  renderRouteTableDraft();
  fillRouteSelectors();
  modal.classList.remove('hidden');
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
}

function saveCardDraft() {
  if (!activeCardDraft) return;
  const draft = cloneCard(activeCardDraft);
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1
  }));
  recalcCardStatus(draft);
  if (activeCardIsNew || activeCardOriginalId == null) {
    cards.push(draft);
  } else {
    const idx = cards.findIndex(c => c.id === activeCardOriginalId);
    if (idx >= 0) {
      cards[idx] = draft;
    }
  }
  saveData();
  renderEverything();
  closeCardModal();
}

// === МАРШРУТ КАРТЫ (ЧЕРЕЗ МОДАЛЬНОЕ ОКНО) ===
function renderRouteTableDraft() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper || !activeCardDraft) return;
  const opsArr = activeCardDraft.operations || [];
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td>' + escapeHtml(o.opCode || '') + '</td>' +
      '<td>' + renderOpName(o) + '</td>' +
      '<td><input class="executor-input" data-rop-id="' + o.id + '" value="' + escapeHtml(o.executor || '') + '" placeholder="ФИО" /></td>' +
      '<td>' + (o.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(o.status) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="move-up">↑</button>' +
      '<button class="btn-small" data-action="move-down">↓</button>' +
      '<button class="btn-small btn-danger" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';
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
        } else if (action === 'move-up' || action === 'move-down') {
          moveRouteOpInDraft(ropId, action === 'move-up' ? -1 : 1);
        }
        document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  });

  wrapper.querySelectorAll('.executor-input').forEach(input => {
    input.addEventListener('input', e => {
      const ropId = input.getAttribute('data-rop-id');
      const value = (e.target.value || '').trim();
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      op.executor = value;
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    });
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
}

function fillRouteSelectors() {
  const opSelect = document.getElementById('route-op');
  const centerSelect = document.getElementById('route-center');
  opSelect.innerHTML = '';
  centerSelect.innerHTML = '';
  const current = opSelect.value;
  const filter = (routeOpCodeFilter || '').toLowerCase();
  const filteredOps = filter
    ? ops.filter(o => (o.code || '').toLowerCase().includes(filter))
    : ops;
  filteredOps.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = formatOpLabel(o);
    opSelect.appendChild(opt);
  });
  if (current) {
    opSelect.value = current;
  }
  centers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    centerSelect.appendChild(opt);
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
  let html = '<table><thead><tr><th>Код операции</th><th>Название</th><th>Описание</th><th>Рек. время (мин)</th><th>Действия</th></tr></thead><tbody>';
  ops.forEach(o => {
    html += '<tr>' +
      '<td>' + escapeHtml(o.code || '') + '</td>' +
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
  return score;
}

function buildOperationsTable(card, { readonly = false } = {}) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Участок</th><th>Код операции</th><th>Операция</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Текущее / факт. время</th>' +
    (readonly ? '' : '<th>Действия</th>') +
    '<th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
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
    if (!readonly) {
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

    html += '<tr data-row-id="' + rowId + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      '<td>' + escapeHtml(op.executor || '') + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + timeCell + '</td>' +
      (readonly ? '' : '<td><div class="table-actions">' + actionsHtml + '</div></td>') +
      '<td>' + commentCell + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function renderWorkordersTable({ collapseAll = false } = {}) {
  const wrapper = document.getElementById('workorders-table-wrapper');
  const cardsWithOps = cards.filter(c => !c.archived && c.operations && c.operations.length);
  if (!cardsWithOps.length) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  if (collapseAll) {
    workorderOpenCards.clear();
  }

  const termRaw = workorderSearchTerm.trim();
  const filteredByStatus = cardsWithOps.filter(card => {
    const state = getCardProcessState(card);
    return workorderStatusFilter === 'ALL' || state.key === workorderStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
    return;
  }

  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => cardSearchScore(card, termRaw) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    const opened = !collapseAll && workorderOpenCards.has(card.id);
    const stateBadge = renderCardStateBadge(card);
    const canArchive = card.status === 'DONE';
    const barcodeInline = card.barcode
      ? ' • № карты: <span class="summary-barcode">' + escapeHtml(card.barcode) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button></span>'
      : '';

    html += '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
      '<summary>' +
      '<div class="summary-line">' +
      '<div class="summary-text">' +
      '<strong>' + escapeHtml(card.name || card.id) + '</strong>' +
      ' <span class="summary-sub">' +
      (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') +
      barcodeInline +
      '</span>' +
      '</div>' +
      '<div class="summary-actions">' +
      ' ' + stateBadge +
      (canArchive ? ' <button type="button" class="btn-small btn-secondary archive-move-btn" data-card-id="' + card.id + '">Перенести в архив</button>' : '') +
      '</div>' +
      '</div>' +
      '</summary>';

    html += buildOperationsTable(card, { readonly: false });
    html += '</details>';
  });

  wrapper.innerHTML = html;

  wrapper.querySelectorAll('.wo-card').forEach(detail => {
    const cardId = detail.getAttribute('data-card-id');
    if (detail.open && cardId) {
      workorderOpenCards.add(cardId);
    }
    detail.addEventListener('toggle', () => {
      if (!cardId) return;
      if (detail.open) {
        workorderOpenCards.add(cardId);
      } else {
        workorderOpenCards.delete(cardId);
      }
    });
  });

  wrapper.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('.archive-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      card.archived = true;
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.comment-input').forEach(input => {
    autoResizeComment(input);
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      op.comment = value;
      saveData();
      renderDashboard();
      autoResizeComment(e.target);
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

      if (action === 'start') {
        op.status = 'IN_PROGRESS';
        op.startedAt = Date.now();
        op.finishedAt = null;
        op.actualSeconds = null;
        op.elapsedSeconds = 0;
      } else if (action === 'pause') {
        if (op.status === 'IN_PROGRESS') {
          const now = Date.now();
          const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
          op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
          op.startedAt = null;
          op.status = 'PAUSED';
        }
      } else if (action === 'resume') {
        const now = Date.now();
        if (op.status === 'DONE' && typeof op.elapsedSeconds !== 'number') {
          op.elapsedSeconds = op.actualSeconds || 0;
        }
        op.status = 'IN_PROGRESS';
        op.startedAt = now;
        op.finishedAt = null;
      } else if (action === 'stop') {
        const now = Date.now();
        if (op.status === 'IN_PROGRESS') {
          const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
          op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
        }
        op.startedAt = null;
        op.finishedAt = now;
        op.actualSeconds = op.elapsedSeconds || 0;
        op.status = 'DONE';
      }

      recalcCardStatus(card);
      saveData();
      renderEverything();
    });
  });
}

function renderArchiveTable() {
  const wrapper = document.getElementById('archive-table-wrapper');
  const archivedCards = cards.filter(c => c.archived && c.operations && c.operations.length);
  if (!archivedCards.length) {
    wrapper.innerHTML = '<p>В архиве пока нет карт.</p>';
    return;
  }

  const termRaw = archiveSearchTerm.trim();
  const filteredByStatus = archivedCards.filter(card => {
    const state = getCardProcessState(card);
    return archiveStatusFilter === 'ALL' || state.key === archiveStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
    return;
  }

  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => cardSearchScore(card, termRaw) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Архивные карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    const stateBadge = renderCardStateBadge(card);
    const barcodeInline = card.barcode
      ? ' • № карты: <span class="summary-barcode">' + escapeHtml(card.barcode) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button></span>'
      : '';

    html += '<details class="wo-card">' +
      '<summary>' +
      '<div class="summary-line">' +
      '<div class="summary-text">' +
      '<strong>' + escapeHtml(card.name || card.id) + '</strong>' +
      ' <span class="summary-sub">' +
      (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') +
      barcodeInline +
      '</span>' +
      '</div>' +
      '<div class="summary-actions">' +
      ' ' + stateBadge +
      ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-card-id="' + card.id + '">Повторить</button>' +
      '</div>' +
      '</div>' +
      '</summary>';

    html += buildOperationsTable(card, { readonly: true });
    html += '</details>';
  });

  wrapper.innerHTML = html;

  wrapper.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('.repeat-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
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
        operations: cloneOps
      };
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

  renderDashboard();
}

// === НАВИГАЦИЯ ===
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (!target) return;

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
      }
    });
  });
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

  const saveBtn = document.getElementById('card-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      activeCardDraft.name = document.getElementById('card-name').value.trim();
      activeCardDraft.orderNo = document.getElementById('card-order').value.trim();
      activeCardDraft.desc = document.getElementById('card-desc').value.trim();
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
      saveCardDraft();
    });
  }

  const cancelBtn = document.getElementById('card-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeCardModal();
    });
  }

  document.getElementById('route-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!activeCardDraft) return;
    const opId = document.getElementById('route-op').value;
    const centerId = document.getElementById('route-center').value;
    const executor = document.getElementById('route-executor').value.trim();
    const planned = parseInt(document.getElementById('route-planned').value, 10) || 30;
    const opRef = ops.find(o => o.id === opId);
    const centerRef = centers.find(c => c.id === centerId);
    if (!opRef || !centerRef) return;
    const maxOrder = activeCardDraft.operations && activeCardDraft.operations.length
      ? Math.max.apply(null, activeCardDraft.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, executor, planned, maxOrder + 1);
    activeCardDraft.operations = activeCardDraft.operations || [];
    activeCardDraft.operations.push(rop);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    renderRouteTableDraft();
    document.getElementById('route-form').reset();
    fillRouteSelectors();
  });

  const routeOpCodeInput = document.getElementById('route-op-code-filter');
  if (routeOpCodeInput) {
    routeOpCodeInput.addEventListener('input', e => {
      routeOpCodeFilter = (e.target.value || '').trim();
      fillRouteSelectors();
    });
  }

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
        const codeInput = document.getElementById('op-code').value.trim();
        const name = document.getElementById('op-name').value.trim();
        const desc = document.getElementById('op-desc').value.trim();
        const time = parseInt(document.getElementById('op-time').value, 10) || 30;
        if (!name) return;
        const used = collectUsedOpCodes();
        let code = codeInput;
        if (code && used.has(code)) {
          alert('Такой код операции уже используется. Введите другой код.');
          return;
        }
        if (!code) {
          code = generateUniqueOpCode(used);
        }
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

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  const statusSelect = document.getElementById('workorder-status');
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
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', e => {
      workorderStatusFilter = e.target.value || 'ALL';
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
}

// === ОБЩИЙ РЕНДЕР ===
function renderEverything() {
  renderDashboard();
  renderCardsTable();
  renderCentersTable();
  renderOpsTable();
  fillRouteSelectors();
  renderWorkordersTable();
  renderArchiveTable();
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupNavigation();
  setupForms();
  setupBarcodeModal();
  renderEverything();
  setInterval(tickTimers, 1000);
});
