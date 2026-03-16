import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

async function checkSchema() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [columns] = await connection.execute('SHOW COLUMNS FROM ad_accounts');
  console.log('ad_accounts columns:');
  columns.forEach(col => console.log(`  ${col.Field} (${col.Type})`));
  
  await connection.end();
}

checkSchema().catch(console.error);
