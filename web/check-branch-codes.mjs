/**
 * Diagnostic: inspect branch_code values in the app_po_search view.
 *
 * Usage:
 *   DATABASE_URL=<your-db-url> node check-branch-codes.mjs
 *   # or if supabase.env exists one level up:
 *   node check-branch-codes.mjs
 */
import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';

let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  try {
    const envFile = readFileSync('../supabase.env', 'utf8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DATABASE_URL=')) {
        databaseUrl = trimmed.substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  } catch (e) {}
}

if (!databaseUrl) {
  console.error('DATABASE_URL not found. Set it in the environment or in ../supabase.env');
  process.exit(1);
}

const urlWithoutProtocol = databaseUrl.replace('postgresql://', '');
const [authSection, hostSection] = urlWithoutProtocol.split('@');
const [user, ...passwordParts] = authSection.split(':');
const password = passwordParts.join(':');
const [hostPort, database] = hostSection.split('/');
const [host, port] = hostPort.split(':');

const client = new Client({
  user, password, host,
  port: parseInt(port || '5432'),
  database,
  ssl: { rejectUnauthorized: false },
});

async function checkBranchCodes() {
  try {
    await client.connect();

    // 1. Check if the view exists
    const viewCheck = await client.query(`
      select table_name, table_type
      from information_schema.tables
      where table_name = 'app_po_search' and table_schema = 'public'
    `);
    if (viewCheck.rows.length === 0) {
      console.error('app_po_search view does NOT exist in the public schema.');
      return;
    }
    console.log('app_po_search exists:', viewCheck.rows[0]);

    // 2. Check if branch_code column exists in the view
    const colCheck = await client.query(`
      select column_name, data_type
      from information_schema.columns
      where table_name = 'app_po_search' and table_schema = 'public' and column_name = 'branch_code'
    `);
    if (colCheck.rows.length === 0) {
      console.error('\nbranch_code column does NOT exist in app_po_search.');
      console.log('All columns in app_po_search:');
      const allCols = await client.query(`
        select column_name, data_type
        from information_schema.columns
        where table_name = 'app_po_search' and table_schema = 'public'
        order by ordinal_position
      `);
      console.table(allCols.rows);
      return;
    }
    console.log('\nbranch_code column found:', colCheck.rows[0]);

    // 3. Total row count
    const total = await client.query(`select count(*) from public.app_po_search`);
    console.log(`\nTotal rows in app_po_search: ${total.rows[0].count}`);

    // 4. NULL branch_code count
    const nullCount = await client.query(`select count(*) from public.app_po_search where branch_code is null`);
    console.log(`Rows with NULL branch_code: ${nullCount.rows[0].count}`);

    // 5. Distinct branch_code values
    const distinct = await client.query(`
      select branch_code, count(*) as po_count
      from public.app_po_search
      where branch_code is not null
      group by branch_code
      order by po_count desc
      limit 30
    `);
    if (distinct.rows.length === 0) {
      console.log('\nNo non-null branch_code values found. All rows have branch_code = NULL.');
      console.log('=> The view likely does not populate branch_code from the underlying ERP data.');
    } else {
      console.log('\nDistinct branch_code values (top 30):');
      console.table(distinct.rows);
    }
  } finally {
    await client.end();
  }
}

checkBranchCodes();
