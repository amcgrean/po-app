// database-migrations.js - Enhanced schema for new features including background PDF parsing
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

function runMigrations(db) {
  console.log('Running database migrations...');
  
  // Migration 1: Print History
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS print_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        printed_by TEXT,
        printed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        page_count INTEGER,
        item_count INTEGER,
        batch_id TEXT,
        print_type TEXT DEFAULT 'individual',
        FOREIGN KEY (po_id) REFERENCES ack_reviews(po_id)
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_print_history_po 
      ON print_history(po_id, printed_date DESC)
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_print_history_branch 
      ON print_history(branch, printed_date DESC)
    `);
    
    console.log('✓ Migration 1: print_history table created');
  } catch (e) {
    console.warn('Migration 1 warning:', e.message);
  }
  
  // Migration 2: Acknowledgement Details (parsed from PDF)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ack_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        line_num INTEGER,
        item_code TEXT,
        description TEXT,
        quantity REAL,
        unit_price REAL,
        line_total REAL,
        extracted_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        confidence_score REAL DEFAULT 1.0,
        UNIQUE(po_id, line_num)
      )
    `);
    
    console.log('✓ Migration 2: ack_details table created');
  } catch (e) {
    console.warn('Migration 2 warning:', e.message);
  }
  
  // Migration 3: Alerts Configuration
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS alert_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT UNIQUE NOT NULL,
        enabled INTEGER DEFAULT 1,
        threshold_value REAL,
        threshold_days INTEGER,
        last_checked DATETIME,
        CHECK(enabled IN (0, 1))
      )
    `);
    
    // Insert default alert configurations
    const defaults = [
      ['variance_critical', 1, 500, null],
      ['variance_warning', 1, 100, null],
      ['no_ack_tomorrow', 1, null, 1],
      ['overdue_receipt', 1, null, 3],
      ['new_ack_scanned', 1, null, null]
    ];
    
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO alert_config (alert_type, enabled, threshold_value, threshold_days)
      VALUES (?, ?, ?, ?)
    `);
    
    defaults.forEach(config => stmt.run(...config));
    
    console.log('✓ Migration 3: alert_config table created');
  } catch (e) {
    console.warn('Migration 3 warning:', e.message);
  }
  
  // Migration 4: Alert History
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS alert_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        po_id TEXT,
        branch TEXT,
        message TEXT,
        severity TEXT CHECK(severity IN ('critical', 'warning', 'info')),
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        dismissed INTEGER DEFAULT 0,
        dismissed_by TEXT,
        dismissed_date DATETIME
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_alert_history_active
      ON alert_history(dismissed, created_date DESC)
    `);
    
    console.log('✓ Migration 4: alert_history table created');
  } catch (e) {
    console.warn('Migration 4 warning:', e.message);
  }
  
  // Migration 5: Dashboard Cache
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value TEXT,
        calculated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch, metric_name)
      )
    `);
    
    console.log('✓ Migration 5: dashboard_cache table created');
  } catch (e) {
    console.warn('Migration 5 warning:', e.message);
  }
  
  // Migration 6: Enhance ack_reviews with tolerance settings
  try {
    const columns = db.prepare(`PRAGMA table_info('ack_reviews')`).all().map(c => c.name);
    
    if (!columns.includes('variance_tolerance_pct')) {
      db.exec(`ALTER TABLE ack_reviews ADD COLUMN variance_tolerance_pct REAL DEFAULT 2.0`);
    }
    if (!columns.includes('variance_tolerance_amt')) {
      db.exec(`ALTER TABLE ack_reviews ADD COLUMN variance_tolerance_amt REAL DEFAULT 100.0`);
    }
    if (!columns.includes('auto_approved')) {
      db.exec(`ALTER TABLE ack_reviews ADD COLUMN auto_approved INTEGER DEFAULT 0`);
    }
    if (!columns.includes('extracted_from_pdf')) {
      db.exec(`ALTER TABLE ack_reviews ADD COLUMN extracted_from_pdf INTEGER DEFAULT 0`);
    }
    
    console.log('✓ Migration 6: ack_reviews enhanced');
  } catch (e) {
    console.warn('Migration 6 warning:', e.message);
  }
  
  // Migration 7: User Preferences
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        default_branch TEXT,
        alert_email TEXT,
        email_notifications INTEGER DEFAULT 0,
        preferences_json TEXT,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✓ Migration 7: user_preferences table created');
  } catch (e) {
    console.warn('Migration 7 warning:', e.message);
  }
  
  // Migration 8: Parse Queue for Background PDF Processing
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parse_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        ack_path TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'success', 'failed', 'skipped')),
        attempts INTEGER DEFAULT 0,
        last_attempt DATETIME,
        error_message TEXT,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(po_id, branch)
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parse_queue_status 
      ON parse_queue(status, priority DESC, created_date ASC)
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parse_queue_branch 
      ON parse_queue(branch, status)
    `);
    
    console.log('✓ Migration 8: parse_queue table created');
  } catch (e) {
    console.warn('Migration 8 warning:', e.message);
  }
  
  // Migration 9: Parsed Acknowledgement Data Storage
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parsed_ack_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        ack_path TEXT,
        
        -- Parsed totals
        parsed_merch_total REAL,
        parsed_freight_total REAL,
        parsed_tax_total REAL,
        parsed_grand_total REAL,
        
        -- Parsed metadata
        parsed_po_number TEXT,
        parsed_expected_date TEXT,
        parsed_order_date TEXT,
        
        -- Parsing method and confidence
        parsing_method TEXT DEFAULT 'generic',
        parse_confidence TEXT DEFAULT 'low' CHECK(parse_confidence IN ('low', 'medium', 'high')),
        confidence_score REAL DEFAULT 0,
        
        -- Field extraction details
        fields_matched INTEGER DEFAULT 0,
        fields_total INTEGER DEFAULT 0,
        fields_detail_json TEXT,
        
        -- Supplier info used for parsing
        supplier_code TEXT,
        seq_num INTEGER,
        ship_from_name TEXT,
        
        -- Status and timestamps
        parse_status TEXT DEFAULT 'pending' CHECK(parse_status IN ('pending', 'success', 'failed', 'partial')),
        parsed_date DATETIME,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        -- Raw text preview for debugging
        raw_text_preview TEXT,
        
        -- Error info if failed
        error_message TEXT,
        
        UNIQUE(po_id, branch)
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parsed_ack_data_branch 
      ON parsed_ack_data(branch, parse_status)
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parsed_ack_data_supplier 
      ON parsed_ack_data(supplier_code, seq_num)
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parsed_ack_data_confidence 
      ON parsed_ack_data(confidence_score DESC)
    `);
    
    console.log('✓ Migration 9: parsed_ack_data table created');
  } catch (e) {
    console.warn('Migration 9 warning:', e.message);
  }
  
  // Migration 10: Parsed Line Items
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parsed_line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        line_num INTEGER,
        item_code TEXT,
        description TEXT,
        quantity REAL,
        uom TEXT,
        unit_price REAL,
        line_total REAL,
        confidence_score REAL DEFAULT 0,
        parsed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (po_id, branch) REFERENCES parsed_ack_data(po_id, branch)
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parsed_line_items_po 
      ON parsed_line_items(po_id, branch)
    `);
    
    console.log('✓ Migration 10: parsed_line_items table created');
  } catch (e) {
    console.warn('Migration 10 warning:', e.message);
  }
  
  // Migration 11: Add additional columns to ack_reviews for parsed data tracking
  try {
    const columns = db.prepare(`PRAGMA table_info('ack_reviews')`).all().map(c => c.name);
    
    const addCol = (name, type) => {
      if (!columns.includes(name)) {
        try {
          db.exec(`ALTER TABLE ack_reviews ADD COLUMN ${name} ${type}`);
          console.log(`  Added column ack_reviews.${name}`);
        } catch (e) {
          console.warn(`  Could not add column ${name}:`, e.message);
        }
      }
    };
    
    // Parsed data tracking
    addCol('has_parsed_data', 'INTEGER DEFAULT 0');
    addCol('match_score', 'REAL');
    addCol('match_quality', 'TEXT');
    addCol('parsing_method', 'TEXT');
    addCol('parse_confidence', 'TEXT');
    
    // Supplier info
    addCol('supplier_code', 'TEXT');
    addCol('seq_num', 'INTEGER');
    addCol('ship_from_name', 'TEXT');
    addCol('order_date', 'TEXT');
    
    // Split totals
    addCol('ack_merch_total', 'REAL');
    addCol('ack_fee_total', 'REAL');
    addCol('po_merch_total', 'REAL');
    addCol('po_fee_total', 'REAL');
    addCol('variance_merch', 'REAL');
    addCol('variance_fee', 'REAL');
    addCol('variance_total', 'REAL');
    
    console.log('✓ Migration 11: ack_reviews parsed data columns added');
  } catch (e) {
    console.warn('Migration 11 warning:', e.message);
  }
  
  // Migration 12: Parse Statistics Table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parse_statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch TEXT NOT NULL,
        date TEXT NOT NULL,
        total_parsed INTEGER DEFAULT 0,
        successful_parses INTEGER DEFAULT 0,
        failed_parses INTEGER DEFAULT 0,
        avg_confidence_score REAL,
        high_confidence_count INTEGER DEFAULT 0,
        medium_confidence_count INTEGER DEFAULT 0,
        low_confidence_count INTEGER DEFAULT 0,
        supplier_specific_count INTEGER DEFAULT 0,
        generic_parse_count INTEGER DEFAULT 0,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch, date)
      )
    `);
    
    console.log('✓ Migration 12: parse_statistics table created');
  } catch (e) {
    console.warn('Migration 12 warning:', e.message);
  }
  
  // Migration 13: Field Extraction Log for debugging
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS field_extraction_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT,
        pattern_used TEXT,
        confidence TEXT,
        extraction_date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_field_extraction_log_po 
      ON field_extraction_log(po_id, branch)
    `);
    
    console.log('✓ Migration 13: field_extraction_log table created');
  } catch (e) {
    console.warn('Migration 13 warning:', e.message);
  }
  
  console.log('✓ All migrations completed');
}

module.exports = { runMigrations };