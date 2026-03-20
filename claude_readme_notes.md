okay i asked claude the following and have attached a :
What do we need to modify in our code to ensure the order acknowledgement module is not showing closed po acknowledgements. What I mean is the acknowledgements are all in vendor specific folders like G\Vendor Acknowledgments - Grimes\Andersen\. But only the open pos are in there. Within that folder there is an archive 2024 and archive 2025. We only care about reviewing open po acknowledgments. Having said that, we would ideally want to add a feature to our app where it would move any closed po acknowledgment to the archive folder for that vendor for that year. Each vendor should have the same archive 2024, 2025 folders. So for starters we should adjust the review screen to omit closed pos. Maybe there is benefit to having the option to view closed po acknowledgments for warranty or backorder stuff so having like a filter to view the closed would be good. It would still be important to scan thw archive folders incase something accidentally got moved to the archive by a user.  With all of that, we need to make the database for storing the ack review data such as status and costs etc. can we move that to our sql database? Also the pdf parsing and folder scanning needs to be broken out of the app to be separate as for the time being I’m gonna run that portion on my pc and push the information to the sql database. I plan to have it run automatically all the time on my pc. So the app itself would just be accessing the database and pdf files for manual review. Not doing scanning or parsing as before. This way our users can just use the app without getting slowed down with folder scanning and parsing every pdf


------claudes respone::::



I'll help you restructure the acknowledgement module to separate scanning/parsing from the app and move the data to SQL Server. Here's a comprehensive solution:

## 1. SQL Server Schema - Create These Tables

First, let's create SQL Server tables to replace the SQLite storage:

```sql
-- Table: ack_reviews (replaces SQLite table)
CREATE TABLE dbo.ack_reviews (
    id INT IDENTITY(1,1) PRIMARY KEY,
    po_id VARCHAR(50) NOT NULL,
    branch VARCHAR(10) NOT NULL,
    ack_path VARCHAR(500),
    po_total DECIMAL(18,2),
    ack_total DECIMAL(18,2),
    variance_total DECIMAL(18,2),
    po_merch_total DECIMAL(18,2),
    po_fee_total DECIMAL(18,2),
    ack_merch_total DECIMAL(18,2),
    ack_fee_total DECIMAL(18,2),
    variance_merch DECIMAL(18,2),
    variance_fee DECIMAL(18,2),
    status VARCHAR(20) DEFAULT 'not_reviewed',
    reviewed_by VARCHAR(100),
    reviewed_date DATETIME,
    notes NVARCHAR(MAX),
    supplier_code VARCHAR(50),
    seq_num INT,
    ship_from_name VARCHAR(200),
    order_date DATETIME,
    match_score DECIMAL(5,2),
    match_quality VARCHAR(20),
    has_parsed_data BIT DEFAULT 0,
    auto_approved BIT DEFAULT 0,
    created_date DATETIME DEFAULT GETDATE(),
    updated_date DATETIME DEFAULT GETDATE(),
    po_status VARCHAR(20), -- Track PO status for filtering
    is_archived BIT DEFAULT 0,
    CONSTRAINT UQ_ack_reviews_po UNIQUE (po_id, branch)
);

CREATE INDEX IX_ack_reviews_branch_status ON dbo.ack_reviews(branch, status, po_status);
CREATE INDEX IX_ack_reviews_supplier ON dbo.ack_reviews(supplier_code, seq_num);

-- Table: parsed_ack_data (replaces SQLite table)
CREATE TABLE dbo.parsed_ack_data (
    id INT IDENTITY(1,1) PRIMARY KEY,
    po_id VARCHAR(50) NOT NULL,
    branch VARCHAR(10) NOT NULL,
    ack_path VARCHAR(500),
    parsed_merch_total DECIMAL(18,2),
    parsed_freight_total DECIMAL(18,2),
    parsed_tax_total DECIMAL(18,2),
    parsed_grand_total DECIMAL(18,2),
    parsed_po_number VARCHAR(50),
    parsed_expected_date VARCHAR(50),
    parsing_method VARCHAR(50),
    parse_confidence VARCHAR(20),
    confidence_score DECIMAL(5,2),
    fields_matched INT,
    fields_total INT,
    supplier_code VARCHAR(50),
    seq_num INT,
    ship_from_name VARCHAR(200),
    parse_status VARCHAR(20),
    parsed_date DATETIME DEFAULT GETDATE(),
    updated_date DATETIME DEFAULT GETDATE(),
    raw_text_preview NVARCHAR(MAX),
    error_message NVARCHAR(500),
    CONSTRAINT UQ_parsed_ack_po UNIQUE (po_id, branch)
);

CREATE INDEX IX_parsed_ack_branch ON dbo.parsed_ack_data(branch, parse_status);

-- Table: ack_file_registry (tracks all ack files found)
CREATE TABLE dbo.ack_file_registry (
    id INT IDENTITY(1,1) PRIMARY KEY,
    branch VARCHAR(10) NOT NULL,
    po_id VARCHAR(50) NOT NULL,
    ack_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    file_modified_date DATETIME,
    is_archived BIT DEFAULT 0,
    last_scanned DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_ack_file UNIQUE (branch, po_id, ack_path)
);

CREATE INDEX IX_ack_file_branch ON dbo.ack_file_registry(branch, is_archived, last_scanned);
```

## 2. Stored Procedures for Acknowledgement Management

```sql
-- Procedure: Get acknowledgements with PO status filtering
CREATE OR ALTER PROCEDURE dbo.usp_GetAcknowledgements
    @Branch VARCHAR(10),
    @IncludeClosed BIT = 0,
    @SupplierCode VARCHAR(50) = NULL,
    @SeqNum INT = NULL,
    @Status VARCHAR(20) = NULL,
    @HasParsedData BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        a.id,
        a.po_id,
        a.branch,
        a.ack_path,
        a.po_total,
        a.ack_total,
        a.variance_total,
        a.po_merch_total,
        a.po_fee_total,
        a.ack_merch_total,
        a.ack_fee_total,
        a.variance_merch,
        a.variance_fee,
        a.status,
        a.reviewed_by,
        a.reviewed_date,
        a.notes,
        a.supplier_code,
        a.seq_num,
        a.ship_from_name,
        a.order_date,
        a.match_score,
        a.match_quality,
        a.has_parsed_data,
        a.auto_approved,
        a.po_status,
        a.is_archived,
        h.po_status as current_po_status,
        h.expect_date,
        COALESCE(totals.total_amount, 0) as current_po_total,
        p.parsed_grand_total,
        p.parsing_method,
        p.confidence_score as parsed_confidence_score
    FROM dbo.ack_reviews a
    LEFT JOIN dbo.po_header h ON a.po_id = h.po_id
    LEFT JOIN (
        SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount
        FROM po_detail 
        WHERE po_status <> 'I' 
        GROUP BY po_id
    ) totals ON a.po_id = totals.po_id
    LEFT JOIN dbo.parsed_ack_data p ON a.po_id = p.po_id AND a.branch = p.branch
    WHERE a.branch = @Branch
        AND (@IncludeClosed = 1 OR ISNULL(h.po_status, 'Open') <> 'Closed')
        AND (@SupplierCode IS NULL OR a.supplier_code = @SupplierCode)
        AND (@SeqNum IS NULL OR a.seq_num = @SeqNum)
        AND (@Status IS NULL OR @Status = 'all' OR a.status = @Status)
        AND (@HasParsedData IS NULL OR a.has_parsed_data = @HasParsedData)
    ORDER BY 
        CASE WHEN a.status = 'flagged' THEN 1 
             WHEN a.status = 'not_reviewed' THEN 2 
             ELSE 3 END,
        ABS(a.variance_total) DESC,
        a.po_id;
END
GO

-- Procedure: Save/Update acknowledgement review
CREATE OR ALTER PROCEDURE dbo.usp_SaveAckReview
    @PoId VARCHAR(50),
    @Branch VARCHAR(10),
    @AckPath VARCHAR(500) = NULL,
    @PoTotal DECIMAL(18,2) = NULL,
    @AckTotal DECIMAL(18,2) = NULL,
    @VarianceTotal DECIMAL(18,2) = NULL,
    @PoMerchTotal DECIMAL(18,2) = NULL,
    @PoFeeTotal DECIMAL(18,2) = NULL,
    @AckMerchTotal DECIMAL(18,2) = NULL,
    @AckFeeTotal DECIMAL(18,2) = NULL,
    @VarianceMerch DECIMAL(18,2) = NULL,
    @VarianceFee DECIMAL(18,2) = NULL,
    @Status VARCHAR(20),
    @ReviewedBy VARCHAR(100) = NULL,
    @Notes NVARCHAR(MAX) = NULL,
    @SupplierCode VARCHAR(50) = NULL,
    @SeqNum INT = NULL,
    @ShipFromName VARCHAR(200) = NULL,
    @OrderDate DATETIME = NULL,
    @MatchScore DECIMAL(5,2) = NULL,
    @MatchQuality VARCHAR(20) = NULL,
    @HasParsedData BIT = 0,
    @AutoApproved BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @PoStatus VARCHAR(20);
    SELECT @PoStatus = po_status FROM dbo.po_header WHERE po_id = @PoId;

    MERGE dbo.ack_reviews AS target
    USING (SELECT @PoId AS po_id, @Branch AS branch) AS source
    ON (target.po_id = source.po_id AND target.branch = source.branch)
    WHEN MATCHED THEN
        UPDATE SET
            ack_path = COALESCE(@AckPath, target.ack_path),
            po_total = COALESCE(@PoTotal, target.po_total),
            ack_total = COALESCE(@AckTotal, target.ack_total),
            variance_total = COALESCE(@VarianceTotal, target.variance_total),
            po_merch_total = COALESCE(@PoMerchTotal, target.po_merch_total),
            po_fee_total = COALESCE(@PoFeeTotal, target.po_fee_total),
            ack_merch_total = COALESCE(@AckMerchTotal, target.ack_merch_total),
            ack_fee_total = COALESCE(@AckFeeTotal, target.ack_fee_total),
            variance_merch = COALESCE(@VarianceMerch, target.variance_merch),
            variance_fee = COALESCE(@VarianceFee, target.variance_fee),
            status = @Status,
            reviewed_by = COALESCE(@ReviewedBy, target.reviewed_by),
            reviewed_date = CASE WHEN @Status = 'reviewed' THEN GETDATE() ELSE target.reviewed_date END,
            notes = COALESCE(@Notes, target.notes),
            supplier_code = COALESCE(@SupplierCode, target.supplier_code),
            seq_num = COALESCE(@SeqNum, target.seq_num),
            ship_from_name = COALESCE(@ShipFromName, target.ship_from_name),
            order_date = COALESCE(@OrderDate, target.order_date),
            match_score = COALESCE(@MatchScore, target.match_score),
            match_quality = COALESCE(@MatchQuality, target.match_quality),
            has_parsed_data = @HasParsedData,
            auto_approved = @AutoApproved,
            po_status = @PoStatus,
            updated_date = GETDATE()
    WHEN NOT MATCHED THEN
        INSERT (po_id, branch, ack_path, po_total, ack_total, variance_total,
                po_merch_total, po_fee_total, ack_merch_total, ack_fee_total,
                variance_merch, variance_fee, status, reviewed_by, reviewed_date,
                notes, supplier_code, seq_num, ship_from_name, order_date,
                match_score, match_quality, has_parsed_data, auto_approved, po_status)
        VALUES (@PoId, @Branch, @AckPath, @PoTotal, @AckTotal, @VarianceTotal,
                @PoMerchTotal, @PoFeeTotal, @AckMerchTotal, @AckFeeTotal,
                @VarianceMerch, @VarianceFee, @Status, @ReviewedBy, 
                CASE WHEN @Status = 'reviewed' THEN GETDATE() ELSE NULL END,
                @Notes, @SupplierCode, @SeqNum, @ShipFromName, @OrderDate,
                @MatchScore, @MatchQuality, @HasParsedData, @AutoApproved, @PoStatus);

    SELECT * FROM dbo.ack_reviews WHERE po_id = @PoId AND branch = @Branch;
END
GO

-- Procedure: Get closed POs that need archiving
CREATE OR ALTER PROCEDURE dbo.usp_GetAcksToArchive
    @Branch VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        a.po_id,
        a.branch,
        a.ack_path,
        a.supplier_code,
        a.seq_num,
        a.ship_from_name,
        h.po_status,
        YEAR(h.order_date) as order_year
    FROM dbo.ack_reviews a
    INNER JOIN dbo.po_header h ON a.po_id = h.po_id
    WHERE a.branch = @Branch
        AND h.po_status = 'Closed'
        AND a.is_archived = 0
        AND a.ack_path IS NOT NULL
        AND a.ack_path <> '';
END
GO
```

## 3. Modified Electron App - Remove Scanning/Parsing

Update your `main.js` to remove folder scanning and background parsing:

```javascript
// Remove these sections from main.js:
// - startAckWatchers()
// - backgroundScanBranch()
// - startBackgroundParsing()
// - All folder watching code
// - All SQLite ack_reviews/parsed_ack_data writes

// Replace with SQL Server queries:

// Get acknowledgements (now from SQL Server)
ipcMain.handle('get-acknowledgements', async (event, branch, forceRefresh = false, filters = {}) => {
  try {
    const result = await executeProc('dbo.usp_GetAcknowledgements', {
      Branch: { type: sql.VarChar(10), value: branch },
      IncludeClosed: { type: sql.Bit, value: filters.includeClosed || 0 },
      SupplierCode: { type: sql.VarChar(50), value: filters.supplierCode || null },
      SeqNum: { type: sql.Int, value: filters.seqNum || null },
      Status: { type: sql.VarChar(20), value: filters.status || null },
      HasParsedData: { type: sql.Bit, value: filters.hasParsedData !== undefined ? filters.hasParsedData : null }
    });

    if (!result.success) return result;

    return {
      success: true,
      data: result.data.map(row => ({
        ...row,
        po_total: Number(row.po_total || row.current_po_total || 0),
        ack_total: Number(row.ack_total || 0),
        variance_total: Number(row.variance_total || 0),
        ack_merch_total: Number(row.ack_merch_total || 0),
        ack_fee_total: Number(row.ack_fee_total || 0),
        variance_merch: Number(row.variance_merch || 0),
        variance_fee: Number(row.variance_fee || 0)
      }))
    };
  } catch (err) {
    console.error('get-acknowledgements error:', err);
    return { success: false, message: err.message };
  }
});

// Save acknowledgement review (now to SQL Server)
ipcMain.handle('save-ack-review', async (event, payload) => {
  try {
    const {
      po_id, status = 'reviewed', reviewed_by = null, notes = null,
      ack_merch_total, ack_fee_total, po_merch_total, po_fee_total, po_total,
      branch, ack_path, supplier_code, seq_num, ship_from_name, order_date,
      match_score, match_quality, has_parsed_data, auto_approved
    } = payload || {};

    if (!po_id) return { success: false, message: 'Missing po_id' };

    const n = v => (v === null || v === undefined || v === '' ? null : Number(v));
    const ackMerch = n(ack_merch_total) || 0;
    const ackFees = n(ack_fee_total) || 0;
    const ackTotal = ackMerch + ackFees;

    const poMerch = n(po_merch_total);
    const poFees = n(po_fee_total);
    const poTotalVal = n(po_total);

    const _poMerch = (poMerch != null) ? poMerch : (poTotalVal != null ? poTotalVal : 0);
    const _poFees = (poFees != null) ? poFees : 0;
    const _poTotal = (poTotalVal != null) ? poTotalVal : (_poMerch + _poFees);

    const varMerch = ackMerch - _poMerch;
    const varFee = ackFees - _poFees;
    const varTotal = ackTotal - _poTotal;

    const result = await executeProc('dbo.usp_SaveAckReview', {
      PoId: { type: sql.VarChar(50), value: String(po_id) },
      Branch: { type: sql.VarChar(10), value: branch },
      AckPath: { type: sql.VarChar(500), value: ack_path || null },
      PoTotal: { type: sql.Decimal(18, 2), value: _poTotal },
      AckTotal: { type: sql.Decimal(18, 2), value: ackTotal },
      VarianceTotal: { type: sql.Decimal(18, 2), value: varTotal },
      PoMerchTotal: { type: sql.Decimal(18, 2), value: _poMerch },
      PoFeeTotal: { type: sql.Decimal(18, 2), value: _poFees },
      AckMerchTotal: { type: sql.Decimal(18, 2), value: ackMerch },
      AckFeeTotal: { type: sql.Decimal(18, 2), value: ackFees },
      VarianceMerch: { type: sql.Decimal(18, 2), value: varMerch },
      VarianceFee: { type: sql.Decimal(18, 2), value: varFee },
      Status: { type: sql.VarChar(20), value: status },
      ReviewedBy: { type: sql.VarChar(100), value: reviewed_by || os.userInfo().username },
      Notes: { type: sql.NVarChar(sql.MAX), value: notes || null },
      SupplierCode: { type: sql.VarChar(50), value: supplier_code || null },
      SeqNum: { type: sql.Int, value: seq_num || null },
      ShipFromName: { type: sql.VarChar(200), value: ship_from_name || null },
      OrderDate: { type: sql.DateTime, value: order_date || null },
      MatchScore: { type: sql.Decimal(5, 2), value: match_score || null },
      MatchQuality: { type: sql.VarChar(20), value: match_quality || null },
      HasParsedData: { type: sql.Bit, value: has_parsed_data ? 1 : 0 },
      AutoApproved: { type: sql.Bit, value: auto_approved ? 1 : 0 }
    });

    if (!result.success) return result;

    return { success: true, data: result.data[0] };
  } catch (err) {
    console.error('save-ack-review error:', err);
    return { success: false, message: err.message };
  }
});

// Archive closed PO acknowledgements
ipcMain.handle('archive-closed-acks', async (event, branch) => {
  try {
    const result = await executeProc('dbo.usp_GetAcksToArchive', {
      Branch: { type: sql.VarChar(10), value: branch }
    });

    if (!result.success || !result.data.length) {
      return { success: true, archived: 0, message: 'No acknowledgements to archive' };
    }

    let archived = 0;
    const errors = [];

    for (const ack of result.data) {
      try {
        const sourcePath = ack.ack_path;
        if (!fs.existsSync(sourcePath)) {
          console.warn(`Source file not found: ${sourcePath}`);
          continue;
        }

        // Determine vendor folder from path
        const vendorFolder = path.dirname(sourcePath);
        const year = ack.order_year || new Date().getFullYear();
        const archiveFolder = path.join(vendorFolder, `archive ${year}`);

        // Create archive folder if it doesn't exist
        if (!fs.existsSync(archiveFolder)) {
          fs.mkdirSync(archiveFolder, { recursive: true });
        }

        const fileName = path.basename(sourcePath);
        const destPath = path.join(archiveFolder, fileName);

        // Move the file
        fs.renameSync(sourcePath, destPath);

        // Update database
        await executeQuery(`
          UPDATE dbo.ack_reviews 
          SET is_archived = 1, ack_path = @NewPath, updated_date = GETDATE()
          WHERE po_id = @PoId AND branch = @Branch
        `, {
          NewPath: { type: sql.VarChar(500), value: destPath },
          PoId: { type: sql.VarChar(50), value: ack.po_id },
          Branch: { type: sql.VarChar(10), value: branch }
        });

        archived++;
        console.log(`✓ Archived ${ack.po_id} to ${archiveFolder}`);
      } catch (err) {
        console.error(`Error archiving ${ack.po_id}:`, err.message);
        errors.push({ po_id: ack.po_id, error: err.message });
      }
    }

    return {
      success: true,
      archived,
      errors: errors.length > 0 ? errors : null,
      message: `Archived ${archived} acknowledgement(s)`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});
```

## 4. Create Separate Scanning/Parsing Service

Create a new file `ack-scanner-service.js`:

```javascript
// ack-scanner-service.js
// Standalone service for scanning acknowledgement folders and parsing PDFs
// Runs continuously and pushes data to SQL Server

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const chokidar = require('chokidar');
const pdfParser = require('./pdf-parser');
const supplierParserConfig = require('./supplier-parser-config');

// SQL Configuration
const dbConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 5, min: 1, idleTimeoutMillis: 30000 }
};

// Acknowledgement folder paths
const ACK_FOLDERS = {
  '10FD': process.env.ACK_PATH_10FD || '\\\\server\\share\\Vendor Acknowledgements - FD',
  '20GR': process.env.ACK_PATH_20GR || '\\\\server\\share\\Vendor Acknowledgements - Grimes',
  '25BW': process.env.ACK_PATH_25BW || '\\\\server\\share\\Vendor Acknowledgements - Grimes',
  '40CV': process.env.ACK_PATH_40CV || '\\\\server\\share\\Vendor Acknowledgements - CV'
};

let pool = null;

// Get SQL connection pool
async function getPool() {
  if (!pool) {
    pool = await new sql.ConnectionPool(dbConfig).connect();
    console.log('✓ Connected to SQL Server');
  }
  return pool;
}

// Extract PO ID from filename
function extractPOIdFromFilename(filename) {
  let name = filename.replace('.pdf', '').trim();
  name = name.replace(/^PO\s*#?\s*/i, '');
  name = name.replace(/^E-PO\s*/i, '');
  name = name.replace(/^E-/i, '');
  const match = name.match(/(\d{5,6})/);
  return match ? match[1] : null;
}

// Register acknowledgement file in SQL
async function registerAckFile(branch, poId, ackPath, isArchived = false) {
  try {
    const pool = await getPool();
    const stats = fs.statSync(ackPath);

    await pool.request()
      .input('Branch', sql.VarChar(10), branch)
      .input('PoId', sql.VarChar(50), poId)
      .input('AckPath', sql.VarChar(500), ackPath)
      .input('FileSize', sql.BigInt, stats.size)
      .input('FileModified', sql.DateTime, stats.mtime)
      .input('IsArchived', sql.Bit, isArchived ? 1 : 0)
      .query(`
        MERGE dbo.ack_file_registry AS target
        USING (SELECT @PoId AS po_id, @Branch AS branch, @AckPath AS ack_path) AS source
        ON (target.po_id = source.po_id AND target.branch = source.branch AND target.ack_path = source.ack_path)
        WHEN MATCHED THEN
          UPDATE SET 
            file_size = @FileSize,
            file_modified_date = @FileModified,
            is_archived = @IsArchived,
            last_scanned = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (branch, po_id, ack_path, file_size, file_modified_date, is_archived)
          VALUES (@Branch, @PoId, @AckPath, @FileSize, @FileModified, @IsArchived);
      `);

    console.log(`✓ Registered ${poId} (${isArchived ? 'archived' : 'active'})`);
  } catch (err) {
    console.warn(`Error registering ${poId}:`, err.message);
  }
}

// Parse and store acknowledgement data
async function parseAndStore(branch, poId, ackPath) {
  try {
    const pool = await getPool();

    // Get PO details for supplier info
    const poResult = await pool.request()
      .input('PoId', sql.VarChar(50), poId)
      .execute('dbo.usp_GetPODetails');

    if (!poResult.recordsets[0]?.[0]) {
      console.warn(`PO ${poId} not found in Agility - skipping parse`);
      return;
    }

    const poHeader = poResult.recordsets[0][0];
    const supplierCode = poHeader.supplier_code;
    const seqNum = poHeader.shipfrom_seq;
    const shipFromName = poHeader.ship_from_name;

    // Parse PDF
    const parsed = await pdfParser.parseAcknowledgement(
      ackPath,
      supplierCode,
      seqNum,
      shipFromName
    );

    if (!parsed || !parsed.success) {
      throw new Error(parsed?.message || 'Parse failed');
    }

    // Calculate match score
    const po_data = {
      po_id: poHeader.po_id,
      total_amount: Number(poHeader.total_amount || 0),
      item_count: Number(poHeader.item_count || 0),
      branch: poHeader.branch,
      supplier_name: shipFromName,
      expect_ship_date: poHeader.expect_date
    };

    const comparison = pdfParser.compareAckToPO(parsed, po_data);

    // Store in parsed_ack_data table
    await pool.request()
      .input('PoId', sql.VarChar(50), poId)
      .input('Branch', sql.VarChar(10), branch)
      .input('AckPath', sql.VarChar(500), ackPath)
      .input('ParsedMerchTotal', sql.Decimal(18, 2), parsed.totals?.merchandise_total || null)
      .input('ParsedFreightTotal', sql.Decimal(18, 2), parsed.totals?.freight_total || null)
      .input('ParsedTaxTotal', sql.Decimal(18, 2), parsed.totals?.tax_total || null)
      .input('ParsedGrandTotal', sql.Decimal(18, 2), parsed.totals?.grand_total || null)
      .input('ParsedPoNumber', sql.VarChar(50), parsed.po_number || null)
      .input('ParsedExpectedDate', sql.VarChar(50), parsed.expected_date || null)
      .input('ParsingMethod', sql.VarChar(50), parsed.parsing_method || 'generic')
      .input('ParseConfidence', sql.VarChar(20), parsed.totals?.confidence || 'low')
      .input('ConfidenceScore', sql.Decimal(5, 2), comparison.confidence_score || 0)
      .input('FieldsMatched', sql.Int, parsed.matched_fields || 0)
      .input('FieldsTotal', sql.Int, parsed.total_fields || 0)
      .input('SupplierCode', sql.VarChar(50), supplierCode)
      .input('SeqNum', sql.Int, seqNum)
      .input('ShipFromName', sql.VarChar(200), shipFromName)
      .input('RawTextPreview', sql.NVarChar(sql.MAX), (parsed.raw_text || '').substring(0, 2000))
      .query(`
        MERGE dbo.parsed_ack_data AS target
        USING (SELECT @PoId AS po_id, @Branch AS branch) AS source
        ON (target.po_id = source.po_id AND target.branch = source.branch)
        WHEN MATCHED THEN
          UPDATE SET
            ack_path = @AckPath,
            parsed_merch_total = @ParsedMerchTotal,
            parsed_freight_total = @ParsedFreightTotal,
            parsed_tax_total = @ParsedTaxTotal,
            parsed_grand_total = @ParsedGrandTotal,
            parsed_po_number = @ParsedPoNumber,
            parsed_expected_date = @ParsedExpectedDate,
            parsing_method = @ParsingMethod,
            parse_confidence = @ParseConfidence,
            confidence_score = @ConfidenceScore,
            fields_matched = @FieldsMatched,
            fields_total = @FieldsTotal,
            supplier_code = @SupplierCode,
            seq_num = @SeqNum,
            ship_from_name = @ShipFromName,
            parse_status = 'success',
            updated_date = GETDATE(),
            raw_text_preview = @RawTextPreview
        WHEN NOT MATCHED THEN
          INSERT (po_id, branch, ack_path, parsed_merch_total, parsed_freight_total,
                  parsed_tax_total, parsed_grand_total, parsed_po_number, parsed_expected_date,
                  parsing_method, parse_confidence, confidence_score, fields_matched, fields_total,
                  supplier_code, seq_num, ship_from_name, parse_status, raw_text_preview)
          VALUES (@PoId, @Branch, @AckPath, @ParsedMerchTotal, @ParsedFreightTotal,
                  @ParsedTaxTotal, @ParsedGrandTotal, @ParsedPoNumber, @ParsedExpectedDate,
                  @ParsingMethod, @ParseConfidence, @ConfidenceScore, @FieldsMatched, @FieldsTotal,
                  @SupplierCode, @SeqNum, @ShipFromName, 'success', @RawTextPreview);
      `);

    // Update/create ack_reviews entry
    await pool.request()
      .input('PoId', sql.VarChar(50), poId)
      .input('Branch', sql.VarChar(10), branch)
      .input('AckPath', sql.VarChar(500), ackPath)
      .input('PoTotal', sql.Decimal(18, 2), po_data.total_amount)
      .input('AckTotal', sql.Decimal(18, 2), parsed.totals?.grand_total || 0)
      .input('VarianceTotal', sql.Decimal(18, 2), (parsed.totals?.grand_total || 0) - po_data.total_amount)
      .input('SupplierCode', sql.VarChar(50), supplierCode)
      .input('SeqNum', sql.Int, seqNum)
      .input('ShipFromName', sql.VarChar(200), shipFromName)
      .input('OrderDate', sql.DateTime, poHeader.order_date)
      .input('MatchScore', sql.Decimal(5, 2), comparison.confidence_score)
      .input('MatchQuality', sql.VarChar(20), comparison.match_quality)
      .input('PoStatus', sql.VarChar(20), poHeader.po_status)
      .query(`
        MERGE dbo.ack_reviews AS target
        USING (SELECT @PoId AS po_id, @Branch AS branch) AS source
        ON (target.po_id = source.po_id AND target.branch = source.branch)
        WHEN MATCHED THEN
          UPDATE SET
            ack_path = @AckPath,
            po_total = @PoTotal,
            ack_total = @AckTotal,
            variance_total = @VarianceTotal,
            supplier_code = @SupplierCode,
            seq_num = @SeqNum,
            ship_from_name = @ShipFromName,
            order_date = @OrderDate,
            match_score = @MatchScore,
            match_quality = @MatchQuality,
            has_parsed_data = 1,
            po_status = @PoStatus,
            updated_date = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (po_id, branch, ack_path, po_total, ack_total, variance_total,
                  supplier_code, seq_num, ship_from_name, order_date,
                  match_score, match_quality, has_parsed_data, po_status)
          VALUES (@PoId, @Branch, @AckPath, @PoTotal, @AckTotal, @VarianceTotal,
                  @SupplierCode, @SeqNum, @ShipFromName, @OrderDate,
                  @MatchScore, @MatchQuality, 1, @PoStatus);
      `);

    console.log(`✓ Parsed and stored ${poId} (${comparison.match_quality})`);
  } catch (err) {
    console.error(`Error parsing ${poId}:`, err.message);

    // Log parse error
    const pool = await getPool();
    await pool.request()
      .input('PoId', sql.VarChar(50), poId)
      .input('Branch', sql.VarChar(10), branch)
      .input('AckPath', sql.VarChar(500), ackPath)
      .input('ErrorMessage', sql.NVarChar(500), err.message)
      .query(`
        MERGE dbo.parsed_ack_data AS target
        USING (SELECT @PoId AS po_id, @Branch AS branch) AS source
        ON (target.po_id = source.po_id AND target.branch = source.branch)
        WHEN MATCHED THEN
          UPDATE SET parse_status = 'failed', error_message = @ErrorMessage, updated_date = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (po_id, branch, ack_path, parse_status, error_message)
          VALUES (@PoId, @Branch, @AckPath, 'failed', @ErrorMessage);
      `);
  }
}

// Scan a folder for acknowledgements
async function scanFolder(branch, folderPath, isArchived = false) {
  try {
    if (!fs.existsSync(folderPath)) {
      console.warn(`Folder not found: ${folderPath}`);
      return;
    }

    console.log(`Scanning ${isArchived ? 'archive' : 'active'} folder: ${folderPath}`);

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        const poId = extractPOIdFromFilename(entry.name);
        if (poId) {
          await registerAckFile(branch, poId, fullPath, isArchived);

          // Only parse non-archived files on initial scan
          if (!isArchived) {
            await parseAndStore(branch, poId, fullPath);
          }
        }
      } else if (entry.isDirectory() && /^archive\s+\d{4}$/i.test(entry.name)) {
        // Recursively scan archive folders
        await scanFolder(branch, fullPath, true);
      }
    }

    console.log(`✓ Scan complete: ${folderPath}`);
  } catch (err) {
    console.error(`Error scanning ${folderPath}:`, err.message);
  }
}

// Start watchers for all branches
function startWatchers() {
  for (const [branch, folder] of Object.entries(ACK_FOLDERS)) {
    if (!folder || !fs.existsSync(folder)) {
      console.warn(`Folder not configured or not found for ${branch}: ${folder}`);
      continue;
    }

    console.log(`Starting watcher for ${branch}: ${folder}`);

    const watcher = chokidar.watch(folder, {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }
    });

    watcher
      .on('add', async (filePath) => {
        if (!/\.pdf$/i.test(filePath)) return;
        const poId = extractPOIdFromFilename(path.basename(filePath));
        if (!poId) return;

        const isArchived = /archive\s+\d{4}/i.test(filePath);
        console.log(`[${branch}] New file: ${path.basename(filePath)} (${isArchived ? 'archived' : 'active'})`);

        await registerAckFile(branch, poId, filePath, isArchived);

        if (!isArchived) {
          await parseAndStore(branch, poId, filePath);
        }
      })
      .on('change', async (filePath) => {
        if (!/\.pdf$/i.test(filePath)) return;
        const poId = extractPOIdFromFilename(path.basename(filePath));
        if (!poId) return;

        const isArchived = /archive\s+\d{4}/i.test(filePath);
        console.log(`[${branch}] Changed: ${path.basename(filePath)}`);

        await registerAckFile(branch, poId, filePath, isArchived);

        if (!isArchived) {
          await parseAndStore(branch, poId, filePath);
        }
      })
      .on('unlink', async (filePath) => {
        if (!/\.pdf$/i.test(filePath)) return;
        const poId = extractPOIdFromFilename(path.basename(filePath));
        if (!poId) return;

        console.log(`[${branch}] Deleted: ${path.basename(filePath)}`);

        // Remove from registry
        const pool = await getPool();
        await pool.request()
          .input('Branch', sql.VarChar(10), branch)
          .input('PoId', sql.VarChar(50), poId)
          .input('AckPath', sql.VarChar(500), filePath)
          .query(`DELETE FROM dbo.ack_file_registry WHERE branch = @Branch AND po_id = @PoId AND ack_path = @AckPath`);
      })
      .on('error', (err) => console.error(`Watcher error [${branch}]:`, err.message));

    // Initial scan
    scanFolder(branch, folder, false);
  }
}

// Main
async function main() {
  console.log('=== Acknowledgement Scanner Service ===');
  console.log('Connecting to SQL Server...');

  await getPool();

  console.log('Loading supplier parsing configurations...');
  supplierParserConfig.loadSupplierConfigs();

  console.log('Starting folder watchers...');
  startWatchers();

  console.log('✓ Service running. Press Ctrl+C to stop.');
}

// Start service
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (pool) await pool.close();
  process.exit(0);
});
```

## 5. Update Frontend - Add "Show Closed" Filter

Update the acknowledgement review modal in `index.html` to add a filter:

```html
<!-- In the acknowledgements modal, add filter controls -->
<div style="padding: 1.5rem; border-bottom: 1px solid #e2e8f0;">
  <div style="display: flex; gap: 1rem; align-items: center;">
    <label style="display: flex; align-items: center; gap: 0.5rem;">
      <input type="checkbox" id="includeClosedPOs" style="width: 18px; height: 18px;">
      <span>Show Closed POs</span>
    </label>
    
    <label style="display: flex; align-items: center; gap: 0.5rem;">
      <input type="checkbox" id="showOnlyUnparsed" style="width: 18px; height: 18px;">
      <span>Only Unparsed</span>
    </label>

    <button id="archiveClosedBtn" class="btn btn-secondary">📦 Archive Closed POs</button>
  </div>
</div>
```

And update `renderer.js` to handle these filters:

```javascript
// In renderer.js

async function loadAcknowledgements(forceRefresh = false) {
  const branch = currentBranch;
  const includeClosed = document.getElementById('includeClosedPOs')?.checked || false;
  const onlyUnparsed = document.getElementById('showOnlyUnparsed')?.checked || false;
  
  const filters = {
    includeClosed,
    hasParsedData: onlyUnparsed ? false : undefined,
    status: 'all'
  };

  const result = await window.api.invoke('get-acknowledgements', branch, forceRefresh, filters);
  
  // ... rest of rendering logic
}

// Archive closed POs button
document.getElementById('archiveClosedBtn')?.addEventListener('click', async () => {
  if (!confirm('Archive all closed PO acknowledgements to year-specific archive folders?')) {
    return;
  }

  showMessage('Archiving closed PO acknowledgements...', 'info');
  
  const result = await window.api.invoke('archive-closed-acks', currentBranch);
  
  if (result.success) {
    showMessage(result.message, 'success');
    await loadAcknowledgements(true);
  } else {
    showMessage('Error: ' + result.message, 'error');
  }
});

// Filter change handlers
document.getElementById('includeClosedPOs')?.addEventListener('change', () => loadAcknowledgements(false));
document.getElementById('showOnlyUnparsed')?.addEventListener('change', () => loadAcknowledgements(false));
```

## Summary

This restructuring:

1. **Moves data to SQL Server** - All `ack_reviews`, `parsed_ack_data`, and file tracking now in SQL
2. **Removes scanning/parsing from app** - Electron app only reads from SQL and displays PDFs
3. **Creates standalone service** - `ack-scanner-service.js` runs continuously, scanning folders and parsing PDFs
4. **Filters closed POs** - UI checkbox to show/hide closed POs
5. **Auto-archives closed POs** - Button to move closed PO acknowledgements to archive folders
6. **Scans archive folders** - Service still tracks archived files but doesn't parse them

Your users get a fast, responsive app while the heavy lifting happens on your PC in the background!