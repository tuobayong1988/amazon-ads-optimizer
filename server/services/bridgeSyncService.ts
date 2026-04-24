/**
 * v26.7.6: PPCOPT Bridge 同步服务
 * 
 * 负责从 PPCOPT Bridge API 拉取绩效数据和搜索词数据，
 * 并写入 AmzOrbit 的 daily_performance 表。
 * 
 * 支持自动化定时同步和手动触发同步。
 */
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { dailyPerformance, campaigns, adAccounts } from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('BridgeSync');

// ==================== 配置 ====================

const BRIDGE_BASE_URL = process.env.PPCOPT_BRIDGE_URL || 'https://www.ppcopt.com/api/bridge/v1';
const BRIDGE_ADMIN_SECRET = process.env.PPCOPT_BRIDGE_ADMIN_SECRET || 'ppcopt-bridge-admin-2026';

interface BridgeSyncConfig {
  storeName: string;
  marketplace: string;
  accountId: number;
  apiKey?: string;
}

interface BridgeCampaign {
  id: number;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  status: string;
  dailyBudget: string;
  startDate: string;
  targetingType: string;
  impressions: number;
  clicks: number;
  spend: string;
  sales: string;
  orders: number;
  acos: string | null;
  roas: string | null;
  ctr: string | null;
  cvr: string | null;
  cpc: string | null;
  conversions: number;
  dataPoints: number;
}

interface BridgeDailyTrend {
  date: string;
  impressions: number;
  clicks: number;
  spend: string;
  sales: string;
  orders: number;
}

interface BridgePerfResponse {
  success: boolean;
  campaigns: BridgeCampaign[];
  dailyTrend: BridgeDailyTrend[];
  summary: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalImpressions: number;
    totalClicks: number;
    totalSpend: string;
    totalSales: string;
    totalOrders: number;
    overallAcos: string | null;
    overallRoas: string | null;
    accountId: number;
    accountName: string;
    dateRange: { startDate: string; endDate: string };
  };
  error?: string;
}

// ==================== API Key 管理 ====================

const keyCache = new Map<string, { key: string; expiresAt: number }>();

async function getOrCreateApiKey(storeName: string, marketplace: string): Promise<string> {
  const cacheKey = `${storeName}:${marketplace}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  try {
    const resp = await fetch(`${BRIDGE_BASE_URL}/admin/generate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': BRIDGE_ADMIN_SECRET,
      },
      body: JSON.stringify({ storeName, marketplace }),
    });

    if (!resp.ok) {
      throw new Error(`Generate key failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { apiKey: string };
    const key = data.apiKey;
    
    // Cache for 20 minutes (keys expire in 30 min)
    keyCache.set(cacheKey, { key, expiresAt: Date.now() + 20 * 60 * 1000 });
    
    return key;
  } catch (err: any) {
    log.error(`[BridgeSync] Failed to get API key for ${storeName}/${marketplace}: ${err.message}`);
    throw err;
  }
}

// ==================== 数据拉取 ====================

export async function pullPerformanceFromBridge(
  config: BridgeSyncConfig,
  dateRange?: { startDate: string; endDate: string }
): Promise<BridgePerfResponse> {
  const apiKey = config.apiKey || await getOrCreateApiKey(config.storeName, config.marketplace);
  
  const body: any = {
    storeName: config.storeName,
    marketplace: config.marketplace,
  };
  if (dateRange) {
    body.dateRange = dateRange;
  }

  const resp = await fetch(`${BRIDGE_BASE_URL}/pull-performance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`pull-performance failed: ${resp.status} ${text}`);
  }

  return await resp.json() as BridgePerfResponse;
}

// ==================== 数据写入 ====================

export async function syncBridgePerformanceToDb(
  config: BridgeSyncConfig,
  perfData: BridgePerfResponse
): Promise<{ campaignsUpdated: number; trendPointsWritten: number }> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  let campaignsUpdated = 0;
  let trendPointsWritten = 0;

  // Step 1: Write daily trend data to daily_performance table
  // Each trend point is an aggregated day across all campaigns
  if (perfData.dailyTrend && perfData.dailyTrend.length > 0) {
    for (const day of perfData.dailyTrend) {
      try {
        await db.insert(dailyPerformance).values({
          accountId: config.accountId,
          campaignId: null, // Aggregated across all campaigns
          date: day.date,
          impressions: day.impressions,
          clicks: day.clicks,
          spend: day.spend,
          sales: day.sales,
          orders: day.orders,
        }).onDuplicateKeyUpdate({
          set: {
            impressions: sql`VALUES(impressions)`,
            clicks: sql`VALUES(clicks)`,
            spend: sql`VALUES(spend)`,
            sales: sql`VALUES(sales)`,
            orders: sql`VALUES(orders)`,
          },
        });
        trendPointsWritten++;
      } catch (err: any) {
        log.warn(`[BridgeSync] Failed to write trend for ${day.date}: ${err.message}`);
      }
    }
  }

  // Step 2: Write per-campaign performance data
  // Only write campaigns that have actual data (impressions > 0)
  const campaignsWithData = perfData.campaigns.filter(c => c.impressions > 0 || c.clicks > 0);
  
  if (campaignsWithData.length > 0) {
    const dateRange = perfData.summary.dateRange;
    
    for (const camp of campaignsWithData) {
      try {
        // Calculate daily average for the date range
        const days = camp.dataPoints || 1;
        
        await db.insert(dailyPerformance).values({
          accountId: config.accountId,
          campaignId: String(camp.campaignId),
          date: dateRange.endDate, // Use end date as the reference point
          impressions: camp.impressions,
          clicks: camp.clicks,
          spend: camp.spend,
          sales: camp.sales,
          orders: camp.orders,
          dailyAcos: camp.acos || undefined,
          dailyRoas: camp.roas || undefined,
          conversions: camp.conversions || 0,
          ctr: camp.ctr || undefined,
          cvr: camp.cvr || undefined,
          cpc: camp.cpc || undefined,
        }).onDuplicateKeyUpdate({
          set: {
            impressions: sql`VALUES(impressions)`,
            clicks: sql`VALUES(clicks)`,
            spend: sql`VALUES(spend)`,
            sales: sql`VALUES(sales)`,
            orders: sql`VALUES(orders)`,
            dailyAcos: sql`VALUES(dailyAcos)`,
            dailyRoas: sql`VALUES(dailyRoas)`,
            conversions: sql`VALUES(conversions)`,
          },
        });
        campaignsUpdated++;
      } catch (err: any) {
        log.warn(`[BridgeSync] Failed to write campaign ${camp.campaignId}: ${err.message}`);
      }
    }
  }

  log.info(`[BridgeSync] Sync complete for ${config.storeName}/${config.marketplace}: ` +
    `${campaignsUpdated} campaigns, ${trendPointsWritten} trend points`);

  return { campaignsUpdated, trendPointsWritten };
}

// ==================== 完整同步流程 ====================

export async function executeBridgeSync(
  config: BridgeSyncConfig,
  dateRange?: { startDate: string; endDate: string }
): Promise<{
  success: boolean;
  campaignsUpdated: number;
  trendPointsWritten: number;
  summary: any;
  error?: string;
}> {
  try {
    log.info(`[BridgeSync] Starting sync for ${config.storeName}/${config.marketplace} (account=${config.accountId})`);
    
    // Pull data from PPCOPT
    const perfData = await pullPerformanceFromBridge(config, dateRange);
    
    if (!perfData.success) {
      return {
        success: false,
        campaignsUpdated: 0,
        trendPointsWritten: 0,
        summary: null,
        error: perfData.error || 'Unknown error from PPCOPT',
      };
    }

    // Write to local database
    const result = await syncBridgePerformanceToDb(config, perfData);

    return {
      success: true,
      campaignsUpdated: result.campaignsUpdated,
      trendPointsWritten: result.trendPointsWritten,
      summary: perfData.summary,
    };
  } catch (err: any) {
    log.error(`[BridgeSync] Sync failed for ${config.storeName}/${config.marketplace}: ${err.message}`);
    return {
      success: false,
      campaignsUpdated: 0,
      trendPointsWritten: 0,
      summary: null,
      error: err.message,
    };
  }
}

// ==================== 自动化同步调度 ====================

let autoSyncInterval: NodeJS.Timeout | null = null;
let autoSyncConfigs: BridgeSyncConfig[] = [];

export function startAutoSync(configs: BridgeSyncConfig[], intervalMs: number = 3600 * 1000) {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
  }
  
  autoSyncConfigs = configs;
  
  log.info(`[BridgeSync] Auto-sync started for ${configs.length} accounts, interval=${intervalMs / 1000}s`);
  
  autoSyncInterval = setInterval(async () => {
    log.info(`[BridgeSync] Auto-sync triggered for ${autoSyncConfigs.length} accounts`);
    
    for (const config of autoSyncConfigs) {
      try {
        await executeBridgeSync(config);
      } catch (err: any) {
        log.error(`[BridgeSync] Auto-sync error for ${config.storeName}: ${err.message}`);
      }
    }
  }, intervalMs);

  // Also run immediately
  setTimeout(async () => {
    for (const config of autoSyncConfigs) {
      try {
        await executeBridgeSync(config);
      } catch (err: any) {
        log.error(`[BridgeSync] Initial sync error for ${config.storeName}: ${err.message}`);
      }
    }
  }, 5000);
}

export function stopAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
    log.info('[BridgeSync] Auto-sync stopped');
  }
}

export function getAutoSyncStatus() {
  return {
    running: autoSyncInterval !== null,
    configCount: autoSyncConfigs.length,
    configs: autoSyncConfigs.map(c => ({
      storeName: c.storeName,
      marketplace: c.marketplace,
      accountId: c.accountId,
    })),
  };
}
