/**
 * 检查amazonApiCredentials表中的Token状态
 */
import { getDb } from '../server/db';
import { amazonApiCredentials, adAccounts } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';

async function checkTokenValidity(
  refreshToken: string | null,
  clientId: string | null,
  clientSecret: string | null
): Promise<{
  valid: boolean;
  error?: string;
  expiresIn?: number;
}> {
  if (!refreshToken) {
    return { valid: false, error: 'refresh token为空' };
  }

  if (!clientId || !clientSecret) {
    return { valid: false, error: '客户端凭证未配置' };
  }

  try {
    const response = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
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
  console.log('========== 检查Amazon API凭证状态 ==========\n');

  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  // 获取所有API凭证
  const credentials = await db.select().from(amazonApiCredentials);

  console.log(`找到 ${credentials.length} 条API凭证记录\n`);

  if (credentials.length === 0) {
    console.log('没有找到API凭证记录，请检查amazonApiCredentials表');
    
    // 检查adAccounts表
    const accounts = await db.select().from(adAccounts);
    console.log(`\nadAccounts表中有 ${accounts.length} 个账户`);
    
    process.exit(0);
    return;
  }

  for (const cred of credentials) {
    // 获取关联的账户信息
    const [account] = await db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, cred.accountId))
      .limit(1);

    const marketplace = account?.marketplace || '未知';

    console.log(`========== ${marketplace} 账户凭证 (ID: ${cred.id}) ==========`);
    console.log(`  Account ID: ${cred.accountId}`);
    console.log(`  Profile ID: ${cred.profileId}`);
    console.log(`  Region: ${cred.region}`);
    console.log(`  Client ID: ${cred.clientId ? `${cred.clientId.substring(0, 20)}...` : '未设置'}`);
    console.log(`  Client Secret: ${cred.clientSecret ? '已设置' : '未设置'}`);
    console.log(`  Refresh Token: ${cred.refreshToken ? `${cred.refreshToken.substring(0, 30)}...` : '未设置'}`);
    console.log(`  Access Token: ${cred.accessToken ? '已缓存' : '未缓存'}`);
    console.log(`  Token过期时间: ${cred.tokenExpiresAt || '未设置'}`);
    console.log(`  同步状态: ${cred.syncStatus}`);
    console.log(`  最后同步: ${cred.lastSyncAt || '从未同步'}`);
    console.log(`  同步错误: ${cred.syncErrorMessage || '无'}`);

    // 验证Token
    console.log('\n  正在验证Token...');
    const result = await checkTokenValidity(cred.refreshToken, cred.clientId, cred.clientSecret);

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
