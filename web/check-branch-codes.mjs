/**
 * Diagnostic: inspect branch_code values in the app_po_search view
 * and identify which column in erp_mirror_po_header holds branch data.
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

async function run() {
  try {
    await client.connect();

    // ── 1. Check if app_po_search view exists ────────────────────────────────
    const viewCheck = await client.query(`
      select table_name, table_type
      from information_schema.tables
      where table_name = 'app_po_search' and table_schema = 'public'
    `);
    if (viewCheck.rows.length === 0) {
      console.error('❌  app_po_search does NOT exist in public schema.');
      return;
    }
    console.log('✅  app_po_search exists:', viewCheck.rows[0].table_type);

    // ── 2. Check branch_code column ──────────────────────────────────────────
    const colCheck = await client.query(`
      select column_name, data_type
      from information_schema.columns
      where table_name = 'app_po_search' and table_schema = 'public' and column_name = 'branch_code'
    `);
    if (colCheck.rows.length === 0) {
      console.error('\n❌  branch_code column does NOT exist in app_po_search.');
      console.log('\nAll columns in app_po_search:');
      const allCols = await client.query(`
        select column_name, data_type
        from information_schema.columns
        where table_name = 'app_po_search' and table_schema = 'public'
        order by ordinal_position
      `);
      console.table(allCols.rows);
      return;
    }
    console.log('\n✅  branch_code column found:', colCheck.rows[0].data_type);

    // ── 3. Row counts ────────────────────────────────────────────────────────
    const [total, nullCount] = await Promise.all([
      client.query(`select count(*) from public.app_po_search`),
      client.query(`select count(*) from public.app_po_search where branch_code is null`),
    ]);
    console.log(`\nTotal rows in app_po_search:   ${total.rows[0].count}`);
    console.log(`Rows with NULL branch_code:    ${nullCount.rows[0].count}`);

    // ── 4. Distinct branch_code values ──────────────────────────────────────
    const distinct = await client.query(`
      select branch_code, count(*) as po_count
      from public.app_po_search
      where branch_code is not null
      group by branch_code
      order by po_count desc
      limit 30
    `);
    if (distinct.rows.length === 0) {
      console.log('\n⚠️   All branch_code values are NULL. The view is not populating this column.');
    } else {
      console.log('\nDistinct branch_code values (top 30):');
      console.table(distinct.rows);
    }

    // ── 5. Get the view definition ───────────────────────────────────────────
    console.log('\n── app_po_search view SQL ──────────────────────────────────────────────');
    const viewDef = await client.query(`
      select definition from pg_views where viewname = 'app_po_search' and schemaname = 'public'
    `);
    if (viewDef.rows.length > 0) {
      console.log(viewDef.rows[0].definition);
    } else {
      console.log('(could not retrieve view definition)');
    }

    // ── 6. Check erp_mirror_po_header for branch-related columns ────────────
    console.log('\n── erp_mirror_po_header columns ────────────────────────────────────────');
    const erpCols = await client.query(`
      select column_name, data_type
      from information_schema.columns
      where table_name = 'erp_mirror_po_header' and table_schema = 'public'
      order by ordinal_position
    `);
    console.table(erpCols.rows);

    const branchLike = erpCols.rows.filter(r =>
      /branch|location|loc_|_loc|site|store|division/i.test(r.column_name)
    );
    if (branchLike.length > 0) {
      console.log('\n✅  Branch-related columns found in erp_mirror_po_header:');
      console.table(branchLike);

      // Show sample values for each
      for (const col of branchLike) {
        const samples = await client.query(`
          select distinct ${col.column_name}, count(*) as count
          from public.erp_mirror_po_header
          where ${col.column_name} is not null
          group by ${col.column_name}
          order by count desc
          limit 10
        `);
        console.log(`\nSample values for ${col.column_name}:`);
        console.table(samples.rows);
      }
    } else {
      console.log('\n⚠️   No obviously branch-related columns found in erp_mirror_po_header.');
      console.log('     Check the full column list above for anything that maps to a branch/location.');
    }

  } finally {
    await client.end();
  }
}

run();
