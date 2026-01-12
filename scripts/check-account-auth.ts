/**
 * 检查所有账户的授权状态
 */
import { getDb } from '../server/db';
import { adAccounts } from '../drizzle/schema';
import axios from 'axios';

const AMAZON_ADS_CLIENT_ID = process.env.AMAZON_ADS_CLIENT_ID;
const AMAZON_ADS_CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET;

async function checkTokenValidity(refreshToken: string | null, marketplace: string): Promise<{
  valid: boolean;
  error?: string;
  expiresIn?: number;
}> {
  if (!refreshToken) {
    return { valid: false, error: 'refresh token为空' };
  }

  if (!AMAZON_ADS_CLIENT_ID || !AMAZON_ADS_CLIENT_SECRET) {
    return { valid: false, error: 'Amazon Ads客户端凭证未配置' };
  }

  try {
    const response = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: AMAZON_ADS_CLIENT_ID,
        client_secret: AMAZON_ADS_CLIENT_SECRET,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (response.data.access_token) {
      return {
        valid: true,
        expiresIn: response.data.expires_in,
      };
    } else {
      return { valid: false, error: '未返回access token' };
    }
  } catch (error: any) {
    if (error.response) {
      return {
        valid: false,
        error: `${error.response.status}: ${error.response.data?.error_description || error.response.data?.error || '未知错误'}`,
      };
    }
    return { valid: false, error: error.message };
  }
}

async function main() {
  console.log('========== 检查Amazon Ads账户授权状态 ==========\n');

  // 检查环境变量
  console.log('环境变量检查:');
  console.log(`  AMAZON_ADS_CLIENT_ID: ${AMAZON_ADS_CLIENT_ID ? '✓ 已配置' : '✗ 未配置'}`);
  console.log(`  AMAZON_ADS_CLIENT_SECRET: ${AMAZON_ADS_CLIENT_SECRET ? '✓ 已配置' : '✗ 未配置'}`);
  console.log('');

  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  // 获取所有账户
  const accounts = await db.select().from(adAccounts);

  console.log(`找到 ${accounts.length} 个广告账户\n`);

  for (const account of accounts) {
    console.log(`========== ${account.marketplace} 账户 (ID: ${account.id}) ==========`);
    console.log(`  Profile ID: ${account.profileId}`);
    console.log(`  店铺名称: ${account.storeName || '未设置'}`);
    console.log(`  Refresh Token: ${account.refreshToken ? `${account.refreshToken.substring(0, 20)}...` : '未设置'}`);
    console.log(`  创建时间: ${account.createdAt}`);
    console.log(`  更新时间: ${account.updatedAt}`);

    // 检查token有效性
    console.log('\n  正在验证Token...');
    const result = await checkTokenValidity(account.refreshToken, account.marketplace);

    if (result.valid) {
      console.log(`  ✓ Token有效，过期时间: ${result.expiresIn}秒`);
    } else {
      console.log(`  ✗ Token无效: ${result.error}`);
    }

    console.log('');
  }

  process.exit(0);
}

main().catch(console.error);
