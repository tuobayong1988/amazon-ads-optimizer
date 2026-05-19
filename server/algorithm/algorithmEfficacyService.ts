import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('AlgorithmEfficacyService');
/**
 * algorithmEfficacyService.ts - 算法效能数据服务 (v235)
 * 
 * 为goalProgressAlgorithm提供NextGen算法效能数据，
 * 包括算法层级分布、正向率、置信度、自我进化纠错数等。
 * 
 * 数据来源：
 * 1. optimization_logs 表 — 出价调整记录中的actionDetail字段包含algorithmTier信息
 * 2. algorithm_effect_records 表 — 算法效果追踪记录
 * 3. algorithm_evolution_records 表 — 自我进化纠错记录
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import type { AlgorithmEfficacyData } from './goalProgressAlgorithm';

/**
 * 获取指定优化目标的算法效能数据
 * 
 * @param targetId 优化目标ID (performance_group_id)
 * @param days 回溯天数，默认30天
 */
export async function getAlgorithmEfficacyForTarget(
  targetId: number,
  days: number = 30
): Promise<AlgorithmEfficacyData | undefined> {
  const dbInstance = await getDb();
  if (!dbInstance) return undefined;
  
  try {
    // 1. 从optimization_logs获取出价调整记录的算法层级分布
    // @ts-ignore - Drizzle raw SQL execution
    const [bidLogs] = await dbInstance.execute(
      sql`SELECT action_detail FROM optimization_logs 
          WHERE performance_group_id = ${targetId}
            AND log_category = 'bid_adjustment'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          ORDER BY created_at DESC
          LIMIT 500`
    ) as unknown;
    
    let totalOperations = 0;
    let advancedCount = 0;
    let ruleEngineCount = 0;
    let conservativeCount = 0;
    let totalConfidence = 0;
    let positiveCount = 0;
    
    if (bidLogs && bidLogs.length > 0) {
      for (const log of (bidLogs as unknown[])) {
        try {
          // @ts-ignore Dynamic property access
          const detail = typeof log.action_detail === 'string' ? JSON.parse(log.action_detail) : log.action_detail;
          if (!detail) continue;
          
          totalOperations++;
          
          // 解析算法层级
          const algorithmUsed = detail.algorithmUsed || detail.algorithm || '';
          const reason = detail.reason || detail.changeReason || '';
          
          if (reason.includes('[高级算法') || ['linucb', 'cql', 'bayesian'].some(a => algorithmUsed.toLowerCase().includes(a))) {
            advancedCount++;
          } else if (reason.includes('[规则引擎') || algorithmUsed.includes('rule')) {
            ruleEngineCount++;
          } else if (reason.includes('[保守策略') || algorithmUsed.includes('conservative')) {
            conservativeCount++;
          } else {
            ruleEngineCount++; // 默认归类为规则引擎
          }
          
          // 解析置信度
          const confidence = detail.confidence || detail.algorithmConfidence || 0.5;
          totalConfidence += Number(confidence);
          
          // 解析正向性（出价降低且ACoS偏高 = 正向，出价提升且ACoS偏低 = 正向）
          const changePercent = detail.changePercent || detail.bidChangePercent || 0;
          const acos = detail.acos || detail.keywordAcos || 0;
          const targetAcos = detail.targetAcos || 30;
          
          if (changePercent < 0 && acos > targetAcos) {
            positiveCount++; // 高ACoS时降价 = 正向
          } else if (changePercent > 0 && acos < targetAcos * 0.8) {
            positiveCount++; // 低ACoS时加价 = 正向
          } else if (Math.abs(changePercent) < 3) {
            positiveCount++; // 小幅调整 = 保守正向
          }
        } catch (parseErr: any) {
          // 跳过解析失败的记录
        }
      }
    }
    
    // 2. 从algorithm_effect_records获取正向率（如果有更精确的数据）
    let precisePositiveRate: number | null = null;
    try {
      // @ts-ignore - Drizzle raw SQL execution
      const [effectStats] = await dbInstance.execute(
        sql`SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN effect_direction = 'positive' THEN 1 ELSE 0 END) as positive,
              AVG(confidence_score) as avg_confidence
            FROM algorithm_effect_records
            WHERE performance_group_id = ${targetId}
              AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
      ) as unknown;
      
      if (effectStats && effectStats[0] && effectStats[0].total > 0) {
        precisePositiveRate = (effectStats[0].positive / effectStats[0].total) * 100;
        if (effectStats[0].avg_confidence) {
          totalConfidence = effectStats[0].avg_confidence * totalOperations;
        }
      }
    } catch (effectErr: any) {
      // algorithm_effect_records表可能不存在，忽略
    }
    
    // 3. 从algorithm_evolution_records获取自我进化纠错数
    let evolutionCorrections = 0;
    let improvementTrend = 'stable';
    try {
      // @ts-ignore - Drizzle raw SQL execution
      const [evoStats] = await dbInstance.execute(
        sql`SELECT 
              COUNT(*) as total_corrections,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as recent_corrections,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as prev_corrections
            FROM algorithm_evolution_records
            WHERE performance_group_id = ${targetId}
              AND action_type = 'correction'
              AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
      ) as unknown;
      
      if (evoStats && evoStats[0]) {
        evolutionCorrections = Number(evoStats[0].total_corrections) || 0;
        const recent = Number(evoStats[0].recent_corrections) || 0;
        const prev = Number(evoStats[0].prev_corrections) || 0;
        if (recent < prev) improvementTrend = 'improving';
        else if (recent > prev * 1.5) improvementTrend = 'declining';
      }
    } catch (evoErr: any) {
      // algorithm_evolution_records表可能不存在，忽略
    }
    
    if (totalOperations === 0) return undefined;
    
    // 计算最终结果
    const total = totalOperations;
    const positiveRate = precisePositiveRate !== null 
      ? precisePositiveRate 
      : (total > 0 ? (positiveCount / total) * 100 : 50);
    
    return {
      totalOperations: total,
      positiveRate,
      tierDistribution: {
        advanced: total > 0 ? Math.round((advancedCount / total) * 100) : 0,
        ruleEngine: total > 0 ? Math.round((ruleEngineCount / total) * 100) : 0,
        conservative: total > 0 ? Math.round((conservativeCount / total) * 100) : 0,
      },
      avgConfidence: total > 0 ? totalConfidence / total : 0.5,
      evolutionCorrections,
      improvementTrend,
    };
  } catch (err: unknown) {
    log.warn(`[algorithmEfficacyService] Error for target ${targetId}:`, (err as Error).message);
    return undefined;
  }
}
