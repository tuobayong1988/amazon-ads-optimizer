import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

async function testProfiles() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await connection.execute(
    'SELECT clientId, clientSecret, refreshToken, profileId, region FROM amazon_api_credentials ORDER BY id DESC LIMIT 1'
  );
  
  if (rows.length === 0) {
    console.log('No credentials found');
    await connection.end();
    return;
  }
  
  const creds = rows[0];
  console.log('Testing with credentials for region:', creds.region);
  
  // 1. 获取access token
  console.log('\n1. Getting access token...');
  const tokenResponse = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }),
  });
  
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    console.log('Token refresh failed:', tokenData);
    await connection.end();
    return;
  }
  
  const accessToken = tokenData.access_token;
  console.log('Access token obtained successfully');
  
  // 2. 获取profiles
  console.log('\n2. Getting profiles...');
  const profilesResponse = await fetch(`${API_ENDPOINTS[creds.region]}/v2/profiles`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': creds.clientId,
      'Content-Type': 'application/json',
    },
  });
  
  console.log('Profiles response status:', profilesResponse.status);
  
  if (profilesResponse.ok) {
    const profiles = await profilesResponse.json();
    console.log('Profiles found:', profiles.length);
    profiles.forEach(p => {
      console.log(`  - ${p.accountInfo?.name || 'Unknown'} (${p.countryCode}) - Profile ID: ${p.profileId}`);
    });
  } else {
    const errorText = await profilesResponse.text();
    console.log('Profiles error:', errorText);
  }
  
  await connection.end();
}

testProfiles().catch(console.error);
