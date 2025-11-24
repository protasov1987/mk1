// === КОНСТАНТЫ И ГЛОБАЛЬНЫЕ МАССИВЫ ===
const API_ENDPOINT = '/api/data';

let cards = [];
let ops = [];
let centers = [];
let workorderSearchTerm = '';

// === УТИЛИТЫ ===
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
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
    return inProgress.opName + ' (' + formatSecondsToHMS(sec) + ')';
  }

  const paused = opsArr.find(o => o.status === 'PAUSED');
  if (paused) {
    const sec = getOperationElapsedSeconds(paused);
    return paused.opName + ' (пауза ' + formatSecondsToHMS(sec) + ')';
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
    return next.opName + ' (ожидание)';
  }

  return 'Не запущена';
}

// === ХРАНИЛИЩЕ ===
async function saveData() {
  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, ops, centers })
    });
  } catch (err) {
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
    ops = [
      { id: genId('op'), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40 },
      { id: genId('op'), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60 },
      { id: genId('op'), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20 }
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
  } catch (err) {
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    cards = [];
    ops = [];
    centers = [];
  }

  ensureDefaults();

  cards.forEach(c => {
    if (!c.barcode || !/^\d{13}$/.test(c.barcode)) {
      c.barcode = generateUniqueEAN13();
    }
    c.operations = c.operations || [];
    c.operations.forEach(op => {
      if (typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = 0;
      }
      if (op.status === 'DONE' && op.actualSeconds != null && !op.elapsedSeconds) {
        op.elapsedSeconds = op.actualSeconds;
      }
    });
    recalcCardStatus(c);
  });

  await saveData();
}

// === РЕНДЕРИНГ ДАШБОРДА ===
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const cardsCount = cards.length;
  const inWork = cards.filter(c => c.status === 'IN_PROGRESS').length;
  const done = cards.filter(c => c.status === 'DONE').length;
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
  if (!cards.length) {
    dashTableWrapper.innerHTML = '<p>Ещё нет ни одной технологической карты.</p>';
    return;
  }

  const limited = cards.slice(0, 5);
  let html = '<table><thead><tr><th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус / операции</th><th>Операций</th></tr></thead><tbody>';

  limited.forEach(card => {
    const opsArr = card.operations || [];
    const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
    let statusHtml = '';

    if (card.status === 'DONE') {
      statusHtml = '<span class="dash-card-completed">Завершена</span>';
    } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
      statusHtml = 'Не запущена';
    } else if (activeOps.length) {
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
          escapeHtml(op.opName) + ' — ' + formatSecondsToHMS(elapsed) +
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
        statusHtml = escapeHtml(next.opName) + ' (ожидание)';
      } else {
        statusHtml = 'Не запущена';
      }
    }

    html += '<tr>' +
      '<td>' + escapeHtml(card.barcode || '') + '</td>' +
      '<td>' + escapeHtml(card.name) + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  dashTableWrapper.innerHTML = html;
}

// === РЕНДЕРИНГ ТЕХ.КАРТ ===
function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  if (!cards.length) {
    wrapper.innerHTML = '<p>Список технологических карт пуст. Нажмите «Создать карту».</p>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>№ карты (EAN-13)</th><th>Наименование</th><th>Заказ</th><th>Статус</th><th>Операций</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  cards.forEach(card => {
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(card.barcode || '') + '</button></td>' +
      '<td>' + escapeHtml(card.name) + '</td>' +
      '<td>' + escapeHtml(card.orderNo || '') + '</td>' +
      '<td>' + cardStatusText(card) + '</td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + card.id + '">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openCardEditor(btn.getAttribute('data-id'));
    });
  });

  wrapper.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const currentIdInput = document.getElementById('card-id');
      if (currentIdInput && currentIdInput.value === id) {
        closeCardEditor();
      }
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

function openCardEditor(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const editor = document.getElementById('card-editor');
  editor.style.display = 'block';
  document.getElementById('route-editor').style.display = 'block';

  document.getElementById('card-id').value = card.id;
  document.getElementById('card-name').value = card.name || '';
  document.getElementById('card-order').value = card.orderNo || '';
  document.getElementById('card-desc').value = card.desc || '';
  document.getElementById('card-status-text').textContent = cardStatusText(card);

  renderRouteTable(card);
  fillRouteSelectors();
}

function closeCardEditor() {
  document.getElementById('card-editor').style.display = 'none';
  document.getElementById('route-editor').style.display = 'none';
  document.getElementById('card-form').reset();
  document.getElementById('route-form').reset();
}

// === МАРШРУТ КАРТЫ ===
function renderRouteTable(card) {
  const wrapper = document.getElementById('route-table-wrapper');
  const opsArr = card.operations || [];
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Операция</th><th>Участок</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.opName) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td>' + escapeHtml(o.executor || '') + '</td>' +
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
        if (action === 'delete') {
          card.operations = card.operations.filter(o => o.id !== ropId);
        } else if (action === 'move-up' || action === 'move-down') {
          moveRouteOp(card, ropId, action === 'move-up' ? -1 : 1);
        }
        recalcCardStatus(card);
        saveData();
        renderRouteTable(card);
        renderDashboard();
        renderCardsTable();
        renderWorkordersTable();
      });
    });
  });
}

function moveRouteOp(card, ropId, delta) {
  const opsArr = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = opsArr.findIndex(o => o.id === ropId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= opsArr.length) return;
  const tmpOrder = opsArr[idx].order;
  opsArr[idx].order = opsArr[newIdx].order;
  opsArr[newIdx].order = tmpOrder;
  card.operations = opsArr;
}

function fillRouteSelectors() {
  const opSelect = document.getElementById('route-op');
  const centerSelect = document.getElementById('route-center');
  opSelect.innerHTML = '';
  centerSelect.innerHTML = '';
  ops.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    opSelect.appendChild(opt);
  });
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
  return score;
}

function renderWorkordersTable() {
  const wrapper = document.getElementById('workorders-table-wrapper');
  const cardsWithOps = cards.filter(c => c.operations && c.operations.length);
  if (!cardsWithOps.length) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  const term = workorderSearchTerm.trim();
  let sortedCards = [...cardsWithOps];
  if (term) {
    sortedCards.sort((a, b) => cardSearchScore(b, term) - cardSearchScore(a, term));
  }

  let html = '';
  sortedCards.forEach((card, idx) => {
    const opened = !term || idx === 0;
    html += '<details class="wo-card"' + (opened ? ' open' : '') + '>' +
      '<summary>' +
      '<strong>' + escapeHtml(card.name || card.id) + '</strong>' +
      ' <span style="color:#6b7280; font-size:12px;">' +
      (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') +
      (card.barcode ? ' • № карты: ' + escapeHtml(card.barcode) : '') +
      '</span>' +
      (card.barcode ? ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button>' : '') +
      '</summary>';

    html += '<table><thead><tr>' +
      '<th>Операция</th><th>Участок</th><th>Исполнитель</th><th>Статус</th><th>План (мин)</th><th>Текущее / факт. время</th><th>Действия</th>' +
      '</tr></thead><tbody>';

    card.operations.forEach(op => {
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

      html += '<tr data-row-id="' + rowId + '">' +
        '<td>' + escapeHtml(op.opName) + '</td>' +
        '<td>' + escapeHtml(op.centerName) + '</td>' +
        '<td>' + escapeHtml(op.executor || '') + '</td>' +
        '<td>' + statusBadge(op.status) + '</td>' +
        '<td>' + (op.plannedMinutes || '') + '</td>' +
        '<td>' + timeCell + '</td>' +
        '<td><div class="table-actions">' + actionsHtml + '</div></td>' +
        '</tr>';
    });

    html += '</tbody></table></details>';
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

  wrapper.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const op = (card.operations || []).find(o => o.id === opId);
      if (!op) return;

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
    });
  });
}

// === ФОРМЫ ===
function setupForms() {
  document.getElementById('btn-new-card').addEventListener('click', () => {
    const newCard = {
      id: genId('card'),
      barcode: generateUniqueEAN13(),
      name: 'Новая карта',
      orderNo: '',
      desc: '',
      status: 'NOT_STARTED',
      operations: []
    };
    cards.push(newCard);
    saveData();
    renderCardsTable();
    openCardEditor(newCard.id);
  });

  document.getElementById('btn-close-card').addEventListener('click', closeCardEditor);

  document.getElementById('card-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('card-id').value;
    const card = cards.find(c => c.id === id);
    if (!card) return;
    card.name = document.getElementById('card-name').value.trim();
    card.orderNo = document.getElementById('card-order').value.trim();
    card.desc = document.getElementById('card-desc').value.trim();
    recalcCardStatus(card);
    saveData();
    renderDashboard();
    renderCardsTable();
    document.getElementById('card-status-text').textContent = cardStatusText(card);
    alert('Карта сохранена');
  });

  document.getElementById('route-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('card-id').value;
    const card = cards.find(c => c.id === id);
    if (!card) return;
    const opId = document.getElementById('route-op').value;
    const centerId = document.getElementById('route-center').value;
    const executor = document.getElementById('route-executor').value.trim();
    const planned = parseInt(document.getElementById('route-planned').value, 10) || 30;
    const opRef = ops.find(o => o.id === opId);
    const centerRef = centers.find(c => c.id === centerId);
    if (!opRef || !centerRef) return;
    const maxOrder = card.operations && card.operations.length
      ? Math.max.apply(null, card.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, executor, planned, maxOrder + 1);
    card.operations = card.operations || [];
    card.operations.push(rop);
    recalcCardStatus(card);
    saveData();
    renderRouteTable(card);
    renderDashboard();
    renderCardsTable();
    renderWorkordersTable();
    document.getElementById('route-form').reset();
    fillRouteSelectors();
  });

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
    ops.push({ id: genId('op'), name: name, desc: desc, recTime: time });
    saveData();
    renderOpsTable();
    fillRouteSelectors();
    e.target.reset();
  });

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      workorderSearchTerm = e.target.value || '';
      renderWorkordersTable();
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      workorderSearchTerm = '';
      if (searchInput) searchInput.value = '';
      renderWorkordersTable();
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
