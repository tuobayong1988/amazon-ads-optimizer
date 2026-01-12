/**
 * 对比报告中的campaignName与数据库中的campaignName
 */
import { getDb } from '../server/db';
import { amazonApiCredentials, adAccounts, campaigns } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';
import JSONBig from 'json-bigint';

const JSONBigString = JSONBig({ storeAsString: true });

const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
};

async function compareCampaignNames() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('数据库连接失败');
      return;
    }
    
    // 获取凭证
    const [credentials] = await db
      .select()
      .from(amazonApiCredentials)
      .limit(1);
    
    if (!credentials) {
      console.error('未找到API凭证');
      return;
    }
    
    // 获取US账号
    const [account] = await db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.marketplace, 'US'))
      .limit(1);
    
    if (!account) {
      console.error('未找到US账号');
      return;
    }
    
    console.log('=== 对比Campaign Name ===');
    console.log('账号:', account.accountName);
    
    // 刷新token
    const tokenResponse = await axios.post('https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // 创建axios实例
    const client = axios.create({
      baseURL: API_ENDPOINTS.NA,
      headers: {
        'Amazon-Advertising-API-ClientId': credentials.clientId,
        'Amazon-Advertising-API-Scope': account.profileId,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      responseType: 'text',
      transformResponse: [(data) => {
        if (typeof data === 'string') {
          try {
            return JSONBigString.parse(data);
          } catch (e) {
            return data;
          }
        }
        return data;
      }],
    });
    
    // 获取数据库中的SB广告活动名称
    const dbCampaigns = await db
      .select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName,
        campaignType: campaigns.campaignType,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, account.id),
          eq(campaigns.campaignType, 'sb')
        )
      )
      .limit(20);
    
    console.log('\n=== 数据库中的SB广告活动名称 (前20个) ===');
    for (const c of dbCampaigns) {
      console.log(`  ID: ${c.campaignId} | Name: "${c.campaignName}"`);
    }
    
    // 请求SB报告
    console.log('\n=== 请求SB报告 ===');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    const reportRequest = {
      name: 'SB Campaign Report',
      startDate: dateStr,
      endDate: dateStr,
      configuration: {
        adProduct: 'SPONSORED_BRANDS',
        groupBy: ['campaign'],
        columns: [
          'campaignId',
          'campaignName',
          'impressions',
          'clicks',
          'cost',
            'sales',
            'purchases',
        ],
        reportTypeId: 'sbCampaigns',
        timeUnit: 'DAILY',
        format: 'GZIP_JSON',
      },
    };
    
    try {
      const reportResponse = await client.post('/reporting/reports', reportRequest);
      console.log('报告请求成功，报告ID:', reportResponse.data.reportId);
      
      // 等待报告完成
      let reportStatus = 'PENDING';
      let reportUrl = '';
      
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusResponse = await client.get(`/reporting/reports/${reportResponse.data.reportId}`);
        reportStatus = statusResponse.data.status;
        console.log(`报告状态: ${reportStatus}`);
        
        if (reportStatus === 'COMPLETED') {
          reportUrl = statusResponse.data.url;
          break;
        } else if (reportStatus === 'FAILED') {
          console.error('报告生成失败');
          return;
        }
      }
      
      if (reportUrl) {
        // 下载报告
        const reportDataResponse = await axios.get(reportUrl, {
          responseType: 'arraybuffer',
        });
        
        const zlib = require('zlib');
        const decompressed = zlib.gunzipSync(reportDataResponse.data);
        const reportData = JSONBigString.parse(decompressed.toString());
        
        console.log('\n=== 报告中的SB广告活动名称 (前20个) ===');
        for (let i = 0; i < Math.min(20, reportData.length); i++) {
          const row = reportData[i];
          console.log(`  ID: ${row.campaignId} | Name: "${row.campaignName}"`);
        }
        
        // 尝试匹配
        console.log('\n=== 匹配分析 ===');
        let matched = 0;
        let notMatched = 0;
        
        for (const row of reportData.slice(0, 20)) {
          const dbMatch = dbCampaigns.find(c => c.campaignName === row.campaignName);
          if (dbMatch) {
            matched++;
            console.log(`✓ 匹配: "${row.campaignName}"`);
          } else {
            notMatched++;
            console.log(`✗ 未匹配: "${row.campaignName}"`);
          }
        }
        
        console.log(`\n匹配: ${matched}, 未匹配: ${notMatched}`);
      }
    } catch (error: any) {
      if (error.response?.data?.message?.includes('duplicate')) {
        console.log('报告已存在，使用已有报告');
        const reportId = error.response.data.reportId;
        // ... 继续处理
      } else {
        throw error;
      }
    }
    
    process.exit(0);
  } catch (error: any) {
    console.error('错误:', error.response?.data || error.message);
    process.exit(1);
  }
}

compareCampaignNames();
