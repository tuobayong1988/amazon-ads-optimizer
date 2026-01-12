// Test script to debug campaigns query
import { db } from '../server/db';
import { campaigns } from '../drizzle/schema';

async function testQuery() {
  console.log('Testing campaigns query...');
  
  try {
    // Simple count query
    const countResult = await db.execute('SELECT COUNT(*) as count FROM campaigns');
    console.log('Count result:', countResult);
    
    // Try to select with drizzle
    const result = await db.select().from(campaigns).limit(1);
    console.log('Drizzle select result:', result);
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

testQuery();
