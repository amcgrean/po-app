// TOP OF FILE - Load environment variables FIRST
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const os = require('os');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const Database = require('better-sqlite3');
const chokidar = require('chokidar');
const { runMigrations } = require('./database-migrations');
const ExcelJS = require('exceljs');
const pdfParser = require('./pdf-parser');
const supplierParserConfig = require('./supplier-parser-config');

// ---- Single-instance lock (prevents two app windows) ----
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Disable GPU acceleration to fix those errors
app.disableHardwareAcceleration();
app.on('ready', () => {
  if (process.env.NODE_ENV !== 'development') {
    session.defaultSession.setProxy({ proxyRules: null });
  }
});

let mainWindow;
let dbConfig = null;
let db; // SQLite database for acknowledgement reviews
let poolPromise = null; // Global SQL connection pool
let ackReviewCols = []; // cached list of columns in ack_reviews
let backgroundParseInterval = null; // Background parsing timer

// Environment variable helper
const req = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in .env`);
  return v;
};

const defaultDbConfig = {
  user: req('SQL_USER'),
  password: req('SQL_PASSWORD'),
  server: req('SQL_SERVER'),
  database: req('SQL_DATABASE'),
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: {
    max: Number(process.env.SQL_POOL_MAX || 10),
    min: Number(process.env.SQL_POOL_MIN || 2),
    idleTimeoutMillis: 30000
  },
  connectionTimeout: Number(process.env.SQL_CONNECTION_TIMEOUT || 30000),
  requestTimeout: Number(process.env.SQL_REQUEST_TIMEOUT || 60000)
};

dbConfig = defaultDbConfig;

// PO Acknowledgement folder paths by branch - USE UNC PATHS
const ACK_FOLDERS = {
  '10FD': process.env.ACK_PATH_10FD || '\\\\server\\share\\Vendor Acknowledgements - FD',
  '20GR': process.env.ACK_PATH_20GR || '\\\\server\\share\\Vendor Acknowledgements - Grimes',
  '25BW': process.env.ACK_PATH_25BW || '\\\\server\\share\\Vendor Acknowledgements - Grimes',
  '40CV': process.env.ACK_PATH_40CV || '\\\\server\\share\\Vendor Acknowledgements - CV'
};

// Get or create the global connection pool
function getPool() {
  if (!poolPromise) {
    console.log('Creating new SQL connection pool...');
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then(pool => {
        console.log('✓ SQL connection pool established');
        pool.on('error', err => {
          console.error('SQL Pool Error:', err);
          poolPromise = null;
        });
        return pool;
      })
      .catch(err => {
        console.error('Failed to create SQL pool:', err);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

// ============================================
// Query/Proc Helpers (GLOBAL POOL)
// ============================================
function upsertAckCache(branch, po_id, ack_path) {
  try {
    const stmt = db.prepare(`
      INSERT INTO ack_cache (branch, po_id, ack_path)
      VALUES (?, ?, ?)
      ON CONFLICT(branch, po_id) DO UPDATE SET
        ack_path = excluded.ack_path,
        last_scanned = CURRENT_TIMESTAMP
    `);
    stmt.run(branch, String(po_id), ack_path || '');
    
    // Queue for background parsing if not already parsed
    queueForParsing(branch, po_id, ack_path);
  } catch (e) {
    console.warn('upsertAckCache error:', e.message);
  }
}

function removeFromAckCache(branch, po_id) {
  try {
    db.prepare(`DELETE FROM ack_cache WHERE branch = ? AND po_id = ?`).run(branch, String(po_id));
  } catch (e) {
    console.warn('removeFromAckCache error:', e.message);
  }
}

function extractPoFromPath(filePath) {
  const base = path.basename(filePath);
  return extractPOIdFromFilename(base);
}

async function executeQuery(query, inputs = {}) {
  try {
    console.log('Executing query...');
    const pool = await getPool();
    const request = pool.request();

    for (const key of Object.keys(inputs)) {
      const param = inputs[key];
      if (param?.type !== undefined && param?.value !== undefined) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.query(query);
    console.log('Query executed successfully. Rows:', result.recordset.length);
    return { success: true, data: result.recordset, raw: result };
  } catch (error) {
    console.error('Database error:', error);
    return { success: false, message: error.message, details: error };
  }
}

async function executeProc(procName, inputs = {}) {
  try {
    console.log('Executing proc:', procName);
    const pool = await getPool();
    const request = pool.request();

    for (const key of Object.keys(inputs)) {
      const param = inputs[key];
      if (param?.type !== undefined && param?.value !== undefined) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.execute(procName);
    const sets = result.recordsets || [];
    const first = result.recordset || [];
    console.log(`Proc ${procName} executed. Sets: ${sets.length}, Rows in first set: ${first.length}`);
    return { success: true, data: first, recordsets: sets, raw: result };
  } catch (error) {
    console.error(`Proc error [${procName}]:`, error);
    return { success: false, message: error.message, details: error };
  }
}

// ============================================
// PO Acknowledgement PDF Helpers
// ============================================

function extractPOIdFromFilename(filename) {
  let name = filename.replace('.pdf', '').trim();
  name = name.replace(/^PO\s*#?\s*/i, '');
  name = name.replace(/^E-PO\s*/i, '');
  name = name.replace(/^E-/i, '');
  const match = name.match(/(\d{5,6})/);
  return match ? match[1] : null;
}

function checkAcknowledgementExists(poId, branch) {
  const folder = ACK_FOLDERS[branch];
  if (!folder) {
    console.log(`No acknowledgement folder configured for branch: ${branch}`);
    return { exists: false, path: null };
  }

  try {
    if (!fs.existsSync(folder)) {
      console.log(`Acknowledgement folder not found: ${folder}`);
      return { exists: false, path: null };
    }

    const pdfPath = path.join(folder, `${poId}.pdf`);
    if (fs.existsSync(pdfPath)) {
      return { exists: true, path: pdfPath };
    }

    const files = fs.readdirSync(folder, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory()) {
        if (file.name.toLowerCase().includes('archive')) continue;
        const subPath = path.join(folder, file.name, `${poId}.pdf`);
        if (fs.existsSync(subPath)) {
          return { exists: true, path: subPath };
        }
      }
    }

    return { exists: false, path: null };
  } catch (error) {
    console.error(`Error checking acknowledgement for PO ${poId}:`, error);
    return { exists: false, path: null, error: error.message };
  }
}

// ============================================
// SQLite Init (ack reviews/cache)
// ============================================

function initDatabase() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'acknowledgements.db');
    console.log('Initializing database at:', dbPath);

    db = new Database(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ack_reviews (
        po_id TEXT PRIMARY KEY,
        branch TEXT NOT NULL,
        ack_path TEXT,
        po_total REAL,
        ack_total REAL,
        variance REAL,
        status TEXT DEFAULT 'not_reviewed',
        reviewed_by TEXT,
        reviewed_date TEXT,
        notes TEXT,
        created_date TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ack_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch TEXT NOT NULL,
        po_id TEXT NOT NULL,
        ack_path TEXT NOT NULL,
        last_scanned TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch, po_id)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ack_cache_branch 
      ON ack_cache(branch, last_scanned)
    `);

    console.log('✓ Database initialized successfully at:', dbPath);
    runMigrations(db);

    return true;
  } catch (error) {
    console.error('✗ Database initialization error:', error);
    db = null;
    return false;
  }
}

function refreshAckReviewCols() {
  try {
    ackReviewCols = db ? db.prepare(`PRAGMA table_info('ack_reviews')`).all().map(c => c.name) : [];
  } catch {
    ackReviewCols = [];
  }
}

function ensureAckReviewSchema() {
  if (!db) return;

  refreshAckReviewCols();
  const has = (name) => ackReviewCols.includes(name);
  const addCol = (name, type) => {
    try {
      if (!has(name)) {
        db.prepare(`ALTER TABLE ack_reviews ADD COLUMN ${name} ${type}`).run();
        console.log(`Added column ack_reviews.${name}`);
      }
    } catch (e) {
      console.warn(`Could not add column ${name}:`, e.message);
    }
  };

  // Split totals + variances
  addCol('ack_merch_total', 'REAL');
  addCol('ack_fee_total', 'REAL');
  addCol('po_merch_total', 'REAL');
  addCol('po_fee_total', 'REAL');
  addCol('variance_merch', 'REAL');
  addCol('variance_fee', 'REAL');

  // Aggregate columns
  addCol('ack_total', 'REAL');
  addCol('po_total', 'REAL');
  addCol('variance_total', 'REAL');

  // Supplier info
  addCol('supplier_code', 'TEXT');
  addCol('seq_num', 'INTEGER');
  addCol('ship_from_name', 'TEXT');
  addCol('order_date', 'TEXT');
  
  // Match info
  addCol('match_score', 'REAL');
  addCol('match_quality', 'TEXT');
  addCol('has_parsed_data', 'INTEGER DEFAULT 0');

  // Safe, nullable helpers
  addCol('ack_path', 'TEXT');
  addCol('branch', 'TEXT');

  refreshAckReviewCols();
}

// ============================================
// BACKGROUND PDF PARSING
// ============================================

function queueForParsing(branch, po_id, ack_path) {
  if (!db || !ack_path) return;
  
  try {
    // Check if already parsed successfully
    const existing = db.prepare(`
      SELECT parse_status FROM parsed_ack_data 
      WHERE po_id = ? AND branch = ?
    `).get(String(po_id), branch);
    
    if (existing && existing.parse_status === 'success') {
      return; // Already parsed
    }
    
    // Add to queue
    db.prepare(`
      INSERT INTO parse_queue (po_id, branch, ack_path, priority, status)
      VALUES (?, ?, ?, 5, 'pending')
      ON CONFLICT(po_id, branch) DO UPDATE SET
        ack_path = excluded.ack_path,
        status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END
    `).run(String(po_id), branch, ack_path);
  } catch (e) {
    console.warn('queueForParsing error:', e.message);
  }
}

async function processParseQueue() {
  if (!db) return;
  
  try {
    // Get next item from queue
    const item = db.prepare(`
      SELECT * FROM parse_queue 
      WHERE status = 'pending' AND attempts < 3
      ORDER BY priority DESC, created_date ASC
      LIMIT 1
    `).get();
    
    if (!item) return;
    
    console.log(`[Background Parse] Processing PO ${item.po_id}...`);
    
    // Mark as processing
    db.prepare(`
      UPDATE parse_queue 
      SET status = 'processing', last_attempt = CURRENT_TIMESTAMP, attempts = attempts + 1
      WHERE id = ?
    `).run(item.id);
    
    // Get PO details for supplier info
    const poResult = await executeProc('dbo.usp_GetPODetails', {
      POId: { type: sql.VarChar(50), value: item.po_id }
    });
    
    if (!poResult.success || !poResult.recordsets?.[0]?.[0]) {
      throw new Error('PO not found in Agility');
    }
    
    const poHeader = poResult.recordsets[0][0];
    const supplierCode = poHeader.supplier_code || null;
    const seqNum = poHeader.shipfrom_seq || null;
    const shipFromName = poHeader.ship_from_name || null;
    
    // Parse the PDF
    const parsed = await pdfParser.parseAcknowledgement(
      item.ack_path,
      supplierCode,
      seqNum,
      shipFromName
    );
    
    if (!parsed || !parsed.success) {
      throw new Error(parsed?.message || parsed?.error || 'Parse failed');
    }
    
    // Calculate match score
    const po_data = {
      po_id: poHeader.po_id,
      total_amount: Number(poHeader.total_amount || poHeader.po_total || 0) || 0,
      item_count: Number(poHeader.item_count || 0) || 0,
      branch: poHeader.branch,
      supplier_name: shipFromName || '',
      expect_ship_date: poHeader.expect_date || null
    };
    
    const comparison = pdfParser.compareAckToPO(parsed, po_data);
    
    // Store parsed data
    const rawTextPreview = (parsed.raw_text || '').substring(0, 2000);
    
    db.prepare(`
      INSERT INTO parsed_ack_data (
        po_id, branch, ack_path,
        parsed_merch_total, parsed_freight_total, parsed_tax_total, parsed_grand_total,
        parsed_po_number, parsed_expected_date,
        parsing_method, parse_confidence, confidence_score,
        fields_matched, fields_total,
        supplier_code, seq_num, ship_from_name,
        parse_status, parsed_date, raw_text_preview
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', CURRENT_TIMESTAMP, ?)
      ON CONFLICT(po_id, branch) DO UPDATE SET
        ack_path = excluded.ack_path,
        parsed_merch_total = excluded.parsed_merch_total,
        parsed_freight_total = excluded.parsed_freight_total,
        parsed_tax_total = excluded.parsed_tax_total,
        parsed_grand_total = excluded.parsed_grand_total,
        parsed_po_number = excluded.parsed_po_number,
        parsed_expected_date = excluded.parsed_expected_date,
        parsing_method = excluded.parsing_method,
        parse_confidence = excluded.parse_confidence,
        confidence_score = excluded.confidence_score,
        fields_matched = excluded.fields_matched,
        fields_total = excluded.fields_total,
        supplier_code = excluded.supplier_code,
        seq_num = excluded.seq_num,
        ship_from_name = excluded.ship_from_name,
        parse_status = 'success',
        parsed_date = CURRENT_TIMESTAMP,
        raw_text_preview = excluded.raw_text_preview,
        updated_date = CURRENT_TIMESTAMP
    `).run(
      String(item.po_id), item.branch, item.ack_path,
      parsed.totals?.merchandise_total ?? null,
      parsed.totals?.freight_total ?? null,
      parsed.totals?.tax_total ?? null,
      parsed.totals?.grand_total ?? null,
      parsed.po_number ?? null,
      parsed.expected_date ?? null,
      parsed.parsing_method || 'generic',
      parsed.totals?.confidence || 'low',
      comparison.confidence_score || 0,
      parsed.matched_fields || 0,
      parsed.total_fields || 0,
      supplierCode, seqNum, shipFromName,
      rawTextPreview
    );
    
    // Update ack_reviews with match info
    db.prepare(`
      UPDATE ack_reviews 
      SET has_parsed_data = 1,
          match_score = ?,
          match_quality = ?,
          supplier_code = ?,
          seq_num = ?,
          ship_from_name = ?
      WHERE po_id = ? AND branch = ?
    `).run(
      comparison.confidence_score,
      comparison.match_quality,
      supplierCode, seqNum, shipFromName,
      String(item.po_id), item.branch
    );
    
    // Remove from queue
    db.prepare(`DELETE FROM parse_queue WHERE id = ?`).run(item.id);
    
    console.log(`[Background Parse] ✓ PO ${item.po_id} parsed successfully (${comparison.match_quality})`);
    
    // Notify renderer of update
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ack-parsed', {
        po_id: item.po_id,
        branch: item.branch,
        match_score: comparison.confidence_score,
        match_quality: comparison.match_quality
      });
    }
    
  } catch (error) {
    console.error('[Background Parse] Error:', error.message);
    
    // Mark as failed in queue
    try {
      const item = db.prepare(`SELECT id FROM parse_queue WHERE status = 'processing' LIMIT 1`).get();
      if (item) {
        db.prepare(`
          UPDATE parse_queue 
          SET status = 'failed', error_message = ?
          WHERE id = ?
        `).run(error.message, item.id);
      }
    } catch (e) {}
  }
}

function startBackgroundParsing() {
  if (backgroundParseInterval) {
    clearInterval(backgroundParseInterval);
  }
  
  // Process queue every 5 seconds
  backgroundParseInterval = setInterval(() => {
    processParseQueue().catch(e => console.warn('Background parse error:', e.message));
  }, 5000);
  
  console.log('✓ Background PDF parsing started');
}

function stopBackgroundParsing() {
  if (backgroundParseInterval) {
    clearInterval(backgroundParseInterval);
    backgroundParseInterval = null;
  }
}

// ============================================
// App & Menu
// ============================================

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Branch',
          submenu: [
            { label: '10FD', type: 'radio', checked: false, click: () => { if (mainWindow) mainWindow.webContents.send('change-branch', '10FD'); } },
            { label: '20GR', type: 'radio', checked: false, click: () => { if (mainWindow) mainWindow.webContents.send('change-branch', '20GR'); } },
            { label: '25BW', type: 'radio', checked: false, click: () => { if (mainWindow) mainWindow.webContents.send('change-branch', '25BW'); } },
            { label: '40CV', type: 'radio', checked: false, click: () => { if (mainWindow) mainWindow.webContents.send('change-branch', '40CV'); } }
          ]
        },
        { type: 'separator' },
        { label: 'Acknowledgement Review', accelerator: 'Ctrl+Shift+A', click: () => { if (mainWindow) mainWindow.webContents.send('show-acknowledgements'); } },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'Alt+F4', click: () => { app.quit(); } }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              title: 'PO Check-In Manager',
              message: 'PO Check-In Manager',
              detail: 'Version 1.6.0\nCustom Purchase Order Check-In Sheet Manager\nFor Agility ERP Integration\n\nFeatures:\n- Background PDF Parsing\n- Enhanced Acknowledgement Review\n- Supplier Filtering & Sorting',
              type: 'info'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
  createMenu();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDatabase();
  ensureAckReviewSchema();
  startAckWatchers();
  startBackgroundParsing();
  createWindow();
});

app.on('window-all-closed', () => {
  stopBackgroundParsing();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================
// IPC Handlers
// ============================================

// Test connection
ipcMain.handle('test-connection', async () => {
  try {
    console.log('Testing database connection...');
    const pool = await getPool();
    await pool.request().query('SELECT 1 as test');
    await pool.request().query('SELECT TOP 1 po_id FROM po_header');
    console.log('Connection test successful!');
    return { success: true, message: 'Database connection successful' };
  } catch (error) {
    console.error('Connection test failed:', error);
    return { 
      success: false, 
      message: error.message,
      details: { code: error.code, server: dbConfig.server, database: dbConfig.database }
    };
  }
});

// Suppliers dropdown
ipcMain.handle('get-suppliers', async (event, branch) => {
  console.log('Loading suppliers for branch:', branch);

  const query = `
    SELECT 
      sf.supplier_key as supplier_id,
      sf.seq_num as seq_num,
      sf.ship_from_name as supplier_name,
      sf.ship_from_city as city,
      sf.ship_from_state as state
    FROM supp_ship_from sf
    INNER JOIN po_header h ON sf.supplier_key = h.supplier_key AND sf.seq_num = h.shipfrom_seq
    WHERE h.po_status = 'Open'
      AND h.system_id = @branch
      AND h.purchase_type != 'Direct' 
    GROUP BY sf.supplier_key, sf.seq_num, sf.ship_from_name, sf.ship_from_city, sf.ship_from_state
    ORDER BY sf.ship_from_name
  `;

  return await executeQuery(query, { branch: { type: sql.VarChar(10), value: branch } });
});

// Get suppliers for ack review (suppliers with acknowledgements)
ipcMain.handle('get-ack-suppliers', async (event, branch) => {
  console.log('Loading suppliers with acknowledgements for branch:', branch);
  
  try {
    // Get unique suppliers from ack_reviews
    const suppliers = db.prepare(`
      SELECT DISTINCT 
        supplier_code,
        seq_num,
        ship_from_name
      FROM ack_reviews
      WHERE branch = ? AND ship_from_name IS NOT NULL
      ORDER BY ship_from_name
    `).all(branch);
    
    return { success: true, data: suppliers };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// Get all open POs
ipcMain.handle('get-all-open-pos', async (event, branch) => {
  console.log('Loading all open POs for branch (PROC):', branch);

  const result = await executeProc('dbo.usp_GetAllOpenPOs', { 
    Branch: { type: sql.VarChar(10), value: branch },
    TopN:   { type: sql.Int,        value: 500 }
  });

  if (!result.success) return result;

  if (result.data && result.data.length) {
    result.data = result.data.map(po => {
      const ack = checkAcknowledgementExists(po.po_id, po.branch);
      return { ...po, ack_exists: ack.exists, ack_path: ack.path };
    });
  }
  return { success: true, data: result.data };
});

// Get PO items for expansion
ipcMain.handle('get-po-items', async (event, poId) => {
  console.log('Loading items for PO (PROC):', poId);

  const result = await executeProc('dbo.usp_GetPOItems', { 
    POId: { type: sql.VarChar(50), value: poId }
  });

  if (!result.success) return result;
  return { success: true, data: result.data };
});

// Get PO Details for Printing
ipcMain.handle('get-po-details', async (event, poId) => {
  console.log('Loading PO details (PROC) for:', poId);

  const procRes = await executeProc('dbo.usp_GetPODetails', { 
    POId: { type: sql.VarChar(50), value: poId }
  });

  if (!procRes.success) return procRes;

  const sets = procRes.recordsets || [];
  const header = (sets[0] && sets[0][0]) ? sets[0][0] : null;
  const details = sets[1] || [];
  const linkedSalesOrders = sets[2] || [];

  if (!header) {
    return { success: false, message: 'PO not found' };
  }

  const ack = checkAcknowledgementExists(poId, header.branch);
  header.ack_exists = ack.exists;
  header.ack_path = ack.path;

  return {
    success: true,
    data: {
      header,
      details,
      linkedSalesOrders,
      linkedWorkOrders: []
    }
  };
});

// Acknowledgement helpers
ipcMain.handle('check-acknowledgement', async (event, poId, branch) => {
  console.log('Checking acknowledgement for PO:', poId, 'Branch:', branch);
  const result = checkAcknowledgementExists(poId, branch);
  return result;
});

ipcMain.handle('open-acknowledgement', async (event, pdfPath) => {
  try {
    console.log('Opening PDF:', pdfPath);
    if (!fs.existsSync(pdfPath)) {
      return { success: false, message: 'PDF file not found' };
    }
    await shell.openPath(pdfPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening PDF:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-pdf-data', async (event, pdfPath) => {
  try {
    console.log('Reading PDF data:', pdfPath);
    if (!fs.existsSync(pdfPath)) {
      return { success: false, message: 'PDF file not found at: ' + pdfPath };
    }
    const pdfData = fs.readFileSync(pdfPath);
    const base64Data = pdfData.toString('base64');
    console.log('PDF loaded successfully, size:', pdfData.length, 'bytes');
    return { success: true, data: base64Data };
  } catch (error) {
    console.error('Error reading PDF:', error);
    return { success: false, message: error.message };
  }
});

// Save acknowledgement review
ipcMain.handle('save-ack-review', async (event, payload) => {
  try {
    const {
      po_id,
      status = 'reviewed',
      reviewed_by = null,
      notes = null,
      ack_merch_total,
      ack_fee_total,
      po_merch_total,
      po_fee_total,
      po_total
    } = payload || {};

    if (!po_id) return { success: false, message: 'Missing po_id' };

    const n = v => (v === null || v === undefined || v === '' ? null : Number(v));
    const ackMerch = n(ack_merch_total) || 0;
    const ackFees  = n(ack_fee_total)  || 0;
    const ackTotal = ackMerch + ackFees;

    const poMerch = n(po_merch_total);
    const poFees  = n(po_fee_total);
    const poTotalVal = n(po_total);

    const _poMerch = (poMerch != null) ? poMerch : (poTotalVal != null ? poTotalVal : 0);
    const _poFees  = (poFees  != null) ? poFees  : 0;
    const _poTotal = (poTotalVal != null) ? poTotalVal : (_poMerch + _poFees);

    const varMerch = ackMerch - _poMerch;
    const varFee   = ackFees  - _poFees;
    const varTotal = ackTotal - _poTotal;

    const reviewedDate = new Date().toISOString();

    refreshAckReviewCols();
    const hasBranch  = ackReviewCols.includes('branch');
    const hasAckPath = ackReviewCols.includes('ack_path');

    let branch = null;
    let ackPath = null;
    let supplierCode = null;
    let seqNum = null;
    let shipFromName = null;
    let orderDate = null;
    
    try {
      const det = await executeProc('dbo.usp_GetPODetails', { POId: { type: sql.VarChar(50), value: po_id } });
      const header = det.recordsets?.[0]?.[0];
      if (header) {
        branch = header.branch || null;
        supplierCode = header.supplier_code || null;
        seqNum = header.shipfrom_seq || null;
        shipFromName = header.ship_from_name || null;
        orderDate = header.order_date || null;
        const ack = checkAcknowledgementExists(po_id, branch || '');
        ackPath = ack.path || null;
      }
    } catch (e) {
      console.warn('Could not fetch branch/ack_path for save:', e.message);
    }

    // Build UPSERT
    let cols = ['po_id', 'status', 'ack_merch_total', 'ack_fee_total', 'ack_total',
                'po_merch_total', 'po_fee_total', 'po_total',
                'variance_merch', 'variance_fee', 'variance_total',
                'reviewed_by', 'reviewed_date', 'notes',
                'supplier_code', 'seq_num', 'ship_from_name', 'order_date'];
    let params = [String(po_id), status, ackMerch, ackFees, ackTotal,
                  _poMerch, _poFees, _poTotal,
                  varMerch, varFee, varTotal,
                  reviewed_by, reviewedDate, notes,
                  supplierCode, seqNum, shipFromName, orderDate];

    if (hasAckPath) { cols.unshift('ack_path'); params.unshift(ackPath); }
    if (hasBranch)  { cols.unshift('branch');  params.unshift(branch); }

    const placeholders = cols.map(() => '?').join(', ');
    const updates = cols
      .filter(c => c !== 'po_id')
      .map(c => `${c} = excluded.${c}`)
      .join(', ');

    const sqlText = `
      INSERT INTO ack_reviews (${cols.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(po_id) DO UPDATE SET
        ${updates}
    `;

    const stmt = db.prepare(sqlText);
    stmt.run(...params);


    console.log(`✓ Acknowledgement review saved for PO ${po_id} (status: ${status})`);

    return {
      success: true,
      data: {
        po_id,
        ack_merch_total: ackMerch,
        ack_fee_total: ackFees,
        ack_total: ackTotal,
        po_merch_total: _poMerch,
        po_fee_total: _poFees,
        po_total: _poTotal,
        variance_merch: varMerch,
        variance_fee: varFee,
        variance_total: varTotal,
        reviewed_by, reviewed_date: reviewedDate, status, notes,
        branch, ack_path: ackPath,
        supplier_code: supplierCode,
        seq_num: seqNum,
        ship_from_name: shipFromName
      }
    };
  } catch (err) {
    console.error('save-ack-review error:', err);
    return { success: false, message: err.message || String(err) };
  }
});

// Get acknowledgement paths
ipcMain.handle('get-ack-paths', async (event, branch) => {
  try {
    let cached = [];
    try {
      cached = db.prepare(`SELECT po_id, ack_path FROM ack_cache WHERE branch = ? ORDER BY last_scanned DESC`).all(branch);
    } catch (_) { }
    
    return { success: true, data: cached };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Get acknowledgements with full data
// Get acknowledgements with full data (NO extra PO detail queries)
ipcMain.handle('get-acknowledgements', async (event, branch, forceRefresh = false, filters = {}) => {
  try {
    if (forceRefresh) setTimeout(() => backgroundScanBranch(branch), 0);

    let cached = [];
    try {
      cached = db.prepare(
        `SELECT po_id, ack_path 
         FROM ack_cache 
         WHERE branch = ? 
         ORDER BY last_scanned DESC`
      ).all(branch);
    } catch (_) { }

    if (!cached.length) {
      // kick off a background scan for next time
      setTimeout(() => backgroundScanBranch(branch), 0);
      return { success: true, data: [], cached: true };
    }

    const startTime = Date.now();
    const rows = [];

    for (const row of cached) {
      const poId = String(row.po_id);

      // Get any saved review
      let review = null;
      try {
        review = db
          .prepare('SELECT * FROM ack_reviews WHERE po_id = ? AND branch = ?')
          .get(poId, branch) || null;
      } catch (_) {}

      // Get parsed data if present
      let parsedData = null;
      try {
        parsedData = db
          .prepare('SELECT * FROM parsed_ack_data WHERE po_id = ? AND branch = ?')
          .get(poId, branch) || null;
      } catch (_) {}

      // PO totals come from the review if we have them; otherwise we leave null
      // and let the renderer combine with the open-PO data it already has.
      const po_total       = review?.po_total ?? null;
      const po_merch_total = review?.po_merch_total ?? null;
      const po_fee_total   = review?.po_fee_total ?? null;

      const ack_total       = review?.ack_total ?? null;
      const ack_merch_total = review?.ack_merch_total ?? null;
      const ack_fee_total   = review?.ack_fee_total ?? null;

      const variance_total = review?.variance_total ?? null;
      const variance_merch = review?.variance_merch ?? null;
      const variance_fee   = review?.variance_fee ?? null;

      rows.push({
        po_id: poId,
        branch,
        ack_path: row.ack_path || null,

        po_total,
        po_merch_total,
        po_fee_total,

        ack_total,
        ack_merch_total,
        ack_fee_total,

        variance_total,
        variance_merch,
        variance_fee,

        status: (review?.status) || 'not_reviewed',
        reviewed_by: review?.reviewed_by || null,
        reviewed_date: review?.reviewed_date || null,
        notes: review?.notes || null,

        supplier_code: review?.supplier_code || parsedData?.supplier_code || null,
        seq_num: review?.seq_num || parsedData?.seq_num || null,
        ship_from_name: review?.ship_from_name || parsedData?.ship_from_name || null,
        order_date: review?.order_date || null,

        has_parsed_data: parsedData ? 1 : 0,
        match_score: parsedData?.confidence_score ?? review?.match_score ?? null,
        match_quality: parsedData?.parse_confidence ?? review?.match_quality ?? null,
        parsed_merch_total: parsedData?.parsed_merch_total ?? null,
        parsed_freight_total: parsedData?.parsed_freight_total ?? null,
        parsed_grand_total: parsedData?.parsed_grand_total ?? null,
        parsing_method: parsedData?.parsing_method ?? null
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`✓ Loaded ${rows.length} acknowledgements (no PO detail re-query) in ${elapsed}ms`);

    // Apply simple filters (same shape as before)
    let filteredRows = rows;

    if (filters.supplierCode && filters.seqNum) {
      filteredRows = filteredRows.filter(r =>
        r.supplier_code === filters.supplierCode &&
        Number(r.seq_num) === Number(filters.seqNum)
      );
    } else if (filters.shipFromName) {
      const name = String(filters.shipFromName).toLowerCase();
      filteredRows = filteredRows.filter(r =>
        (r.ship_from_name || '').toLowerCase().includes(name)
      );
    }

    if (filters.status && filters.status !== 'all') {
      filteredRows = filteredRows.filter(r => (r.status || 'not_reviewed') === filters.status);
    }

    if (filters.hasParsedData === true) {
      filteredRows = filteredRows.filter(r => r.has_parsed_data === 1);
    } else if (filters.hasParsedData === false) {
      filteredRows = filteredRows.filter(r => r.has_parsed_data !== 1);
    }

    return { success: true, data: filteredRows, cached: true };
  } catch (err) {
    console.error('get-acknowledgements error:', err);
    return { success: false, message: err.message || String(err) };
  }
});


// Get parsed data for a specific PO
ipcMain.handle('get-parsed-ack-data', async (event, poId, branch) => {
  try {
    const data = db.prepare(`
      SELECT * FROM parsed_ack_data WHERE po_id = ? AND branch = ?
    `).get(String(poId), branch);
    
    return { success: true, data: data || null };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Force re-parse a specific acknowledgement
ipcMain.handle('reparse-acknowledgement', async (event, poId, branch, ackPath) => {
  try {
    // Remove from parsed_ack_data to force re-parse
    db.prepare(`DELETE FROM parsed_ack_data WHERE po_id = ? AND branch = ?`).run(String(poId), branch);
    
    // Add to queue with high priority
    db.prepare(`
      INSERT INTO parse_queue (po_id, branch, ack_path, priority, status)
      VALUES (?, ?, ?, 10, 'pending')
      ON CONFLICT(po_id, branch) DO UPDATE SET
        status = 'pending',
        priority = 10,
        attempts = 0
    `).run(String(poId), branch, ackPath);
    
    return { success: true, message: 'Queued for re-parsing' };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Get parsing queue status
ipcMain.handle('get-parse-queue-status', async (event, branch) => {
  try {
    const pending = db.prepare(`SELECT COUNT(*) as count FROM parse_queue WHERE branch = ? AND status = 'pending'`).get(branch);
    const processing = db.prepare(`SELECT COUNT(*) as count FROM parse_queue WHERE branch = ? AND status = 'processing'`).get(branch);
    const failed = db.prepare(`SELECT COUNT(*) as count FROM parse_queue WHERE branch = ? AND status = 'failed'`).get(branch);
    
    return {
      success: true,
      data: {
        pending: pending?.count || 0,
        processing: processing?.count || 0,
        failed: failed?.count || 0
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---- Folder scan + watchers ----
async function backgroundScanBranch(branch) {
  const folder = ACK_FOLDERS[branch];
  if (!folder || !fs.existsSync(folder)) return;
  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    const seen = new Set();

    const pushPdf = (fullPath) => {
      if (!/\.pdf$/i.test(fullPath)) return;
      const po = extractPoFromPath(fullPath);
      if (po && !seen.has(po)) {
        seen.add(po);
        upsertAckCache(branch, po, fullPath);
      }
    };

    for (const ent of entries) {
      const full = path.join(folder, ent.name);
      if (ent.isFile()) {
        pushPdf(full);
      } else if (ent.isDirectory() && !/archive/i.test(ent.name)) {
        const files = fs.readdirSync(full);
        for (const f of files) pushPdf(path.join(full, f));
      }
    }
  } catch (e) {
    console.warn('backgroundScanBranch error:', branch, e.message);
  }
}

const watchers = {};
function startAckWatchers() {
  for (const [branch, folder] of Object.entries(ACK_FOLDERS)) {
    if (!folder || !fs.existsSync(folder)) continue;

    setTimeout(() => backgroundScanBranch(branch), 10);

    const watcher = chokidar.watch(folder, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    watcher
      .on('add', (file) => {
        if (!/\.pdf$/i.test(file)) return;
        const po = extractPoFromPath(file);
        if (po) upsertAckCache(branch, po, file);
      })
      .on('change', (file) => {
        if (!/\.pdf$/i.test(file)) return;
        const po = extractPoFromPath(file);
        if (po) upsertAckCache(branch, po, file);
      })
      .on('unlink', (file) => {
        if (!/\.pdf$/i.test(file)) return;
        const po = extractPoFromPath(file);
        if (po) removeFromAckCache(branch, po);
      })
      .on('error', (err) => console.warn(`Watcher error [${branch}]:`, err.message));

    watchers[branch] = watcher;
  }
}

// Parse acknowledgement PDF (manual trigger)
ipcMain.handle('parse-acknowledgement-pdf', async (event, { po_id, branch, ack_path }) => {
  try {
    console.log('Parsing acknowledgement PDF:', ack_path);

    const poResult = await executeProc('dbo.usp_GetPODetails', {
      POId: { type: sql.VarChar(50), value: po_id }
    });

    if (!poResult.success || !poResult.recordsets?.[0]?.[0]) {
      return {
        success: false,
        message: 'PO header not found for acknowledgement parse'
      };
    }

    const poHeader = poResult.recordsets[0][0];

    let supplierCode = poHeader.supplier_code || null;
    let seqNum       = poHeader.shipfrom_seq || null;
    let shipFromName = poHeader.ship_from_name || null;

    console.log(`Supplier info for PO ${po_id}:`, { supplierCode, seqNum, shipFromName });

    const parsed = await pdfParser.parseAcknowledgement(
      ack_path,
      supplierCode,
      seqNum,
      shipFromName
    );

    if (!parsed || !parsed.success) {
      return {
        success: false,
        message: parsed?.message || parsed?.error || 'PDF parsing failed'
      };
    }

    const po_data = {
      po_id: poHeader.po_id,
      total_amount: Number(poHeader.total_amount || poHeader.po_total || 0) || 0,
      item_count: Number(poHeader.item_count || 0) || 0,
      branch: poHeader.branch,
      supplier_name: poHeader.ship_from_name || poHeader.supplier_name || '',
      expect_ship_date: poHeader.expect_date || poHeader.min_exp_date || null
    };

    const comparison = pdfParser.compareAckToPO(parsed, po_data);

    // Store parsed data
    try {
      const rawTextPreview = (parsed.raw_text || '').substring(0, 2000);
      
      db.prepare(`
        INSERT INTO parsed_ack_data (
          po_id, branch, ack_path,
          parsed_merch_total, parsed_freight_total, parsed_tax_total, parsed_grand_total,
          parsed_po_number, parsed_expected_date,
          parsing_method, parse_confidence, confidence_score,
          supplier_code, seq_num, ship_from_name,
          parse_status, parsed_date, raw_text_preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', CURRENT_TIMESTAMP, ?)
        ON CONFLICT(po_id, branch) DO UPDATE SET
          parsed_merch_total = excluded.parsed_merch_total,
          parsed_freight_total = excluded.parsed_freight_total,
          parsed_tax_total = excluded.parsed_tax_total,
          parsed_grand_total = excluded.parsed_grand_total,
          parsed_po_number = excluded.parsed_po_number,
          parsed_expected_date = excluded.parsed_expected_date,
          parsing_method = excluded.parsing_method,
          parse_confidence = excluded.parse_confidence,
          confidence_score = excluded.confidence_score,
          parse_status = 'success',
          parsed_date = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
      `).run(
        String(po_id), branch, ack_path,
        parsed.totals?.merchandise_total ?? null,
        parsed.totals?.freight_total ?? null,
        parsed.totals?.tax_total ?? null,
        parsed.totals?.grand_total ?? null,
        parsed.po_number ?? null,
        parsed.expected_date ?? null,
        parsed.parsing_method || 'generic',
        parsed.totals?.confidence || 'low',
        comparison.confidence_score || 0,
        supplierCode, seqNum, shipFromName,
        rawTextPreview
      );
      
      // Update ack_reviews
      db.prepare(`
        UPDATE ack_reviews 
        SET has_parsed_data = 1,
            match_score = ?,
            match_quality = ?
        WHERE po_id = ? AND branch = ?
      `).run(comparison.confidence_score, comparison.match_quality, String(po_id), branch);
      
    } catch (e) {
      console.warn('Error storing parsed data:', e.message);
    }

    return {
      success: true,
      parsed_data: parsed,
      comparison,
      po_data,
      meta: { supplierCode, seqNum, shipFromName, branch, po_id }
    };
  } catch (error) {
    console.error('parse-acknowledgement-pdf error:', error);
    return { success: false, message: error.message || String(error) };
  }
});

// Bulk approve acknowledgements
ipcMain.handle('bulk-approve-acks', async (event, { branch, criteria }) => {
  try {
    const { max_variance_amt = 50, max_variance_pct = 2 } = criteria;
    
    const toApprove = db.prepare(`
      SELECT po_id
      FROM ack_reviews
      WHERE branch = ?
        AND status = 'not_reviewed'
        AND ABS(variance_total) <= ?
        AND (ABS(variance_total) / NULLIF(po_total, 0) * 100) <= ?
    `).all(branch, max_variance_amt, max_variance_pct);
    
    const stmt = db.prepare(`
      UPDATE ack_reviews
      SET status = 'reviewed',
          auto_approved = 1,
          reviewed_by = ?,
          reviewed_date = CURRENT_TIMESTAMP,
          notes = COALESCE(notes || ' | ', '') || 'Auto-approved (variance within tolerance)'
      WHERE po_id = ? AND branch = ?
    `);
    
    const username = os.userInfo().username;
    let count = 0;
    
    toApprove.forEach(row => {
      stmt.run(username, row.po_id, branch);
      count++;
    });
    
    return { success: true, approved_count: count };
  } catch (error) {
    console.error('Bulk approve error:', error);
    return { success: false, message: error.message };
  }
});

// Printer handlers
let PREFERRED_PRINTER = null;

ipcMain.handle('list-printers', async (event) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  try {
    if (typeof win.webContents.getPrintersAsync === 'function') {
      return await win.webContents.getPrintersAsync();
    } else if (typeof win.webContents.getPrinters === 'function') {
      return win.webContents.getPrinters();
    } else {
      return [];
    }
  } catch (error) {
    console.error('Error getting printers:', error);
    return [];
  }
});

ipcMain.handle('set-preferred-printer', async (event, printerName) => {
  PREFERRED_PRINTER = printerName || null;
  return { ok: true, name: PREFERRED_PRINTER };
});

ipcMain.handle('export-and-print-pos', async (event, { docs, deviceName, savePDFs }) => {
  try {
    console.log('=== STARTING EXPORT AND PRINT ===');

    if (!Array.isArray(docs) || docs.length === 0) {
      return { success: false, message: 'No documents to process.' };
    }

    let outDir = null;
    if (savePDFs) {
      const choice = await dialog.showOpenDialog({
        title: 'Choose folder to save PDFs',
        properties: ['openDirectory', 'createDirectory']
      });
      if (choice.canceled || !choice.filePaths?.[0]) {
        return { success: false, message: 'Export canceled.' };
      }
      outDir = choice.filePaths[0];
    }

    let saved = 0;
    let printed = 0;

    let availablePrinters = [];
    try {
      const listWin = BrowserWindow.getAllWindows()[0];
      if (listWin && listWin.webContents) {
        if (typeof listWin.webContents.getPrintersAsync === 'function') {
          availablePrinters = await listWin.webContents.getPrintersAsync();
        } else if (typeof listWin.webContents.getPrinters === 'function') {
          availablePrinters = listWin.webContents.getPrinters();
        }
      }
    } catch (printerError) {
      console.error('Error getting printer list:', printerError);
      return { success: false, message: 'Failed to get printer list.' };
    }

    const chosenPrinter =
      (PREFERRED_PRINTER && !/zebra/i.test(PREFERRED_PRINTER) ? PREFERRED_PRINTER : null) ||
      (deviceName && !/zebra/i.test(deviceName) ? deviceName : null);

    let deviceToUse = chosenPrinter;
    if (!deviceToUse && availablePrinters.length > 0) {
      const nonZebra = availablePrinters.find(p => !/zebra/i.test(p.name));
      if (nonZebra) deviceToUse = nonZebra.name;
    }

    if (!deviceToUse && availablePrinters.length > 0) {
      const defaultPrinter = availablePrinters.find(p => p.isDefault);
      if (defaultPrinter && !/zebra/i.test(defaultPrinter.name)) {
        deviceToUse = defaultPrinter.name;
      }
    }

    if (!deviceToUse) {
      const printerList = availablePrinters.length > 0 
        ? availablePrinters.map(p => p.name).join(', ')
        : 'None detected';
      return { success: false, message: `No suitable printer found.\n\nAvailable: ${printerList}` };
    }

    for (let i = 0; i < docs.length; i++) {
      const { poId, html } = docs[i];

      const htmlWin = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true }
      });
      
      try {
        await htmlWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

        const rawPdf = await htmlWin.webContents.printToPDF({
          printBackground: true,
          pageSize: 'Letter',
          landscape: false,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          preferCSSPageSize: false
        });

        const headerText = await htmlWin.webContents.executeJavaScript(`
          (function(){
            const m = document.querySelector('meta[name="po-header"]');
            return m ? m.getAttribute('content') : '';
          })();
        `);

        const stampedPdf = await stampPdf(rawPdf, headerText);

        const tmpPath = path.join(os.tmpdir(), `PO-${poId}-stamped.pdf`);
        fs.writeFileSync(tmpPath, stampedPdf);

        if (outDir) {
          const outPath = path.join(outDir, `PO-${poId}.pdf`);
          fs.writeFileSync(outPath, stampedPdf);
          saved++;
        }

        const pdfWin = new BrowserWindow({
          show: false,
          backgroundColor: '#FFFFFF',
          webPreferences: { sandbox: true, zoomFactor: 1.0 }
        });

        try {
          await pdfWin.loadURL('file://' + tmpPath);
          pdfWin.webContents.setZoomFactor(1.0);
          await new Promise(r => setTimeout(r, 500));

          await new Promise((resolve, reject) => {
            pdfWin.webContents.print(
              {
                silent: true,
                deviceName: deviceToUse,
                printBackground: true,
                pageSize: 'Letter'
              },
              (ok, err) => {
                if (ok) resolve();
                else reject(err || new Error('Print failed'));
              }
            );
          });

          printed++;
        } finally {
          pdfWin.destroy();
        }
      } finally {
        htmlWin.destroy();
      }
    }

    return { success: true, printed, saved: outDir ? saved : 0 };
  } catch (err) {
    console.error('Export and print error:', err);
    return { success: false, message: `Print operation failed: ${err.message}` };
  }
});

async function stampPdf(pdfBuffer, headerText) {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    const p = pages[i];
    const { width, height } = p.getSize();

    if (headerText) {
      p.drawText(headerText, {
        x: 18,
        y: height - 20,
        size: 10,
        font,
        color: rgb(0.15, 0.15, 0.15)
      });
    }

    const label = `Page ${i + 1} of ${total}`;

    p.drawText(label, {
      x: width - 150,
      y: height - 20,
      size: 10,
      font,
      color: rgb(0.33, 0.33, 0.33)
    });

    p.drawText(label, {
      x: width - 150,
      y: 12,
      size: 10,
      font,
      color: rgb(0.33, 0.33, 0.33)
    });
  }

  return await doc.save();
}

// Dashboard
ipcMain.handle('get-dashboard-data', async (event, branch) => {
  try {
    const [
      overduePOs,
      upcomingShipments,
      pendingAcks,
      topSuppliers,
      recentPrints,
      activeAlerts
    ] = await Promise.all([
      executeQuery(`
        SELECT 
          COUNT(DISTINCT h.po_id) as count,
          COALESCE(SUM(d.qty_ordered * (d.cost / d.disp_cost_conv)), 0) as total_value
        FROM po_header h
        INNER JOIN po_detail d ON h.po_id = d.po_id
        LEFT JOIN (
          SELECT po_id, MIN(exp_rcpt_date) as min_exp_date
          FROM po_detail WHERE po_status <> 'I' GROUP BY po_id
        ) dates ON h.po_id = dates.po_id
        WHERE h.system_id = @branch
          AND h.po_status = 'Open'
          AND h.purchase_type != 'Direct'
          AND d.po_status <> 'I'
          AND COALESCE(h.expect_date, dates.min_exp_date) < GETDATE()
      `, { branch: { type: sql.VarChar(10), value: branch } }),
      
      executeQuery(`
        SELECT h.po_id, COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date,
          sf.ship_from_name as supplier_name,
          COALESCE(totals.total_amount, 0) as total_amount,
          COALESCE(totals.item_count, 0) as item_count
        FROM po_header h
        INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
        LEFT JOIN (
          SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount, COUNT(*) as item_count
          FROM po_detail WHERE po_status <> 'I' GROUP BY po_id
        ) totals ON h.po_id = totals.po_id
        LEFT JOIN (
          SELECT po_id, MIN(exp_rcpt_date) as min_exp_date
          FROM po_detail WHERE po_status <> 'I' GROUP BY po_id
        ) dates ON h.po_id = dates.po_id
        WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
          AND COALESCE(h.expect_date, dates.min_exp_date) BETWEEN GETDATE() AND DATEADD(day, 7, GETDATE())
        ORDER BY COALESCE(h.expect_date, dates.min_exp_date) ASC
      `, { branch: { type: sql.VarChar(10), value: branch } }),
      
      Promise.resolve({
        success: true,
        data: [{ 
          not_reviewed: db.prepare(`SELECT COUNT(*) as count FROM ack_reviews WHERE branch = ? AND status = 'not_reviewed'`).get(branch)?.count || 0,
          flagged: db.prepare(`SELECT COUNT(*) as count FROM ack_reviews WHERE branch = ? AND status = 'flagged'`).get(branch)?.count || 0
        }]
      }),
      
      executeQuery(`
        SELECT TOP 5 sf.ship_from_name as supplier_name, COUNT(DISTINCT h.po_id) as po_count,
          COALESCE(SUM(d.qty_ordered * (d.cost / d.disp_cost_conv)), 0) as total_value
        FROM po_header h
        INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
        INNER JOIN po_detail d ON h.po_id = d.po_id
        WHERE h.system_id = @branch AND h.order_date >= DATEADD(day, -30, GETDATE())
          AND h.purchase_type != 'Direct' AND d.po_status <> 'I'
        GROUP BY sf.ship_from_name ORDER BY po_count DESC
      `, { branch: { type: sql.VarChar(10), value: branch } }),
      
      Promise.resolve({
        success: true,
        data: db.prepare(`
          SELECT po_id, printed_by, printed_date, page_count, item_count
          FROM print_history WHERE branch = ? AND datetime(printed_date) >= datetime('now', '-1 day')
          ORDER BY printed_date DESC LIMIT 10
        `).all(branch)
      }),
      
      Promise.resolve({
        success: true,
        data: db.prepare(`
          SELECT id, alert_type, po_id, message, severity, created_date
          FROM alert_history WHERE branch = ? AND dismissed = 0
          ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_date DESC
          LIMIT 20
        `).all(branch)
      })
    ]);
    
    return {
      success: true,
      data: {
        overdue: overduePOs.data[0] || { count: 0, total_value: 0 },
        upcoming: upcomingShipments.data || [],
        acknowledgements: pendingAcks.data[0],
        topSuppliers: topSuppliers.data || [],
        recentPrints: recentPrints.data,
        alerts: activeAlerts.data
      }
    };
  } catch (error) {
    console.error('Dashboard data error:', error);
    return { success: false, message: error.message };
  }
});

// Print history
ipcMain.handle('record-print', async (event, printData) => {
  try {
    const { po_id, branch, printed_by = os.userInfo().username, page_count, item_count, batch_id = null, print_type = 'individual' } = printData;
    
    db.prepare(`
      INSERT INTO print_history (po_id, branch, printed_by, page_count, item_count, batch_id, print_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(po_id, branch, printed_by, page_count, item_count, batch_id, print_type);
    
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-print-history', async (event, filters) => {
  try {
    const { branch, po_id, days = 30 } = filters;
    
    let query = `SELECT ph.*, datetime(ph.printed_date, 'localtime') as local_printed_date FROM print_history ph WHERE 1=1`;
    const params = [];
    
    if (branch) { query += ` AND ph.branch = ?`; params.push(branch); }
    if (po_id) { query += ` AND ph.po_id = ?`; params.push(po_id); }
    if (days) { query += ` AND datetime(ph.printed_date) >= datetime('now', '-${days} days')`; }
    
    query += ` ORDER BY ph.printed_date DESC LIMIT 100`;
    
    return { success: true, data: db.prepare(query).all(...params) };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Excel export
ipcMain.handle('export-pos-to-excel', async (event, { pos, filename }) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Purchase Orders');
    
    worksheet.columns = [
      { header: 'PO Number', key: 'po_id', width: 12 },
      { header: 'Supplier', key: 'supplier_name', width: 30 },
      { header: 'Order Date', key: 'order_date', width: 12 },
      { header: 'Expected Ship', key: 'expect_ship_date', width: 12 },
      { header: 'Reference', key: 'reference', width: 15 },
      { header: 'Item Count', key: 'item_count', width: 10 },
      { header: 'Total Amount', key: 'total_amount', width: 12 },
      { header: 'Status', key: 'po_status', width: 10 },
      { header: 'Buyer', key: 'buyer_id', width: 10 },
      { header: 'Has Ack', key: 'ack_exists', width: 8 }
    ];
    
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006834' } };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    
    pos.forEach(po => {
      worksheet.addRow({
        po_id: po.po_id,
        supplier_name: po.ship_from_name || po.supplier_name,
        order_date: po.order_date ? new Date(po.order_date) : null,
        expect_ship_date: po.expect_ship_date ? new Date(po.expect_ship_date) : null,
        reference: po.reference || '',
        item_count: po.item_count || 0,
        total_amount: po.total_amount || 0,
        po_status: po.po_status || 'Open',
        buyer_id: po.buyer_id || '',
        ack_exists: po.ack_exists ? 'Yes' : 'No'
      });
    });
    
    worksheet.getColumn('total_amount').numFmt = '$#,##0.00';
    worksheet.getColumn('order_date').numFmt = 'mm/dd/yyyy';
    worksheet.getColumn('expect_ship_date').numFmt = 'mm/dd/yyyy';
    worksheet.autoFilter = { from: 'A1', to: 'J1' };
    
    await workbook.xlsx.writeFile(filename);
    return { success: true, filename };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('export-ack-variance-report', async (event, { branch, filename }) => {
  try {
    const acks = db.prepare(`
      SELECT ar.*, datetime(ar.reviewed_date, 'localtime') as local_reviewed_date
      FROM ack_reviews ar WHERE ar.branch = ?
        AND (ABS(ar.variance_merch) > ar.variance_tolerance_amt
          OR ABS(ar.variance_fee) > ar.variance_tolerance_amt
          OR (ABS(ar.variance_merch) / NULLIF(ar.po_merch_total, 0) * 100) > ar.variance_tolerance_pct)
      ORDER BY ABS(ar.variance_total) DESC
    `).all(branch);
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Variance Report');
    
    worksheet.columns = [
      { header: 'PO Number', key: 'po_id', width: 12 },
      { header: 'PO Merch Total', key: 'po_merch_total', width: 14 },
      { header: 'PO Freight', key: 'po_fee_total', width: 12 },
      { header: 'PO Total', key: 'po_total', width: 12 },
      { header: 'Ack Merch Total', key: 'ack_merch_total', width: 14 },
      { header: 'Ack Freight', key: 'ack_fee_total', width: 12 },
      { header: 'Ack Total', key: 'ack_total', width: 12 },
      { header: 'Variance Merch', key: 'variance_merch', width: 14 },
      { header: 'Variance Freight', key: 'variance_fee', width: 14 },
      { header: 'Variance Total', key: 'variance_total', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Reviewed By', key: 'reviewed_by', width: 15 },
      { header: 'Notes', key: 'notes', width: 40 }
    ];
    
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006834' } };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    
    acks.forEach(ack => {
      const row = worksheet.addRow(ack);
      if (ack.variance_total && Math.abs(ack.variance_total) > 100) {
        ['H', 'I', 'J'].forEach(col => {
          row.getCell(col).fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: ack.variance_total > 0 ? 'FFFFC7CE' : 'FFC6EFCE' }
          };
        });
      }
    });
    
    ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(col => {
      worksheet.getColumn(col).numFmt = '$#,##0.00';
    });
    
    await workbook.xlsx.writeFile(filename);
    return { success: true, filename, count: acks.length };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Alerts
ipcMain.handle('check-alerts', async (event, branch) => {
  try {
    const alerts = [];
    const config = db.prepare('SELECT * FROM alert_config WHERE enabled = 1').all();
    
    for (const alertConfig of config) {
      switch (alertConfig.alert_type) {
        case 'variance_critical':
          const criticalVariances = db.prepare(`
            SELECT po_id, variance_total FROM ack_reviews
            WHERE branch = ? AND status != 'reviewed' AND ABS(variance_total) > ?
          `).all(branch, alertConfig.threshold_value);
          
          criticalVariances.forEach(v => {
            alerts.push({
              type: 'variance_critical', po_id: v.po_id, branch,
              message: `PO ${v.po_id} has variance of $${Math.abs(v.variance_total).toFixed(2)}`,
              severity: 'critical'
            });
          });
          break;
          
        case 'no_ack_tomorrow':
          const tomorrow = await executeQuery(`
            SELECT h.po_id, sf.ship_from_name FROM po_header h
            INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
            LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
            WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
              AND CAST(COALESCE(h.expect_date, dates.min_exp_date) AS DATE) = CAST(DATEADD(day, 1, GETDATE()) AS DATE)
          `, { branch: { type: sql.VarChar(10), value: branch } });
          
          if (tomorrow.success) {
            tomorrow.data.forEach(po => {
              const hasAck = checkAcknowledgementExists(po.po_id, branch);
              if (!hasAck.exists) {
                alerts.push({
                  type: 'no_ack_tomorrow', po_id: po.po_id, branch,
                  message: `PO ${po.po_id} (${po.ship_from_name}) expected tomorrow - no acknowledgement`,
                  severity: 'warning'
                });
              }
            });
          }
          break;
          
        case 'overdue_receipt':
          const overdue = await executeQuery(`
            SELECT h.po_id, sf.ship_from_name, COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date
            FROM po_header h
            INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
            LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
            WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
              AND COALESCE(h.expect_date, dates.min_exp_date) < DATEADD(day, -@days, GETDATE())
          `, { branch: { type: sql.VarChar(10), value: branch }, days: { type: sql.Int, value: alertConfig.threshold_days } });
          
          if (overdue.success) {
            overdue.data.forEach(po => {
              alerts.push({
                type: 'overdue_receipt', po_id: po.po_id, branch,
                message: `PO ${po.po_id} (${po.ship_from_name}) is ${alertConfig.threshold_days}+ days overdue`,
                severity: 'warning'
              });
            });
          }
          break;
      }
    }
    
    const stmt = db.prepare(`
      INSERT INTO alert_history (alert_type, po_id, branch, message, severity)
      SELECT ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM alert_history WHERE alert_type = ? AND po_id = ? AND dismissed = 0)
    `);
    
    alerts.forEach(alert => {
      stmt.run(alert.type, alert.po_id, alert.branch, alert.message, alert.severity, alert.type, alert.po_id);
    });
    
    db.prepare('UPDATE alert_config SET last_checked = CURRENT_TIMESTAMP').run();
    
    return { success: true, alerts };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('dismiss-alert', async (event, alertId) => {
  try {
    db.prepare(`UPDATE alert_history SET dismissed = 1, dismissed_by = ?, dismissed_date = CURRENT_TIMESTAMP WHERE id = ?`).run(os.userInfo().username, alertId);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Batch print
ipcMain.handle('get-batch-print-list', async (event, criteria) => {
  try {
    const { branch, type, value } = criteria;
    let query = '';
    let params = { branch: { type: sql.VarChar(10), value: branch } };
    
    switch (type) {
      case 'supplier':
        query = `
          SELECT h.*, sf.ship_from_name as supplier_name,
            COALESCE(totals.total_amount, 0) as total_amount,
            COALESCE(totals.item_count, 0) as item_count,
            COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date
          FROM po_header h
          INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
          LEFT JOIN (SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount, COUNT(*) as item_count FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) totals ON h.po_id = totals.po_id
          LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
          WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
            AND sf.supplier_key = @supplierId AND sf.seq_num = @seqNum
          ORDER BY COALESCE(h.expect_date, dates.min_exp_date)`;
        params.supplierId = { type: sql.VarChar(50), value: value.supplier_id };
        params.seqNum = { type: sql.Int, value: value.seq_num };
        break;
        
      case 'date_range':
        query = `
          SELECT h.*, sf.ship_from_name as supplier_name,
            COALESCE(totals.total_amount, 0) as total_amount,
            COALESCE(totals.item_count, 0) as item_count,
            COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date
          FROM po_header h
          INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
          LEFT JOIN (SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount, COUNT(*) as item_count FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) totals ON h.po_id = totals.po_id
          LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
          WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
            AND COALESCE(h.expect_date, dates.min_exp_date) BETWEEN @fromDate AND @toDate
          ORDER BY COALESCE(h.expect_date, dates.min_exp_date)`;
        params.fromDate = { type: sql.DateTime, value: new Date(value.from) };
        params.toDate = { type: sql.DateTime, value: new Date(value.to) };
        break;
        
      case 'flagged_acks':
        const flaggedPOs = db.prepare(`SELECT po_id FROM ack_reviews WHERE branch = ? AND status = 'flagged'`).all(branch).map(r => r.po_id);
        if (flaggedPOs.length === 0) return { success: true, data: [] };
        query = `
          SELECT h.*, sf.ship_from_name as supplier_name,
            COALESCE(totals.total_amount, 0) as total_amount,
            COALESCE(totals.item_count, 0) as item_count,
            COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date
          FROM po_header h
          INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
          LEFT JOIN (SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount, COUNT(*) as item_count FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) totals ON h.po_id = totals.po_id
          LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
          WHERE h.system_id = @branch AND h.po_id IN ('${flaggedPOs.join("','")}')
          ORDER BY h.po_id`;
        break;
        
      case 'no_ack':
        query = `
          SELECT h.*, sf.ship_from_name as supplier_name,
            COALESCE(totals.total_amount, 0) as total_amount,
            COALESCE(totals.item_count, 0) as item_count,
            COALESCE(h.expect_date, dates.min_exp_date) as expect_ship_date
          FROM po_header h
          INNER JOIN supp_ship_from sf ON h.supplier_key = sf.supplier_key AND h.shipfrom_seq = sf.seq_num
          LEFT JOIN (SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount, COUNT(*) as item_count FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) totals ON h.po_id = totals.po_id
          LEFT JOIN (SELECT po_id, MIN(exp_rcpt_date) as min_exp_date FROM po_detail WHERE po_status <> 'I' GROUP BY po_id) dates ON h.po_id = dates.po_id
          WHERE h.system_id = @branch AND h.po_status = 'Open' AND h.purchase_type != 'Direct'
          ORDER BY COALESCE(h.expect_date, dates.min_exp_date)`;
        break;
    }
    
    const result = await executeQuery(query, params);
    if (!result.success) return result;
    
    if (type === 'no_ack') {
      result.data = result.data.filter(po => !checkAcknowledgementExists(po.po_id, branch).exists);
    }
    
    return { success: true, data: result.data };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

console.log('✓ Enhanced feature handlers loaded');

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('Application starting...');
console.log('Node version:', process.version);
console.log('Electron version:', process.versions.electron);