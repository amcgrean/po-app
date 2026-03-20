-- =============================================
-- SQL Server Schema Setup for PO Check-in App
-- Run this script in your Agility database
-- =============================================

-- 1. Create Tables
-- =============================================

-- Table: ack_reviews (replaces SQLite table)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.ack_reviews') AND type in (N'U'))
BEGIN
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
END
GO

-- Table: parsed_ack_data (replaces SQLite table)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.parsed_ack_data') AND type in (N'U'))
BEGIN
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
END
GO

-- Table: ack_file_registry (tracks all ack files found)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.ack_file_registry') AND type in (N'U'))
BEGIN
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
END
GO

-- 2. Create Stored Procedures
-- =============================================

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

-- Procedure: Get PO Details (Required for Scanner Service)
-- Note: This was referenced in the service code but not explicitly provided in the notes.
-- I've reconstructed it based on the fields required by the service.
CREATE OR ALTER PROCEDURE dbo.usp_GetPODetails
    @PoId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        h.po_id,
        h.supplier_code,
        h.shipfrom_seq,
        h.ship_from_name,
        h.branch,
        h.expect_date,
        h.order_date,
        h.po_status,
        h.item_count,
        COALESCE(totals.total_amount, 0) as total_amount
    FROM dbo.po_header h
    LEFT JOIN (
        SELECT po_id, SUM(qty_ordered * (cost / disp_cost_conv)) as total_amount
        FROM po_detail 
        WHERE po_status <> 'I' 
        GROUP BY po_id
    ) totals ON h.po_id = totals.po_id
    WHERE h.po_id = @PoId;
END
GO
