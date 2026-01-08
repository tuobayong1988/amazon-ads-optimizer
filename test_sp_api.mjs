import axios from 'axios';

// 从环境变量获取凭证
const CLIENT_ID = process.env.AMAZON_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET;

// 从数据库获取的refresh token和profile id
const REFRESH_TOKEN = 'Atzr|IwEBIFLmYBbQJvwMBxYlgTvjZWqE2QCRxBQBYdHB3HKXMxNiOHNjFvlz8LjPqJRXWYQwrXJPMHKFNWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQJPKFMWJXLjZQYvRQ';
const PROFILE_ID = '3006146346026650';

const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function getAccessToken() {
  try {
    const response = await axios.post('https://api.amazon.com/auth/o2/token', 
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: REFRESH_TOKEN,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Token error:', error.response?.data || error.message);
    throw error;
  }
}

async function testSpCampaignsList() {
  console.log('Testing SP Campaigns List API...');
  console.log('CLIENT_ID:', CLIENT_ID ? 'Set' : 'Not set');
  
  try {
    const accessToken = await getAccessToken();
    console.log('Access token obtained successfully');
    
    // 测试不同的header组合
    const headerVariants = [
      {
        name: 'Variant 1: v3+json',
        headers: {
          'Content-Type': 'application/vnd.spCampaign.v3+json',
          'Accept': 'application/vnd.spCampaign.v3+json',
        }
      },
      {
        name: 'Variant 2: plain json',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
      {
        name: 'Variant 3: v3+json with Prefer',
        headers: {
          'Content-Type': 'application/vnd.spCampaign.v3+json',
          'Accept': 'application/vnd.spCampaign.v3+json',
          'Prefer': 'return=representation',
        }
      }
    ];
    
    for (const variant of headerVariants) {
      console.log(`\n--- Testing ${variant.name} ---`);
      try {
        const response = await axios.post(
          `${API_ENDPOINT}/sp/campaigns/list`,
          {}, // empty body to get all campaigns
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Amazon-Advertising-API-ClientId': CLIENT_ID,
              'Amazon-Advertising-API-Scope': PROFILE_ID,
              ...variant.headers,
            },
          }
        );
        console.log('SUCCESS! Status:', response.status);
        console.log('Campaigns count:', response.data?.campaigns?.length || 0);
        if (response.data?.campaigns?.length > 0) {
          console.log('First campaign:', JSON.stringify(response.data.campaigns[0], null, 2));
        }
        break; // 成功就退出
      } catch (error) {
        console.log('FAILED! Status:', error.response?.status);
        console.log('Error:', error.response?.data || error.message);
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testSpCampaignsList();
