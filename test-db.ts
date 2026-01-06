import { drizzle } from 'drizzle-orm/mysql2';
import { campaigns } from './drizzle/schema';
import { eq } from 'drizzle-orm';

async function test() {
  const db = drizzle(process.env.DATABASE_URL!);
  try {
    const result = await db.select().from(campaigns).where(eq(campaigns.accountId, 6)).limit(1);
    console.log('Success:', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error('SQL:', error.sql);
  }
  process.exit(0);
}
test();
