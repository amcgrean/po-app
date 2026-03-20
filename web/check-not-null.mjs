import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';

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
  } catch (e) {}
}

const urlWithoutProtocol = databaseUrl.replace('postgresql://', '');
const [authSection, hostSection] = urlWithoutProtocol.split('@');
const [user, ...passwordParts] = authSection.split(':');
const password = passwordParts.join(':');
const [hostPort, database] = hostSection.split('/');
const [host, port] = hostPort.split(':');

const client = new Client({
  user,
  password,
  host,
  port: parseInt(port || '5432'),
  database,
  ssl: { rejectUnauthorized: false }
});

async function checkNotNull() {
  try {
    await client.connect();
    const res = await client.query(`
      select table_name, column_name, data_type 
      from information_schema.columns 
      where is_nullable = 'NO' 
      and column_default is null
      and table_name like 'erp_mirror_%'
      and table_name in ('erp_mirror_po_header', 'erp_mirror_po_detail', 'erp_mirror_item', 'erp_mirror_cust_shipto')
    `);
    console.table(res.rows);
  } finally {
    await client.end();
  }
}

checkNotNull();
