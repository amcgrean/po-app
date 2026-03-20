// supplier-parser-config.js - Supplier-specific acknowledgement parsing configurations
const fs = require('fs');
const path = require('path');

/**
 * Supplier-specific parsing configuration
 * Loaded from CSV template filled out by team
 * 
 * Structure:
 * {
 *   "LMC1000-002": {
 *     supplier_code: "LMC1000",
 *     seq_num: 2,
 *     ship_from_name: "Novo Building Products",
 *     patterns: {
 *       po_number: [...],
 *       date: [...],
 *       expected_date: [...],
 *       merchandise_total: [...],
 *       freight_total: [...],
 *       tax_total: [...],
 *       grand_total: [...]
 *     }
 *   }
 * }
 */

let supplierConfigs = {};
let configsByShipFromName = {}; // Fallback lookup by name

/**
 * Load supplier configurations from CSV template
 */
function loadSupplierConfigs(csvPath = null) {
  try {
    // Try user data directory first, then fallback to app directory
    const userDataPath = path.join(
      require('electron').app.getPath('userData'),
      'supplier-config.csv'
    );
    const appPath = path.join(__dirname, 'supplier-config.csv');

    const configPath =
      csvPath || (fs.existsSync(userDataPath) ? userDataPath : appPath);

    if (!fs.existsSync(configPath)) {
      console.warn('No supplier configuration CSV found. Using generic parsing.');
      return {};
    }


    console.log('Loading supplier configs from:', configPath);
    const csvContent = fs.readFileSync(configPath, 'utf-8');
    const lines = csvContent
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('Supplier Code'));

    supplierConfigs = {};
    configsByShipFromName = {};

    for (const line of lines) {
      const [
        supplier_code,
        seq_num,
        ship_from_name,
        field_type,
        field_label,
        example_value,
        position,
        notes
      ] = line.split(',').map(s => s?.trim());

      if (!supplier_code || !seq_num || !ship_from_name || !field_type || !field_label) {
        continue; // Skip incomplete rows
      }

      // Composite key: supplier_code-seq_num
      const compositeKey = `${supplier_code}-${String(seq_num).padStart(3, '0')}`;

      // Initialize config for this supplier if not exists
      if (!supplierConfigs[compositeKey]) {
        supplierConfigs[compositeKey] = {
          supplier_code,
          seq_num: parseInt(seq_num, 10),
          ship_from_name,
          patterns: {
            po_number: [],
            date: [],
            expected_date: [],
            merchandise_total: [],
            freight_total: [],
            tax_total: [],
            grand_total: []
          }
        };

        // Also index by ship_from_name for fallback
        configsByShipFromName[ship_from_name.toLowerCase()] =
          supplierConfigs[compositeKey];
      }

      // Build regex pattern from field label
      const pattern = buildPattern(field_type, field_label, position);

      // Add pattern to appropriate field type
      const fieldKey = field_type.toLowerCase().replace(/\s+/g, '_');
      if (supplierConfigs[compositeKey].patterns[fieldKey]) {
        supplierConfigs[compositeKey].patterns[fieldKey].push({
          label: field_label,
          pattern,
          position: position || 'any',
          example: example_value,
          notes
        });
      }
    }

    console.log(`✓ Loaded ${Object.keys(supplierConfigs).length} supplier configurations`);
    return supplierConfigs;
  } catch (error) {
    console.error('Error loading supplier configs:', error);
    return {};
  }
}

/**
 * Build regex pattern from field label and type
 */
function buildPattern(fieldType, label, position) {
  // Escape special regex characters in label
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  switch (fieldType.toLowerCase()) {
    case 'po number':
    case 'po_number':
      // Match label followed by optional colon/space and capture 5-10 digits
      return new RegExp(`${escapedLabel}[:\\s]*([\\d]{5,10})`, 'i');

    case 'date':
    case 'expected date':
    case 'expected_date':
      // Match label followed by date in various formats
      return new RegExp(
        `${escapedLabel}[:\\s]*([\\d]{1,2}[\\/\\-][\\d]{1,2}[\\/\\-][\\d]{2,4})`,
        'i'
      );

    case 'merchandise total':
    case 'merchandise_total':
    case 'freight total':
    case 'freight_total':
    case 'tax total':
    case 'tax_total':
    case 'grand total':
    case 'grand_total':
      // Match label followed by currency amount
      return new RegExp(
        `${escapedLabel}[:\\s]*\\$?\\s*([\\d,]+\\.\\d{2})`,
        'i'
      );

    default:
      return new RegExp(`${escapedLabel}[:\\s]*([^\\n\\r]+)`, 'i');
  }
}

/**
 * Get parsing configuration for a supplier
 * 
 * Lookup priority:
 * 1. Try composite key: supplier_code-seq_num (e.g., "LMC1000-002")
 * 2. Fallback to ship_from_name (case-insensitive)
 * 3. Return null if no config found (will use generic parsing)
 */
function getSupplierConfig(supplierCode, seqNum, shipFromName) {
  // Try composite key first (most precise)
  const compositeKey = `${supplierCode}-${String(seqNum).padStart(3, '0')}`;
  let config = supplierConfigs[compositeKey];

  if (config) {
    console.log(`✓ Found config for ${compositeKey} (${shipFromName})`);
    return config;
  }

  // Fallback to ship_from_name lookup
  if (shipFromName) {
    config = configsByShipFromName[shipFromName.toLowerCase()];
    if (config) {
      console.log(`✓ Found config for "${shipFromName}" (fallback lookup)`);
      return config;
    }
  }

  console.log(
    `⚠️  No specific config found for ${compositeKey} (${shipFromName}). Using generic parsing.`
  );
  return null;
}

/**
 * Parse acknowledgement PDF text using supplier-specific configuration
 */
function parseWithConfig(pdfText, supplierCode, seqNum, shipFromName) {
  const config = getSupplierConfig(supplierCode, seqNum, shipFromName);

  if (!config) {
    return null; // Caller should fall back to generic parsing
  }

  console.log(`Parsing PDF with config for ${config.ship_from_name}`);

  const result = {
    supplier_code: config.supplier_code,
    seq_num: config.seq_num,
    ship_from_name: config.ship_from_name,
    po_number: null,
    date: null,
    expected_date: null,
    merchandise_total: null,
    freight_total: null,
    tax_total: null,
    grand_total: null,
    confidence: 'low'
  };

  let matchCount = 0;
  let totalFields = 0;

  // Try each field type
  for (const [fieldKey, patterns] of Object.entries(config.patterns)) {
    if (!patterns || patterns.length === 0) continue;

    totalFields++;

    // Try each pattern for this field
    for (const patternConfig of patterns) {
      const match = pdfText.match(patternConfig.pattern);

      if (match && match[1]) {
        const value = match[1].trim();

        // Parse value based on field type
        if (fieldKey.includes('total')) {
          result[fieldKey] = parseFloat(value.replace(/,/g, ''));
        } else if (fieldKey.includes('date')) {
          result[fieldKey] = value; // Keep as string, caller can parse
        } else if (fieldKey === 'po_number') {
          result[fieldKey] = value.replace(/\D/g, ''); // Strip non-digits
        } else {
          result[fieldKey] = value;
        }

        matchCount++;
        console.log(`✓ Matched ${fieldKey}: ${value} (using "${patternConfig.label}")`);
        break; // Stop trying patterns for this field once we match
      }
    }
  }

  // Calculate confidence based on match rate
  if (totalFields > 0) {
    const matchRate = matchCount / totalFields;
    if (matchRate >= 0.8) {
      result.confidence = 'high';
    } else if (matchRate >= 0.5) {
      result.confidence = 'medium';
    } else {
      result.confidence = 'low';
    }
  }

  result.matched_fields = matchCount;
  result.total_fields = totalFields;

  console.log(
    `Parsing complete: ${matchCount}/${totalFields} fields matched (${result.confidence} confidence)`
  );

  return result;
}

/**
 * Export CSV template for team to fill out
 */
function exportTemplate(outputPath) {
  const template = `Supplier Code,Seq Num,Ship From Name,Field Type,Field Label,Example Value,Position,Notes
LMC1000,2,Novo Building Products,PO Number,Customer Order:,299768,top-third,Look for 'Customer Order:' label
LMC1000,2,Novo Building Products,Date,Date:,12/15/2024,top-third,Order/acknowledgement date
LMC1000,2,Novo Building Products,Expected Date,Ship Date:,01/05/2025,middle,Expected ship date
LMC1000,2,Novo Building Products,Merchandise Total,Subtotal:,15234.50,bottom-third,Pre-tax/freight merchandise total
LMC1000,2,Novo Building Products,Freight Total,Freight:,350.00,bottom-third,Shipping/freight charges
LMC1000,2,Novo Building Products,Tax Total,Tax:,1234.56,bottom-third,Sales tax amount
LMC1000,2,Novo Building Products,Grand Total,Total:,16819.06,bottom-third,Final total amount`;

  fs.writeFileSync(outputPath, template);
  console.log(`✓ Template exported to: ${outputPath}`);
}

// Initialize configs on load
loadSupplierConfigs();

module.exports = {
  loadSupplierConfigs,
  getSupplierConfig,
  parseWithConfig,
  exportTemplate,
  supplierConfigs
};
