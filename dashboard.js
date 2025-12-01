const DASH_ROTATION_MS = 7000;
const DASH_MIN_CARD_WIDTH = 320;
const DASH_MIN_CARD_HEIGHT = 240;
const DASH_GRID_GAP = 12;

let dashboardPages = [];
let dashboardCurrentPage = 0;
let dashboardLatestCards = [];
let dashboardRotationTimer = null;
let dashboardGridConfig = { cols: 1, rows: 1 };

function ensureDashboardContainers() {
  const wrapper = document.getElementById('dashboard-cards');
  if (!wrapper) return {};

  let container = wrapper.querySelector('.dashboard-cards-container');
  let grid = wrapper.querySelector('.dashboard-grid');
  let dots = wrapper.querySelector('.dashboard-dots');

  if (!container || !grid || !dots) {
    wrapper.innerHTML = '';
    container = document.createElement('div');
    container.className = 'dashboard-cards-container';

    grid = document.createElement('div');
    grid.className = 'dashboard-grid';
    grid.id = 'dashboard-grid';

    dots = document.createElement('div');
    dots.className = 'dashboard-dots';
    dots.id = 'dashboard-dots';

    container.appendChild(grid);
    container.appendChild(dots);
    wrapper.appendChild(container);
  }

  return { container, grid, dots };
}

function resetDashboardRotation() {
  dashboardPages = [];
  dashboardLatestCards = [];
  dashboardCurrentPage = 0;
  stopDashboardRotation();
  const { grid, dots } = ensureDashboardContainers();
  if (grid) grid.innerHTML = '';
  if (dots) dots.innerHTML = '';
}

function stopDashboardRotation() {
  if (dashboardRotationTimer) {
    clearInterval(dashboardRotationTimer);
    dashboardRotationTimer = null;
  }
}

function startDashboardRotation() {
  stopDashboardRotation();
  if (dashboardPages.length < 2) return;
  dashboardRotationTimer = setInterval(() => {
    switchDashboardPage(dashboardCurrentPage + 1);
  }, DASH_ROTATION_MS);
}

function calculateDashboardGrid(grid) {
  const width = grid?.clientWidth || 0;
  const height = grid?.clientHeight || 0;
  const cols = Math.max(1, Math.floor((width + DASH_GRID_GAP) / (DASH_MIN_CARD_WIDTH + DASH_GRID_GAP)) || 1);
  const rows = Math.max(1, Math.floor((height + DASH_GRID_GAP) / (DASH_MIN_CARD_HEIGHT + DASH_GRID_GAP)) || 1);
  return { cols, rows };
}

function chunkDashboardCards(cards, grid) {
  dashboardGridConfig = calculateDashboardGrid(grid);
  const pageSize = Math.max(1, dashboardGridConfig.cols * dashboardGridConfig.rows);
  const pages = [];
  for (let i = 0; i < cards.length; i += pageSize) {
    pages.push(cards.slice(i, i + pageSize));
  }
  return pages;
}

function renderDashboardPages(cards) {
  dashboardLatestCards = Array.isArray(cards) ? cards.slice() : [];
  const containers = ensureDashboardContainers();
  if (!containers.grid) return;

  dashboardPages = chunkDashboardCards(dashboardLatestCards, containers.grid);
  if (dashboardCurrentPage >= dashboardPages.length) {
    dashboardCurrentPage = 0;
  }
  renderDashboardGrid(containers);
  renderDashboardDots(containers.dots);
  startDashboardRotation();
}

function renderDashboardGrid(containers) {
  const grid = containers?.grid;
  if (!grid) return;
  grid.style.setProperty('--dashboard-cols', dashboardGridConfig.cols);
  grid.classList.add('dashboard-grid-fade');

  const page = dashboardPages[dashboardCurrentPage] || [];
  setTimeout(() => {
    grid.innerHTML = '';
    page.forEach(card => {
      const cardEl = document.createElement('article');
      cardEl.className = 'dashboard-card';
      cardEl.innerHTML = `
        <div class="dash-card-meta">
          <span class="dash-card-barcode">${card.barcode}</span>
          <span class="dash-card-order">${card.orderNo || '—'}</span>
        </div>
        <div class="dash-card-name">${card.nameHtml}</div>
        <div class="dashboard-card-status" data-card-id="${card.id}">${card.statusHtml}</div>
        <div class="dash-card-progress">
          <div class="dash-card-qty">${card.qtyHtml || '—'}</div>
          <div class="dash-card-ops">${card.progressText}</div>
        </div>
        <div class="dash-card-comments">${card.commentsHtml || '—'}</div>
      `;
      grid.appendChild(cardEl);
    });
    requestAnimationFrame(() => {
      grid.classList.remove('dashboard-grid-fade');
    });
  }, 80);
}

function renderDashboardDots(dotsContainer) {
  if (!dotsContainer) return;
  dotsContainer.innerHTML = '';
  dashboardPages.forEach((_, idx) => {
    const btn = document.createElement('button');
    const isActive = idx === dashboardCurrentPage;
    btn.className = 'dashboard-dot' + (isActive ? ' active' : '');
    btn.type = 'button';
    btn.textContent = isActive ? '●' : '○';
    btn.setAttribute('aria-label', 'Страница ' + (idx + 1));

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      stopDashboardRotation();
      switchDashboardPage(idx, false);
    });
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      stopDashboardRotation();
      switchDashboardPage(idx, false);
    });
    const resume = () => startDashboardRotation();
    btn.addEventListener('mouseup', resume);
    btn.addEventListener('mouseleave', resume);
    btn.addEventListener('touchend', resume);
    btn.addEventListener('touchcancel', resume);

    dotsContainer.appendChild(btn);
  });
}

function switchDashboardPage(targetIndex, restartRotation = true) {
  if (!dashboardPages.length) return;
  const maxIndex = dashboardPages.length - 1;
  if (targetIndex > maxIndex) targetIndex = 0;
  if (targetIndex < 0) targetIndex = maxIndex;
  dashboardCurrentPage = targetIndex;
  const containers = ensureDashboardContainers();
  renderDashboardGrid(containers);
  renderDashboardDots(containers.dots);
  if (restartRotation) {
    startDashboardRotation();
  }
}

function debouncedResizeHandler() {
  let resizeTimer;
  return () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!dashboardLatestCards.length) return;
      const containers = ensureDashboardContainers();
      dashboardPages = chunkDashboardCards(dashboardLatestCards, containers.grid);
      if (dashboardCurrentPage >= dashboardPages.length) {
        dashboardCurrentPage = 0;
      }
      renderDashboardGrid(containers);
      renderDashboardDots(containers.dots);
      startDashboardRotation();
    }, 200);
  };
}

window.addEventListener('resize', debouncedResizeHandler());

// Expose helpers for app.js
window.renderDashboardPages = renderDashboardPages;
window.resetDashboardRotation = resetDashboardRotation;

