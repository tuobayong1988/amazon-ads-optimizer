import { AmazonAdsApiClient } from './server/amazonAdsApi.ts';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq } from 'drizzle-orm';
import * as schema from './drizzle/schema.ts';

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: parseInt(process.env.DATABASE_PORT || '3306'),
  ssl: { rejectUnauthorized: false }
});

const db = drizzle(connection, { schema, mode: 'default' });

// 获取US账号的凭据
const [accounts] = await connection.execute(`
  SELECT aa.id, aa.profileId, aac.accessToken, aac.refreshToken
  FROM adAccounts aa
  JOIN amazonApiCredentials aac ON aa.credentialId = aac.id
  WHERE aa.marketplace = 'US'
  LIMIT 1
`);

if (accounts.length === 0) {
  console.log('No US account found');
  process.exit(1);
}

const account = accounts[0];
console.log('Using account:', account.profileId);

// 创建API客户端
const client = new AmazonAdsApiClient(
  account.accessToken,
  account.refreshToken,
  String(account.profileId),
  'US'
);

// 获取SP广告活动
console.log('\n获取SP广告活动...');
const campaigns = await client.listSpCampaigns();
console.log(`获取到 ${campaigns.length} 个SP广告活动`);

if (campaigns.length > 0) {
  console.log('\n第一个广告活动的完整结构:');
  console.log(JSON.stringify(campaigns[0], null, 2));
  console.log('\nstartDate字段:', campaigns[0].startDate);
  console.log('endDate字段:', campaigns[0].endDate);
}

await connection.end();
