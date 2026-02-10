/**
 * 查询优化工具
 * 功能：
 * 1. 批量查询优化
 * 2. 查询结果缓存
 * 3. 查询性能监控
 * 4. SQL查询分析
 */

class QueryOptimizer {
  constructor() {
    this.queryStats = new Map();
    this.slowQueryThreshold = 1000; // 慢查询阈值：1秒
  }
  
  /**
   * 批量获取广告活动数据
   * 优化：使用IN查询代替多次单独查询
   */
  async batchGetCampaigns(db, campaignIds) {
    if (!campaignIds || campaignIds.length === 0) {
      return [];
    }
    
    const startTime = Date.now();
    
    try {
      const { campaigns } = db.schema;
      const { inArray } = require('drizzle-orm');
      
      const result = await db.select().from(campaigns)
        .where(inArray(campaigns.campaignId, campaignIds));
      
      const duration = Date.now() - startTime;
      this.recordQuery('batchGetCampaigns', duration, campaignIds.length);
      
      return result;
    } catch (error) {
      console.error('[QueryOptimizer] Error in batchGetCampaigns:', error);
      throw error;
    }
  }
  
  /**
   * 批量获取绩效数据
   * 优化：使用聚合查询和索引
   */
  async batchGetPerformance(db, campaignIds, startDate, endDate) {
    if (!campaignIds || campaignIds.length === 0) {
      return {};
    }
    
    const startTime = Date.now();
    
    try {
      const { dailyPerformance } = db.schema;
      const { inArray, and, sql } = require('drizzle-orm');
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      const perfData = await db.select({
        campaignId: dailyPerformance.campaignId,
        totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
      }).from(dailyPerformance).where(and(
        inArray(dailyPerformance.campaignId, campaignIds),
        sql`DATE(${dailyPerformance.date}) >= ${startStr}`,
        sql`DATE(${dailyPerformance.date}) <= ${endStr}`
      )).groupBy(dailyPerformance.campaignId);
      
      const duration = Date.now() - startTime;
      this.recordQuery('batchGetPerformance', duration, campaignIds.length);
      
      // 转换为Map以便快速查找
      const perfMap = {};
      for (const p of perfData) {
        perfMap[p.campaignId] = p;
      }
      
      return perfMap;
    } catch (error) {
      console.error('[QueryOptimizer] Error in batchGetPerformance:', error);
      throw error;
    }
  }
  
  /**
   * 优化的获取优化目标广告活动方法
   * 整合了多个查询，减少数据库往返次数
   */
  async getGoalCampaignsOptimized(db, goalId) {
    const startTime = Date.now();
    
    try {
      const { strategyTemplateCampaigns, campaigns, dailyPerformance } = db.schema;
      const { eq, inArray, and, sql } = require('drizzle-orm');
      
      // 1. 获取关联的广告活动ID
      const goalCampaigns = await db.select().from(strategyTemplateCampaigns)
        .where(eq(strategyTemplateCampaigns.applicationId, parseInt(goalId)));
      
      const campaignIds = goalCampaigns.map(gc => gc.campaignId);
      
      if (campaignIds.length === 0) {
        return { campaigns: [], message: '暂无关联的广告活动' };
      }
      
      // 2. 批量获取广告活动详情
      const campaignsData = await this.batchGetCampaigns(db, campaignIds);
      
      // 如果没有找到匹配的广告活动，说明数据已失效
      if (campaignsData.length === 0) {
        // 清理无效数据
        await db.delete(strategyTemplateCampaigns)
          .where(eq(strategyTemplateCampaigns.applicationId, parseInt(goalId)));
        
        return { 
          campaigns: [], 
          message: '广告活动数据已过期，请重新添加广告活动',
          cleaned: true 
        };
      }
      
      // 3. 批量获取绩效数据
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      
      const perfMap = await this.batchGetPerformance(db, campaignIds, startDate, endDate);
      
      // 4. 组合数据
      const result = campaignsData.map(c => {
        const perf = perfMap[c.campaignId] || {};
        const spend = parseFloat(perf.totalSpend || 0);
        const sales = parseFloat(perf.totalSales || 0);
        
        return {
          id: c.id,
          campaignName: c.campaignName,
          campaignType: c.campaignType,
          state: c.campaignStatus,
          dailyBudget: c.dailyBudget,
          impressions: parseInt(perf.totalImpressions || 0),
          clicks: parseInt(perf.totalClicks || 0),
          spend: spend,
          sales: sales,
          orders: parseInt(perf.totalOrders || 0),
          acos: sales > 0 ? (spend / sales * 100).toFixed(2) : '-',
          roas: spend > 0 ? (sales / spend).toFixed(2) : '-'
        };
      });
      
      const duration = Date.now() - startTime;
      this.recordQuery('getGoalCampaignsOptimized', duration, result.length);
      
      return { campaigns: result };
    } catch (error) {
      console.error('[QueryOptimizer] Error in getGoalCampaignsOptimized:', error);
      throw error;
    }
  }
  
  /**
   * 记录查询统计
   */
  recordQuery(queryName, duration, resultCount) {
    if (!this.queryStats.has(queryName)) {
      this.queryStats.set(queryName, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        slowQueries: 0
      });
    }
    
    const stats = this.queryStats.get(queryName);
    stats.count++;
    stats.totalDuration += duration;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.avgDuration = stats.totalDuration / stats.count;
    
    if (duration > this.slowQueryThreshold) {
      stats.slowQueries++;
      console.warn(`[QueryOptimizer] Slow query detected: ${queryName} took ${duration}ms for ${resultCount} results`);
    }
    
    console.log(`[QueryOptimizer] ${queryName}: ${duration}ms (${resultCount} results)`);
  }
  
  /**
   * 获取查询统计信息
   */
  getStats() {
    const stats = {};
    
    for (const [queryName, data] of this.queryStats.entries()) {
      stats[queryName] = {
        ...data,
        avgDuration: Math.round(data.avgDuration),
        minDuration: data.minDuration === Infinity ? 0 : data.minDuration
      };
    }
    
    return stats;
  }
  
  /**
   * 重置统计信息
   */
  resetStats() {
    this.queryStats.clear();
  }
  
  /**
   * 分析慢查询
   */
  analyzeSlowQueries() {
    const slowQueries = [];
    
    for (const [queryName, stats] of this.queryStats.entries()) {
      if (stats.slowQueries > 0) {
        slowQueries.push({
          queryName,
          slowCount: stats.slowQueries,
          totalCount: stats.count,
          slowPercentage: ((stats.slowQueries / stats.count) * 100).toFixed(2) + '%',
          avgDuration: Math.round(stats.avgDuration),
          maxDuration: stats.maxDuration
        });
      }
    }
    
    return slowQueries.sort((a, b) => b.slowCount - a.slowCount);
  }
}

// 创建全局查询优化器实例
const globalOptimizer = new QueryOptimizer();

module.exports = {
  QueryOptimizer,
  globalOptimizer
};
