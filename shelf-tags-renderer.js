// ============================================
// SHELF TAGS TAB - Add to END of renderer.js
// ============================================

const { ipcRenderer } = require('electron');

let shelfTagState = {
    selectedLocations: new Set(),
    selectedSublocations: new Set(),
    selectedItems: new Map(), // itemId -> row data
    allLocations: [],
    allSublocations: [],
    allItems: [],
    currentBranch: '',
    locationToSublocs: {} // Map of location -> Set of sublocations
};

// Initialize shelf tags when tab is clicked
function initShelfTags() {
    loadShelfTagBranches();
    loadShelfTagPrinters();
}

async function loadShelfTagBranches() {
    const result = await ipcRenderer.invoke('get-shelf-tag-branches');
    if (result.success) {
        const select = document.getElementById('shelfTagBranch');
        select.innerHTML = '<option value="">Select...</option>' +
            result.data.map(b => `<option value="${b}">${b}</option>`).join('');
    }
}

async function loadShelfTagPrinters() {
    const result = await ipcRenderer.invoke('get-printers');
    if (result.success) {
        const select = document.getElementById('shelfTagPrinter');
        select.innerHTML = '<option value="">Select...</option>' +
            result.data.map(p => `<option value="${p}">${p}</option>`).join('');
    }
}

// Branch change handler
document.getElementById('shelfTagBranch')?.addEventListener('change', async (e) => {
    const branch = e.target.value;
    if (!branch) return;

    shelfTagState.currentBranch = branch;
    shelfTagState.selectedLocations.clear();
    shelfTagState.selectedSublocations.clear();
    shelfTagState.selectedItems.clear();

    const result = await ipcRenderer.invoke('get-shelf-tag-locations', branch);
    if (result.success) {
        renderShelfTagLocations(result.data);
    }
});

function renderShelfTagLocations(data) {
    // Build location -> sublocations map
    const locMap = {};
    data.forEach(row => {
        const loc = row.location?.trim() || '';
        const sub = row.location_subloc?.trim() || '';
        if (!loc) return;
        if (!locMap[loc]) locMap[loc] = new Set();
        if (sub) locMap[loc].add(sub);
    });

    shelfTagState.locationToSublocs = locMap;
    shelfTagState.allLocations = Object.keys(locMap).sort();

    const html = shelfTagState.allLocations.map(loc =>
        `<div class="listbox-item" data-loc="${loc}">${loc}</div>`
    ).join('');

    document.getElementById('shelfTagLocations').innerHTML = html ||
        '<div style="padding: 1rem; text-align: center; color: #64748b;">No locations found</div>';

    // Clear sublocations
    document.getElementById('shelfTagSublocations').innerHTML =
        '<div style="padding: 1rem; text-align: center; color: #64748b;">Select a location</div>';

    // Add click handlers
    document.querySelectorAll('#shelfTagLocations .listbox-item').forEach(div => {
        div.addEventListener('click', () => {
            const loc = div.dataset.loc;
            if (shelfTagState.selectedLocations.has(loc)) {
                shelfTagState.selectedLocations.delete(loc);
                div.classList.remove('selected');
            } else {
                shelfTagState.selectedLocations.add(loc);
                div.classList.add('selected');
            }
            updateShelfTagSublocations();
            loadShelfTagItems();
        });
    });
}

function updateShelfTagSublocations() {
    if (shelfTagState.selectedLocations.size === 0) {
        document.getElementById('shelfTagSublocations').innerHTML =
            '<div style="padding: 1rem; text-align: center; color: #64748b;">Select a location</div>';
        return;
    }

    // Collect all sublocations from selected locations
    const allSubs = new Set();
    shelfTagState.selectedLocations.forEach(loc => {
        const subs = shelfTagState.locationToSublocs[loc] || new Set();
        subs.forEach(sub => allSubs.add(sub));
    });

    shelfTagState.allSublocations = Array.from(allSubs).sort();

    if (shelfTagState.allSublocations.length === 0) {
        document.getElementById('shelfTagSublocations').innerHTML =
            '<div style="padding: 1rem; text-align: center; color: #64748b;">No sublocations</div>';
        return;
    }

    const html = shelfTagState.allSublocations.map(sub =>
        `<div class="listbox-item" data-subloc="${sub}">${sub}</div>`
    ).join('');

    document.getElementById('shelfTagSublocations').innerHTML = html;

    // Add click handlers
    document.querySelectorAll('#shelfTagSublocations .listbox-item').forEach(div => {
        div.addEventListener('click', () => {
            const sub = div.dataset.subloc;
            if (shelfTagState.selectedSublocations.has(sub)) {
                shelfTagState.selectedSublocations.delete(sub);
                div.classList.remove('selected');
            } else {
                shelfTagState.selectedSublocations.add(sub);
                div.classList.add('selected');
            }
            loadShelfTagItems();
        });
    });
}

async function loadShelfTagItems() {
    if (shelfTagState.selectedLocations.size === 0) {
        document.getElementById('shelfTagItemsTable').innerHTML =
            '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Select locations</td></tr>';
        document.getElementById('shelfTagItemCount').textContent = '0';
        return;
    }

    const result = await ipcRenderer.invoke('get-shelf-tag-items', {
        systemId: shelfTagState.currentBranch,
        locations: Array.from(shelfTagState.selectedLocations),
        sublocations: Array.from(shelfTagState.selectedSublocations)
    });

    if (result.success) {
        shelfTagState.allItems = result.data;
        renderShelfTagItems();
    }
}

function renderShelfTagItems() {
    const tbody = document.getElementById('shelfTagItemsTable');
    if (shelfTagState.allItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">No items found</td></tr>';
        document.getElementById('shelfTagItemCount').textContent = '0';
        return;
    }

    tbody.innerHTML = shelfTagState.allItems.map(item => {
        const checked = shelfTagState.selectedItems.has(item.item);
        return `<tr data-item="${item.item}">
      <td><input type="checkbox" class="shelf-tag-checkbox" ${checked ? 'checked' : ''}></td>
      <td>${item.item}</td>
      <td>${item.description || ''}</td>
      <td>${item.size_ || ''}</td>
      <td>${item.location || ''}</td>
      <td>${item.location_subloc || ''}</td>
    </tr>`;
    }).join('');

    document.getElementById('shelfTagItemCount').textContent = shelfTagState.allItems.length;

    // Add click handlers
    tbody.querySelectorAll('tr[data-item]').forEach(row => {
        const checkbox = row.querySelector('.shelf-tag-checkbox');
        row.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                checkbox.checked = !checkbox.checked;
            }
            toggleShelfTagItem(row.dataset.item, checkbox.checked);
        });
        checkbox.addEventListener('change', () => {
            toggleShelfTagItem(row.dataset.item, checkbox.checked);
        });
    });
}

function toggleShelfTagItem(itemId, selected) {
    const item = shelfTagState.allItems.find(i => i.item === itemId);
    if (selected && item) {
        shelfTagState.selectedItems.set(itemId, item);
    } else {
        shelfTagState.selectedItems.delete(itemId);
    }
}

// Select all checkbox
document.getElementById('selectAllShelfTags')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    shelfTagState.allItems.forEach(item => {
        if (checked) {
            shelfTagState.selectedItems.set(item.item, item);
        } else {
            shelfTagState.selectedItems.delete(item.item);
        }
    });
    renderShelfTagItems();
});

// Print button
document.getElementById('printShelfTagsBtn')?.addEventListener('click', async () => {
    if (shelfTagState.selectedItems.size === 0) {
        alert('No items selected');
        return;
    }

    const printer = document.getElementById('shelfTagPrinter').value;
    if (!printer) {
        alert('Please select a printer in Settings');
        document.getElementById('shelfTagSettingsModal').classList.remove('hidden');
        return;
    }

    const size = document.getElementById('shelfTagSize').value;
    const qty = parseInt(document.getElementById('shelfTagQty').value) || 1;
    const rows = Array.from(shelfTagState.selectedItems.values());

    // Duplicate rows based on quantity
    const allRows = [];
    for (let i = 0; i < qty; i++) {
        allRows.push(...rows);
    }

    const result = await ipcRenderer.invoke('print-shelf-tags-zpl', {
        rows: allRows,
        size,
        printer,
        settings: { dpi: document.getElementById('shelfTagDPI').value }
    });

    if (result.success) {
        alert(`✓ Sent ${result.count} tag(s) to ${printer}`);
    } else {
        alert(`❌ Print failed: ${result.message}`);
    }
});

// Settings button
document.getElementById('shelfTagSettingsBtn')?.addEventListener('click', () => {
    document.getElementById('shelfTagSettingsModal').classList.remove('hidden');
});

document.getElementById('closeShelfTagSettings')?.addEventListener('click', () => {
    document.getElementById('shelfTagSettingsModal').classList.add('hidden');
});

document.getElementById('saveShelfTagSettings')?.addEventListener('click', () => {
    document.getElementById('shelfTagSettingsModal').classList.add('hidden');
    alert('Printer settings saved!');
});

// Tab initialization - hook into existing tab system
document.querySelector('[data-tab="shelf-tags"]')?.addEventListener('click', () => {
    initShelfTags();
});
