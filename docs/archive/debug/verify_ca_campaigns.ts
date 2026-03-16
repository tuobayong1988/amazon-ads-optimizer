/**
 * 验证加拿大站点广告活动在Amazon端的实际状态
 */
import * as db from './server/db';
import { getAmazonSyncService } from './server/services/amazonApiHelper';

async function main() {
  try {
    console.log('=== 验证加拿大站点广告活动Amazon端状态 ===\n');
    
    // 获取优化目标30017的campaigns
    const campaigns = await db.getCampaignsByPerformanceGroupId(30017);
    console.log(`本地数据库中30017组共有 ${campaigns.length} 个广告活动\n`);
    
    // 获取SyncService
    const syncService = await getAmazonSyncService(90021);
    if (!syncService) {
      console.error('无法获取加拿大站点的API服务');
      process.exit(1);
    }
    
    console.log('成功连接到Amazon API\n');
    
    // 分别获取SP和SB广告活动状态
    const spCampaigns = campaigns.filter((c: any) => c.campaignType?.startsWith('sp'));
    const sbCampaigns = campaigns.filter((c: any) => c.campaignType === 'sb');
    
    console.log(`SP广告活动: ${spCampaigns.length}个, SB广告活动: ${sbCampaigns.length}个\n`);
    
    // 获取Amazon端的SP广告活动列表
    console.log('--- SP广告活动状态对比 ---');
    try {
      const amazonSpCampaigns = await syncService.client.listSpCampaigns();
      for (const localCampaign of spCampaigns) {
        const amazonCampaign = amazonSpCampaigns.find((ac: any) => 
          String(ac.campaignId) === String((localCampaign as any).campaignId)
        );
        if (amazonCampaign) {
          const localStatus = (localCampaign as any).campaignStatus;
          const amazonStatus = (amazonCampaign.state || amazonCampaign.status || 'unknown').toLowerCase();
          const match = localStatus === amazonStatus ? '✅' : '❌';
          console.log(`${match} ${(localCampaign as any).campaignName?.substring(0, 60)}`);
          console.log(`   本地: ${localStatus} | Amazon: ${amazonStatus}`);
        } else {
          console.log(`⚠️ ${(localCampaign as any).campaignName?.substring(0, 60)}`);
          console.log(`   Amazon端未找到此广告活动 (ID: ${(localCampaign as any).campaignId})`);
        }
      }
    } catch (e: any) {
      console.error(`SP广告活动获取失败: ${e.message}`);
    }
    
    // 获取Amazon端的SB广告活动列表
    console.log('\n--- SB广告活动状态对比 ---');
    try {
      const amazonSbCampaigns = await syncService.client.listSbCampaigns();
      for (const localCampaign of sbCampaigns) {
        const amazonCampaign = amazonSbCampaigns.find((ac: any) => 
          String(ac.campaignId) === String((localCampaign as any).campaignId)
        );
        if (amazonCampaign) {
          const localStatus = (localCampaign as any).campaignStatus;
          const amazonStatus = (amazonCampaign.state || amazonCampaign.status || 'unknown').toLowerCase();
          const match = localStatus === amazonStatus ? '✅' : '❌';
          console.log(`${match} ${(localCampaign as any).campaignName?.substring(0, 60)}`);
          console.log(`   本地: ${localStatus} | Amazon: ${amazonStatus}`);
        } else {
          console.log(`⚠️ ${(localCampaign as any).campaignName?.substring(0, 60)}`);
          console.log(`   Amazon端未找到此广告活动 (ID: ${(localCampaign as any).campaignId})`);
        }
      }
    } catch (e: any) {
      console.error(`SB广告活动获取失败: ${e.message}`);
    }
    
    console.log('\n=== 验证完成 ===');
    process.exit(0);
  } catch (error: any) {
    console.error('验证失败:', error.message);
    process.exit(1);
  }
}

main();
