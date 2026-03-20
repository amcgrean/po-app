import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';
import { resolve } from 'path';

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  try {
    const envFile = readFileSync('../supabase.env', 'utf8');
    const lines = envFile.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DATABASE_URL=')) {
        databaseUrl = trimmed.substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  } catch (e) {
    console.error('Could not find DATABASE_URL in environment or ../supabase.env');
    process.exit(1);
  }
}

if (!databaseUrl) {
  console.error('DATABASE_URL is empty');
  process.exit(1);
}

// Manually parse the connection string
let clientConfig = {};
try {
  const urlWithoutProtocol = databaseUrl.replace('postgresql://', '');
  const [authSection, hostSection] = urlWithoutProtocol.split('@');
  const [user, ...passwordParts] = authSection.split(':');
  const password = passwordParts.join(':');
  const [hostPort, database] = hostSection.split('/');
  const [host, port] = hostPort.split(':');

  clientConfig = {
    user,
    password,
    host,
    port: parseInt(port || '5432'),
    database,
    ssl: { rejectUnauthorized: false }
  };
} catch (e) {
  console.error('Failed to parse DATABASE_URL manually:', e.message);
  process.exit(1);
}

const sqlViewsPath = resolve('C:/Users/amcgrean/python/api/sql/app_po_read_models.sql');
let sqlViews = '';
try {
  sqlViews = readFileSync(sqlViewsPath, 'utf8');
  // Fix type mismatch: wo_id is integer in po_detail but varchar in wo_header
  sqlViews = sqlViews.replace('on wo.wo_id = d.wo_id', 'on wo.wo_id = d.wo_id::text');
} catch (e) {
  console.error('Could not read SQL views file:', sqlViewsPath);
  process.exit(1);
}

const sqlMigrations = `
-- Create submissions table if it doesn't exist
create table if not exists public.submissions (
    id uuid primary key default gen_random_uuid(),
    po_number text not null,
    image_url text,
    image_key text,
    image_urls text[] default '{}',
    image_keys text[] default '{}',
    submitted_by uuid,
    submitted_username text,
    branch text,
    notes text,
    status text default 'pending',
    reviewer_notes text,
    reviewed_at timestamptz,
    created_at timestamptz default now(),
    -- PO-linked metadata
    supplier_name text,
    supplier_code text,
    po_status text,
    expect_date timestamptz
);

-- Ensure columns exist if table already existed
alter table public.submissions add column if not exists image_urls text[] default '{}';
alter table public.submissions add column if not exists image_keys text[] default '{}';
alter table public.submissions add column if not exists supplier_name text;
alter table public.submissions add column if not exists supplier_code text;
alter table public.submissions add column if not exists po_status text;
alter table public.submissions add column if not exists expect_date timestamptz;

comment on table public.submissions is 'PO check-in submissions with photos and ERP metadata snapshots.';
`;

const sqlSeed = `
-- Seed some dummy ERP data for testing if tables are empty
insert into public.erp_mirror_po_header (system_id, po_id, supplier_key, shipfrom_seq, order_date, expect_date, po_status, purchase_type, synced_at, is_deleted)
select '1', 99999, 'TEST-SUP', 1, now(), now() + interval '7 days', 'Open', 'Stock', now(), false
where not exists (select 1 from public.erp_mirror_po_header where po_id = 99999);

insert into public.erp_mirror_po_detail (system_id, po_id, sequence, item_ptr, qty_ordered, cost, uom, po_status, synced_at, is_deleted)
select '1', 99999, 1, 101, 100, 15.50, 'EA', 'Open', now(), false
where not exists (select 1 from public.erp_mirror_po_detail where po_id = 99999 and sequence = 1);

insert into public.erp_mirror_item (system_id, item_ptr, item, description, synced_at, is_deleted)
select '1', 101, 'WIDGET-001', 'High Precision Test Widget', now(), false
where not exists (select 1 from public.erp_mirror_item where item_ptr = 101);

insert into public.erp_mirror_cust_shipto (system_id, cust_key, seq_num, shipto_name, city, state, synced_at, is_deleted)
select '1', 'TEST-SUP', 1, 'Acme Industrial Testing', 'Springfield', 'IL', now(), false
where not exists (select 1 from public.erp_mirror_cust_shipto where cust_key = 'TEST-SUP' and seq_num = 1);
`;

const client = new Client(clientConfig);

async function applyViews() {
  try {
    console.log('Connecting to Supabase Postgres...');
    await client.connect();
    
    console.log('Applying schema migrations (submissions table)...');
    await client.query(sqlMigrations);
    
    console.log('Applying PO read-model views...');
    await client.query(sqlViews);
    
    console.log('Seeding dummy ERP data for testing...');
    await client.query(sqlSeed);
    
    console.log('Database setup and seeding completed successfully!');
  } catch (err) {
    console.error('Error in database operations:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyViews();
