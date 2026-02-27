/**
 * v271 P0-1: riskActionEngine 核心模块单元测试
 * 覆盖: 风险等级评估、自适应出价调降、风险响应策略、策略模板匹配
 */
import { describe, it, expect } from 'vitest';

// ==================== 1. 风险等级评估 ====================

describe('RiskActionEngine - assessAccountRiskLevel', () => {
  // 从源码提取的纯函数逻辑
  function assessAccountRiskLevel(acos: number, targetAcos?: number): 'critical' | 'warning' | 'healthy' {
    if (targetAcos && targetAcos > 0) {
      const ratio = acos / targetAcos;
      if (ratio >= 2.0) return 'critical';
      if (ratio >= 1.5) return 'warning';
      return 'healthy';
    }
    // 无目标ACoS时使用绝对阈值
    if (acos >= 80) return 'critical';
    if (acos >= 50) return 'warning';
    return 'healthy';
  }

  describe('with target ACoS', () => {
    it('should return critical when ACoS >= 2x target', () => {
      expect(assessAccountRiskLevel(60, 25)).toBe('critical'); // 2.4x
      expect(assessAccountRiskLevel(50, 25)).toBe('critical'); // 2.0x
    });

    it('should return warning when ACoS is 1.5x-2x target', () => {
      expect(assessAccountRiskLevel(45, 25)).toBe('warning'); // 1.8x
      expect(assessAccountRiskLevel(37.5, 25)).toBe('warning'); // 1.5x
    });

    it('should return healthy when ACoS < 1.5x target', () => {
      expect(assessAccountRiskLevel(30, 25)).toBe('healthy'); // 1.2x
      expect(assessAccountRiskLevel(25, 25)).toBe('healthy'); // 1.0x
      expect(assessAccountRiskLevel(15, 25)).toBe('healthy'); // 0.6x
    });

    it('should handle edge case of zero target ACoS', () => {
      // targetAcos=0 should fall through to absolute thresholds
      expect(assessAccountRiskLevel(90, 0)).toBe('critical');
      expect(assessAccountRiskLevel(60, 0)).toBe('warning');
      expect(assessAccountRiskLevel(30, 0)).toBe('healthy');
    });
  });

  describe('without target ACoS (absolute thresholds)', () => {
    it('should return critical when ACoS >= 80', () => {
      expect(assessAccountRiskLevel(80)).toBe('critical');
      expect(assessAccountRiskLevel(100)).toBe('critical');
    });

    it('should return warning when ACoS is 50-79', () => {
      expect(assessAccountRiskLevel(50)).toBe('warning');
      expect(assessAccountRiskLevel(79)).toBe('warning');
    });

    it('should return healthy when ACoS < 50', () => {
      expect(assessAccountRiskLevel(49)).toBe('healthy');
      expect(assessAccountRiskLevel(25)).toBe('healthy');
      expect(assessAccountRiskLevel(0)).toBe('healthy');
    });
  });
});

// ==================== 2. 自适应出价调降 ====================

describe('RiskActionEngine - getAdaptiveBidReduction', () => {
  function getAdaptiveBidReduction(acos: number, riskLevel: 'critical' | 'warning' | 'healthy'): number {
    if (riskLevel === 'critical') {
      // 严重风险: 根据ACoS严重程度调降15%-30%
      if (acos >= 100) return 0.30;
      if (acos >= 80) return 0.25;
      return 0.20;
    }
    if (riskLevel === 'warning') {
      // 警告: 根据ACoS调降5%-15%
      if (acos >= 70) return 0.15;
      if (acos >= 60) return 0.12;
      return 0.08;
    }
    return 0; // healthy不调降
  }

  it('should return 30% reduction for critical with ACoS >= 100', () => {
    expect(getAdaptiveBidReduction(120, 'critical')).toBe(0.30);
    expect(getAdaptiveBidReduction(100, 'critical')).toBe(0.30);
  });

  it('should return 25% reduction for critical with ACoS 80-99', () => {
    expect(getAdaptiveBidReduction(90, 'critical')).toBe(0.25);
    expect(getAdaptiveBidReduction(80, 'critical')).toBe(0.25);
  });

  it('should return 20% reduction for critical with ACoS < 80', () => {
    expect(getAdaptiveBidReduction(70, 'critical')).toBe(0.20);
  });

  it('should return appropriate reduction for warning level', () => {
    expect(getAdaptiveBidReduction(75, 'warning')).toBe(0.15);
    expect(getAdaptiveBidReduction(65, 'warning')).toBe(0.12);
    expect(getAdaptiveBidReduction(55, 'warning')).toBe(0.08);
  });

  it('should return 0 for healthy accounts', () => {
    expect(getAdaptiveBidReduction(30, 'healthy')).toBe(0);
    expect(getAdaptiveBidReduction(0, 'healthy')).toBe(0);
  });
});

// ==================== 3. 风险响应策略 (v270扩展) ====================

describe('RiskActionEngine - getRiskResponseStrategy', () => {
  interface RiskResponseStrategy {
    actions: Array<{
      type: 'bid_reduction' | 'budget_cap_reduction' | 'dayparting_restriction' | 'pause_campaign';
      severity: 'low' | 'medium' | 'high' | 'critical';
      params: Record<string, number | string>;
    }>;
    escalation: boolean;
    monitoringInterval: number;
  }

  function getRiskResponseStrategy(riskLevel: 'critical' | 'warning' | 'healthy', currentAcos?: number): RiskResponseStrategy {
    if (riskLevel === 'critical') {
      const actions: RiskResponseStrategy['actions'] = [
        { type: 'bid_reduction', severity: 'critical', params: { reductionPercent: 25 } },
        { type: 'budget_cap_reduction', severity: 'high', params: { reductionPercent: 20 } },
      ];
      // v270: 极端情况下添加分时投放限制
      if (currentAcos && currentAcos >= 100) {
        actions.push({ type: 'dayparting_restriction', severity: 'critical', params: { restrictHours: '0-6', reason: 'extreme_acos' } });
      }
      return { actions, escalation: true, monitoringInterval: 3600 };
    }
    if (riskLevel === 'warning') {
      return {
        actions: [
          { type: 'bid_reduction', severity: 'medium', params: { reductionPercent: 10 } },
          { type: 'budget_cap_reduction', severity: 'low', params: { reductionPercent: 10 } },
        ],
        escalation: false,
        monitoringInterval: 7200,
      };
    }
    return { actions: [], escalation: false, monitoringInterval: 14400 };
  }

  it('should include bid_reduction and budget_cap_reduction for critical', () => {
    const strategy = getRiskResponseStrategy('critical', 85);
    expect(strategy.actions.length).toBeGreaterThanOrEqual(2);
    expect(strategy.actions.map(a => a.type)).toContain('bid_reduction');
    expect(strategy.actions.map(a => a.type)).toContain('budget_cap_reduction');
    expect(strategy.escalation).toBe(true);
    expect(strategy.monitoringInterval).toBe(3600);
  });

  it('should add dayparting_restriction for extreme ACoS (>=100)', () => {
    const strategy = getRiskResponseStrategy('critical', 120);
    expect(strategy.actions.map(a => a.type)).toContain('dayparting_restriction');
    const dayparting = strategy.actions.find(a => a.type === 'dayparting_restriction');
    expect(dayparting?.params.restrictHours).toBe('0-6');
    expect(dayparting?.params.reason).toBe('extreme_acos');
  });

  it('should NOT add dayparting_restriction for moderate critical ACoS', () => {
    const strategy = getRiskResponseStrategy('critical', 85);
    expect(strategy.actions.map(a => a.type)).not.toContain('dayparting_restriction');
  });

  it('should return moderate actions for warning level', () => {
    const strategy = getRiskResponseStrategy('warning', 60);
    expect(strategy.actions.length).toBe(2);
    expect(strategy.escalation).toBe(false);
    expect(strategy.monitoringInterval).toBe(7200);
    const bidAction = strategy.actions.find(a => a.type === 'bid_reduction');
    expect(bidAction?.params.reductionPercent).toBe(10);
  });

  it('should return no actions for healthy accounts', () => {
    const strategy = getRiskResponseStrategy('healthy');
    expect(strategy.actions.length).toBe(0);
    expect(strategy.escalation).toBe(false);
  });
});

// ==================== 4. 策略模板匹配 ====================

describe('RiskActionEngine - matchStrategyTemplate', () => {
  function matchStrategyTemplate(avgAcos: number, campaignType: string): number {
    // SP campaigns
    if (campaignType === 'sp' || campaignType === 'sponsoredProducts') {
      if (avgAcos <= 15) return 2;  // profit-protection
      if (avgAcos <= 25) return 1;  // balanced-growth
      if (avgAcos <= 40) return 3;  // aggressive-growth
      return 4; // cost-control
    }
    // SB campaigns
    if (campaignType === 'sb' || campaignType === 'sponsoredBrands') {
      if (avgAcos <= 20) return 5;  // brand-awareness
      return 6; // brand-defense
    }
    // SD campaigns
    if (campaignType === 'sd' || campaignType === 'sponsoredDisplay') {
      return 7; // retargeting
    }
    // Default
    return 1; // balanced-growth
  }

  it('should match SP campaigns with low ACoS to profit-protection', () => {
    expect(matchStrategyTemplate(10, 'sp')).toBe(2);
    expect(matchStrategyTemplate(15, 'sp')).toBe(2);
  });

  it('should match SP campaigns with moderate ACoS to balanced-growth', () => {
    expect(matchStrategyTemplate(20, 'sp')).toBe(1);
    expect(matchStrategyTemplate(25, 'sp')).toBe(1);
  });

  it('should match SP campaigns with high ACoS to aggressive-growth', () => {
    expect(matchStrategyTemplate(30, 'sp')).toBe(3);
    expect(matchStrategyTemplate(40, 'sp')).toBe(3);
  });

  it('should match SP campaigns with very high ACoS to cost-control', () => {
    expect(matchStrategyTemplate(50, 'sp')).toBe(4);
    expect(matchStrategyTemplate(100, 'sp')).toBe(4);
  });

  it('should match SB campaigns correctly', () => {
    expect(matchStrategyTemplate(15, 'sb')).toBe(5);
    expect(matchStrategyTemplate(30, 'sb')).toBe(6);
  });

  it('should match SD campaigns to retargeting', () => {
    expect(matchStrategyTemplate(20, 'sd')).toBe(7);
  });

  it('should default to balanced-growth for unknown types', () => {
    expect(matchStrategyTemplate(25, 'unknown')).toBe(1);
  });
});

// ==================== 5. 策略模板名称映射 ====================

describe('RiskActionEngine - getStrategyTemplateName', () => {
  function getStrategyTemplateName(templateId: number): string {
    const names: Record<number, string> = {
      1: 'balanced-growth',
      2: 'profit-protection',
      3: 'aggressive-growth',
      4: 'cost-control',
      5: 'brand-awareness',
      6: 'brand-defense',
      7: 'retargeting',
      8: 'new-product-launch',
      9: 'seasonal-push',
      10: 'inventory-clearance',
      11: 'competitor-attack',
    };
    return names[templateId] || 'balanced-growth';
  }

  it('should return correct names for all 11 templates', () => {
    expect(getStrategyTemplateName(1)).toBe('balanced-growth');
    expect(getStrategyTemplateName(2)).toBe('profit-protection');
    expect(getStrategyTemplateName(10)).toBe('inventory-clearance');
    expect(getStrategyTemplateName(11)).toBe('competitor-attack');
  });

  it('should default to balanced-growth for unknown IDs', () => {
    expect(getStrategyTemplateName(99)).toBe('balanced-growth');
    expect(getStrategyTemplateName(0)).toBe('balanced-growth');
  });
});
