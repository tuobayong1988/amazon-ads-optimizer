/**
 * 为CA账户同步SB广告活动预算（使用正确的Token来源）
 */
import { getDb } from '../server/db';
import { campaigns, adAccounts, amazonApiCredentials } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';

const AMAZON_ADS_API_BASE = 'https://advertising-api.amazon.com';

interface SbCampaign {
  campaignId: string | number;
  name?: string;
  budget?: number | string | { budget?: number | string };
  budgetType?: string;
  state?: string;
}

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
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
    }
  );
  return response.data.access_token;
}

async function listSbCampaigns(
  accessToken: string,
  profileId: string,
  clientId: string
): Promise<SbCampaign[]> {
  const allCampaigns: SbCampaign[] = [];
  let nextToken: string | undefined;

  do {
    const params: any = { maxResults: 100 };
    if (nextToken) {
      params.nextToken = nextToken;
    }

    const response = await axios.get(
      `${AMAZON_ADS_API_BASE}/sb/v4/campaigns/list`,
      {
        params,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': clientId,
          'Amazon-Advertising-API-Scope': profileId,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;
    if (data.campaigns && Array.isArray(data.campaigns)) {
      allCampaigns.push(...data.campaigns);
    }
    nextToken = data.nextToken;
  } while (nextToken);

  return allCampaigns;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  // 获取CA账户
  const [caAccount] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'CA'))
    .limit(1);

  if (!caAccount) {
    console.error('没有找到CA账户');
    return;
  }

  console.log('CA账户ID:', caAccount.id);
  console.log('Profile ID:', caAccount.profileId);

  // 从amazonApiCredentials表获取凭证
  const [credentials] = await db
    .select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, caAccount.id))
    .limit(1);

  if (!credentials) {
    console.error('没有找到CA账户的API凭证');
    return;
  }

  console.log('找到API凭证，正在获取Access Token...');

  // 获取Access Token
  const accessToken = await getAccessToken(
    credentials.refreshToken,
    credentials.clientId,
    credentials.clientSecret
  );
  console.log('Access Token获取成功');

  // 获取SB广告活动列表
  console.log('\n正在从Amazon API获取SB广告活动...');
  const sbCampaigns = await listSbCampaigns(
    accessToken,
    credentials.profileId,
    credentials.clientId
  );
  console.log(`获取到 ${sbCampaigns.length} 个SB广告活动`);

  if (sbCampaigns.length === 0) {
    console.log('没有SB广告活动需要更新');
    return;
  }

  // 打印前3个广告活动的数据结构
  console.log('\n前3个广告活动数据结构:');
  for (let i = 0; i < Math.min(3, sbCampaigns.length); i++) {
    const c = sbCampaigns[i];
    console.log(`  ${i + 1}. campaignId: ${c.campaignId}`);
    console.log(`     name: ${c.name?.substring(0, 50)}`);
    console.log(`     budget: ${c.budget} (type: ${typeof c.budget})`);
    console.log(`     budgetType: ${c.budgetType}`);
    console.log(`     state: ${c.state}`);
  }

  // 更新数据库中的预算
  console.log('\n正在更新数据库...');
  let updated = 0;
  let errors = 0;

  for (const apiCampaign of sbCampaigns) {
    try {
      // 解析预算 - SB API v4 返回的 budget 是直接的数字
      let dailyBudget = '0.00';
      if (typeof apiCampaign.budget === 'number') {
        dailyBudget = apiCampaign.budget.toFixed(2);
      } else if (typeof apiCampaign.budget === 'string') {
        dailyBudget = parseFloat(apiCampaign.budget).toFixed(2);
      } else if (apiCampaign.budget && typeof apiCampaign.budget === 'object') {
        // 兼容旧版API格式
        const budgetObj = apiCampaign.budget as any;
        if (budgetObj.budget !== undefined) {
          dailyBudget = parseFloat(budgetObj.budget).toFixed(2);
        }
      }

      // 更新数据库
      await db
        .update(campaigns)
        .set({
          dailyBudget,
          campaignStatus: apiCampaign.state?.toLowerCase() || 'unknown',
        })
        .where(and(
          eq(campaigns.accountId, caAccount.id),
          eq(campaigns.campaignId, String(apiCampaign.campaignId))
        ));

      updated++;
    } catch (error) {
      console.error(`更新广告活动 ${apiCampaign.campaignId} 失败:`, error);
      errors++;
    }
  }

  console.log(`\n更新完成: ${updated} 个成功, ${errors} 个失败`);

  // 验证更新结果
  console.log('\n验证更新结果...');
  const verifyResult = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
      campaignStatus: campaigns.campaignStatus,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, caAccount.id),
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ))
    .limit(5);

  console.log('更新后的活跃SB广告活动 (前5个):');
  for (const c of verifyResult) {
    console.log(`  ID: ${c.id}, 预算: ${c.dailyBudget}, 状态: ${c.campaignStatus}`);
    console.log(`    名称: ${c.campaignName?.substring(0, 50)}`);
  }

  process.exit(0);
}

main().catch(console.error);
