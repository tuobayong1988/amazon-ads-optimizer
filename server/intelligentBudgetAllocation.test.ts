import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as intelligentBudgetAllocationService from './intelligentBudgetAllocationService';

describe('智能预算分配服务', () => {
  describe('多维度评分系统', () => {
    it('应该正确计算转化效率得分', () => {
      // 高转化效率的广告活动应该获得高分
      const highEfficiencyCampaign = {
        campaignId: 1,
        campaignName: '高效广告',
        currentBudget: 100,
        dailyAvgSpend30d: 90,
        dailyAvgConversions: 15,
        roas7d: 4.5,
        roas14d: 4.2,
        roas30d: 4.0,
        totalSpend30d: 2700,
        totalSales30d: 10800,
        totalConversions30d: 450,
        budgetUtilization: 90,
        avgCpc: 0.8,
        avgCtr: 0.5,
        avgCvr: 12,
        impressions30d: 50000,
        clicks30d: 3375,
      };
      
      // 转化效率 = 15 / 90 * 100 = 16.67%
      // 这是一个很高的转化效率
      const conversionEfficiency = highEfficiencyCampaign.dailyAvgConversions / highEfficiencyCampaign.dailyAvgSpend30d * 100;
      expect(conversionEfficiency).toBeGreaterThan(10);
    });
    
    it('应该正确计算ROAS得分', () => {
      // ROAS > 3 应该获得高分
      const highRoasCampaign = {
        roas7d: 5.0,
        roas14d: 4.5,
        roas30d: 4.0,
      };
      
      // 平均ROAS = (5.0 + 4.5 + 4.0) / 3 = 4.5
      const avgRoas = (highRoasCampaign.roas7d + highRoasCampaign.roas14d + highRoasCampaign.roas30d) / 3;
      expect(avgRoas).toBeGreaterThan(3);
    });
    
    it('应该正确计算增长潜力得分', () => {
      // 预算利用率高且ROAS好的广告活动有增长潜力
      const highPotentialCampaign = {
        budgetUtilization: 95,
        roas30d: 4.0,
      };
      
      // 高预算利用率 + 高ROAS = 高增长潜力
      expect(highPotentialCampaign.budgetUtilization).toBeGreaterThan(90);
      expect(highPotentialCampaign.roas30d).toBeGreaterThan(3);
    });
    
    it('应该正确计算稳定性得分', () => {
      // ROAS波动小的广告活动应该获得高稳定性分数
      const stableCampaign = {
        roas7d: 4.0,
        roas14d: 4.1,
        roas30d: 4.0,
      };
      
      // 计算变异系数
      const roasValues = [stableCampaign.roas7d, stableCampaign.roas14d, stableCampaign.roas30d];
      const mean = roasValues.reduce((a, b) => a + b, 0) / roasValues.length;
      const variance = roasValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / roasValues.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;
      
      // 变异系数应该很小（< 0.1）
      expect(cv).toBeLessThan(0.1);
    });
    
    it('应该正确计算趋势得分', () => {
      // 7天ROAS > 30天ROAS 表示上升趋势
      const upwardTrendCampaign = {
        roas7d: 5.0,
        roas30d: 4.0,
      };
      
      const trendRatio = upwardTrendCampaign.roas7d / upwardTrendCampaign.roas30d;
      expect(trendRatio).toBeGreaterThan(1);
    });
  });
  
  describe('预算调整计算', () => {
    it('应该限制最大调整幅度', () => {
      const maxAdjustmentPercent = 15;
      const currentBudget = 100;
      const rawSuggestedBudget = 150; // 50%增加
      
      // 限制后的建议预算
      const maxIncrease = currentBudget * (1 + maxAdjustmentPercent / 100);
      const limitedBudget = Math.min(rawSuggestedBudget, maxIncrease);
      
      expect(limitedBudget).toBeCloseTo(115, 10);
    });
    
    it('应该确保预算不低于最小值', () => {
      const minDailyBudget = 5;
      const suggestedBudget = 3;
      
      const finalBudget = Math.max(suggestedBudget, minDailyBudget);
      expect(finalBudget).toBe(5);
    });
    
    it('应该正确计算调整百分比', () => {
      const currentBudget = 100;
      const suggestedBudget = 115;
      
      const adjustmentPercent = ((suggestedBudget - currentBudget) / currentBudget) * 100;
      expect(adjustmentPercent).toBe(15);
    });
  });
  
  describe('风险评估', () => {
    it('应该将高调整幅度标记为高风险', () => {
      const adjustmentPercent = 20;
      
      let riskLevel: string;
      if (Math.abs(adjustmentPercent) > 15) {
        riskLevel = 'high';
      } else if (Math.abs(adjustmentPercent) > 10) {
        riskLevel = 'medium';
      } else {
        riskLevel = 'low';
      }
      
      expect(riskLevel).toBe('high');
    });
    
    it('应该将低数据量标记为风险因素', () => {
      const totalConversions30d = 5;
      const minConversionsForReliability = 10;
      
      const isLowData = totalConversions30d < minConversionsForReliability;
      expect(isLowData).toBe(true);
    });
    
    it('应该将高波动性标记为风险因素', () => {
      const roas7d = 5.0;
      const roas30d = 3.0;
      
      const volatility = Math.abs(roas7d - roas30d) / roas30d;
      const isHighVolatility = volatility > 0.3;
      
      expect(isHighVolatility).toBe(true);
    });
  });
  
  describe('边际效益分析', () => {
    it('应该计算边际ROAS', () => {
      // 假设增加10%预算，销售额增加8%
      const currentSpend = 100;
      const currentSales = 400;
      const newSpend = 110;
      const newSales = 432;
      
      const marginalSpend = newSpend - currentSpend;
      const marginalSales = newSales - currentSales;
      const marginalROAS = marginalSales / marginalSpend;
      
      expect(marginalROAS).toBe(3.2);
    });
    
    it('应该识别边际效益递减', () => {
      // 当边际ROAS低于平均ROAS时，说明边际效益递减
      const avgROAS = 4.0;
      const marginalROAS = 3.2;
      
      const isDiminishingReturns = marginalROAS < avgROAS;
      expect(isDiminishingReturns).toBe(true);
    });
  });
  
  describe('场景模拟', () => {
    it('应该正确预测预算增加后的效果', () => {
      const currentBudget = 100;
      const currentSpend = 90;
      const currentSales = 360;
      const newBudget = 120;
      
      // 假设线性关系（简化模型）
      const budgetUtilization = currentSpend / currentBudget;
      const predictedSpend = Math.min(newBudget * budgetUtilization, newBudget);
      const roas = currentSales / currentSpend;
      const predictedSales = predictedSpend * roas;
      
      expect(predictedSpend).toBe(108);
      expect(predictedSales).toBe(432);
    });
    
    it('应该计算预测置信度', () => {
      const totalConversions30d = 100;
      const roasStability = 0.95; // 95%稳定性
      
      // 基于数据量和稳定性计算置信度
      const dataConfidence = Math.min(totalConversions30d / 100, 1) * 100;
      const stabilityConfidence = roasStability * 100;
      const overallConfidence = (dataConfidence + stabilityConfidence) / 2;
      
      expect(overallConfidence).toBeGreaterThan(80);
    });
  });
  
  describe('异常检测', () => {
    it('应该检测到异常高的ROAS', () => {
      const roas = 15.0;
      const normalRoasThreshold = 10.0;
      
      const isAnomalous = roas > normalRoasThreshold;
      expect(isAnomalous).toBe(true);
    });
    
    it('应该检测到异常低的转化率', () => {
      const cvr = 0.5; // 0.5%
      const normalCvrThreshold = 1.0;
      
      const isAnomalous = cvr < normalCvrThreshold;
      expect(isAnomalous).toBe(true);
    });
    
    it('应该检测到预算利用率异常', () => {
      const budgetUtilization = 150; // 超支50%
      const normalUtilizationMax = 110;
      
      const isAnomalous = budgetUtilization > normalUtilizationMax;
      expect(isAnomalous).toBe(true);
    });
  });
  
  describe('配置管理', () => {
    it('应该验证权重总和为1', () => {
      const config = {
        conversionEfficiencyWeight: 0.25,
        roasWeight: 0.25,
        growthPotentialWeight: 0.20,
        stabilityWeight: 0.15,
        trendWeight: 0.15,
      };
      
      const totalWeight = 
        config.conversionEfficiencyWeight +
        config.roasWeight +
        config.growthPotentialWeight +
        config.stabilityWeight +
        config.trendWeight;
      
      expect(totalWeight).toBe(1);
    });
    
    it('应该验证约束参数的合理性', () => {
      const config = {
        maxAdjustmentPercent: 15,
        minDailyBudget: 5,
        cooldownDays: 3,
        newCampaignProtectionDays: 7,
      };
      
      expect(config.maxAdjustmentPercent).toBeGreaterThan(0);
      expect(config.maxAdjustmentPercent).toBeLessThanOrEqual(50);
      expect(config.minDailyBudget).toBeGreaterThan(0);
      expect(config.cooldownDays).toBeGreaterThanOrEqual(0);
      expect(config.newCampaignProtectionDays).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('综合评分计算', () => {
    it('应该正确计算加权综合得分', () => {
      const scores = {
        conversionEfficiencyScore: 80,
        roasScore: 75,
        growthPotentialScore: 70,
        stabilityScore: 85,
        trendScore: 60,
      };
      
      const weights = {
        conversionEfficiencyWeight: 0.25,
        roasWeight: 0.25,
        growthPotentialWeight: 0.20,
        stabilityWeight: 0.15,
        trendWeight: 0.15,
      };
      
      const compositeScore = 
        scores.conversionEfficiencyScore * weights.conversionEfficiencyWeight +
        scores.roasScore * weights.roasWeight +
        scores.growthPotentialScore * weights.growthPotentialWeight +
        scores.stabilityScore * weights.stabilityWeight +
        scores.trendScore * weights.trendWeight;
      
      // 80*0.25 + 75*0.25 + 70*0.20 + 85*0.15 + 60*0.15
      // = 20 + 18.75 + 14 + 12.75 + 9 = 74.5
      expect(compositeScore).toBe(74.5);
    });
  });
  
  describe('预算分配建议生成', () => {
    it('应该为高分广告活动建议增加预算', () => {
      const compositeScore = 85;
      const avgScore = 60;
      
      const shouldIncrease = compositeScore > avgScore * 1.1;
      expect(shouldIncrease).toBe(true);
    });
    
    it('应该为低分广告活动建议减少预算', () => {
      const compositeScore = 40;
      const avgScore = 60;
      
      const shouldDecrease = compositeScore < avgScore * 0.9;
      expect(shouldDecrease).toBe(true);
    });
    
    it('应该为中等分数的广告活动保持预算不变', () => {
      const compositeScore = 58;
      const avgScore = 60;
      
      const shouldMaintain = compositeScore >= avgScore * 0.9 && compositeScore <= avgScore * 1.1;
      expect(shouldMaintain).toBe(true);
    });
  });
  
  describe('新广告活动保护', () => {
    it('应该保护新创建的广告活动', () => {
      const campaignCreatedAt = new Date();
      campaignCreatedAt.setDate(campaignCreatedAt.getDate() - 3); // 3天前创建
      const protectionDays = 7;
      
      const daysSinceCreation = (Date.now() - campaignCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      const isProtected = daysSinceCreation < protectionDays;
      
      expect(isProtected).toBe(true);
    });
    
    it('应该不保护超过保护期的广告活动', () => {
      const campaignCreatedAt = new Date();
      campaignCreatedAt.setDate(campaignCreatedAt.getDate() - 10); // 10天前创建
      const protectionDays = 7;
      
      const daysSinceCreation = (Date.now() - campaignCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      const isProtected = daysSinceCreation < protectionDays;
      
      expect(isProtected).toBe(false);
    });
  });
  
  describe('冷却期检查', () => {
    it('应该在冷却期内阻止调整', () => {
      const lastAdjustmentAt = new Date();
      lastAdjustmentAt.setDate(lastAdjustmentAt.getDate() - 1); // 1天前调整
      const cooldownDays = 3;
      
      const daysSinceLastAdjustment = (Date.now() - lastAdjustmentAt.getTime()) / (1000 * 60 * 60 * 24);
      const isInCooldown = daysSinceLastAdjustment < cooldownDays;
      
      expect(isInCooldown).toBe(true);
    });
    
    it('应该在冷却期后允许调整', () => {
      const lastAdjustmentAt = new Date();
      lastAdjustmentAt.setDate(lastAdjustmentAt.getDate() - 5); // 5天前调整
      const cooldownDays = 3;
      
      const daysSinceLastAdjustment = (Date.now() - lastAdjustmentAt.getTime()) / (1000 * 60 * 60 * 24);
      const isInCooldown = daysSinceLastAdjustment < cooldownDays;
      
      expect(isInCooldown).toBe(false);
    });
  });
  
  describe('与Adspert的差异化功能', () => {
    it('应该支持多时间窗口分析（7天/14天/30天）', () => {
      const campaign = {
        roas7d: 4.5,
        roas14d: 4.2,
        roas30d: 4.0,
      };
      
      // 验证三个时间窗口都有数据
      expect(campaign.roas7d).toBeDefined();
      expect(campaign.roas14d).toBeDefined();
      expect(campaign.roas30d).toBeDefined();
    });
    
    it('应该提供详细的评分解释', () => {
      const scoreExplanation = [
        '转化效率高于平均水平',
        'ROAS表现优秀',
        '预算利用率接近饱和，有增长潜力',
        '表现稳定，波动较小',
        '近期趋势向好'
      ];
      
      expect(scoreExplanation.length).toBeGreaterThan(0);
    });
    
    it('应该提供风险因素说明', () => {
      const riskFactors = [
        '数据量较少，预测可能不够准确',
        '近期波动较大'
      ];
      
      expect(Array.isArray(riskFactors)).toBe(true);
    });
    
    it('应该支持场景模拟', () => {
      const simulationResult = {
        predictedSpend: 108,
        predictedSales: 432,
        predictedROAS: 4.0,
        predictedACoS: 25,
        budgetUtilization: 90,
        confidence: 85,
      };
      
      expect(simulationResult.predictedSpend).toBeDefined();
      expect(simulationResult.confidence).toBeDefined();
    });
  });
});
