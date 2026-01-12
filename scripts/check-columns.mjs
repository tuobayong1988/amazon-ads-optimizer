import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false }
});

const [rows] = await connection.execute("SHOW COLUMNS FROM campaigns");
console.log("Campaigns table columns:");
rows.forEach((row, i) => {
  if (i < 30) console.log(`${i+1}. ${row.Field} (${row.Type})`);
});

await connection.end();
