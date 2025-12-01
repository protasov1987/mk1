(function() {
  const state = {
    container: null,
    tableArea: null,
    dotsContainer: null,
    measureBox: null,
    pages: [],
    rowsHtml: [],
    headerHtml: '',
    timerId: null,
    rotationDelay: 7000,
    paused: false,
    currentPage: 0,
    lastAvailableHeight: null,
    lastKnownWidth: null,
    emptyMessage: ''
  };

  function ensureContainer() {
    if (state.container && state.tableArea && state.dotsContainer) return true;
    const container = document.getElementById('dashboard-cards');
    if (!container) return false;

    container.classList.add('dashboard-pager-container');
    container.innerHTML = '';

    const tableArea = document.createElement('div');
    tableArea.className = 'dashboard-pages';

    const dots = document.createElement('div');
    dots.className = 'dashboard-dots';

    container.appendChild(tableArea);
    container.appendChild(dots);

    state.container = container;
    state.tableArea = tableArea;
    state.dotsContainer = dots;
    return true;
  }

  function getAvailableHeight() {
    if (!state.container) return state.lastAvailableHeight;
    const rect = state.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const dotsHeight = state.dotsContainer ? state.dotsContainer.offsetHeight || 24 : 24;
    const padding = 24;
    const available = viewportHeight - rect.top - dotsHeight - padding;
    if (available > 0) {
      state.lastAvailableHeight = available;
      return available;
    }
    return state.lastAvailableHeight;
  }

  function getMeasureBox() {
    if (!state.measureBox) {
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.visibility = 'hidden';
      box.style.pointerEvents = 'none';
      box.style.left = '-9999px';
      box.style.top = '-9999px';
      document.body.appendChild(box);
      state.measureBox = box;
    }
    return state.measureBox;
  }

  function getMeasureWidth() {
    if (state.container && state.container.clientWidth) {
      state.lastKnownWidth = state.container.clientWidth;
      return state.container.clientWidth;
    }
    return state.lastKnownWidth || 960;
  }

  function measureHeightForRows(rows) {
    const box = getMeasureBox();
    const width = getMeasureWidth();
    box.style.width = width + 'px';
    box.innerHTML = '<table>' + state.headerHtml + '<tbody>' + rows.join('') + '</tbody></table>';
    return box.getBoundingClientRect().height;
  }

  function paginateRows(rows) {
    if (!rows.length) return [];
    const availableHeight = getAvailableHeight();
    if (!availableHeight) return [rows.slice()];

    const pages = [];
    let current = [];

    rows.forEach(row => {
      current.push(row);
      const height = measureHeightForRows(current);
      if (height > availableHeight && current.length > 1) {
        const last = current.pop();
        pages.push(current.slice());
        current = [last];
      }
    });

    if (current.length) {
      pages.push(current.slice());
    }

    return pages;
  }

  function buildTableHtml(rows) {
    return '<table>' + state.headerHtml + '<tbody>' + rows.join('') + '</tbody></table>';
  }

  function stopRotation() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function restartRotation() {
    stopRotation();
    if (state.paused || state.pages.length <= 1) return;
    state.timerId = setInterval(() => {
      showPage((state.currentPage + 1) % state.pages.length);
    }, state.rotationDelay);
  }

  function updateDots() {
    const dots = state.dotsContainer ? Array.from(state.dotsContainer.children) : [];
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === state.currentPage);
      dot.textContent = idx === state.currentPage ? '●' : '○';
    });
  }

  function showPage(index, immediate = false) {
    if (!state.tableArea || !state.pages.length) return;
    const pages = Array.from(state.tableArea.children);
    const targetIndex = Math.max(0, Math.min(index, pages.length - 1));
    state.currentPage = targetIndex;

    pages.forEach((page, idx) => {
      const isActive = idx === targetIndex;
      page.classList.toggle('active', isActive);
      page.classList.toggle('hidden', !isActive);
      if (isActive) {
        if (!immediate) {
          page.classList.add('fade-in');
          setTimeout(() => page.classList.remove('fade-in'), 400);
        }
      }
    });

    updateDots();
    restartRotation();
  }

  function handleDotPointerDown() {
    state.paused = true;
    stopRotation();
  }

  function handleDotPointerUp() {
    state.paused = false;
    restartRotation();
  }

  function buildDots() {
    if (!state.dotsContainer) return;
    state.dotsContainer.innerHTML = '';
    const total = Math.max(state.pages.length, state.rowsHtml.length ? 1 : 0);

    for (let i = 0; i < total; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dashboard-dot';
      btn.textContent = i === state.currentPage ? '●' : '○';
      btn.setAttribute('aria-label', 'Страница ' + (i + 1));
      btn.addEventListener('pointerdown', handleDotPointerDown);
      btn.addEventListener('pointerup', handleDotPointerUp);
      btn.addEventListener('pointerleave', handleDotPointerUp);
      btn.addEventListener('pointercancel', handleDotPointerUp);
      btn.addEventListener('click', () => {
        showPage(i, true);
      });
      state.dotsContainer.appendChild(btn);
    }

    updateDots();
  }

  function renderPages() {
    if (!state.tableArea) return;
    state.tableArea.innerHTML = '';

    if (!state.pages.length) {
      state.tableArea.innerHTML = state.emptyMessage || '';
      buildDots();
      stopRotation();
      return;
    }

    state.pages.forEach(rows => {
      const pageEl = document.createElement('div');
      pageEl.className = 'dashboard-page hidden';
      pageEl.innerHTML = buildTableHtml(rows);
      state.tableArea.appendChild(pageEl);
    });

    const targetPage = Math.min(state.currentPage, state.pages.length - 1);
    showPage(targetPage, true);
    buildDots();
    restartRotation();
  }

  function updatePages() {
    if (!ensureContainer()) return;

    const availableHeight = getAvailableHeight();
    if (availableHeight) {
      state.tableArea.style.maxHeight = availableHeight + 'px';
      state.tableArea.style.minHeight = availableHeight + 'px';
    } else {
      state.tableArea.style.maxHeight = '';
      state.tableArea.style.minHeight = '';
    }

    state.pages = paginateRows(state.rowsHtml);
    if (!state.pages.length) {
      state.currentPage = 0;
    } else {
      state.currentPage = Math.min(state.currentPage, state.pages.length - 1);
    }

    renderPages();
  }

  function render(payload) {
    if (!payload) return;
    state.headerHtml = payload.headerHtml || '';
    state.rowsHtml = Array.isArray(payload.rowsHtml) ? payload.rowsHtml : [];
    state.emptyMessage = payload.emptyMessage || '';
    updatePages();
  }

  window.dashboardPager = {
    render,
    updatePages,
    stopRotation
  };

  window.addEventListener('resize', () => {
    window.dashboardPager.updatePages();
  });
})();
