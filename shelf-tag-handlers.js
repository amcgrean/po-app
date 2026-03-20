// ============================================
// SHELF TAG PRINTING - IPC HANDLERS
// ============================================

const QRCode = require('qrcode');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper functions for ZPL template processing
function escapeZPL(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\5C')
    .replace(/\^/g, '\\5E')
    .replace(/~/g, '\\7E')
    .replace(/\{/g, '\\7B')
    .replace(/\}/g, '\\7D')
    .replace(/_/g, '\\5F');
}

function buildZPL(tags, sizeKey, settings = {}) {
  const templatePath = path.join(__dirname, 'shelf-tag-app', 'printing', 'templates',
    sizeKey === '3x5' ? 'label3x5.prn' : 'label2x3.prn');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  let template = fs.readFileSync(templatePath, 'utf8');

  const pages = tags.map(tag => {
    let page = template;
    page = page.replace(/\{\{DESC\}\}/g, escapeZPL(tag.description || ''));
    page = page.replace(/\{\{SIZE\}\}/g, escapeZPL(tag.size_ || ''));
    page = page.replace(/\{\{LOC\}\}/g, escapeZPL(tag.location_subloc || ''));
    page = page.replace(/\{\{QR\}\}/g, escapeZPL(tag.item || ''));
    page = page.replace(/\{\{ITEM\}\}/g, escapeZPL(tag.item || ''));
    return page;
  });

  return pages.join('');
}

// Windows raw printing via PowerShell
async function printRaw(printerName, zplData) {
  const tmpFile = path.join(os.tmpdir(), `zpl_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, zplData, 'ascii');

  // PowerShell script to send raw data to printer
  const psScript = `
    $printerName = "${printerName.replace(/"/g, '`"')}"
    $filePath = "${tmpFile.replace(/\\/g, '\\\\')}"
    $data = [System.IO.File]::ReadAllBytes($filePath)
    $stream = [System.IO.File]::OpenWrite("\\\\\\\\.\\\\$printerName")
    $stream.Write($data, 0, $data.Length)
    $stream.Close()
  `.trim();

  try {
    await execAsync(`powershell -Command "${psScript}"`);
    fs.unlinkSync(tmpFile);
    return { success: true };
  } catch (error) {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    throw error;
  }
}

// Get list of printers
async function getWindowsPrinters() {
  try {
    const { stdout } = await execAsync('wmic printer get name');
    const lines = stdout.split('\n')
      .map(l => l.trim())
      .filter(l => l && l !== 'Name');
    return lines;
  } catch (error) {
    console.error('Error getting printers:', error);
    return [];
  }
}

// Shelf Tag IPC Handlers
const registerShelfTagHandlers = (ipcMain, sql, executeQuery) => {
  // Get branches for shelf tags
  ipcMain.handle('get-shelf-tag-branches', async () => {
    return { success: true, data: ['20GR', '25BW'] };
  });

  // Get locations
  ipcMain.handle('get-shelf-tag-locations', async (event, systemId) => {
    const query = `
      SELECT DISTINCT L.location, L.location_subloc
      FROM location AS L
      WHERE L.active = 1 AND L.system_id = @system_id
        AND EXISTS (
          SELECT 1 FROM item_content_def_branch AS ICDF
          JOIN item_branch AS IB ON IB.item_ptr = ICDF.item_ptr 
            AND IB.system_id = @system_id 
            AND IB.active_flag = 1 AND IB.stock = 1
          WHERE ICDF.system_id = @system_id 
            AND ICDF.default_loc_ptr = L.loc_ptr 
            AND ICDF.length = 0
        )
      ORDER BY L.location, L.location_subloc
    `;
    return await executeQuery(query, { system_id: { type: sql.VarChar(10), value: systemId } });
  });

  // Get items by location
  ipcMain.handle('get-shelf-tag-items', async (event, { systemId, locations, sublocations }) => {
    if (!locations || locations.length === 0) {
      return { success: true, data: [] };
    }

    const query = `
      SELECT
        I.item,
        I.description,
        I.ext_description,
        I.size_,
        L.location,
        L.location_subloc
      FROM item_branch AS IB
      JOIN item AS I ON I.item_ptr = IB.item_ptr
      JOIN item_content_def_branch AS ICDF
        ON ICDF.item_ptr = IB.item_ptr AND ICDF.system_id = @system_id
      JOIN location AS L
        ON L.loc_ptr = ICDF.default_loc_ptr
        AND L.active = 1
        AND L.system_id = @system_id
      WHERE IB.active_flag = 1
        AND IB.stock = 1
        AND IB.system_id = @system_id
        AND ICDF.length = 0
        AND L.location IN (${locations.map((_, i) => `@loc${i}`).join(', ')})
        ${sublocations && sublocations.length > 0
        ? `AND L.location_subloc IN (${sublocations.map((_, i) => `@subloc${i}`).join(', ')})`
        : ''}
        AND I.item NOT LIKE 'Z%' AND I.item NOT LIKE 'Y%' AND I.item NOT LIKE 'X%'
      ORDER BY I.item
    `;

    const inputs = {
      system_id: { type: sql.VarChar(10), value: systemId }
    };

    // Add location parameters
    locations.forEach((loc, i) => {
      inputs[`loc${i}`] = { type: sql.VarChar(50), value: loc };
    });

    // Add sublocation parameters if provided
    if (sublocations && sublocations.length > 0) {
      sublocations.forEach((sub, i) => {
        inputs[`subloc${i}`] = { type: sql.VarChar(50), value: sub };
      });
    }

    return await executeQuery(query, inputs);
  });

  // Get printers
  ipcMain.handle('get-printers', async () => {
    try {
      const printers = await getWindowsPrinters();
      return { success: true, data: printers };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Generate QR code
  ipcMain.handle('generate-qr', async (event, text) => {
    try {
      const dataUrl = await QRCode.toDataURL(text, { margin: 2, width: 200 });
      return { success: true, dataUrl };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Print shelf tags (ZPL)
  ipcMain.handle('print-shelf-tags-zpl', async (event, { rows, size, printer: printerName, settings }) => {
    try {
      const zpl = buildZPL(rows, size, settings);
      await printRaw(printerName, zpl);
      console.log(`[Shelf Tags] Printed ${rows.length} tag(s) to ${printerName}`);
      return { success: true, count: rows.length };
    } catch (error) {
      console.error('[Shelf Tags] Print error:', error);
      return { success: false, message: error.message };
    }
  });

  // Generate PDF (placeholder - can implement later)
  ipcMain.handle('generate-shelf-tag-pdf', async (event, { rows, size, omitLocation }) => {
    // TODO: Implement PDF generation using pdf-lib
    return { success: false, message: 'PDF generation not yet implemented' };
  });
};

module.exports = { registerShelfTagHandlers };
