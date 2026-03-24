import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('StrategyRecommendationService');
/**
 * 策略模板推荐服务
 * 
 * 基于广告活动的综合表现数据，智能推荐最适合的策略模板。
 * 
 * 策略模板定义：
 * 1. aggressive-growth（激进增长）- 新品推广期，接受高ACoS换取曝光
 * 2. balanced（平衡增长）- 成熟产品日常运营，成本与增长平衡
 * 3. profit-focused（利润优先）- 严格控制成本，追求最大化利润
 * 4. seasonal-boost（旺季冲刺）- 大促期间短期最大化销量
 * 5. brand-defense（品牌防御）- 保护品牌词不被竞争对手抢占
 * 6. inventory-clearance（库存清理）- 快速清理FBA库存，避免长期仓储费
 * 7. competitor-attack（竞品攻击）- 抢占指定竞品的流量和市场份额
 * 8. market-expansion（新市场拓展）- 在新站点快速建立初始销量和排名
 * 9. seasonal-pattern（季节性模式）- 适应季节性产品的周期性波动
 * 10. decline-management（衰退期管理）- 在产品生命周期末期，维持利润
 * 11. emergency-response（紧急响应）- 应对差评、断货等突发负面事件
 */

import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { campaigns, performanceGroups, dailyPerformance } from '../../drizzle/schema';

// 策略模板定义
export const STRATEGY_TEMPLATES = [
  {
    id: 'aggressive-growth',
    name: '激进增长',
    description: '适合新品推广期或需要快速抢占市场份额的场景。接受较高的ACoS换取更多曝光和销量。',
    targetAcos: 40,
    minAcos: 25,
    maxAcos: 100,
    bidMultiplier: 1.25, // 高于建议竞价20-30%
    budgetMultiplier: 1.5,
  },
  {
    id: 'balanced',
    name: '平衡增长',
    description: '在控制成本的同时追求稳定增长。适合大多数成熟产品的日常运营。',
    targetAcos: 25,
    minAcos: 15,
    maxAcos: 35,
    bidMultiplier: 1.0,
    budgetMultiplier: 1.0,
  },
  {
    id: 'profit-focused',
    name: '利润优先',
    description: '严格控制广告成本，追求最大化利润。适合利润率较低或需要控制支出的产品。',
    targetAcos: 15,
    minAcos: 0,
    maxAcos: 20,
    bidMultiplier: 0.85,
    budgetMultiplier: 0.8,
  },
  {
    id: 'seasonal-boost',
    name: '旺季冲刺',
    description: '针对Prime Day、黑五等大促期间的特殊策略。短期内最大化销量。',
    targetAcos: 35,
    minAcos: 20,
    maxAcos: 50,
    bidMultiplier: 1.4,
    budgetMultiplier: 2.0,
  },
  {
    id: 'brand-defense',
    name: '品牌防御',
    description: '保护品牌词不被竞争对手抢占。适合有一定品牌知名度的卖家。',
    targetAcos: 10,
    minAcos: 0,
    maxAcos: 15,
    bidMultiplier: 1.1,
    budgetMultiplier: 0.9,
  },
  {
    id: 'inventory-clearance',
    name: '库存清理',
    description: '快速清理FBA库存，避免长期仓储费。大幅提高预算和出价，接受高ACoS，配合促销。',
    targetAcos: 60,
    minAcos: 40,
    maxAcos: 150,
    bidMultiplier: 1.5,
    budgetMultiplier: 2.5,
  },
  {
    id: 'competitor-attack',
    name: '竞品攻击',
    description: '抢占指定竞品的流量和市场份额。针对竞品ASIN和品牌词进行高强度投放。',
    targetAcos: 45,
    minAcos: 30,
    maxAcos: 70,
    bidMultiplier: 1.6,
    budgetMultiplier: 1.8,
  },
  {
    id: 'market-expansion',
    name: '新市场拓展',
    description: '在新站点快速建立初始销量和排名。采用激进策略，但更关注本地化关键词的测试。',
    targetAcos: 50,
    minAcos: 30,
    maxAcos: 80,
    bidMultiplier: 1.3,
    budgetMultiplier: 1.6,
  },
  {
    id: 'seasonal-pattern',
    name: '季节性模式',
    description: '适应季节性产品的周期性波动。根据历史同期数据，自动在旺季前提升预算，淡季降低。',
    targetAcos: 30,
    minAcos: 20,
    maxAcos: 45,
    bidMultiplier: 1.2,
    budgetMultiplier: 1.4,
  },
  {
    id: 'decline-management',
    name: '衰退期管理',
    description: '在产品生命周期末期，维持利润，平稳过渡。逐步降低预算，暂停低效广告，聚焦核心盈利词。',
    targetAcos: 20,
    minAcos: 10,
    maxAcos: 30,
    bidMultiplier: 0.7,
    budgetMultiplier: 0.6,
  },
  {
    id: 'emergency-response',
    name: '紧急响应',
    description: '应对差评、断货等突发负面事件。立即暂停相关广告，或切换到品牌防御模式，降低负面影响。',
    targetAcos: 15,
    minAcos: 0,
    maxAcos: 25,
    bidMultiplier: 0.5,
    budgetMultiplier: 0.4,
  },
];

interface CampaignPerformanceData {
  id: number;
  campaignName: string;
  campaignType: string;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cvr: number | null;
  spend: number;
  sales: number;
  impressions: number;
  clicks: number;
  orders: number;
  dailyBudget: number;
  performanceGroupId: number | null;
}

interface StrategyRecommendation {
  campaignId: number;
  recommendedTemplateId: string;
  recommendedTemplateName: string;
  reason: string;
  confidence: number; // 0-100
}

/**
 * 为单个广告活动推荐最佳策略模板
 */
export function recommendStrategyTemplate(campaign: CampaignPerformanceData): StrategyRecommendation {
  const { acos, roas, ctr, cvr, spend, sales, impressions, clicks, orders, dailyBudget } = campaign;

  // 数据不足时默认推荐平衡增长
  if (impressions < 100 || clicks < 10 || spend < 5) {
    return {
      // @ts-ignore
      campaignId: (campaign as Record<string, unknown>).campaignId,
      recommendedTemplateId: 'aggressive-growth',
      recommendedTemplateName: '激进增长',
      reason: '数据量不足（曝光<100或点击<10），建议采用激进增长策略积累数据',
      confidence: 30,
    };
  }

  const acosVal = acos ?? (sales > 0 ? (spend / sales) * 100 : 100);
  const roasVal = roas ?? (spend > 0 ? sales / spend : 0);
  const ctrVal = ctr ?? (impressions > 0 ? clicks / impressions : 0);
  const cvrVal = cvr ?? (clicks > 0 ? orders / clicks : 0);
  const budgetUtilization = dailyBudget > 0 ? (spend / dailyBudget) * 100 : 0;

  // 评分系统：为每个策略模板计算适配分数
  const scores: { templateId: string; score: number; reasons: string[] }[] = [];

  // 1. 激进增长评分
  {
    let score = 0;
    const reasons: string[] = [];
    
    // 高ACoS但有增长潜力
    if (acosVal > 30) { score += 20; reasons.push(`ACoS(${acosVal.toFixed(1)}%)较高，需要增长策略`); }
    // 低曝光量 - 需要更多曝光
    if (impressions < 1000) { score += 25; reasons.push(`曝光量(${impressions})较低，需要扩大曝光`); }
    // 预算利用率低 - 还有增长空间
    if (budgetUtilization < 60) { score += 15; reasons.push(`预算利用率(${budgetUtilization.toFixed(0)}%)较低`); }
    // CTR较好 - 产品有吸引力
    if (ctrVal > 0.005) { score += 10; reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)表现良好`); }
    // 低销量 - 新品特征
    if (orders < 10) { score += 20; reasons.push(`订单量(${orders})较少，处于推广初期`); }
    
    scores.push({ templateId: 'aggressive-growth', score, reasons });
  }

  // 2. 平衡增长评分
  {
    let score = 0;
    const reasons: string[] = [];
    
    // ACoS在合理范围
    if (acosVal >= 15 && acosVal <= 35) { score += 30; reasons.push(`ACoS(${acosVal.toFixed(1)}%)在平衡范围内`); }
    // 有稳定的转化
    if (cvrVal >= 0.05 && cvrVal <= 0.15) { score += 20; reasons.push(`转化率(${(cvrVal * 100).toFixed(1)}%)稳定`); }
    // 预算利用率适中
    if (budgetUtilization >= 60 && budgetUtilization <= 95) { score += 15; reasons.push(`预算利用率(${budgetUtilization.toFixed(0)}%)适中`); }
    // 有一定的销量基础
    if (orders >= 10 && orders <= 100) { score += 15; reasons.push(`订单量(${orders})稳定`); }
    // ROAS合理
    if (roasVal >= 2.5 && roasVal <= 5) { score += 10; reasons.push(`ROAS(${roasVal.toFixed(1)})表现均衡`); }
    
    scores.push({ templateId: 'balanced', score, reasons });
  }

  // 3. 利润优先评分
  {
    let score = 0;
    const reasons: string[] = [];
    
    // 低ACoS - 已经很高效
    if (acosVal < 20) { score += 25; reasons.push(`ACoS(${acosVal.toFixed(1)}%)已经很低，适合利润优先`); }
    // 高ROAS
    if (roasVal > 4) { score += 25; reasons.push(`ROAS(${roasVal.toFixed(1)})很高，利润空间大`); }
    // 高转化率
    if (cvrVal > 0.1) { score += 15; reasons.push(`转化率(${(cvrVal * 100).toFixed(1)}%)很高`); }
    // 预算接近上限 - 需要优化效率
    if (budgetUtilization > 90) { score += 10; reasons.push(`预算利用率(${budgetUtilization.toFixed(0)}%)接近上限`); }
    // 高销量 - 成熟产品
    if (orders > 50) { score += 15; reasons.push(`订单量(${orders})充足，产品成熟`); }
    
    scores.push({ templateId: 'profit-focused', score, reasons });
  }

  // 4. 旺季冲刺评分（基于时间和表现特征）
  {
    let score = 0;
    const reasons: string[] = [];
    
    const now = new Date();
    const month = now.getMonth() + 1;
    // 旺季月份：7月(Prime Day)、10-12月(黑五/圣诞)
    if ([7, 10, 11, 12].includes(month)) { score += 30; reasons.push(`当前处于旺季月份(${month}月)`); }
    // 高CTR - 产品受欢迎
    if (ctrVal > 0.008) { score += 15; reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)很高，产品受欢迎`); }
    // 转化率好但曝光不够
    if (cvrVal > 0.08 && impressions < 5000) { score += 20; reasons.push(`转化率高但曝光不足，适合冲刺`); }
    // 预算还有空间
    if (budgetUtilization < 80) { score += 10; reasons.push(`预算还有增长空间`); }
    
    scores.push({ templateId: 'seasonal-boost', score, reasons });
  }

  // 5. 品牌防御评分
  {
    let score = 0;
    const reasons: string[] = [];
    
    // 极低ACoS - 品牌词特征
    if (acosVal < 10) { score += 30; reasons.push(`ACoS(${acosVal.toFixed(1)}%)极低，可能是品牌词广告`); }
    // 极高转化率 - 品牌词特征
    if (cvrVal > 0.15) { score += 25; reasons.push(`转化率(${(cvrVal * 100).toFixed(1)}%)极高，品牌词特征`); }
    // 极高ROAS
    if (roasVal > 8) { score += 20; reasons.push(`ROAS(${roasVal.toFixed(1)})极高`); }
    // 高CTR - 品牌认知度高
    if (ctrVal > 0.01) { score += 10; reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)很高，品牌认知度好`); }
    
    scores.push({ templateId: 'brand-defense', score, reasons });
  }

  // 选择得分最高的策略模板
  // @ts-ignore
  scores.sort((a: unknown, b: unknown) => b.score - a.score);
  const best = scores[0] as unknown;
  // @ts-ignore
  const template = STRATEGY_TEMPLATES.find(t => t.id === best.templateId)!;

  // 计算置信度：最高分与第二高分的差距越大，置信度越高
  const secondBest = scores[1];
  // @ts-ignore
  const scoreDiff = best.score - secondBest.score;
  // @ts-ignore
  const confidence = Math.min(95, Math.max(20, 40 + scoreDiff * 2));

  // @ts-ignore
  return {
    // @ts-ignore
    campaignId: (campaign as Record<string, unknown>).campaignId,
    // @ts-ignore
    recommendedTemplateId: best.templateId,
    recommendedTemplateName: template.name,
    // @ts-ignore
    reason: best.reasons.slice(0, 3).join('；'),
    confidence,
  };
}

/**
 * 批量更新所有广告活动的策略模板推荐
 */
export async function updateAllCampaignRecommendations(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    // 获取该账户下所有广告活动及其绩效数据
    const allCampaigns = await db
      .select({
        id: campaigns.id,
        campaignName: campaigns.campaignName,
        campaignType: campaigns.campaignType,
        acos: campaigns.acos,
        roas: campaigns.roas,
        ctr: campaigns.ctr,
        cvr: campaigns.cvr,
        spend: campaigns.spend,
        sales: campaigns.sales,
        impressions: campaigns.impressions,
        clicks: campaigns.clicks,
        orders: campaigns.orders,
        dailyBudget: campaigns.dailyBudget,
        performanceGroupId: campaigns.performanceGroupId,
      // @ts-ignore
      })
      // @ts-ignore
      .from(campaigns)
      // @ts-ignore
      .where(eq(campaigns.accountId, accountId));

    // @ts-ignore
    let updated = 0;
    // @ts-ignore
    for (const campaign of (allCampaigns as unknown[])) {
      // @ts-ignore
      const perfData: CampaignPerformanceData = {
        // @ts-ignore
        id: campaign.id,
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        campaignType: campaign.campaignType,
        // @ts-ignore
        acos: campaign.acos ? Number(campaign.acos) : null,
        // @ts-ignore
        roas: campaign.roas ? Number(campaign.roas) : null,
        // @ts-ignore
        ctr: campaign.ctr ? Number(campaign.ctr) : null,
        // @ts-ignore
        cvr: campaign.cvr ? Number(campaign.cvr) : null,
        // @ts-ignore
        spend: Number(campaign.spend || 0),
        // @ts-ignore
        sales: Number(campaign.sales || 0),
        // @ts-ignore
        impressions: Number(campaign.impressions || 0),
        // @ts-ignore
        clicks: Number(campaign.clicks || 0),
        // @ts-ignore
        orders: Number(campaign.orders || 0),
        // @ts-ignore
        dailyBudget: Number(campaign.dailyBudget || 0),
        // @ts-ignore
        performanceGroupId: campaign.performanceGroupId,
      };

      const recommendation = recommendStrategyTemplate(perfData);

      await db
        .update(campaigns)
        .set({
          recommendedStrategyTemplateId: recommendation.recommendedTemplateId,
          recommendedStrategyTemplateName: recommendation.recommendedTemplateName,
          recommendationReason: recommendation.reason,
          recommendationUpdatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        })
        // @ts-ignore
        .where(eq(campaigns.id, campaign.id));

      updated++;
    }

    log.info(`[StrategyRecommendation] 已更新 ${updated} 个广告活动的策略推荐`);
    return updated;
  } catch (error: any) {
    log.warn('[StrategyRecommendation] 更新策略推荐失败:', error);
    return 0;
  }
}
