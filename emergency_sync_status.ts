/**
 * 紧急同步脚本 - 将用户批量重启的campaign状态同步到Amazon
 * v158: 修复batchUpdateCampaignStatus中amazonCampaignId字段引用错误
 */
import { AmazonAdsApiClient } from './server/amazonAdsApi';
import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
  user: 'admin',
  password: 'Mucers2025',
  database: 'amazon_ads_optimizer',
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  
  console.log('=== 紧急同步：将用户批量重启的campaign状态同步到Amazon ===\n');
  
  // 1. 获取最近被用户重启的campaign（11:35之后更新为enabled的）
  const [campaigns] = await conn.execute(`
    SELECT c.id, c.campaignId, c.campaignName, c.campaignStatus, c.performanceGroupId, c.accountId
    FROM campaigns c
    WHERE c.performanceGroupId IS NOT NULL
      AND c.campaignStatus = 'enabled'
      AND c.updatedAt >= '2026-02-19 11:35:00'
      AND c.campaignId IS NOT NULL AND c.campaignId != '' AND c.campaignId != '0'
    ORDER BY c.performanceGroupId, c.id
  `) as any[];
  
  console.log(`找到 ${campaigns.length} 个需要同步的campaign\n`);
  
  // 2. 按accountId分组
  const byAccount: Record<number, any[]> = {};
  for (const c of campaigns) {
    if (!byAccount[c.accountId]) byAccount[c.accountId] = [];
    byAccount[c.accountId].push(c);
  }
  
  // 3. 获取API凭证
  for (const [accountIdStr, accountCampaigns] of Object.entries(byAccount)) {
    const accountId = Number(accountIdStr);
    console.log(`\n--- 处理账号 ${accountId}: ${accountCampaigns.length} 个campaign ---`);
    
    const [creds] = await conn.execute(
      'SELECT * FROM amazon_api_credentials WHERE accountId = ? LIMIT 1',
      [accountId]
    ) as any[];
    
    if (!creds || creds.length === 0) {
      console.error(`❌ 账号 ${accountId} 没有API凭证，跳过`);
      continue;
    }
    
    const cred = creds[0];
    
    try {
      // 创建API客户端
      const client = new AmazonAdsApiClient({
        clientId: cred.clientId,
        clientSecret: cred.clientSecret,
        refreshToken: cred.refreshToken,
        profileId: cred.profileId,
        region: cred.region || 'NA',
      });
      
      let successCount = 0;
      let failCount = 0;
      
      // 4. 逐个同步campaign状态到Amazon
      for (const campaign of accountCampaigns) {
        try {
          console.log(`  同步: "${campaign.campaignName}" (amazonId=${campaign.campaignId}) -> ENABLED`);
          
          await client.updateSpCampaign(String(campaign.campaignId), {
            state: 'ENABLED',
          } as any);
          
          successCount++;
          console.log(`  ✅ 成功`);
        } catch (error: any) {
          failCount++;
          console.error(`  ❌ 失败: ${error.message}`);
          
          // 如果是SB类型的campaign，尝试SB API
          if (error.message?.includes('404') || error.message?.includes('not found')) {
            console.log(`  ℹ️ 可能是SB/SD类型campaign，SP API不适用`);
          }
        }
        
        // 避免API限流
        await new Promise(r => setTimeout(r, 200));
      }
      
      console.log(`\n  账号 ${accountId} 同步完成: 成功=${successCount}, 失败=${failCount}`);
    } catch (error: any) {
      console.error(`❌ 账号 ${accountId} API初始化失败: ${error.message}`);
    }
  }
  
  await conn.end();
  console.log('\n=== 同步完成 ===');
}

main().catch(console.error);
