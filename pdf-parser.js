// pdf-parser.js - Enhanced PDF parsing with detailed error tracking and field extraction
// Version 2.0 - Better error messages, field tracking, confidence scoring, preview mode
const fs = require('fs');

// Load pdfjs-dist using dynamic import (v3.x compatible)
let pdfjsLib = null;
let pdfjsLoadPromise = null;

// Field extraction tracking
const FIELD_TYPES = {
  PO_NUMBER: 'po_number',
  DATE: 'date',
  EXPECTED_DATE: 'expected_date',
  MERCHANDISE_TOTAL: 'merchandise_total',
  FREIGHT_TOTAL: 'freight_total',
  TAX_TOTAL: 'tax_total',
  GRAND_TOTAL: 'grand_total'
};

// Initialize pdfjs-dist asynchronously
async function initPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  
  pdfjsLoadPromise = (async () => {
    try {
      console.log('Attempting to load pdfjs-dist legacy build (v3.x)...');
      const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.js');
      
      // v3.x structure - check what's available
      console.log('Module keys:', Object.keys(pdfjsModule));
      
      // Try different ways to access the API
      pdfjsLib = pdfjsModule.default || pdfjsModule;
      
      console.log('pdfjs-dist loaded');
      console.log('Has getDocument?', typeof pdfjsLib.getDocument);
      
      // Disable worker for Electron environment
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = null;
      }
      console.log('✓ pdfjs-dist configured successfully');
      return pdfjsLib;
    } catch (e) {
      console.error('❌ pdfjs-dist failed to load:', e.message);
      console.error('Stack:', e.stack);
      return null;
    }
  })();
  
  return pdfjsLoadPromise;
}

/**
 * Extract text from PDF file using PDF.js
 * Enhanced with detailed error reporting
 */
async function extractPDFText(pdfPath) {
  const extractionResult = {
    success: false,
    text: '',
    numPages: 0,
    error: null,
    errorDetails: null,
    pageTexts: [], // Text per page for preview
    extractionTime: 0
  };
  
  const startTime = Date.now();
  
  try {
    // Initialize pdfjs-dist
    const pdfjs = await initPdfJs();
    
    if (!pdfjs) {
      extractionResult.error = 'PDF parsing library not available';
      extractionResult.errorDetails = {
        type: 'LIBRARY_ERROR',
        message: 'pdfjs-dist dependency not installed or failed to load',
        suggestion: 'Run: npm install pdfjs-dist'
      };
      return extractionResult;
    }
    
    // Check file exists
    if (!fs.existsSync(pdfPath)) {
      extractionResult.error = 'PDF file not found';
      extractionResult.errorDetails = {
        type: 'FILE_NOT_FOUND',
        path: pdfPath,
        suggestion: 'Verify the acknowledgement file exists at the specified path'
      };
      return extractionResult;
    }
    
    // Check file size
    const stats = fs.statSync(pdfPath);
    if (stats.size === 0) {
      extractionResult.error = 'PDF file is empty';
      extractionResult.errorDetails = {
        type: 'EMPTY_FILE',
        path: pdfPath,
        size: stats.size
      };
      return extractionResult;
    }
    
    if (stats.size > 50 * 1024 * 1024) { // 50MB limit
      extractionResult.error = 'PDF file is too large';
      extractionResult.errorDetails = {
        type: 'FILE_TOO_LARGE',
        path: pdfPath,
        size: stats.size,
        maxSize: 50 * 1024 * 1024
      };
      return extractionResult;
    }
    
    console.log('Reading PDF file:', pdfPath, `(${(stats.size / 1024).toFixed(1)}KB)`);
    
    // Read PDF file as buffer
    const dataBuffer = new Uint8Array(fs.readFileSync(pdfPath));
    
    // Load PDF document
    const loadingTask = pdfjs.getDocument({
      data: dataBuffer,
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: null,
      useWorkerFetch: false,
      isEvalSupported: false
    });
    
    console.log('Loading PDF document...');
    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;
    console.log(`PDF loaded: ${numPages} pages`);
    
    // Extract text from all pages
    let fullText = '';
    const pageTexts = [];
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
        pageTexts.push({
          pageNum,
          text: pageText,
          charCount: pageText.length
        });
      } catch (pageError) {
        console.warn(`Error extracting page ${pageNum}:`, pageError.message);
        pageTexts.push({
          pageNum,
          text: '',
          error: pageError.message
        });
      }
    }
    
    extractionResult.success = true;
    extractionResult.text = fullText;
    extractionResult.numPages = numPages;
    extractionResult.pageTexts = pageTexts;
    extractionResult.extractionTime = Date.now() - startTime;
    
    console.log(`Extracted ${fullText.length} characters of text in ${extractionResult.extractionTime}ms`);
    
    return extractionResult;
    
  } catch (error) {
    console.error('PDF extraction error:', error);
    extractionResult.error = error.message;
    extractionResult.errorDetails = {
      type: 'EXTRACTION_ERROR',
      message: error.message,
      stack: error.stack
    };
    extractionResult.extractionTime = Date.now() - startTime;
    return extractionResult;
  }
}

/**
 * Parse acknowledgement totals from PDF text with detailed field tracking
 */
function parseAcknowledgementTotals(text) {
  const results = {
    merchandise_total: null,
    freight_total: null,
    tax_total: null,
    grand_total: null,
    confidence: 'low',
    fieldsExtracted: [],
    fieldDetails: {}
  };
  
  // Clean text for parsing
  const cleanText = text.replace(/\s+/g, ' ');
  
  // Patterns for different total types with labels for tracking
  const patterns = {
    merchandise: [
      { regex: /MERCHANDISE\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'MERCHANDISE TOTAL' },
      { regex: /SUBTOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'SUBTOTAL' },
      { regex: /MATERIAL\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'MATERIAL TOTAL' },
      { regex: /PRODUCT\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'PRODUCT TOTAL' },
      { regex: /NET\s*AMOUNT[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'NET AMOUNT' },
      { regex: /TOTAL\s*MERCHANDISE[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'TOTAL MERCHANDISE' }
    ],
    freight: [
      { regex: /FREIGHT[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'FREIGHT' },
      { regex: /SHIPPING[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'SHIPPING' },
      { regex: /DELIVERY[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'DELIVERY' },
      { regex: /HANDLING[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'HANDLING' },
      { regex: /S\s*&\s*H[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'S&H' }
    ],
    tax: [
      { regex: /(?<!SUB)TAX[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'TAX' },
      { regex: /SALES\s*TAX[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'SALES TAX' },
      { regex: /STATE\s*TAX[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'STATE TAX' }
    ],
    grand: [
      { regex: /GRAND\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'GRAND TOTAL' },
      { regex: /TOTAL\s*AMOUNT[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'TOTAL AMOUNT' },
      { regex: /INVOICE\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'INVOICE TOTAL' },
      { regex: /ORDER\s*TOTAL[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'ORDER TOTAL' },
      { regex: /AMOUNT\s*DUE[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'AMOUNT DUE' },
      { regex: /TOTAL\s*DUE[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'TOTAL DUE' },
      { regex: /BALANCE\s*DUE[:\s]*\$?\s*([\d,]+\.?\d*)/i, label: 'BALANCE DUE' }
    ]
  };
  
  let matchCount = 0;
  
  // Try to match each pattern
  for (const [key, patternList] of Object.entries(patterns)) {
    for (const patternConfig of patternList) {
      const match = text.match(patternConfig.regex);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(value) && value > 0) {
          results[`${key}_total`] = value;
          matchCount++;
          
          // Track successful extraction
          results.fieldsExtracted.push({
            field: `${key}_total`,
            value: value,
            pattern: patternConfig.label,
            rawMatch: match[0]
          });
          
          results.fieldDetails[`${key}_total`] = {
            value: value,
            pattern: patternConfig.label,
            rawMatch: match[0],
            confidence: 'high'
          };
          
          console.log(`✓ Found ${key}_total: $${value.toFixed(2)} (pattern: ${patternConfig.label})`);
          break;
        }
      }
    }
  }
  
  // Set confidence based on matches
  if (matchCount >= 3) {
    results.confidence = 'high';
  } else if (matchCount >= 2) {
    results.confidence = 'medium';
  } else if (matchCount >= 1) {
    results.confidence = 'low';
  }
  
  // If we found merchandise and freight but not grand, calculate it
  if (results.merchandise_total && results.freight_total && !results.grand_total) {
    results.grand_total = results.merchandise_total + results.freight_total;
    if (results.tax_total) results.grand_total += results.tax_total;
    
    results.fieldDetails.grand_total = {
      value: results.grand_total,
      pattern: 'CALCULATED',
      rawMatch: null,
      confidence: 'medium',
      note: 'Calculated from merchandise + freight + tax'
    };
  }
  
  // If we only found grand total, assume it's all merchandise (no freight breakdown)
  if (results.grand_total && !results.merchandise_total) {
    results.merchandise_total = results.grand_total;
    results.freight_total = 0;
    
    results.fieldDetails.merchandise_total = {
      value: results.merchandise_total,
      pattern: 'INFERRED',
      rawMatch: null,
      confidence: 'low',
      note: 'Inferred from grand total (no merchandise breakdown found)'
    };
  }
  
  console.log('Parse results:', {
    merchandise: results.merchandise_total,
    freight: results.freight_total,
    tax: results.tax_total,
    grand: results.grand_total,
    confidence: results.confidence,
    fieldsFound: results.fieldsExtracted.length
  });
  
  return results;
}

/**
 * Parse line items from acknowledgement text with confidence scoring
 */
function parseLineItems(text) {
  const items = [];
  const lines = text.split('\n');
  
  // Common item line patterns
  const patterns = [
    // Pattern 1: "12345  Widget Part  10.00  EA  $15.50  $155.00"
    /(\S+)\s+(.+?)\s+([\d.]+)\s+(\w+)\s+\$?([\d,.]+)\s+\$?([\d,.]+)/,
    // Pattern 2: "12345 | Widget Part | 10.00 | EA | $15.50 | $155.00"
    /(\S+)\s*\|\s*(.+?)\s*\|\s*([\d.]+)\s*\|\s*(\w+)\s*\|\s*\$?([\d,.]+)\s*\|\s*\$?([\d,.]+)/,
    // Pattern 3: Tab-separated
    /(\S+)\t(.+?)\t([\d.]+)\t(\w+)\t\$?([\d,.]+)\t\$?([\d,.]+)/
  ];
  
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const item = {
          item_code: match[1],
          description: match[2].trim(),
          quantity: parseFloat(match[3]),
          uom: match[4],
          unit_price: parseFloat(match[5].replace(/,/g, '')),
          line_total: parseFloat(match[6].replace(/,/g, '')),
          confidence: 0.8, // Default confidence
          raw_line: line
        };
        
        // Validate item
        if (item.item_code && item.quantity > 0 && item.unit_price > 0) {
          // Calculate expected total
          const expectedTotal = item.quantity * item.unit_price;
          const tolerance = 0.02; // 2% tolerance
          
          if (Math.abs(expectedTotal - item.line_total) / item.line_total <= tolerance) {
            item.confidence = 0.95; // High confidence - math checks out
          }
          
          items.push(item);
        }
        break;
      }
    }
  }
  
  return items;
}

/**
 * Extract PO number from acknowledgement text with detailed tracking
 */
function extractPONumber(text) {
  const result = {
    value: null,
    pattern: null,
    confidence: 'low',
    allMatches: []
  };
  
  // Comprehensive patterns for PO numbers
  const patterns = [
    // Standard PO formats
    { regex: /P\.?O\.?\s*#?\s*:?\s*(\d{5,10})/i, label: 'P.O. #' },
    { regex: /PURCHASE\s*ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'PURCHASE ORDER' },
    { regex: /PO\s*NUMBER\s*:?\s*(\d{5,10})/i, label: 'PO NUMBER' },
    { regex: /ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'ORDER #' },
    
    // Customer/Cust variations
    { regex: /CUSTOMER\s*ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'CUSTOMER ORDER' },
    { regex: /CUSTOMER\s*PO\s*#?\s*:?\s*(\d{5,10})/i, label: 'CUSTOMER PO' },
    { regex: /CUST\.?\s*ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'CUST ORDER' },
    { regex: /CUST\.?\s*PO\s*#?\s*:?\s*(\d{5,10})/i, label: 'CUST PO' },
    
    // "Your" variations
    { regex: /YOUR\s*ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'YOUR ORDER' },
    { regex: /YOUR\s*PO\s*#?\s*:?\s*(\d{5,10})/i, label: 'YOUR PO' },
    { regex: /YOUR\s*PURCHASE\s*ORDER\s*#?\s*:?\s*(\d{5,10})/i, label: 'YOUR PURCHASE ORDER' },
    
    // Reference variations
    { regex: /REFERENCE\s*#?\s*:?\s*(\d{5,10})/i, label: 'REFERENCE' },
    { regex: /REF\.?\s*#?\s*:?\s*(\d{5,10})/i, label: 'REF' },
    { regex: /ORDER\s*REF\.?\s*:?\s*(\d{5,10})/i, label: 'ORDER REF' },
    
    // Job/Project variations
    { regex: /JOB\s*#?\s*:?\s*(\d{5,10})/i, label: 'JOB' },
    { regex: /PROJECT\s*#?\s*:?\s*(\d{5,10})/i, label: 'PROJECT' }
  ];
  
  for (const patternConfig of patterns) {
    const match = text.match(patternConfig.regex);
    if (match && match[1]) {
      const poNum = match[1];
      // Validate: should be 5-10 digits, most commonly 6 digits
      if (poNum.length >= 5 && poNum.length <= 10) {
        result.allMatches.push({
          value: poNum,
          pattern: patternConfig.label,
          rawMatch: match[0]
        });
        
        if (!result.value) {
          result.value = poNum;
          result.pattern = patternConfig.label;
          result.confidence = poNum.length === 6 ? 'high' : 'medium';
          console.log(`✓ Found PO number: ${poNum} (pattern: ${patternConfig.label})`);
        }
      }
    }
  }
  
  if (!result.value) {
    console.log('⚠ No PO number found in acknowledgement text');
  }
  
  return result;
}

/**
 * Parse a date string into a normalized format with validation
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Clean up the date string
  let cleaned = dateStr.trim();
  
  // VALIDATION: Quick pre-check to avoid false matches
  const hasDateIndicators = /[\/\-]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(cleaned);
  if (!hasDateIndicators) {
    return null;
  }
  
  const monthNames = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11
  };
  
  // Try various formats
  const formats = [
    // MM/DD/YYYY or MM-DD-YYYY
    { regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/, order: 'mdy' },
    // MM/DD/YY or MM-DD-YY  
    { regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/, order: 'mdy2' },
    // YYYY-MM-DD (ISO format)
    { regex: /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/, order: 'ymd' },
    // Month DD, YYYY
    { regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/, order: 'Mdy' },
    // DD Month YYYY
    { regex: /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/, order: 'dMy' }
  ];
  
  for (const format of formats) {
    const match = cleaned.match(format.regex);
    if (match) {
      let year, month, day;
      
      switch (format.order) {
        case 'mdy':
          month = parseInt(match[1]);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          break;
        case 'mdy2':
          month = parseInt(match[1]);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          year = year <= 50 ? 2000 + year : 1900 + year;
          break;
        case 'ymd':
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          break;
        case 'Mdy':
          month = monthNames[match[1].toLowerCase()];
          if (month === undefined) continue;
          month += 1;
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          break;
        case 'dMy':
          day = parseInt(match[1]);
          month = monthNames[match[2].toLowerCase()];
          if (month === undefined) continue;
          month += 1;
          year = parseInt(match[3]);
          break;
      }
      
      // Validate year is reasonable (2020-2035)
      if (year >= 2020 && year <= 2035 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract expected/promise date from acknowledgement with detailed tracking
 */
function extractExpectedDate(text) {
  const result = {
    value: null,
    pattern: null,
    confidence: 'low',
    allMatches: []
  };
  
  // Comprehensive date extraction patterns
  const patterns = [
    // Ship/Shipping dates
    { regex: /SHIP\s*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'SHIP DATE' },
    { regex: /SHIPPING\s*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'SHIPPING DATE' },
    { regex: /SHIP\s*BY[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'SHIP BY' },
    { regex: /SHIPS[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'SHIPS' },
    
    // Expected dates
    { regex: /EXPECTED[:\s]*SHIP[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'EXPECTED SHIP' },
    { regex: /EXPECTED[:\s]*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'EXPECTED DATE' },
    { regex: /EXP\.?\s*SHIP[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'EXP SHIP' },
    
    // Delivery dates
    { regex: /DELIVERY[:\s]*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'DELIVERY DATE' },
    { regex: /DELIVER[:\s]*BY[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'DELIVER BY' },
    
    // Promise/Promised dates
    { regex: /PROMISE\s*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'PROMISE DATE' },
    { regex: /PROMISED[:\s]*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'PROMISED DATE' },
    
    // Estimated dates
    { regex: /ESTIMATED[:\s]*SHIP[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'ESTIMATED SHIP' },
    { regex: /EST\.?\s*SHIP[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'EST SHIP' },
    
    // Due dates
    { regex: /DUE[:\s]*DATE[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'DUE DATE' },
    
    // ETA
    { regex: /ETA[:\s]*([\d\/\-]+|\w+\s+\d{1,2},?\s+\d{4})/i, label: 'ETA' }
  ];
  
  for (const patternConfig of patterns) {
    const match = text.match(patternConfig.regex);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      
      // Filter out false matches
      if (dateStr.length < 4 || dateStr.length > 30) continue;
      
      const hasDateIndicators = /[\/\-]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(dateStr);
      if (!hasDateIndicators) continue;
      
      const parsedDate = parseDate(dateStr);
      if (parsedDate) {
        result.allMatches.push({
          value: parsedDate,
          rawValue: dateStr,
          pattern: patternConfig.label
        });
        
        if (!result.value) {
          result.value = parsedDate;
          result.pattern = patternConfig.label;
          result.confidence = 'high';
          console.log(`✓ Found expected date: ${dateStr} -> ${parsedDate} (pattern: ${patternConfig.label})`);
        }
      }
    }
  }
  
  if (!result.value) {
    console.log('⚠ No expected date found in acknowledgement text');
  }
  
  return result;
}

/**
 * Get a text preview for debugging/review
 */
function getTextPreview(text, maxLength = 2000) {
  if (!text) return '';
  
  // Clean up whitespace
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  // Return first portion plus indication of more
  return cleaned.substring(0, maxLength) + `... [${cleaned.length - maxLength} more characters]`;
}

/**
 * Analyze text to find potential parsing opportunities
 */
function analyzeText(text) {
  const analysis = {
    totalLength: text.length,
    lineCount: text.split('\n').length,
    hasNumbers: /\d/.test(text),
    hasCurrency: /\$[\d,]+\.?\d*/.test(text),
    hasDates: /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text),
    hasPOKeywords: /(?:purchase\s*order|p\.?o\.?|customer\s*order)/i.test(text),
    hasTotalKeywords: /(?:total|subtotal|amount|balance)/i.test(text),
    hasShippingKeywords: /(?:ship|freight|delivery|handling)/i.test(text),
    potentialTotals: [],
    potentialDates: [],
    parseability: 'unknown'
  };
  
  // Find all currency values
  const currencyMatches = text.match(/\$[\d,]+\.?\d*/g) || [];
  analysis.potentialTotals = currencyMatches.slice(0, 10); // First 10
  
  // Find all date-like strings
  const dateMatches = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g) || [];
  analysis.potentialDates = dateMatches.slice(0, 5); // First 5
  
  // Determine parseability
  if (analysis.hasCurrency && analysis.hasTotalKeywords) {
    analysis.parseability = 'good';
  } else if (analysis.hasCurrency || analysis.hasNumbers) {
    analysis.parseability = 'moderate';
  } else {
    analysis.parseability = 'poor';
  }
  
  return analysis;
}

/**
 * Full acknowledgement parsing with enhanced tracking
 */
async function parseAcknowledgement(pdfPath, supplierCode = null, seqNum = null, shipFromName = null) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Starting parseAcknowledgement for:', pdfPath);
  console.log('Supplier info:', { supplierCode, seqNum, shipFromName });
  console.log('═══════════════════════════════════════════════════════════════');
  
  const startTime = Date.now();
  
  // Initialize result structure
  const result = {
    success: false,
    error: null,
    errorDetails: null,
    
    // Raw extraction
    raw_text: '',
    raw_text_preview: '',
    text_analysis: null,
    num_pages: 0,
    extraction_time: 0,
    
    // Parsed values
    po_number: null,
    po_number_details: null,
    expected_date: null,
    expected_date_details: null,
    totals: null,
    line_items: [],
    
    // Parsing metadata
    parsing_method: 'generic',
    parse_confidence: 'low',
    fields_extracted: [],
    fields_failed: [],
    matched_fields: 0,
    total_fields: 0,
    
    // Supplier info
    supplier_code: supplierCode,
    seq_num: seqNum,
    ship_from_name: shipFromName,
    
    // Timing
    extraction_date: new Date().toISOString(),
    total_time: 0
  };
  
  // Step 1: Extract text from PDF
  const extraction = await extractPDFText(pdfPath);
  result.extraction_time = extraction.extractionTime;
  
  if (!extraction.success) {
    result.error = extraction.error;
    result.errorDetails = extraction.errorDetails;
    result.total_time = Date.now() - startTime;
    console.log('❌ PDF extraction failed:', extraction.error);
    return result;
  }
  
  const text = extraction.text;
  result.raw_text = text;
  result.raw_text_preview = getTextPreview(text, 2000);
  result.num_pages = extraction.numPages;
  
  // Analyze text
  result.text_analysis = analyzeText(text);
  console.log('Text analysis:', result.text_analysis);
  
  // Step 2: Try supplier-specific parsing first
  let supplierParseResult = null;
  try {
    const supplierConfig = require('./supplier-parser-config');
    if (supplierCode && seqNum && shipFromName) {
      console.log(`Attempting supplier-specific parsing for ${supplierCode}-${seqNum} (${shipFromName})`);
      supplierParseResult = supplierConfig.parseWithConfig(text, supplierCode, seqNum, shipFromName);
      
      if (supplierParseResult && supplierParseResult.confidence !== 'low') {
        console.log(`✓ Supplier-specific parsing successful (${supplierParseResult.confidence} confidence)`);
        result.parsing_method = 'supplier_specific';
      } else {
        console.log('⚠ Supplier-specific parsing unsuccessful, falling back to generic parsing');
        supplierParseResult = null;
      }
    }
  } catch (e) {
    console.warn('Supplier config not available:', e.message);
  }
  
  // Step 3: Parse fields
  let totalFields = 4; // PO number, expected date, merchandise total, grand total
  let matchedFields = 0;
  
  // Parse PO number
  const poResult = extractPONumber(text);
  result.po_number = supplierParseResult?.po_number || poResult.value;
  result.po_number_details = poResult;
  if (result.po_number) {
    matchedFields++;
    result.fields_extracted.push({
      field: 'po_number',
      value: result.po_number,
      pattern: poResult.pattern,
      confidence: poResult.confidence
    });
  } else {
    result.fields_failed.push({
      field: 'po_number',
      reason: 'No matching pattern found'
    });
  }
  
  // Parse expected date
  const dateResult = extractExpectedDate(text);
  result.expected_date = supplierParseResult?.expected_date || dateResult.value;
  result.expected_date_details = dateResult;
  if (result.expected_date) {
    matchedFields++;
    result.fields_extracted.push({
      field: 'expected_date',
      value: result.expected_date,
      pattern: dateResult.pattern,
      confidence: dateResult.confidence
    });
  } else {
    result.fields_failed.push({
      field: 'expected_date',
      reason: 'No valid date found'
    });
  }
  
  // Parse totals
  const totalsResult = parseAcknowledgementTotals(text);
  
  // Merge supplier-specific totals if available
  if (supplierParseResult) {
    if (supplierParseResult.merchandise_total != null) {
      totalsResult.merchandise_total = supplierParseResult.merchandise_total;
    }
    if (supplierParseResult.freight_total != null) {
      totalsResult.freight_total = supplierParseResult.freight_total;
    }
    if (supplierParseResult.tax_total != null) {
      totalsResult.tax_total = supplierParseResult.tax_total;
    }
    if (supplierParseResult.grand_total != null) {
      totalsResult.grand_total = supplierParseResult.grand_total;
    }
  }
  
  result.totals = totalsResult;
  
  if (totalsResult.merchandise_total != null) {
    matchedFields++;
    result.fields_extracted.push({
      field: 'merchandise_total',
      value: totalsResult.merchandise_total,
      pattern: totalsResult.fieldDetails?.merchandise_total?.pattern || 'unknown',
      confidence: totalsResult.fieldDetails?.merchandise_total?.confidence || 'medium'
    });
  } else {
    result.fields_failed.push({
      field: 'merchandise_total',
      reason: 'No merchandise/subtotal pattern matched'
    });
  }
  
  if (totalsResult.grand_total != null) {
    matchedFields++;
    result.fields_extracted.push({
      field: 'grand_total',
      value: totalsResult.grand_total,
      pattern: totalsResult.fieldDetails?.grand_total?.pattern || 'unknown',
      confidence: totalsResult.fieldDetails?.grand_total?.confidence || 'medium'
    });
  } else {
    result.fields_failed.push({
      field: 'grand_total',
      reason: 'No grand total pattern matched'
    });
  }
  
  // Track optional fields
  if (totalsResult.freight_total != null) {
    totalFields++;
    matchedFields++;
    result.fields_extracted.push({
      field: 'freight_total',
      value: totalsResult.freight_total,
      pattern: totalsResult.fieldDetails?.freight_total?.pattern || 'unknown',
      confidence: totalsResult.fieldDetails?.freight_total?.confidence || 'medium'
    });
  }
  
  if (totalsResult.tax_total != null) {
    totalFields++;
    matchedFields++;
    result.fields_extracted.push({
      field: 'tax_total',
      value: totalsResult.tax_total,
      pattern: totalsResult.fieldDetails?.tax_total?.pattern || 'unknown',
      confidence: totalsResult.fieldDetails?.tax_total?.confidence || 'medium'
    });
  }
  
  // Parse line items
  result.line_items = parseLineItems(text);
  
  // Calculate overall confidence
  result.matched_fields = matchedFields;
  result.total_fields = totalFields;
  
  const matchRate = matchedFields / totalFields;
  if (matchRate >= 0.75) {
    result.parse_confidence = 'high';
  } else if (matchRate >= 0.5) {
    result.parse_confidence = 'medium';
  } else {
    result.parse_confidence = 'low';
  }
  
  // Override with supplier-specific confidence if available
  if (supplierParseResult && supplierParseResult.confidence !== 'low') {
    result.parse_confidence = supplierParseResult.confidence;
  }
  
  result.success = true;
  result.total_time = Date.now() - startTime;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Parse complete:');
  console.log(`  PO Number: ${result.po_number || 'NOT FOUND'}`);
  console.log(`  Expected Date: ${result.expected_date || 'NOT FOUND'}`);
  console.log(`  Merchandise Total: ${result.totals?.merchandise_total != null ? '$' + result.totals.merchandise_total.toFixed(2) : 'NOT FOUND'}`);
  console.log(`  Freight Total: ${result.totals?.freight_total != null ? '$' + result.totals.freight_total.toFixed(2) : 'NOT FOUND'}`);
  console.log(`  Grand Total: ${result.totals?.grand_total != null ? '$' + result.totals.grand_total.toFixed(2) : 'NOT FOUND'}`);
  console.log(`  Line Items: ${result.line_items.length}`);
  console.log(`  Fields: ${matchedFields}/${totalFields} (${(matchRate * 100).toFixed(0)}%)`);
  console.log(`  Confidence: ${result.parse_confidence}`);
  console.log(`  Method: ${result.parsing_method}`);
  console.log(`  Time: ${result.total_time}ms`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  return result;
}

/**
 * Compare acknowledgement details to PO details from Agility
 * Returns discrepancies and match confidence
 */
function compareAckToPO(ackData, poDetails) {
  const discrepancies = [];
  let matchScore = 0;
  let totalChecks = 0;
  
  // Check PO number match
  if (ackData.po_number && poDetails.po_id) {
    totalChecks++;
    const ackPO = String(ackData.po_number).replace(/\D/g, '');
    const poPO = String(poDetails.po_id).replace(/\D/g, '');
    
    if (ackPO === poPO) {
      matchScore++;
    } else if (ackPO.includes(poPO) || poPO.includes(ackPO)) {
      matchScore += 0.5; // Partial match
      discrepancies.push({
        type: 'po_number_partial',
        ack_value: ackData.po_number,
        po_value: poDetails.po_id,
        severity: 'warning',
        message: 'PO numbers partially match'
      });
    } else {
      discrepancies.push({
        type: 'po_number_mismatch',
        ack_value: ackData.po_number,
        po_value: poDetails.po_id,
        severity: 'critical',
        message: 'PO numbers do not match - verify correct acknowledgement'
      });
    }
  }
  
  // Check total amount
  const ackTotal = ackData.totals?.grand_total || ackData.totals?.merchandise_total;
  const poTotal = poDetails.total_amount || poDetails.po_total;
  
  if (ackTotal && poTotal) {
    totalChecks++;
    const diff = Math.abs(ackTotal - poTotal);
    const pctDiff = (diff / poTotal) * 100;
    
    if (pctDiff < 0.5) {
      matchScore++; // Excellent match
    } else if (pctDiff < 2) {
      matchScore += 0.9; // Good match
      discrepancies.push({
        type: 'total_variance_minor',
        ack_value: ackTotal,
        po_value: poTotal,
        difference: diff,
        pct_difference: pctDiff,
        severity: 'info',
        message: `Minor variance of $${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`
      });
    } else if (pctDiff < 5) {
      matchScore += 0.5;
      discrepancies.push({
        type: 'total_variance',
        ack_value: ackTotal,
        po_value: poTotal,
        difference: diff,
        pct_difference: pctDiff,
        severity: 'warning',
        message: `Variance of $${diff.toFixed(2)} (${pctDiff.toFixed(1)}%) - review recommended`
      });
    } else {
      discrepancies.push({
        type: 'total_variance_large',
        ack_value: ackTotal,
        po_value: poTotal,
        difference: diff,
        pct_difference: pctDiff,
        severity: 'critical',
        message: `Large variance of $${diff.toFixed(2)} (${pctDiff.toFixed(1)}%) - verification required`
      });
    }
  }
  
  // Check line item count if available
  if (ackData.line_items?.length && poDetails.item_count) {
    totalChecks++;
    if (ackData.line_items.length === poDetails.item_count) {
      matchScore++;
    } else {
      const diff = Math.abs(ackData.line_items.length - poDetails.item_count);
      discrepancies.push({
        type: 'item_count_mismatch',
        ack_value: ackData.line_items.length,
        po_value: poDetails.item_count,
        difference: diff,
        severity: diff > 3 ? 'warning' : 'info',
        message: `Item count differs by ${diff}`
      });
    }
  }
  
  // Check expected date if available
  if (ackData.expected_date && poDetails.expect_ship_date) {
    totalChecks++;
    const ackDate = new Date(ackData.expected_date);
    const poDate = new Date(poDetails.expect_ship_date);
    const daysDiff = Math.abs((ackDate - poDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 1) {
      matchScore++;
    } else if (daysDiff <= 7) {
      matchScore += 0.5;
      discrepancies.push({
        type: 'date_variance',
        ack_value: ackData.expected_date,
        po_value: poDetails.expect_ship_date,
        days_difference: daysDiff,
        severity: 'info',
        message: `Expected date differs by ${Math.round(daysDiff)} days`
      });
    } else {
      discrepancies.push({
        type: 'date_variance_large',
        ack_value: ackData.expected_date,
        po_value: poDetails.expect_ship_date,
        days_difference: daysDiff,
        severity: 'warning',
        message: `Expected date differs significantly (${Math.round(daysDiff)} days)`
      });
    }
  }
  
  const confidence = totalChecks > 0 ? (matchScore / totalChecks) * 100 : 0;
  
  return {
    confidence_score: confidence,
    match_score: matchScore,
    total_checks: totalChecks,
    discrepancies,
    match_quality: confidence >= 90 ? 'excellent' : 
                   confidence >= 75 ? 'good' : 
                   confidence >= 50 ? 'fair' : 'poor',
    summary: {
      total_discrepancies: discrepancies.length,
      critical_count: discrepancies.filter(d => d.severity === 'critical').length,
      warning_count: discrepancies.filter(d => d.severity === 'warning').length,
      info_count: discrepancies.filter(d => d.severity === 'info').length
    }
  };
}

/**
 * Get parsing status summary for a batch of acknowledgements
 */
function getParseStatusSummary(parseResults) {
  const summary = {
    total: parseResults.length,
    successful: 0,
    failed: 0,
    high_confidence: 0,
    medium_confidence: 0,
    low_confidence: 0,
    supplier_specific: 0,
    generic: 0,
    avg_confidence: 0,
    avg_fields_matched: 0,
    common_failures: {}
  };
  
  let totalConfidence = 0;
  let totalFieldsMatched = 0;
  
  for (const result of parseResults) {
    if (result.success) {
      summary.successful++;
      
      if (result.parse_confidence === 'high') summary.high_confidence++;
      else if (result.parse_confidence === 'medium') summary.medium_confidence++;
      else summary.low_confidence++;
      
      if (result.parsing_method === 'supplier_specific') summary.supplier_specific++;
      else summary.generic++;
      
      totalFieldsMatched += result.matched_fields;
      totalConfidence += (result.matched_fields / result.total_fields) * 100;
    } else {
      summary.failed++;
      
      // Track failure reasons
      const reason = result.error || 'unknown';
      summary.common_failures[reason] = (summary.common_failures[reason] || 0) + 1;
    }
  }
  
  if (summary.successful > 0) {
    summary.avg_confidence = totalConfidence / summary.successful;
    summary.avg_fields_matched = totalFieldsMatched / summary.successful;
  }
  
  return summary;
}

module.exports = {
  extractPDFText,
  parseAcknowledgementTotals,
  parseLineItems,
  extractPONumber,
  extractExpectedDate,
  parseAcknowledgement,
  compareAckToPO,
  analyzeText,
  getTextPreview,
  getParseStatusSummary,
  FIELD_TYPES
};