// Test script to check getAllCampaigns function
import { drizzle } from "drizzle-orm/mysql2";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

console.log("Connecting to database...");

try {
  const db = drizzle(DATABASE_URL);
  
  // Simple query to test connection
  const result = await db.execute("SELECT COUNT(*) as count FROM campaigns");
  console.log("Campaign count:", result);
  
  // Try to select all campaigns
  const campaigns = await db.execute("SELECT id, campaignName, campaignType, accountId FROM campaigns LIMIT 5");
  console.log("Sample campaigns:", campaigns);
  
  process.exit(0);
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
