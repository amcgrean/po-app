/* renderer.js - UI v1.7.0 - Enhanced with Preview Mode, Manual Correction, Detailed Error Messages */
const { ipcRenderer } = require('electron');

let currentSearchMethod = 'po';
let selectedPOs = [];
let searchResults = [];
let poDetails = {};
let currentBranch = '10FD';
let expandedPOs = {};
let poItemsCache = {};
let currentRenderCount = 0;
const BATCH_SIZE = 50;

// v1.5+ variables
let allPOs = [];
let isLoadingAll = false;
let currentAckData = {};
let ackLastLoaded = null;
let ackRefreshInterval = null;
let acksLoaded = false;

// v1.6+ variables - Enhanced Ack Review
let allAcknowledgements = [];
let ackSortColumn = 'po_id';
let ackSortDirection = 'asc';
let ackFilters = {
  supplier: null,
  status: 'all',
  hasParsedData: null
};
let ackSuppliers = [];

// v1.7 variables - Preview mode and manual correction
let lastParseResult = null;
let pendingCorrections = {};

// Utility: Debounce
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  setDefaultDates();

  const savedBranch = localStorage.getItem('selectedBranch');
  if (savedBranch) {
    currentBranch = savedBranch;
  }

  document.getElementById('currentBranch').textContent = currentBranch;

  // Restore UI State
  const savedTab = localStorage.getItem('activeTab') || 'open-pos';
  switchTab(savedTab);

  const savedFilters = localStorage.getItem('poFilters');
  if (savedFilters) {
    try {
      const filters = JSON.parse(savedFilters);
      if (document.getElementById('poNumber')) document.getElementById('poNumber').value = filters.poNum || '';
      if (document.getElementById('dateFrom')) document.getElementById('dateFrom').value = filters.dateFrom || '';
      if (document.getElementById('dateTo')) document.getElementById('dateTo').value = filters.dateTo || '';
      window.savedSupplierFilter = filters.supplier;
    } catch (e) { console.error('Error restoring filters', e); }
  }

  loadSuppliers().then(() => {
    if (window.savedSupplierFilter) {
      document.getElementById('supplierSelect').value = window.savedSupplierFilter;
      applyFilters();
    }
  });

  testDatabaseConnection();
  ensurePrintStyles();
  createProgressModal();
  createLoadingModal();

  showLoadingScreen('Loading purchase orders...', 0);
  loadAllOpenPOs();

  // Listen for menu events
  ipcRenderer.on('change-branch', async (event, newBranch) => {
    const confirmed = await showConfirmDialog(
      'Change Branch?',
      `Change from ${currentBranch} to ${newBranch}? This will reload all purchase orders.`
    );

    if (confirmed) {
      currentBranch = newBranch;
      localStorage.setItem('selectedBranch', currentBranch);
      document.getElementById('currentBranch').textContent = currentBranch;

      searchResults = [];
      allPOs = [];
      selectedPOs = [];
      poDetails = {};
      allAcknowledgements = [];
      acksLoaded = false;

      displayResults();
      loadSuppliers();
      showLoadingScreen(`Loading POs for ${currentBranch}...`, 0);
      await loadAllOpenPOs();
    }
  });

  ipcRenderer.on('show-acknowledgements', () => {
    openAcknowledgementsModal();
  });

  // Listen for background parse completions
  ipcRenderer.on('ack-parsed', (event, data) => {
    console.log('Ack parsed in background:', data);
    const idx = allAcknowledgements.findIndex(a => a.po_id === data.po_id);
    if (idx !== -1) {
      allAcknowledgements[idx].has_parsed_data = 1;
      allAcknowledgements[idx].match_score = data.match_score;
      allAcknowledgements[idx].match_quality = data.match_quality;
      if (currentAckData[data.po_id]) {
        currentAckData[data.po_id].has_parsed_data = 1;
        currentAckData[data.po_id].match_score = data.match_score;
        currentAckData[data.po_id].match_quality = data.match_quality;
      }
      if (!document.getElementById('acknowledgementsModal').classList.contains('hidden')) {
        displayAcknowledgements(getFilteredAndSortedAcks());
      }
    }
  });
});

// ===== Loading Modal =====
function createLoadingModal() {
  const modal = document.createElement('div');
  modal.id = 'loadingModal';
  modal.style.cssText = `
    display:none;position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,.85);z-index:10001;justify-content:center;align-items:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff;padding:3rem 4rem;border-radius:12px;text-align:center;min-width:500px;box-shadow:0 10px 40px rgba(0,0,0,.3);">
      <div style="width:80px;height:80px;margin:0 auto 1.5rem;border:5px solid #e2e8f0;border-top-color:#006834;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <h2 style="margin:0 0 1rem 0;color:#006834;font-size:1.5rem;">PO Check-In Manager</h2>
      <div id="loadingText" style="font-size:1.1rem;margin-bottom:1.5rem;color:#333;">Initializing...</div>
      <div style="background:#e2e8f0;border-radius:10px;height:20px;overflow:hidden;margin-bottom:.5rem;">
        <div id="loadingBar" style="background:linear-gradient(90deg,#006834,#00a84f);height:100%;width:0%;transition:width .5s;"></div>
      </div>
      <div id="loadingPercent" style="font-size:.9rem;color:#64748b;">0%</div>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    @keyframes shimmer {
      0% { background-position: -1000px 0; }
      100% { background-position: 1000px 0; }
    }
    .skeleton {
      animation: shimmer 2s infinite linear;
      background: linear-gradient(to right, #f6f7f8 4%, #edeef1 25%, #f6f7f8 36%);
      background-size: 1000px 100%;
      color: transparent !important;
      border-radius: 4px;
    }
    .skeleton-text {
      height: 1em;
      width: 80%;
      display: inline-block;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(modal);
}

function showLoadingScreen(text, percent) {
  const modal = document.getElementById('loadingModal');
  const t = document.getElementById('loadingText');
  const b = document.getElementById('loadingBar');
  const p = document.getElementById('loadingPercent');
  if (modal) {
    modal.style.display = 'flex';
    if (t) t.textContent = text;
    if (b) b.style.width = `${percent}%`;
    if (p) p.textContent = `${Math.round(percent)}%`;
  }
}

function hideLoadingScreen() {
  const m = document.getElementById('loadingModal');
  if (m) m.style.display = 'none';
}

// ===== Progress Modal =====
function createProgressModal() {
  const modal = document.createElement('div');
  modal.id = 'progressModal';
  modal.style.cssText = `
    display:none;position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,.7);z-index:10000;justify-content:center;align-items:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff;padding:2rem 3rem;border-radius:8px;text-align:center;min-width:400px;">
      <h2 style="margin:0 0 1.5rem 0;color:#006834;">Processing Purchase Orders</h2>
      <div id="progressText" style="font-size:1.1rem;margin-bottom:1rem;color:#333;">Preparing...</div>
      <div style="background:#e2e8f0;border-radius:10px;height:30px;overflow:hidden;margin-bottom:1rem;">
        <div id="progressBar" style="background:linear-gradient(90deg,#006834,#00a84f);height:100%;width:0%;transition:width .3s;"></div>
      </div>
      <div id="progressDetail" style="font-size:.9rem;color:#64748b;">Please wait...</div>
    </div>
  `;
  document.body.appendChild(modal);
}

function showProgress(text, detail = '', percent = 0) {
  const m = document.getElementById('progressModal');
  const t = document.getElementById('progressText');
  const b = document.getElementById('progressBar');
  const d = document.getElementById('progressDetail');
  if (m) {
    m.style.display = 'flex';
    if (t) t.textContent = text;
    if (b) b.style.width = `${percent}%`;
    if (d) d.textContent = detail;
  }
}

function hideProgress() {
  const m = document.getElementById('progressModal');
  if (m) m.style.display = 'none';
}

// ===== Load all open POs =====
async function loadAllOpenPOs() {
  if (isLoadingAll) return;
  isLoadingAll = true;

  const poList = document.getElementById('poList');
  if (!poList) {
    console.error('poList element not found');
    isLoadingAll = false;
    return;
  }
  poList.innerHTML = '<div class="loading">Loading all open purchase orders...</div>';
  showLoadingScreen(`Loading open POs for ${currentBranch}...`, 25);

  try {
    const result = await ipcRenderer.invoke('get-all-open-pos', currentBranch);
    showLoadingScreen(`Processing ${result.data?.length || 0} purchase orders...`, 75);

    if (result.success) {
      allPOs = result.data.map(po => ({
        ...po,
        clean_po_id: String(po.po_id).replace(/\D/g, '')
      }));
      searchResults = allPOs;
      displayResults();
      showLoadingScreen('Complete!', 100);
      hideLoadingScreen();
      showSuccess(`Loaded ${allPOs.length} open purchase orders for ${currentBranch}`);
    } else {
      hideLoadingScreen();
      showError('Failed to load POs: ' + result.message);
      allPOs = [];
      searchResults = [];
      displayResults();
    }
  } catch (e) {
    console.error(e);
    hideLoadingScreen();
    showError('Error loading purchase orders: ' + e.message);
    allPOs = [];
    searchResults = [];
    displayResults();
  } finally {
    isLoadingAll = false;
  }
}
// ===== UI Wiring =====
function setDefaultDates() {
  const today = new Date();
  const priorDate = new Date();
  priorDate.setDate(today.getDate() - 30);

  // Format as YYYY-MM-DD for input type="date"
  const fmt = d => d.toISOString().split('T')[0];

  // Only set if empty
  if (!document.getElementById('dateFrom').value) {
    document.getElementById('dateFrom').value = fmt(priorDate);
  }
  if (!document.getElementById('dateTo').value) {
    document.getElementById('dateTo').value = fmt(today);
  }
}

function initializeEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // Search inputs
  const poInput = document.getElementById('poNumber');
  if (poInput) {
    poInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchByPO();
    });
    // Live search with debounce
    const debouncedSearch = debounce(() => {
      const val = poInput.value;
      if (val.length > 2 || val.length === 0) searchByPO();
    }, 300);
    poInput.addEventListener('input', debouncedSearch);
  }

  // Helper to bind clicks safely
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
    else console.warn(`Element #${id} not found`);
  };

  // Helper to bind clicks to classes
  const bindClassClick = (className, handler) => {
    document.querySelectorAll('.' + className).forEach(el => {
      el.addEventListener('click', handler);
    });
  };

  // Main buttons
  bindClick('searchPOBtn', searchByPO);
  bindClick('applyFiltersBtn', applyFilters);
  bindClick('clearFiltersBtn', clearFilters);

  // Action buttons
  bindClassClick('action-btn-select-all', selectAll);
  bindClassClick('action-btn-clear-all', clearAll);
  bindClick('exportPOsBtn', exportCurrentPOsToExcel);

  bindClassClick('action-btn-preview', () => {
    if (selectedPOs.length === 0) return showError('Please select at least one PO to preview.');
    ipcRenderer.send('open-preview', selectedPOs);
  });

  // Ack buttons
  bindClick('bulkApproveBtn', bulkApprove);

  // Modal close buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', function () {
      const modal = this.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // Close modal on outside click
  window.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(m => {
      if (e.target === m) m.classList.add('hidden');
    });
  });

  // Infinite scroll
  window.addEventListener('scroll', () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
      if (currentRenderCount < searchResults.length) {
        displayResults(true);
      }
    }
  });

  // Event delegation for PO rows
  const poList = document.getElementById('poList');
  if (poList) {
    poList.addEventListener('click', async (e) => {
      const row = e.target.closest('.po-row');
      if (row) {
        if (e.target.type === 'checkbox') {
          const poId = row.dataset.poId;
          togglePOSelection(poId);
          return;
        }
        const poId = row.dataset.poId;
        await togglePOExpansion(poId);
      }
    });
  }
}

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const result = confirm(`${title}\n\n${message}`);
    resolve(result);
  });
}

function switchTab(tabName) {
  localStorage.setItem('activeTab', tabName); // Save active tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const selectedTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const selectedContent = document.getElementById(tabName);

  if (selectedTab) selectedTab.classList.add('active');
  if (selectedContent) selectedContent.classList.add('active');

  if (tabName === 'dashboard') {
    loadDashboard();
  }
}

async function testDatabaseConnection() {
  try {
    const result = await ipcRenderer.invoke('test-connection');
    const statusEl = document.getElementById('dbStatus');
    if (statusEl) {
      if (result.success) {
        statusEl.textContent = 'DB Connected';
        statusEl.className = 'status-indicator connected';
      } else {
        statusEl.textContent = 'DB Error';
        statusEl.className = 'status-indicator disconnected';
        showError('Database connection failed: ' + result.message);
      }
    }
  } catch (e) {
    const statusEl = document.getElementById('dbStatus');
    if (statusEl) {
      statusEl.textContent = 'DB Error';
      statusEl.className = 'status-indicator disconnected';
    }
  }
}

async function loadSuppliers() {
  try {
    const result = await ipcRenderer.invoke('get-suppliers', currentBranch);
    if (result.success) {
      const select = document.getElementById('supplierSelect');
      select.innerHTML = '<option value="">All Suppliers</option>';
      result.data.forEach(s => {
        const val = JSON.stringify({ supplier_id: s.supplier_id, seq_num: s.seq_num });
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = s.ship_from_name || s.supplier_name;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Error loading suppliers', e);
  }
}

// ===== Search & Filter =====
function searchByPO() {
  const poNum = document.getElementById('poNumber').value.trim().replace(/\D/g, '');

  if (!poNum) {
    // If empty, show all
    applyFilters();
    return;
  }

  // Use clean_po_id for faster search
  searchResults = allPOs.filter(po =>
    po.clean_po_id && po.clean_po_id.includes(poNum)
  );

  displayResults();

  if (searchResults.length === 0) {
    // Try to fetch from DB if not found in local list (in case it's new)
    // But for now, just show message
  }
}

function applyFilters() {
  let results = [...allPOs];
  let filtersApplied = 0;

  // Save filters to localStorage
  const state = {
    poNum: document.getElementById('poNumber').value,
    dateFrom: document.getElementById('dateFrom').value,
    dateTo: document.getElementById('dateTo').value,
    supplier: document.getElementById('supplierSelect').value
  };
  localStorage.setItem('poFilters', JSON.stringify(state));

  const poNum = document.getElementById('poNumber').value.trim().replace(/\D/g, '');
  if (poNum) {
    results = results.filter(po => po.clean_po_id && po.clean_po_id.includes(poNum));
    filtersApplied++;
  }

  const fromDate = document.getElementById('dateFrom').value;
  const toDate = document.getElementById('dateTo').value;

  if (fromDate && toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    results = results.filter(po => {
      const d = new Date(po.expect_ship_date);
      return d >= from && d <= to;
    });
    filtersApplied++;
  }

  const supplierValue = document.getElementById('supplierSelect').value;
  if (supplierValue) {
    try {
      const { supplier_id, seq_num } = JSON.parse(supplierValue);
      results = results.filter(po => po.supplier_id === supplier_id && po.seq_num === seq_num);
      filtersApplied++;
    } catch (e) {
      return showError('Invalid supplier selection');
    }
  }

  searchResults = results;
  displayResults();

  if (filtersApplied === 0) {
    showSuccess(`Showing all ${results.length} open POs`);
  } else {
    showSuccess(`Found ${results.length} PO(s) matching ${filtersApplied} filter(s)`);
  }
}

function clearFilters() {
  document.getElementById('poNumber').value = '';
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  document.getElementById('supplierSelect').value = '';

  // Clear saved filters
  localStorage.removeItem('poFilters');
  applyFilters();
}

function togglePOSelection(id) {
  const i = selectedPOs.indexOf(id);
  if (i > -1) {
    selectedPOs.splice(i, 1);
  } else {
    selectedPOs.push(id);
  }
  updateSelectedUI();
}

function updateSelectedUI() {
  const count = selectedPOs.length;

  // Update all count displays
  document.querySelectorAll('.selected-count-display').forEach(el => {
    el.textContent = count;
  });

  // Update all preview buttons
  document.querySelectorAll('.action-btn-preview').forEach(btn => {
    btn.disabled = count === 0;
    // Update button text to include count if needed, but the span handles it
  });

  // Update checkboxes in the list
  // This is optional if we assume the click handled it, but good for consistency
  // especially if we have "Select All" logic
  // However, iterating all rows might be slow if list is huge. 
  // Let's just rely on the toggle logic for individual clicks, 
  // but for Select All/Clear All we need to update checkboxes.
}

// ===== Results table =====
function displayResults(append = false) {
  const poList = document.getElementById('poList');
  document.getElementById('poCount').textContent = searchResults.length;

  if (isLoadingAll) {
    poList.innerHTML = `
      <table class="po-table">
        <thead>
          <tr>
            <th class="checkbox-cell"></th>
            <th>PO #</th>
            <th>Supplier</th>
            <th>Order Date</th>
            <th>Expected</th>
            <th>Reference</th>
            <th class="center">Label</th>
            <th class="right">Items</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${Array(10).fill(0).map(() => `
            <tr class="po-row">
              <td class="checkbox-cell"><div class="skeleton" style="width:16px;height:16px;"></div></td>
              <td><div class="skeleton skeleton-text" style="width:60px;"></div></td>
              <td><div class="skeleton skeleton-text" style="width:150px;"></div></td>
              <td><div class="skeleton skeleton-text" style="width:80px;"></div></td>
              <td><div class="skeleton skeleton-text" style="width:80px;"></div></td>
              <td><div class="skeleton skeleton-text" style="width:100px;"></div></td>
              <td class="center"><div class="skeleton" style="width:20px;height:20px;border-radius:50%;display:inline-block;"></div></td>
              <td class="right"><div class="skeleton skeleton-text" style="width:40px;"></div></td>
              <td class="right"><div class="skeleton skeleton-text" style="width:60px;"></div></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    return;
  }

  if (!searchResults.length) {
    poList.innerHTML = '<div class="loading">No results found</div>';
    return;
  }

  if (!append) {
    currentRenderCount = 0;
    poList.innerHTML = `
      <table class="po-table">
        <thead>
          <tr>
            <th class="checkbox-cell"></th>
            <th>PO #</th>
            <th>Supplier</th>
            <th>Order Date</th>
            <th>Expected</th>
            <th>Reference</th>
            <th class="center">Label</th>
            <th class="right">Items</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody id="poListBody"></tbody>
      </table>
    `;
  }

  const tbody = document.getElementById('poListBody');
  if (!tbody) return;

  const nextBatch = searchResults.slice(currentRenderCount, currentRenderCount + BATCH_SIZE);

  const html = nextBatch.map(po => {
    const poIdStr = String(po.po_id);
    const isSelected = selectedPOs.includes(poIdStr);
    const isExpanded = expandedPOs[poIdStr];
    const shipFromName = po.ship_from_name || po.supplier_name || 'Unknown Supplier';
    const labelIcon = (po.label_ptr === 1 || po.po_label_ptr === 1)
      ? '<span class="status-yes">&#10004;</span>'
      : '<span class="status-no">&#10008;</span>';
    return `
      <tr class="po-row ${isSelected ? 'selected' : ''}" data-po-id="${poIdStr}">
        <td class="checkbox-cell" onclick="event.stopPropagation()">
          <input type="checkbox" class="po-checkbox" ${isSelected ? 'checked' : ''}>
        </td>
        <td class="po-id-cell">${po.po_id}</td>
        <td>${shipFromName}</td>
        <td>${formatDateShort(po.order_date)}</td>
        <td><strong>${formatDateShort(po.expect_ship_date)}</strong></td>
        <td>${po.reference || '-'}</td>
        <td class="center">${labelIcon}</td>
        <td class="right">${po.item_count || 0}</td>
        <td class="right">$${formatCurrency(po.total_amount || 0)}</td>
      </tr>
      <tr class="detail-row ${isExpanded ? 'expanded' : ''}" id="detail-${poIdStr}">
        <td colspan="9">
          <div class="detail-content" id="detail-content-${poIdStr}">
            <div class="loading">Loading items...</div>
          </div>
        </td>
      </tr>`;
  }).join('');

  tbody.insertAdjacentHTML('beforeend', html);
  currentRenderCount += nextBatch.length;

  updateSelectedUI();
}

async function togglePOExpansion(poId) {
  const id = String(poId);
  const detailRow = document.getElementById(`detail-${id}`);
  const contentDiv = document.getElementById(`detail-content-${id}`);

  if (expandedPOs[id]) {
    delete expandedPOs[id];
    detailRow.classList.remove('expanded');
  } else {
    expandedPOs[id] = true;
    detailRow.classList.add('expanded');

    if (!poItemsCache[id]) {
      // Skeleton for items
      contentDiv.innerHTML = `
        <table class="detail-items-table">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Description</th>
              <th class="right">Expected</th>
              <th class="right">Received</th>
              <th>Location/Notes</th>
            </tr>
          </thead>
          <tbody>
            ${Array(3).fill(0).map(() => `
              <tr>
                <td><div class="skeleton skeleton-text" style="width:80px;"></div></td>
                <td>
                  <div class="skeleton skeleton-text" style="width:200px;margin-bottom:4px;"></div>
                  <div class="skeleton skeleton-text" style="width:150px;height:0.8em;"></div>
                </td>
                <td class="right"><div class="skeleton skeleton-text" style="width:40px;"></div></td>
                <td class="right"><div class="skeleton skeleton-text" style="width:40px;"></div></td>
                <td><div class="skeleton skeleton-text" style="width:100px;"></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      const result = await ipcRenderer.invoke('get-po-items', id);
      if (result.success && result.data.length > 0) {
        poItemsCache[id] = result.data;
        displayPOItems(id, poItemsCache[id], contentDiv);
      } else {
        contentDiv.innerHTML = '<div class="error">Failed to load items</div>';
      }
    } else {
      displayPOItems(id, poItemsCache[id], contentDiv);
    }
  }
}

function displayPOItems(poId, items, container) {
  const html = `
    <table class="detail-items-table">
      <thead>
        <tr>
          <th>Item Code</th>
          <th>Description</th>
          <th class="right">Expected</th>
          <th class="right">Received</th>
          <th>Location/Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => {
    const remaining = (Number(item.order_quantity) || 0) - (Number(item.quantity_received) || 0);
    const rows = [];
    rows.push(`
            <tr>
              <td style="font-family:monospace;">${item.product_code || ''}</td>
              <td>
                ${item.item_description || ''}
                ${item.ext_description ? `<br><span style="font-size:.80em;color:#222;line-height:1.2;display:block;margin-top:3px;">${item.ext_description}</span>` : ''}
                ${item.item_size ? `<br><span style="font-size:.85em;color:#444;">Size: ${item.item_size}</span>` : ''}
                ${item.supplier_item_id ? `<br><span style="font-size:.85em;color:#444;">Supplier #: ${item.supplier_item_id}</span>` : ''}
              </td>
              <td class="right">
                <strong>${remaining.toFixed(2)}</strong><br>
                <span style="font-size:.75em;color:#555;">/ ${item.quantity_uom || 'EA'}</span>
              </td>
              <td class="right" style="background:#ffffcc;">-</td>
              <td style="background:#f0f0f0;">${item.location_id || ''}</td>
            </tr>
          `);

    if (item.__linkedSO && Array.isArray(item.__linkedSO)) {
      rows.push(item.__linkedSO.map(so => {
        const poQty = Number(item.qty_ordered ?? item.order_quantity ?? 0);
        const linkedQty = Number(so.linked_tran_qty ?? 0);
        const mismatch = Number.isFinite(poQty) && Number.isFinite(linkedQty) && linkedQty !== poQty;
        const qtyText = isNaN(linkedQty) ? '' : linkedQty.toFixed(2);
        const qtyDisplay = mismatch ? `*** Qty: ${qtyText} ***` : `Qty: ${qtyText}`;
        return `
                <tr style="background:#eef6ff;">
                  <td colspan="5" style="border:1px solid #ddd;padding:4px 6px;font-size:10px;">
                    <strong>SO:</strong> <strong>${so.sales_order_id || ''}</strong> | 
                    ${so.shipto_name || 'N/A'} | 
                    <strong>${qtyDisplay}</strong>
                  </td>
                </tr>`;
      }).join(''));
    }

    if (item.__linkedWO && Array.isArray(item.__linkedWO)) {
      rows.push(item.__linkedWO.map(wo => `
              <tr style="background:#e8f5e9;">
                <td colspan="5" style="border:1px solid #ddd;padding:4px 6px;font-size:10px;">
                  <strong>WO:</strong> <strong>${wo.work_order_id}</strong> | ${wo.customer_ship_to_name || 'N/A'}
                </td>
              </tr>`).join(''));
    }

    if (needsTallyRows(item)) {
      rows.push(renderTallyRows(5));
    }

    return rows.join('');
  }).join('')}
      </tbody>
    </table>`;
  container.innerHTML = html;
}

function needsTallyRows(item) {
  const allowed = new Set(['EWP', 'Random Length Lumber', 'Specific Length Lumber', 'Tally Calculator']);
  const t = (item && typeof item.item_type_name === 'string') ? item.item_type_name.trim() : '';
  return allowed.has(t);
}

function isClosed(item) {
  const status = String(item.status || item.line_status || '').toLowerCase();
  const explicitlyClosed = ['c', 'closed', 'complete', 'completed'].includes(status);
  const ordered = Number(item.order_quantity) || 0;
  const received = Number(item.quantity_received) || 0;
  const remaining = ordered - received;
  return explicitlyClosed || remaining <= 0.000001;
}

function renderTallyRows(count = 5) {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += `
      <tr class="tally-row">
        <td style="border-top:1px dotted #bbb;"></td>
        <td colspan="4" style="border-top:1px dotted #bbb;padding:6px 8px;">
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;">
            <span>Len:</span><span style="display:inline-block;border-bottom:1px solid #666;min-width:70px;">&nbsp;</span>
            <span>Qty:</span><span style="display:inline-block;border-bottom:1px solid #666;min-width:60px;">&nbsp;</span>
            <span>Len:</span><span style="display:inline-block;border-bottom:1px solid #666;min-width:70px;">&nbsp;</span>
            <span>Qty:</span><span style="display:inline-block;border-bottom:1px solid #666;min-width:60px;">&nbsp;</span>
          </div>
        </td>
      </tr>`;
  }
  return out;
}

function selectAll() {
  selectedPOs = searchResults.map(po => String(po.po_id));
  updateSelectedUI();
  displayResults();
}

function clearAll() {
  selectedPOs = [];
  updateSelectedUI();
  displayResults();
}

function updateSelectedUI() {
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = selectedPOs.length;

  const previewBtn = document.getElementById('previewBtn');
  if (previewBtn) previewBtn.disabled = selectedPOs.length === 0;

  document.querySelectorAll('.po-row').forEach(row => {
    const id = row.dataset.poId;
    const sel = selectedPOs.includes(id);
    row.classList.toggle('selected', sel);
    const cb = row.querySelector('input.po-checkbox');
    if (cb) cb.checked = sel;
  });
}

// ===== Acknowledgements Modal - ENHANCED v1.7 =====
function openAcknowledgementsModal() {
  const modal = document.getElementById('acknowledgementsModal');
  const branchSpan = document.getElementById('ackBranch');

  modal.classList.remove('hidden');
  branchSpan.textContent = currentBranch;

  if (!acksLoaded) {
    loadAcknowledgements();
  }
}

function closeAcknowledgementsModal() {
  const modal = document.getElementById('acknowledgementsModal');
  modal.classList.add('hidden');
}

async function loadAckSuppliers() {
  const result = await ipcRenderer.invoke('get-ack-suppliers', currentBranch);
  if (result.success) {
    ackSuppliers = result.data;
  }
}

async function loadAcknowledgements(silent = false, forceRefresh = false) {
  const ackList = document.getElementById('ackList');
  if (!silent) ackList.innerHTML = '<div class="loading">Loading acknowledgements...</div>';

  try {
    // Load suppliers for filter
    await loadAckSuppliers();

    // Get acknowledgements
    const result = await ipcRenderer.invoke('get-acknowledgements', currentBranch, forceRefresh, {});

    if (!result.success) {
      ackList.innerHTML = `<div class="error">Failed to load: ${result.message}</div>`;
      return;
    }

    allAcknowledgements = result.data;
    acksLoaded = true;
    ackLastLoaded = Date.now();

    // Store in currentAckData for easy access
    allAcknowledgements.forEach(ack => {
      currentAckData[ack.po_id] = ack;
    });

    renderAckFiltersAndTable();

    if (!silent) {
      const parsedCount = allAcknowledgements.filter(a => a.has_parsed_data).length;
      const queueResult = await ipcRenderer.invoke('get-parse-queue-status', currentBranch);
      const pendingParse = queueResult.success ? queueResult.data.pending : 0;
      showSuccess(`Loaded ${allAcknowledgements.length} acknowledgement(s), ${parsedCount} parsed, ${pendingParse} pending`);
    }
  } catch (error) {
    if (!silent) showError('Error loading acknowledgements: ' + error.message);
    ackList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
  }
}

function renderAckFiltersAndTable() {
  const ackList = document.getElementById('ackList');

  // Build filter/toolbar HTML
  const filtersHTML = `
    <div style="display: flex; gap: 1rem; margin-bottom: 1rem; align-items: end; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 200px;">
        <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Filter by Supplier</label>
        <select id="ackSupplierFilter" class="form-control" style="padding: 0.5rem;" onchange="applyAckFilters()">
          <option value="">All Suppliers</option>
          ${ackSuppliers.map(s => `
            <option value="${s.supplier_code}|${s.seq_num}">${s.ship_from_name || 'Unknown'}</option>
          `).join('')}
        </select>
      </div>
      <div style="min-width: 150px;">
        <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Status</label>
        <select id="ackStatusFilter" class="form-control" style="padding: 0.5rem;" onchange="applyAckFilters()">
          <option value="all">All Status</option>
          <option value="not_reviewed">Not Reviewed</option>
          <option value="reviewed">Reviewed</option>
          <option value="flagged">Flagged</option>
        </select>
      </div>
      <div style="min-width: 150px;">
        <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Parsed Data</label>
        <select id="ackParsedFilter" class="form-control" style="padding: 0.5rem;" onchange="applyAckFilters()">
          <option value="">All</option>
          <option value="yes">Has Parsed Data</option>
          <option value="no">Not Parsed</option>
        </select>
      </div>
      <div>
        <button onclick="clearAckFilters()" class="btn btn-secondary" style="padding: 0.5rem 1rem;">Clear Filters</button>
      </div>
    </div>
    <div style="margin-bottom: 0.5rem; font-size: 0.875rem; color: #64748b;">
      Showing <strong id="ackFilteredCount">${allAcknowledgements.length}</strong> of ${allAcknowledgements.length} acknowledgements
      | Click column headers to sort
    </div>
  `;

  ackList.innerHTML = filtersHTML + '<div id="ackTableContainer"></div>';
  displayAcknowledgements(getFilteredAndSortedAcks());
}

function applyAckFilters() {
  const supplierVal = document.getElementById('ackSupplierFilter')?.value || '';
  const statusVal = document.getElementById('ackStatusFilter')?.value || 'all';
  const parsedVal = document.getElementById('ackParsedFilter')?.value || '';

  if (supplierVal) {
    const [code, seq] = supplierVal.split('|');
    ackFilters.supplier = { code, seq: parseInt(seq) };
  } else {
    ackFilters.supplier = null;
  }

  ackFilters.status = statusVal;
  ackFilters.hasParsedData = parsedVal === 'yes' ? true : parsedVal === 'no' ? false : null;

  displayAcknowledgements(getFilteredAndSortedAcks());
}

function clearAckFilters() {
  document.getElementById('ackSupplierFilter').value = '';
  document.getElementById('ackStatusFilter').value = 'all';
  document.getElementById('ackParsedFilter').value = '';

  ackFilters = { supplier: null, status: 'all', hasParsedData: null };
  displayAcknowledgements(getFilteredAndSortedAcks());
}

function getFilteredAndSortedAcks() {
  let filtered = [...allAcknowledgements];

  // Apply filters
  if (ackFilters.supplier) {
    filtered = filtered.filter(a =>
      a.supplier_code === ackFilters.supplier.code &&
      a.seq_num === ackFilters.supplier.seq
    );
  }

  if (ackFilters.status && ackFilters.status !== 'all') {
    filtered = filtered.filter(a => a.status === ackFilters.status);
  }

  if (ackFilters.hasParsedData === true) {
    filtered = filtered.filter(a => a.has_parsed_data === 1);
  } else if (ackFilters.hasParsedData === false) {
    filtered = filtered.filter(a => a.has_parsed_data !== 1);
  }

  // Apply sorting
  filtered.sort((a, b) => {
    let aVal = a[ackSortColumn];
    let bVal = b[ackSortColumn];

    // Handle nulls
    if (aVal == null) aVal = '';
    if (bVal == null) bVal = '';

    // Numeric columns
    if (['po_total', 'ack_total', 'variance_total', 'match_score'].includes(ackSortColumn)) {
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
    }

    // String comparison
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (aVal < bVal) return ackSortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return ackSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Update count display
  const countEl = document.getElementById('ackFilteredCount');
  if (countEl) countEl.textContent = filtered.length;

  return filtered;
}

function sortAckTable(column) {
  if (ackSortColumn === column) {
    ackSortDirection = ackSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    ackSortColumn = column;
    ackSortDirection = 'asc';
  }
  displayAcknowledgements(getFilteredAndSortedAcks());
}

function getSortIndicator(column) {
  if (ackSortColumn !== column) return '';
  return ackSortDirection === 'asc' ? ' â–²' : ' â–¼';
}

function displayAcknowledgements(acks) {
  const container = document.getElementById('ackTableContainer');
  if (!container) return;

  if (!acks || !acks.length) {
    container.innerHTML = '<div class="loading">No acknowledgements found matching filters</div>';
    return;
  }

  const html = `
    <table class="po-table">
      <thead>
        <tr>
          <th style="cursor:pointer;" onclick="sortAckTable('po_id')">PO #${getSortIndicator('po_id')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('ship_from_name')">Supplier${getSortIndicator('ship_from_name')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('order_date')">Order Date${getSortIndicator('order_date')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('po_total')" class="right">PO Total${getSortIndicator('po_total')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('ack_total')" class="right">Ack Total${getSortIndicator('ack_total')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('variance_total')" class="right">Variance${getSortIndicator('variance_total')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('match_score')" class="center">Match${getSortIndicator('match_score')}</th>
          <th style="cursor:pointer;" onclick="sortAckTable('status')">Status${getSortIndicator('status')}</th>
          <th>Reviewed By</th>
        </tr>
      </thead>
      <tbody>
        ${acks.map(ack => {
    const variance = ack.variance_total ? parseFloat(ack.variance_total) : 0;
    const varianceClass = variance > 0 ? 'variance-positive' : variance < 0 ? 'variance-negative' : '';
    const status = ack.status || 'not_reviewed';
    const badge = status === 'reviewed' ? 'status-reviewed' : status === 'flagged' ? 'status-flagged' : 'status-not-reviewed';
    const ackTotal = (ack.ack_merch_total || 0) + (ack.ack_fee_total || 0);

    // Match score display
    let matchDisplay = '-';
    let matchClass = '';
    if (ack.has_parsed_data && ack.match_score != null) {
      const score = Math.round(ack.match_score);
      matchDisplay = `${score}%`;
      if (score >= 90) matchClass = 'style="color:#16a34a;font-weight:bold;"';
      else if (score >= 75) matchClass = 'style="color:#ca8a04;"';
      else matchClass = 'style="color:#dc2626;"';
    } else if (!ack.has_parsed_data) {
      matchDisplay = '<span style="color:#94a3b8;font-size:0.75rem;">pending</span>';
    }

    return `
            <tr class="ack-row" onclick="toggleAckDetails('${ack.po_id}')">
              <td class="po-id-cell">${ack.po_id}</td>
              <td>${ack.ship_from_name || ack.supplier_name || 'N/A'}</td>
              <td>${formatDateShort(ack.order_date)}</td>
              <td class="right">$${formatCurrency(ack.po_total || 0)}</td>
              <td class="right">${ackTotal ? ('$' + formatCurrency(ackTotal)) : '-'}</td>
              <td class="right ${varianceClass}">${variance !== 0 ? ('$' + formatCurrency(Math.abs(variance))) : '-'}</td>
              <td class="center" ${matchClass}>${matchDisplay}</td>
              <td><span class="status-badge ${badge}">${status.replace('_', ' ')}</span></td>
              <td>${ack.reviewed_by || '-'}</td>
            </tr>
            <tr class="ack-details" id="ack-details-${ack.po_id}" style="display:none;">
              <td colspan="9">
                ${buildAckDetailsHTML(ack)}
              </td>
            </tr>`;
  }).join('')}
      </tbody>
    </table>`;
  container.innerHTML = html;
}

function buildAckDetailsHTML(ack) {
  const ackTotal = (ack.ack_merch_total || 0) + (ack.ack_fee_total || 0);
  const variance = ack.variance_total || 0;
  const varianceClass = variance > 0 ? 'variance-positive' : variance < 0 ? 'variance-negative' : '';
  const status = ack.status || 'not_reviewed';

  return `
    <div style="padding:1rem;">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:1rem;">
        <div>
          <h3 style="margin-bottom:.5rem;">Cost Breakdown</h3>
          
          <!-- Parsed Data Info -->
          ${ack.has_parsed_data ? `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:0.75rem;border-radius:0.5rem;margin-bottom:1rem;">
              <strong style="color:#16a34a;">âœ“ PDF Parsed</strong>
              <span style="margin-left:1rem;color:#64748b;">
                Method: ${ack.parsing_method || 'generic'} | 
                Match: ${ack.match_score ? Math.round(ack.match_score) + '%' : 'N/A'}
              </span>
              ${ack.parsed_merch_total != null ? `
                <div style="margin-top:0.5rem;font-size:0.875rem;">
                  Parsed values: Merch $${formatCurrency(ack.parsed_merch_total)}, 
                  Freight $${formatCurrency(ack.parsed_freight_total || 0)}
                </div>
              ` : ''}
            </div>
          ` : `
            <div style="background:#fef3c7;border:1px solid #fcd34d;padding:0.75rem;border-radius:0.5rem;margin-bottom:1rem;">
              <strong style="color:#92400e;">â³ Parsing Pending</strong>
              <span style="margin-left:1rem;color:#64748b;">
                PDF will be parsed in background or click "Parse PDF" below
              </span>
            </div>
          `}
          
          <div class="cost-compare">
            <div class="cost-box">
              <div class="cost-label">PO Merchandise</div>
              <div class="cost-value">$${formatCurrency(ack.po_merch_total || ack.po_total || 0)}</div>
            </div>
            <div class="cost-box">
              <div class="cost-label">Ack Merchandise</div>
              <input type="number" step="0.01" id="ack-merch-total-${ack.po_id}" 
                     value="${ack.ack_merch_total || ''}" 
                     placeholder="Enter amount" 
                     onchange="updateAckVariance('${ack.po_id}')"
                     style="font-size:1.25rem;padding:.5rem;border:1px solid #cbd5e1;border-radius:.25rem;width:100%;">
            </div>
            <div class="cost-box">
              <div class="cost-label">Variance Merch</div>
              <div class="cost-value ${ack.variance_merch > 0 ? 'variance-positive' : ack.variance_merch < 0 ? 'variance-negative' : ''}" id="variance-merch-${ack.po_id}">
                ${ack.variance_merch ? ('$' + formatCurrency(Math.abs(ack.variance_merch))) : '-'}
              </div>
            </div>
          </div>
          <div class="cost-compare" style="margin-top: 0.5rem;">
            <div class="cost-box">
              <div class="cost-label">PO Freight</div>
              <div class="cost-value">$${formatCurrency(ack.po_fee_total || 0)}</div>
            </div>
            <div class="cost-box">
              <div class="cost-label">Ack Freight</div>
              <input type="number" step="0.01" id="ack-fee-total-${ack.po_id}" 
                     value="${ack.ack_fee_total || ''}" 
                     placeholder="Enter amount"
                     onchange="updateAckVariance('${ack.po_id}')"
                     style="font-size:1.25rem;padding:.5rem;border:1px solid #cbd5e1;border-radius:.25rem;width:100%;">
            </div>
            <div class="cost-box">
              <div class="cost-label">Variance Freight</div>
              <div class="cost-value ${ack.variance_fee > 0 ? 'variance-positive' : ack.variance_fee < 0 ? 'variance-negative' : ''}" id="variance-fee-${ack.po_id}">
                ${ack.variance_fee ? ('$' + formatCurrency(Math.abs(ack.variance_fee))) : '-'}
              </div>
            </div>
          </div>
          <div class="cost-compare" style="margin-top: 0.5rem; background: #f8fafc; padding: 0.75rem; border-radius: 0.5rem;">
            <div class="cost-box" style="background: transparent; border: none;">
              <div class="cost-label">Total PO</div>
              <div class="cost-value" style="font-size: 1.1rem;">$${formatCurrency(ack.po_total || 0)}</div>
            </div>
            <div class="cost-box" style="background: transparent; border: none;">
              <div class="cost-label">Total Ack</div>
              <div class="cost-value" style="font-size: 1.1rem;" id="total-ack-${ack.po_id}">
                ${ackTotal ? ('$' + formatCurrency(ackTotal)) : '-'}
              </div>
            </div>
            <div class="cost-box" style="background: transparent; border: none;">
              <div class="cost-label">Total Variance</div>
              <div class="cost-value ${varianceClass}" style="font-size: 1.1rem;" id="variance-total-${ack.po_id}">
                ${variance !== 0 ? ('$' + formatCurrency(Math.abs(variance))) : '-'}
              </div>
            </div>
          </div>
          <div style="margin-top:1rem;">
            <label class="cost-label">Notes</label>
            <textarea id="notes-${ack.po_id}" rows="3" 
                      style="width:100%;padding:.5rem;border:1px solid #cbd5e1;border-radius:.25rem;font-family:inherit;" 
                      placeholder="Add any notes about this acknowledgement...">${ack.notes || ''}</textarea>
          </div>
          <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">
            <button onclick="markAsReviewed('${ack.po_id}','reviewed')" class="btn btn-primary">
              âœ“ Mark as Reviewed
            </button>
            <button onclick="markAsReviewed('${ack.po_id}','flagged')" class="btn" 
                    style="background:#dc2626;color:#fff;">
              âš  Flag Issue
            </button>
            <button onclick="viewAckPDF('${ack.po_id}','${(ack.ack_path || '').replace(/\\/g, '/')}')" 
                    class="btn btn-secondary">
              ðŸ“„ View PDF
            </button>
            <button onclick="showTextPreview('${ack.po_id}','${(ack.ack_path || '').replace(/\\/g, '/')}')" 
                    class="btn btn-secondary">
              ðŸ‘ Preview Text
            </button>
            <button onclick="parseAndReviewAck('${ack.po_id}','${(ack.ack_path || '').replace(/\\/g, '/')}')" 
                    class="btn btn-secondary">
              ðŸ” Parse PDF
            </button>
            ${ack.has_parsed_data ? `
              <button onclick="useParsedData('${ack.po_id}')" class="btn btn-secondary" style="background:#16a34a;color:#fff;">
                âœ“ Use Parsed Data
              </button>
            ` : ''}
          </div>
        </div>
        <div style="background:#f8fafc;padding:1rem;border-radius:.5rem;">
          <h4 style="margin-bottom:.5rem;font-size:.875rem;color:#64748b;">Review Info</h4>
          <div style="font-size:.875rem;">
            <div><strong>Status:</strong> ${status.replace('_', ' ')}</div>
            <div><strong>Reviewed By:</strong> ${ack.reviewed_by || 'Not reviewed'}</div>
            <div><strong>Date:</strong> ${ack.reviewed_date ? formatDate(ack.reviewed_date) : 'N/A'}</div>
            <div style="margin-top:1rem;"><strong>Supplier:</strong> ${ack.ship_from_name || 'N/A'}</div>
            <div><strong>Supplier Code:</strong> ${ack.supplier_code || 'N/A'}-${ack.seq_num || 'N/A'}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleAckDetails(poId) {
  const details = document.getElementById(`ack-details-${poId}`);
  if (!details) return;
  const isExpanded = details.style.display !== 'none';
  document.querySelectorAll('.ack-details').forEach(d => d.style.display = 'none');
  if (!isExpanded) details.style.display = 'table-row';
}

function updateAckVariance(poId) {
  const merchInput = document.getElementById(`ack-merch-total-${poId}`);
  const feeInput = document.getElementById(`ack-fee-total-${poId}`);

  const ackMerch = parseFloat(merchInput?.value || 0);
  const ackFee = parseFloat(feeInput?.value || 0);
  const ackTotal = ackMerch + ackFee;

  const ackData = currentAckData[poId];
  if (!ackData) return;

  const poMerch = ackData.po_merch_total || ackData.po_total || 0;
  const poFee = ackData.po_fee_total || 0;
  const poTotal = poMerch + poFee;

  const varMerch = ackMerch - poMerch;
  const varFee = ackFee - poFee;
  const varTotal = ackTotal - poTotal;

  const varMerchEl = document.getElementById(`variance-merch-${poId}`);
  if (varMerchEl) {
    varMerchEl.textContent = varMerch !== 0 ? '$' + formatCurrency(Math.abs(varMerch)) : '-';
    varMerchEl.className = 'cost-value ' + (varMerch > 0 ? 'variance-positive' : varMerch < 0 ? 'variance-negative' : '');
  }

  const varFeeEl = document.getElementById(`variance-fee-${poId}`);
  if (varFeeEl) {
    varFeeEl.textContent = varFee !== 0 ? '$' + formatCurrency(Math.abs(varFee)) : '-';
    varFeeEl.className = 'cost-value ' + (varFee > 0 ? 'variance-positive' : varFee < 0 ? 'variance-negative' : '');
  }

  const totalAckEl = document.getElementById(`total-ack-${poId}`);
  if (totalAckEl) {
    totalAckEl.textContent = ackTotal !== 0 ? '$' + formatCurrency(ackTotal) : '-';
  }

  const varTotalEl = document.getElementById(`variance-total-${poId}`);
  if (varTotalEl) {
    varTotalEl.textContent = varTotal !== 0 ? '$' + formatCurrency(Math.abs(varTotal)) : '-';
    varTotalEl.className = 'cost-value ' + (varTotal > 0 ? 'variance-positive' : varTotal < 0 ? 'variance-negative' : '');
  }
}

async function useParsedData(poId) {
  // First try to get from local cache
  let ackData = currentAckData[poId];

  // If parsed data not in local cache, fetch from database
  if (!ackData || (ackData.parsed_merch_total == null && ackData.parsed_freight_total == null)) {
    const result = await ipcRenderer.invoke('get-parsed-ack-data', poId, currentBranch);
    if (result.success && result.data) {
      // merge into local cache
      ackData = { ...(ackData || {}), ...result.data };
      currentAckData[poId] = ackData;
    }
  }


  if (!ackData) {
    showError('No parsed data available for this acknowledgement');
    return;
  }

  const merchInput = document.getElementById(`ack-merch-total-${poId}`);
  const feeInput = document.getElementById(`ack-fee-total-${poId}`);

  if (ackData.parsed_merch_total != null && merchInput) {
    merchInput.value = Number(ackData.parsed_merch_total).toFixed(2);
  }
  if (ackData.parsed_freight_total != null && feeInput) {
    feeInput.value = Number(ackData.parsed_freight_total).toFixed(2);
  }

  updateAckVariance(poId);
  showSuccess('Parsed data applied to form');
}

async function markAsReviewed(poId, status) {
  const merchInput = document.getElementById(`ack-merch-total-${poId}`);
  const feeInput = document.getElementById(`ack-fee-total-${poId}`);
  const notesInput = document.getElementById(`notes-${poId}`);

  const ackMerchTotal = merchInput ? parseFloat(merchInput.value) : null;
  const ackFeeTotal = feeInput ? parseFloat(feeInput.value) : null;
  const notes = notesInput ? notesInput.value : '';
  const ackData = currentAckData[poId];
  const poTotal = ackData ? ackData.po_total : 0;
  const poMerchTotal = ackData ? (ackData.po_merch_total || ackData.po_total) : poTotal;
  const poFeeTotal = ackData ? (ackData.po_fee_total || 0) : 0;
  const ackPath = ackData ? ackData.ack_path : '';
  const reviewed_by = process.env.USERNAME || process.env.USER || 'Unknown';

  // Optimistic Update
  const originalStatus = ackData.status;
  const originalReviewedBy = ackData.reviewed_by;
  const originalReviewedDate = ackData.reviewed_date;

  // Update local data immediately
  if (currentAckData[poId]) {
    currentAckData[poId].status = status;
    currentAckData[poId].reviewed_by = reviewed_by;
    currentAckData[poId].reviewed_date = new Date().toISOString();
    currentAckData[poId].ack_merch_total = ackMerchTotal;
    currentAckData[poId].ack_fee_total = ackFeeTotal;
    currentAckData[poId].ack_total = (ackMerchTotal || 0) + (ackFeeTotal || 0);
    currentAckData[poId].variance_merch = (ackMerchTotal || 0) - poMerchTotal;
    currentAckData[poId].variance_fee = (ackFeeTotal || 0) - poFeeTotal;
    currentAckData[poId].variance_total = currentAckData[poId].ack_total - poTotal;
    currentAckData[poId].notes = notes;
  }

  // Update UI immediately
  const row = document.querySelector(`.ack-row[onclick*="${poId}"]`);
  if (row) {
    const badge = row.querySelector('.status-badge');
    if (badge) {
      badge.className = `status-badge status-${status}`;
      badge.textContent = status.replace('_', ' ');
    }
  }
  showSuccess(`PO ${poId} marked as ${status} (saving...)`);

  try {
    const result = await ipcRenderer.invoke('save-ack-review', {
      po_id: poId,
      branch: currentBranch,
      ack_path: ackPath,
      po_total: poTotal,
      po_merch_total: poMerchTotal,
      po_fee_total: poFeeTotal,
      ack_merch_total: ackMerchTotal,
      ack_fee_total: ackFeeTotal,
      status,
      reviewed_by,
      notes
    });

    if (result.success) {
      showSuccess(`PO ${poId} saved`);

      // Update allAcknowledgements
      const idx = allAcknowledgements.findIndex(a => a.po_id === poId);
      if (idx !== -1 && currentAckData[poId]) {
        allAcknowledgements[idx] = {
          ...allAcknowledgements[idx],
          ...currentAckData[poId]
        };
      }
    } else {
      throw new Error(result.message);
    }
  } catch (e) {
    // Revert
    if (currentAckData[poId]) {
      currentAckData[poId].status = originalStatus;
      currentAckData[poId].reviewed_by = originalReviewedBy;
      currentAckData[poId].reviewed_date = originalReviewedDate;
    }
    // Revert UI
    if (row) {
      const badge = row.querySelector('.status-badge');
      if (badge) {
        badge.className = `status-badge status-${originalStatus || 'not-reviewed'}`;
        badge.textContent = (originalStatus || 'not_reviewed').replace('_', ' ');
      }
    }
    showError('Error saving review: ' + e.message);
  }
}

async function bulkApprove() {
  const toApprove = allAcknowledgements.filter(a =>
    (a.status === 'not_reviewed' || !a.status) &&
    Math.abs((a.ack_total || 0) - (a.po_total || 0)) < 50
  );

  if (!toApprove.length) return showSuccess('No eligible POs for bulk approval (variance < $50)');

  if (!confirm(`Approve ${toApprove.length} POs with variance < $50?`)) return;

  // Optimistic Update
  toApprove.forEach(a => {
    a.status = 'reviewed';
    a.reviewed_by = process.env.USERNAME || process.env.USER || 'Batch';
    a.reviewed_date = new Date().toISOString();
    if (currentAckData[a.po_id]) {
      Object.assign(currentAckData[a.po_id], a);
    }
  });

  displayAcknowledgements(getFilteredAndSortedAcks());
  showSuccess(`Bulk approving ${toApprove.length} POs...`);

  try {
    const result = await ipcRenderer.invoke('bulk-approve-acks', toApprove.map(a => a.po_id));
    if (result.success) {
      showSuccess(`Successfully approved ${toApprove.length} POs`);
    } else {
      throw new Error(result.message);
    }
  } catch (e) {
    showError('Bulk approve failed: ' + e.message);
    // Reload to revert
    loadAcknowledgements();
  }
}

async function viewAckPDF(poId, pdfPath) {
  if (!pdfPath) {
    return showError('No acknowledgement PDF found for this PO.');
  }
  const windowsPath = pdfPath.replace(/\//g, '\\');
  try {
    const result = await ipcRenderer.invoke('get-pdf-data', windowsPath);
    if (!result.success) return showError('Failed to load PDF: ' + result.message);
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head><title>Acknowledgement - ${poId}</title></head>
        <body style="margin:0;">
          <iframe src="data:application/pdf;base64,${result.data}" 
                  style="width:100%;height:100vh;border:none;"></iframe>
        </body>
      </html>`);
  } catch (e) {
    showError('Failed to view PDF: ' + e.message);
  }
}

// ===== NEW: Text Preview Mode =====
async function showTextPreview(poId, ackPath) {
  if (!ackPath) {
    return showError('No acknowledgement PDF found for this PO.');
  }

  showProgress('Extracting text from PDF...', 'Please wait', 25);

  try {
    const result = await ipcRenderer.invoke('parse-acknowledgement-pdf', {
      po_id: poId,
      branch: currentBranch,
      ack_path: ackPath
    });

    hideProgress();

    if (!result.success) {
      showError('Failed to extract text: ' + result.message);
      return;
    }

    showTextPreviewModal(poId, result);

  } catch (error) {
    hideProgress();
    showError('Text extraction error: ' + error.message);
  }
}

function showTextPreviewModal(poId, parseResult) {
  const { parsed_data, comparison, po_data } = parseResult;
  const textPreview = parsed_data.raw_text_preview || parsed_data.raw_text || 'No text extracted';
  const textAnalysis = parsed_data.text_analysis || {};

  const modal = document.createElement('div');
  modal.id = 'textPreviewModal';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 3000; overflow-y: auto; padding: 2rem;';

  modal.innerHTML = `
    <div style="max-width: 1100px; margin: 0 auto; background: white; border-radius: 0.5rem; padding: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="margin: 0;">Text Preview - PO ${poId}</h2>
        <button id="closeTextPreview" class="btn btn-secondary">Close</button>
      </div>
      
      <!-- Text Analysis Summary -->
      <div style="background: #f8fafc; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #64748b;">Text Analysis</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.875rem;">
          <div>
            <span style="color: #64748b;">Characters:</span> 
            <strong>${textAnalysis.totalLength || textPreview.length}</strong>
          </div>
          <div>
            <span style="color: #64748b;">Lines:</span> 
            <strong>${textAnalysis.lineCount || (textPreview.split('\n').length)}</strong>
          </div>
          <div>
            <span style="color: #64748b;">Pages:</span> 
            <strong>${parsed_data.num_pages || 1}</strong>
          </div>
          <div>
            <span style="color: #64748b;">Parseability:</span> 
            <strong style="color: ${textAnalysis.parseability === 'good' ? '#16a34a' : textAnalysis.parseability === 'moderate' ? '#ca8a04' : '#dc2626'};">
              ${textAnalysis.parseability || 'Unknown'}
            </strong>
          </div>
        </div>
        ${textAnalysis.potentialTotals?.length > 0 ? `
          <div style="margin-top: 0.5rem;">
            <span style="color: #64748b;">Potential totals found:</span> 
            ${textAnalysis.potentialTotals.slice(0, 5).map(t => `<code style="background: #e0f2fe; padding: 0.125rem 0.25rem; border-radius: 0.125rem; margin-left: 0.25rem;">${t}</code>`).join('')}
          </div>
        ` : ''}
      </div>
      
      <!-- Fields Extracted vs Failed -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 0.5rem;">
          <h4 style="margin: 0 0 0.5rem 0; color: #16a34a; font-size: 0.875rem;">âœ“ Fields Successfully Extracted (${parsed_data.fields_extracted?.length || 0})</h4>
          ${parsed_data.fields_extracted?.length > 0 ? `
            <div style="font-size: 0.875rem;">
              ${parsed_data.fields_extracted.map(f => `
                <div style="margin-bottom: 0.25rem; display: flex; justify-content: space-between;">
                  <span>${f.field.replace(/_/g, ' ')}:</span>
                  <strong>${f.field.includes('total') ? '$' + formatCurrency(f.value) : f.value}</strong>
                  <span style="color: #64748b; font-size: 0.75rem;">(${f.pattern})</span>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color: #64748b; font-size: 0.875rem;">No fields extracted</div>'}
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 1rem; border-radius: 0.5rem;">
          <h4 style="margin: 0 0 0.5rem 0; color: #dc2626; font-size: 0.875rem;">âœ— Fields Not Found (${parsed_data.fields_failed?.length || 0})</h4>
          ${parsed_data.fields_failed?.length > 0 ? `
            <div style="font-size: 0.875rem;">
              ${parsed_data.fields_failed.map(f => `
                <div style="margin-bottom: 0.25rem;">
                  <span>${f.field.replace(/_/g, ' ')}:</span>
                  <span style="color: #64748b; font-size: 0.75rem;">${f.reason}</span>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color: #64748b; font-size: 0.875rem;">All fields extracted successfully!</div>'}
        </div>
      </div>
      
      <!-- Raw Text Preview -->
      <div>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem;">Extracted Text Preview</h3>
        <div style="background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 0.5rem; max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all;">
${escapeHtml(textPreview)}
        </div>
      </div>
      
      <!-- Action Buttons -->
      <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 2px solid #e2e8f0; display: flex; gap: 0.5rem; justify-content: flex-end;">
        <button onclick="document.getElementById('textPreviewModal').remove()" class="btn btn-secondary">
          Close
        </button>
        <button onclick="document.getElementById('textPreviewModal').remove(); parseAndReviewAck('${poId}', '${(parseResult.meta?.ack_path || '').replace(/\\/g, '/')}')" class="btn btn-primary">
          Continue to Parse Results
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('closeTextPreview').onclick = () => {
    document.body.removeChild(modal);
  };
}

// ===== Enhanced PDF Parsing with Manual Correction =====
async function parseAndReviewAck(poId, ackPath) {
  try {
    showProgress('Parsing acknowledgement PDF...', 'Extracting text and totals', 25);

    const result = await ipcRenderer.invoke('parse-acknowledgement-pdf', {
      po_id: poId,
      branch: currentBranch,
      ack_path: ackPath
    });

    hideProgress();

    if (!result.success) {
      showParseErrorModal(poId, result);
      return;
    }

    // Store for potential use later
    lastParseResult = result;

    showParsedAckResults(poId, result);

  } catch (error) {
    hideProgress();
    showError('Parse error: ' + error.message);
  }
}

function showParseErrorModal(poId, result) {
  const errorDetails = result.parsed_data?.errorDetails || {};

  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 3000; overflow-y: auto; padding: 2rem;';

  modal.innerHTML = `
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 0.5rem; padding: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="margin: 0; color: #dc2626;">âŒ Parsing Failed - PO ${poId}</h2>
        <button onclick="this.closest('div[style*=z-index]').remove()" class="btn btn-secondary">Close</button>
      </div>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
        <h3 style="margin: 0 0 0.5rem 0; color: #dc2626; font-size: 1rem;">Error Details</h3>
        <div style="font-size: 0.875rem;">
          <div><strong>Type:</strong> ${errorDetails.type || 'Unknown'}</div>
          <div><strong>Message:</strong> ${result.message || 'PDF parsing failed'}</div>
          ${errorDetails.path ? `<div><strong>Path:</strong> <code style="font-size: 0.75rem;">${errorDetails.path}</code></div>` : ''}
        </div>
      </div>
      
      ${errorDetails.suggestion ? `
        <div style="background: #fef3c7; border: 1px solid #fcd34d; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 0.5rem 0; color: #92400e; font-size: 1rem;">ðŸ’¡ Suggestion</h3>
          <div style="font-size: 0.875rem;">${errorDetails.suggestion}</div>
        </div>
      ` : ''}
      
      <div style="background: #f8fafc; padding: 1rem; border-radius: 0.5rem;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem;">What you can do:</h3>
        <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.875rem;">
          <li>Open the PDF manually to view the acknowledgement</li>
          <li>Enter the totals manually in the review form</li>
          <li>Check if the PDF file is corrupted or password-protected</li>
          <li>Contact IT if this error persists</li>
        </ul>
      </div>
      
      <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
        <button onclick="this.closest('div[style*=z-index]').remove()" class="btn btn-secondary">Close</button>
        <button onclick="this.closest('div[style*=z-index]').remove(); viewAckPDF('${poId}', '${(result.meta?.ack_path || '').replace(/\\/g, '/')}')" class="btn btn-primary">
          View PDF Manually
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function showParsedAckResults(poId, parseResult) {
  const { parsed_data, comparison, po_data } = parseResult;

  // Build fields matched info
  const fieldsInfo = parsed_data.fields_extracted || [];
  const fieldsFailed = parsed_data.fields_failed || [];

  const modal = document.createElement('div');
  modal.id = 'parsedResultsModal';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 3000; overflow-y: auto; padding: 2rem;';

  modal.innerHTML = `
    <div style="max-width: 1000px; margin: 0 auto; background: white; border-radius: 0.5rem; padding: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="margin: 0;">Parsed Acknowledgement - PO ${poId}</h2>
        <button id="closeParsedResults" class="btn btn-secondary">Close</button>
      </div>
      
      <!-- Match Quality Banner -->
      <div style="background: ${comparison.match_quality === 'excellent' ? '#f0fdf4' : comparison.match_quality === 'good' ? '#fffbeb' : '#fef2f2'}; 
                  border: 1px solid ${comparison.match_quality === 'excellent' ? '#bbf7d0' : comparison.match_quality === 'good' ? '#fcd34d' : '#fecaca'};
                  padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; font-size: 1.1rem;">
              Match Quality: <span style="color: ${comparison.match_quality === 'excellent' ? '#16a34a' : comparison.match_quality === 'good' ? '#ca8a04' : '#dc2626'};">
                ${comparison.match_quality.toUpperCase()}
              </span>
            </div>
            <div style="color: #64748b; margin-top: 0.25rem;">
              Confidence: ${comparison.confidence_score.toFixed(1)}% | 
              Method: ${parsed_data.parsing_method || 'generic'} |
              Fields: ${parsed_data.matched_fields || 0}/${parsed_data.total_fields || 0}
            </div>
          </div>
          <div style="font-size: 2rem; font-weight: bold; color: ${comparison.match_quality === 'excellent' ? '#16a34a' : comparison.match_quality === 'good' ? '#ca8a04' : '#dc2626'};">
            ${Math.round(comparison.confidence_score)}%
          </div>
        </div>
      </div>
      
      <!-- Fields Status -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 0.5rem;">
          <h4 style="margin: 0 0 0.5rem 0; color: #16a34a; font-size: 0.875rem;">âœ“ Successfully Extracted (${fieldsInfo.length})</h4>
          ${fieldsInfo.length > 0 ? `
            <div style="font-size: 0.8rem;">
              ${fieldsInfo.map(f => `
                <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; border-bottom: 1px solid #dcfce7;">
                  <span>${f.field.replace(/_/g, ' ')}:</span>
                  <div>
                    <strong>${f.field.includes('total') ? '$' + formatCurrency(f.value) : f.value}</strong>
                    <span style="color: #64748b; font-size: 0.7rem; margin-left: 0.5rem;">${f.pattern}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color: #64748b;">None</div>'}
        </div>
        <div style="background: ${fieldsFailed.length > 0 ? '#fef2f2' : '#f8fafc'}; border: 1px solid ${fieldsFailed.length > 0 ? '#fecaca' : '#e2e8f0'}; padding: 1rem; border-radius: 0.5rem;">
          <h4 style="margin: 0 0 0.5rem 0; color: ${fieldsFailed.length > 0 ? '#dc2626' : '#64748b'}; font-size: 0.875rem;">
            ${fieldsFailed.length > 0 ? 'âœ— Not Found' : 'âœ“ All Fields Found'} (${fieldsFailed.length})
          </h4>
          ${fieldsFailed.length > 0 ? `
            <div style="font-size: 0.8rem;">
              ${fieldsFailed.map(f => `
                <div style="padding: 0.25rem 0; border-bottom: 1px solid #fecaca;">
                  <span>${f.field.replace(/_/g, ' ')}</span>
                  <div style="color: #64748b; font-size: 0.7rem;">${f.reason}</div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color: #16a34a;">All expected fields were found!</div>'}
        </div>
      </div>
      
      <!-- Manual Correction Section -->
      <div style="background: #f8fafc; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
        <h3 style="margin: 0 0 1rem 0; font-size: 1rem;">Review & Correct Values</h3>
        <p style="font-size: 0.875rem; color: #64748b; margin-bottom: 1rem;">
          Review the parsed values below and make corrections if needed before applying.
        </p>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
          <div>
            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Merchandise Total</label>
            <input type="number" step="0.01" id="correct-merch-${poId}" 
                   value="${parsed_data.totals?.merchandise_total?.toFixed(2) || ''}"
                   placeholder="Enter merchandise total"
                   style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.25rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Freight Total</label>
            <input type="number" step="0.01" id="correct-freight-${poId}" 
                   value="${parsed_data.totals?.freight_total?.toFixed(2) || ''}"
                   placeholder="Enter freight total"
                   style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.25rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Tax Total</label>
            <input type="number" step="0.01" id="correct-tax-${poId}" 
                   value="${parsed_data.totals?.tax_total?.toFixed(2) || ''}"
                   placeholder="Enter tax total"
                   style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.25rem;">
          </div>
        </div>
        
        <div style="margin-top: 1rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Grand Total (Calculated)</label>
            <div id="correct-grand-${poId}" style="padding: 0.5rem; background: #e2e8f0; border-radius: 0.25rem; font-weight: bold;">
              $${formatCurrency((parsed_data.totals?.merchandise_total || 0) + (parsed_data.totals?.freight_total || 0) + (parsed_data.totals?.tax_total || 0))}
            </div>
          </div>
          <div>
            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">PO Total (From Agility)</label>
            <div style="padding: 0.5rem; background: #e2e8f0; border-radius: 0.25rem;">
              $${formatCurrency(po_data.total_amount || 0)}
            </div>
          </div>
        </div>
      </div>
      
      ${comparison.discrepancies.length > 0 ? `
        <div style="margin-bottom: 1.5rem;">
          <h3 style="font-size: 1rem; margin-bottom: 0.5rem; color: #dc2626;">âš ï¸ Discrepancies (${comparison.discrepancies.length})</h3>
          ${comparison.discrepancies.map(d => `
            <div style="background: ${d.severity === 'critical' ? '#fef2f2' : d.severity === 'warning' ? '#fffbeb' : '#f0f9ff'}; 
                        border-left: 4px solid ${d.severity === 'critical' ? '#dc2626' : d.severity === 'warning' ? '#f59e0b' : '#0ea5e9'};
                        padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">
              <div style="display: flex; justify-content: space-between;">
                <strong>${d.type.replace(/_/g, ' ').toUpperCase()}</strong>
                <span style="color: ${d.severity === 'critical' ? '#dc2626' : d.severity === 'warning' ? '#f59e0b' : '#0ea5e9'}; font-weight: bold; text-transform: uppercase; font-size: 0.75rem;">${d.severity}</span>
              </div>
              <div style="color: #64748b; margin-top: 0.25rem;">${d.message || ''}</div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
          <strong style="color: #16a34a;">âœ“ No discrepancies found - values match within tolerance</strong>
        </div>
      `}
      
      <!-- Action Buttons -->
      <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 2px solid #e2e8f0; display: flex; gap: 0.5rem; justify-content: space-between; flex-wrap: wrap;">
        <div>
          <button onclick="showTextPreviewFromParsed('${poId}')" class="btn btn-secondary">
            ðŸ‘ View Raw Text
          </button>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="document.getElementById('parsedResultsModal').remove()" class="btn btn-secondary">
            Cancel
          </button>
          <button onclick="applyCorrectionsAndFill('${poId}')" class="btn btn-primary">
            Apply Values to Review Form
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners for recalculating grand total
  ['merch', 'freight', 'tax'].forEach(field => {
    const input = document.getElementById(`correct-${field}-${poId}`);
    if (input) {
      input.addEventListener('input', () => recalculateGrandTotal(poId));
    }
  });

  document.getElementById('closeParsedResults').onclick = () => {
    document.getElementById('parsedResultsModal').remove();
  };
}

function recalculateGrandTotal(poId) {
  const merch = parseFloat(document.getElementById(`correct-merch-${poId}`)?.value) || 0;
  const freight = parseFloat(document.getElementById(`correct-freight-${poId}`)?.value) || 0;
  const tax = parseFloat(document.getElementById(`correct-tax-${poId}`)?.value) || 0;

  const grandEl = document.getElementById(`correct-grand-${poId}`);
  if (grandEl) {
    grandEl.textContent = '$' + formatCurrency(merch + freight + tax);
  }
}

function applyCorrectionsAndFill(poId) {
  const merch = parseFloat(document.getElementById(`correct-merch-${poId}`)?.value) || 0;
  const freight = parseFloat(document.getElementById(`correct-freight-${poId}`)?.value) || 0;

  // Close the modal
  const modal = document.getElementById('parsedResultsModal');
  if (modal) modal.remove();

  // Fill in the review form
  const merchInput = document.getElementById(`ack-merch-total-${poId}`);
  const feeInput = document.getElementById(`ack-fee-total-${poId}`);

  if (merchInput && merch > 0) {
    merchInput.value = merch.toFixed(2);
  }
  if (feeInput) {
    feeInput.value = freight.toFixed(2);
  }

  // Update variance calculation
  updateAckVariance(poId);

  showSuccess('Values applied to review form. Review and save when ready.');
}

function showTextPreviewFromParsed(poId) {
  if (lastParseResult && lastParseResult.parsed_data) {
    showTextPreviewModal(poId, lastParseResult);
  }
}

function autoFillAckData(poId, merchTotal, feeTotal) {
  const merchInput = document.getElementById(`ack-merch-total-${poId}`);
  const feeInput = document.getElementById(`ack-fee-total-${poId}`);

  // Handle null/undefined values safely
  const merchValue = (merchTotal != null && !isNaN(merchTotal)) ? Number(merchTotal).toFixed(2) : '';
  const feeValue = (feeTotal != null && !isNaN(feeTotal)) ? Number(feeTotal).toFixed(2) : '';

  if (merchInput) merchInput.value = merchValue;
  if (feeInput) feeInput.value = feeValue;

  // Update variance calculation if we have valid data
  if (merchValue || feeValue) {
    updateAckVariance(poId);
    showSuccess('Acknowledgement data filled from parsed PDF');
  } else {
    showError('PDF parsing found no valid total amounts. Please enter manually.');
  }

  // Close modal
  const modal = document.querySelector('[style*="z-index: 3000"]');
  if (modal) document.body.removeChild(modal);
}

// ===== Utility Functions =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDateMDY2(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = String(d.getFullYear()).slice(-2);
  return `${m}/${day}/${y}`;
}

function formatDateShort(date) {
  return formatDateMDY2(date);
}

function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatCurrency(amount) {
  if (!amount && amount !== 0) return '0.00';
  return parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ===== Messages =====
function showError(message) {
  const e = document.getElementById('errorMessage');
  const s = document.getElementById('successMessage');
  if (!e || !s) return;
  e.textContent = message;
  e.classList.remove('hidden');
  s.classList.add('hidden');
  setTimeout(() => e.classList.add('hidden'), 5000);
}

function showSuccess(message) {
  const e = document.getElementById('errorMessage');
  const s = document.getElementById('successMessage');
  if (!e || !s) return;
  s.textContent = message;
  s.classList.remove('hidden');
  e.classList.add('hidden');
  setTimeout(() => s.classList.add('hidden'), 5000);
}

// ===== Dashboard =====
let dashboardData = null;

async function loadDashboard() {
  try {
    showLoadingInSection('dashboardContent', 'Loading dashboard data...');

    const result = await ipcRenderer.invoke('get-dashboard-data', currentBranch);

    if (result.success) {
      dashboardData = result.data;
      renderDashboard(dashboardData);
    } else {
      showErrorInSection('dashboardContent', 'Failed to load dashboard: ' + result.message);
    }
  } catch (error) {
    showErrorInSection('dashboardContent', 'Error loading dashboard: ' + error.message);
  }
}

function renderDashboard(data) {
  const container = document.getElementById('dashboardContent');

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
      <div class="metric-card card" style="padding: 1.5rem;">
        <div class="metric-label">Overdue POs</div>
        <div class="metric-value" style="color: #dc2626;">${data.overdue.count}</div>
        <div class="metric-detail">$${formatCurrency(data.overdue.total_value)}</div>
      </div>
      
      <div class="metric-card card" style="padding: 1.5rem;">
        <div class="metric-label">Pending Acks</div>
        <div class="metric-value" style="color: #f59e0b;">${data.acknowledgements.not_reviewed}</div>
        <div class="metric-detail">${data.acknowledgements.flagged} flagged</div>
      </div>
      
      <div class="metric-card card" style="padding: 1.5rem;">
        <div class="metric-label">Upcoming (7 days)</div>
        <div class="metric-value" style="color: #06b6d4;">${data.upcoming.length}</div>
        <div class="metric-detail">Expected shipments</div>
      </div>
      
      <div class="metric-card card" style="padding: 1.5rem;">
        <div class="metric-label">Active Alerts</div>
        <div class="metric-value" style="color: ${data.alerts.length > 0 ? '#dc2626' : '#16a34a'};">${data.alerts.length}</div>
        <div class="metric-detail">${data.alerts.filter(a => a.severity === 'critical').length} critical</div>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
      <div class="card">
        <h3 style="margin: 0 0 1rem 0; padding: 1rem 1rem 0 1rem;">Top Suppliers (30 days)</h3>
        <div style="padding: 0 1rem 1rem 1rem;">
          ${data.topSuppliers.length ? `
            <table style="width: 100%; font-size: 0.875rem;">
              <thead><tr style="border-bottom: 2px solid #e2e8f0;">
                <th style="text-align: left; padding: 0.5rem 0;">Supplier</th>
                <th style="text-align: right; padding: 0.5rem 0;">POs</th>
                <th style="text-align: right; padding: 0.5rem 0;">Value</th>
              </tr></thead>
              <tbody>${data.topSuppliers.map(s => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 0.5rem 0;">${s.supplier_name}</td>
                  <td style="text-align: right;">${s.po_count}</td>
                  <td style="text-align: right;">$${formatCurrency(s.total_value)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; text-align: center; padding: 2rem;">No data</p>'}
        </div>
      </div>
      
      <div class="card">
        <h3 style="margin: 0 0 1rem 0; padding: 1rem 1rem 0 1rem;">Recent Prints (24hrs)</h3>
        <div style="padding: 0 1rem 1rem 1rem; max-height: 300px; overflow-y: auto;">
          ${data.recentPrints.length ? data.recentPrints.map(p => `
            <div style="padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; font-size: 0.875rem;">
              <div style="display: flex; justify-content: space-between;">
                <span style="font-weight: 600;">PO ${p.po_id}</span>
                <span style="color: #64748b;">${new Date(p.printed_date).toLocaleTimeString()}</span>
              </div>
              <div style="color: #64748b; font-size: 0.75rem;">${p.printed_by} â€¢ ${p.page_count} pages</div>
            </div>
          `).join('') : '<p style="color: #64748b; text-align: center; padding: 2rem;">No recent prints</p>'}
        </div>
      </div>
    </div>
  `;
}

function showLoadingInSection(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<div class="loading">${message}</div>`;
}

function showErrorInSection(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<div class="error">${message}</div>`;
}

// ===== Export Functions =====
async function exportCurrentPOsToExcel() {
  try {
    const { filePath } = await ipcRenderer.invoke('show-save-dialog', {
      title: 'Export POs to Excel',
      defaultPath: `POs_${currentBranch}_${new Date().toISOString().split('T')[0]}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (!filePath) return;

    showProgress('Exporting to Excel...', `Exporting ${searchResults.length} POs`, 50);

    const result = await ipcRenderer.invoke('export-pos-to-excel', {
      pos: searchResults,
      filename: filePath
    });

    hideProgress();

    if (result.success) {
      showSuccess(`Exported ${searchResults.length} POs to Excel`);
    } else {
      showError('Export failed: ' + result.message);
    }
  } catch (error) {
    hideProgress();
    showError('Export error: ' + error.message);
  }
}

async function exportAckVarianceReport() {
  try {
    const { filePath } = await ipcRenderer.invoke('show-save-dialog', {
      title: 'Export Variance Report',
      defaultPath: `Variance_Report_${currentBranch}_${new Date().toISOString().split('T')[0]}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (!filePath) return;

    showProgress('Generating variance report...', 'Please wait', 50);

    const result = await ipcRenderer.invoke('export-ack-variance-report', {
      branch: currentBranch,
      filename: filePath
    });

    hideProgress();

    if (result.success) {
      showSuccess(`Exported ${result.count} variance records`);
    } else {
      showError('Export failed: ' + result.message);
    }
  } catch (error) {
    hideProgress();
    showError('Export error: ' + error.message);
  }
}

function ensurePrintStyles() {
  if (!document.getElementById('print-styles')) {
    const style = document.createElement('style');
    style.id = 'print-styles';
    style.textContent = `
      @media print {
        .no-print, .sidebar, .header, .filters, .modal { display: none !important; }
        .main-content { margin: 0; padding: 0; width: 100%; }
        body { background: white; }
      }
    `;
    document.head.appendChild(style);
  }
}
