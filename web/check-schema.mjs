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

async function checkSchema() {
  try {
    await client.connect();
    const tables = ['erp_mirror_po_header', 'erp_mirror_po_detail', 'erp_mirror_receiving_header', 'erp_mirror_receiving_detail'];
    for (const table of tables) {
      console.log(`\n--- ${table} ---`);
      const res = await client.query(`
        select column_name, data_type 
        from information_schema.columns 
        where table_name = $1 
        order by ordinal_position
      `, [table]);
      console.table(res.rows);
    }
  } finally {
    await client.end();
  }
}

checkSchema();
