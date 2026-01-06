import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.execute('SHOW COLUMNS FROM campaigns');
  console.log('Columns:', rows.map(r => r.Field).join(', '));
  await connection.end();
}
main().catch(console.error);
