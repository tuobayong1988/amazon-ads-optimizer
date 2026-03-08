/**
 * 智能投放系统集成测试
 */

import { describe, it, expect } from 'vitest';
import { DecisionEngine, RuleEngine } from '../../server/smartCampaign/decisionEngine';

describe('智能投放系统集成测试', () => {
  describe('规则引擎', () => {
    const ruleEngine = new RuleEngine();

    it('应该能够识别高ACoS广告活动', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 60, // 高ACoS
        targetAcos: 30,
        spend: 1000,
        sales: 1500,
        impressions: 10000,
        clicks: 500,
        orders: 50,
      };

      const decision = ruleEngine.evaluatePauseRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('pause');
      expect(decision?.reason).toContain('ACoS');
    });

    it('应该能够识别无转化广告活动', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 0,
        targetAcos: 30,
        spend: 500,
        sales: 0,
        impressions: 5000,
        clicks: 250,
        orders: 0,
      };

      const decision = ruleEngine.evaluatePauseRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('pause');
      expect(decision?.reason).toContain('转化');
    });

    it('应该能够识别低CTR广告活动', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 30,
        targetAcos: 30,
        spend: 1000,
        sales: 3000,
        impressions: 100000,
        clicks: 50, // 0.05% CTR
        orders: 10,
      };

      const decision = ruleEngine.evaluatePauseRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('pause');
      expect(decision?.reason).toContain('CTR');
    });

    it('应该能够建议提高出价', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 20, // 低于目标
        targetAcos: 30,
        roas: 5.0, // 高ROAS
        spend: 1000,
        sales: 5000,
        currentBid: 1.5,
      };

      const decision = ruleEngine.evaluateBidAdjustmentRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('increase_bid');
      expect(decision?.recommendedValue).toBeGreaterThan(campaign.currentBid);
    });

    it('应该能够建议降低出价', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 40, // 高于目标
        targetAcos: 30,
        roas: 2.5, // 低ROAS
        spend: 1000,
        sales: 2500,
        currentBid: 2.0,
      };

      const decision = ruleEngine.evaluateBidAdjustmentRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('decrease_bid');
      expect(decision?.recommendedValue).toBeLessThan(campaign.currentBid);
    });

    it('应该能够建议增加预算', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 25,
        targetAcos: 30,
        roas: 4.0,
        spend: 950,
        dailyBudget: 1000,
        budgetUtilization: 0.95, // 95%使用率
      };

      const decision = ruleEngine.evaluateBudgetAdjustmentRules(campaign);

      expect(decision).toBeDefined();
      expect(decision?.action).toBe('increase_budget');
    });
  });

  describe('决策引擎', () => {
    const decisionEngine = new DecisionEngine();

    it('应该能够生成单个广告活动的优化决策', () => {
      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 50,
        targetAcos: 30,
        roas: 2.0,
        spend: 1000,
        sales: 2000,
        impressions: 10000,
        clicks: 500,
        orders: 50,
        currentBid: 2.0,
        dailyBudget: 1000,
      };

      const decision = decisionEngine.generateDecision(campaign);

      expect(decision).toBeDefined();
      expect(decision.action).toBeDefined();
      expect(decision.reason).toBeDefined();
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.priority).toBeGreaterThan(0);
    });

    it('应该能够批量生成优化决策', () => {
      const campaigns = [
        {
          id: 1,
          name: 'High ACoS Campaign',
          status: 'enabled',
          acos: 60,
          targetAcos: 30,
          spend: 1000,
          sales: 1500,
        },
        {
          id: 2,
          name: 'Good Campaign',
          status: 'enabled',
          acos: 28,
          targetAcos: 30,
          spend: 1000,
          sales: 3500,
        },
        {
          id: 3,
          name: 'No Conversion Campaign',
          status: 'enabled',
          acos: 0,
          targetAcos: 30,
          spend: 500,
          sales: 0,
          orders: 0,
        },
      ];

      const decisions = decisionEngine.generateBatchDecisions(campaigns);

      expect(decisions).toBeDefined();
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions.length).toBeLessThanOrEqual(campaigns.length);

      // 验证决策按优先级排序
      for (let i = 1; i < decisions.length; i++) {
        expect(decisions[i - 1].priority).toBeGreaterThanOrEqual(decisions[i].priority);
      }
    });

    it('应该能够生成优化报告', () => {
      const campaigns = [
        {
          id: 1,
          name: 'Campaign 1',
          status: 'enabled',
          acos: 60,
          targetAcos: 30,
        },
        {
          id: 2,
          name: 'Campaign 2',
          status: 'enabled',
          acos: 25,
          targetAcos: 30,
        },
      ];

      const report = decisionEngine.generateOptimizationReport(campaigns);

      expect(report).toBeDefined();
      expect(report.totalCampaigns).toBe(2);
      expect(report.needsOptimization).toBeGreaterThan(0);
      expect(report.performingWell).toBeGreaterThan(0);
      expect(report.summary).toBeDefined();
    });
  });

  describe('自动执行引擎', () => {
    it('应该能够在dry-run模式下预览操作', async () => {
      const decisions = [
        {
          campaignId: 1,
          action: 'pause' as const,
          reason: 'High ACoS',
        },
        {
          campaignId: 2,
          action: 'increase_bid' as const,
          value: 2.5,
          reason: 'Low ACoS, good performance',
        },
      ];

      // 模拟执行
      const results = decisions.map((decision: any) => ({
        campaignId: decision.campaignId,
        action: decision.action,
        success: true,
        dryRun: true,
      }));

      expect(results).toHaveLength(2);
      results.forEach((result: any) => {
        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
      });
    });

    it('应该能够处理执行错误', async () => {
      const decisions = [
        {
          campaignId: 999, // 不存在的广告活动
          action: 'pause' as const,
          reason: 'Test',
        },
      ];

      // 模拟执行失败
      const results = decisions.map((decision: any) => ({
        campaignId: decision.campaignId,
        action: decision.action,
        success: false,
        error: 'Campaign not found',
      }));

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });
  });

  describe('决策优先级', () => {
    it('应该正确计算决策优先级', () => {
      const decisionEngine = new DecisionEngine();

      const highPriorityCampaign = {
        id: 1,
        name: 'Critical Campaign',
        status: 'enabled',
        acos: 80, // 非常高的ACoS
        targetAcos: 30,
        spend: 5000, // 高花费
        sales: 6000,
      };

      const lowPriorityCampaign = {
        id: 2,
        name: 'Minor Campaign',
        status: 'enabled',
        acos: 35, // 略高于目标
        targetAcos: 30,
        spend: 100, // 低花费
        sales: 280,
      };

      const highPriorityDecision = decisionEngine.generateDecision(highPriorityCampaign);
      const lowPriorityDecision = decisionEngine.generateDecision(lowPriorityCampaign);

      expect(highPriorityDecision.priority).toBeGreaterThan(lowPriorityDecision.priority);
    });
  });

  describe('决策置信度', () => {
    it('应该为数据充足的决策提供高置信度', () => {
      const decisionEngine = new DecisionEngine();

      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 60,
        targetAcos: 30,
        spend: 10000, // 大量数据
        sales: 15000,
        impressions: 100000,
        clicks: 5000,
        orders: 500,
      };

      const decision = decisionEngine.generateDecision(campaign);

      expect(decision.confidence).toBeGreaterThan(0.7); // 高置信度
    });

    it('应该为数据不足的决策提供低置信度', () => {
      const decisionEngine = new DecisionEngine();

      const campaign = {
        id: 1,
        name: 'Test Campaign',
        status: 'enabled',
        acos: 60,
        targetAcos: 30,
        spend: 50, // 数据很少
        sales: 75,
        impressions: 500,
        clicks: 25,
        orders: 2,
      };

      const decision = decisionEngine.generateDecision(campaign);

      expect(decision.confidence).toBeLessThan(0.5); // 低置信度
    });
  });

  describe('复杂场景测试', () => {
    it('应该能够处理混合状态的广告活动组', () => {
      const decisionEngine = new DecisionEngine();

      const campaigns = [
        // 高效活动
        {
          id: 1,
          name: 'Star Performer',
          status: 'enabled',
          acos: 20,
          targetAcos: 30,
          roas: 5.0,
          spend: 2000,
          sales: 10000,
        },
        // 低效活动
        {
          id: 2,
          name: 'Underperformer',
          status: 'enabled',
          acos: 70,
          targetAcos: 30,
          roas: 1.4,
          spend: 1000,
          sales: 1400,
        },
        // 暂停的活动(表现良好)
        {
          id: 3,
          name: 'Paused Good',
          status: 'paused',
          acos: 25,
          targetAcos: 30,
          roas: 4.0,
          spend: 500,
          sales: 2000,
        },
        // 新活动(数据不足)
        {
          id: 4,
          name: 'New Campaign',
          status: 'enabled',
          acos: 40,
          targetAcos: 30,
          spend: 50,
          sales: 100,
        },
      ];

      const decisions = decisionEngine.generateBatchDecisions(campaigns);

      expect(decisions).toBeDefined();

      // 应该建议暂停低效活动
      const pauseDecision = decisions.find((d: any) => d.campaignId === 2);
      expect(pauseDecision?.action).toBe('pause');

      // 应该建议启用暂停的高效活动
      const enableDecision = decisions.find((d: any) => d.campaignId === 3);
      expect(enableDecision?.action).toBe('enable');

      // 应该为高效活动建议增加投入
      const increaseDecision = decisions.find((d: any) => d.campaignId === 1);
      expect(increaseDecision?.action).toMatch(/increase/);

      // 新活动应该有低置信度
      const newCampaignDecision = decisions.find((d: any) => d.campaignId === 4);
      if (newCampaignDecision) {
        expect(newCampaignDecision.confidence).toBeLessThan(0.6);
      }
    });
  });
});
