import { drizzle } from 'drizzle-orm/mysql2';
import { campaigns } from '../drizzle/schema';

async function testQuery() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  try {
    console.log('Testing getAllCampaigns query...');
    const result = await db.select().from(campaigns).limit(1);
    console.log('Query successful!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Query failed:', error);
  }
  
  process.exit(0);
}

testQuery();
