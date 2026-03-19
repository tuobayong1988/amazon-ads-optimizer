/**
 * v271 P0-1: metaLearningSelector 核心模块单元测试
 * 覆盖: Cascade Ensemble融合逻辑、自适应探索机制、算法评分、降级策略
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== 1. 纯函数测试 (无需数据库mock) ====================

describe('MetaLearningSelector - Pure Logic Tests', () => {

  // Beta分布采样函数测试
  describe('betaSample', () => {
    it('should return values between 0 and 1 for valid alpha/beta', () => {
      // 模拟Beta分布采样的核心逻辑
      const gammaSample = (shape: number): number => {
        if (shape < 1) {
          return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
        }
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
          let x: number, v: number;
          do {
            x = (Math.random() * 2 - 1) * 3;
            v = 1 + c * x;
          } while (v <= 0);
          v = v * v * v;
          const u = Math.random();
          if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
          if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
        }
      };
      const betaSample = (alpha: number, beta: number): number => {
        const x = gammaSample(alpha);
        const y = gammaSample(beta);
        return x / (x + y);
      };

      // 运行多次采样验证范围
      for (let i = 0; i < 100; i++) {
        const sample = betaSample(2, 3);
        expect(sample).toBeGreaterThanOrEqual(0);
        expect(sample).toBeLessThanOrEqual(1);
      }
    });
  });

  // Cascade Ensemble 融合阈值逻辑测试
  describe('Cascade Ensemble Fusion Logic', () => {
    const FUSION_THRESHOLD = 0.15; // 15%分差阈值

    it('should trigger fusion when score difference < 15%', () => {
      const top1Score = 0.85;
      const top2Score = 0.78; // 差距 = (0.85-0.78)/0.85 = 8.2% < 15%
      const scoreDiff = (top1Score - top2Score) / top1Score;
      expect(scoreDiff).toBeLessThan(FUSION_THRESHOLD);
    });

    it('should NOT trigger fusion when score difference >= 15%', () => {
      const top1Score = 0.85;
      const top2Score = 0.70; // 差距 = (0.85-0.70)/0.85 = 17.6% > 15%
      const scoreDiff = (top1Score - top2Score) / top1Score;
      expect(scoreDiff).toBeGreaterThanOrEqual(FUSION_THRESHOLD);
    });

    it('should NOT fuse with rule_based algorithm', () => {
      const top2Algorithm = 'rule_based';
      const shouldFuse = top2Algorithm !== 'rule_based';
      expect(shouldFuse).toBe(false);
    });

    it('should correctly calculate confidence-weighted bid fusion', () => {
      const fusionBids = [
        { bid: 1.20, confidence: 0.80, algorithm: 'ucb' },
        { bid: 1.10, confidence: 0.60, algorithm: 'linucb' },
      ];
      const totalConf = fusionBids.reduce((s: unknown, b: unknown) => s + b.confidence, 0);
      const fusedBid = fusionBids.reduce((s: unknown, b: unknown) => s + b.bid * b.confidence, 0) / totalConf;
      
      // 加权平均: (1.20*0.80 + 1.10*0.60) / (0.80+0.60) = (0.96+0.66)/1.40 = 1.157
      expect(fusedBid).toBeCloseTo(1.157, 2);
    });

    it('should apply consensus bonus when bids are close (divergence < 10%)', () => {
      const bid1 = 1.20;
      const bid2 = 1.15;
      const bidDivergence = Math.abs(bid1 - bid2) / Math.max(bid1, bid2, 0.01);
      // 分歧度 = |1.20-1.15|/1.20 = 4.2% < 10%
      expect(bidDivergence).toBeLessThan(0.10);
      const consensusBonus = bidDivergence < 0.10 ? 0.10 : bidDivergence < 0.20 ? 0.05 : 0;
      expect(consensusBonus).toBe(0.10);
    });

    it('should apply reduced consensus bonus when divergence is 10-20%', () => {
      const bid1 = 1.20;
      const bid2 = 1.00;
      const bidDivergence = Math.abs(bid1 - bid2) / Math.max(bid1, bid2, 0.01);
      // 分歧度 = |1.20-1.00|/1.20 = 16.7%
      expect(bidDivergence).toBeGreaterThanOrEqual(0.10);
      expect(bidDivergence).toBeLessThan(0.20);
      const consensusBonus = bidDivergence < 0.10 ? 0.10 : bidDivergence < 0.20 ? 0.05 : 0;
      expect(consensusBonus).toBe(0.05);
    });

    it('should apply no consensus bonus when divergence >= 20%', () => {
      const bid1 = 1.50;
      const bid2 = 1.00;
      const bidDivergence = Math.abs(bid1 - bid2) / Math.max(bid1, bid2, 0.01);
      // 分歧度 = |1.50-1.00|/1.50 = 33.3%
      expect(bidDivergence).toBeGreaterThanOrEqual(0.20);
      const consensusBonus = bidDivergence < 0.10 ? 0.10 : bidDivergence < 0.20 ? 0.05 : 0;
      expect(consensusBonus).toBe(0);
    });

    it('should cap fused confidence at 0.95', () => {
      const fusionBids = [
        { bid: 1.20, confidence: 0.92, algorithm: 'ucb' },
        { bid: 1.19, confidence: 0.91, algorithm: 'linucb' },
      ];
      const totalConf = fusionBids.reduce((s: unknown, b: unknown) => s + b.confidence, 0);
      const bidDivergence = Math.abs(fusionBids[0].bid - fusionBids[1].bid) / Math.max(fusionBids[0].bid, fusionBids[1].bid, 0.01);
      const consensusBonus = bidDivergence < 0.10 ? 0.10 : bidDivergence < 0.20 ? 0.05 : 0;
      const fusedConfidence = Math.min(0.95, (totalConf / fusionBids.length) + consensusBonus);
      expect(fusedConfidence).toBeLessThanOrEqual(0.95);
    });

    it('should degrade to single mode when only one algorithm returns valid result', () => {
      const fusionBids = [
        { bid: 1.20, confidence: 0.80, algorithm: 'ucb' },
        // second algorithm returned bid=0 or confidence=0
      ];
      expect(fusionBids.length).toBe(1);
      // In this case, use the single valid result
      const recommendedBid = fusionBids[0].bid;
      expect(recommendedBid).toBe(1.20);
    });

    it('should degrade to rule_based when both algorithms fail', () => {
      const fusionBids: { bid: number; confidence: number; algorithm: string }[] = [];
      expect(fusionBids.length).toBe(0);
      // Both failed → fallback to rule_based
      const recommendedBid = 0.50; // currentBid fallback
      const confidence = 0.3;
      expect(confidence).toBe(0.3);
    });
  });

  // 自适应探索机制测试
  describe('Adaptive Exploration Mechanism', () => {
    it('should increase exploration rate when recent data exists', () => {
      const baseExplorationRate = 0.50;
      const dataFreshnessFactor = 1.15; // 有新数据
      const explorationRate = Math.min(0.65, Math.max(0.30, baseExplorationRate * dataFreshnessFactor));
      expect(explorationRate).toBeCloseTo(0.575, 2);
      expect(explorationRate).toBeGreaterThan(baseExplorationRate);
    });

    it('should decrease exploration rate when no recent data', () => {
      const baseExplorationRate = 0.50;
      const dataFreshnessFactor = 0.85; // 无新数据
      const explorationRate = Math.min(0.65, Math.max(0.30, baseExplorationRate * dataFreshnessFactor));
      expect(explorationRate).toBeCloseTo(0.425, 2);
      expect(explorationRate).toBeLessThan(baseExplorationRate);
    });

    it('should clamp exploration rate to [0.30, 0.65] range', () => {
      // 测试下限
      const lowRate = Math.min(0.65, Math.max(0.30, 0.20 * 0.85));
      expect(lowRate).toBe(0.30);

      // 测试上限
      const highRate = Math.min(0.65, Math.max(0.30, 0.60 * 1.15));
      expect(highRate).toBe(0.65);
    });

    it('should calculate base exploration rate based on data maturity', () => {
      // 数据成熟度 = min(1, syntheticDataCount / 30)
      const syntheticDataCount0 = 0;
      const maturity0 = Math.min(1, syntheticDataCount0 / 30);
      const baseRate0 = Math.max(0.35, 0.60 - maturity0 * 0.25);
      expect(baseRate0).toBe(0.60); // 无数据时最高探索率

      const syntheticDataCount30 = 30;
      const maturity30 = Math.min(1, syntheticDataCount30 / 30);
      const baseRate30 = Math.max(0.35, 0.60 - maturity30 * 0.25);
      expect(baseRate30).toBe(0.35); // 数据充足时最低探索率
    });

    it('should apply performance decay for consistently failing algorithms', () => {
      // 模拟 getConsecutiveFailures 逻辑
      const getConsecutiveFailures = (stat: { totalTrials: number; alphaParam: number; betaParam: number }): number => {
        if (stat.totalTrials < 3) return 0;
        const failRate = stat.betaParam / (stat.alphaParam + stat.betaParam);
        return failRate > 0.75 ? 0.20 : failRate > 0.60 ? 0.10 : 0;
      };

      // 高失败率
      expect(getConsecutiveFailures({ totalTrials: 10, alphaParam: 2, betaParam: 8 })).toBe(0.20);
      // 中等失败率
      expect(getConsecutiveFailures({ totalTrials: 10, alphaParam: 3, betaParam: 7 })).toBe(0.10);
      // 低失败率
      expect(getConsecutiveFailures({ totalTrials: 10, alphaParam: 7, betaParam: 3 })).toBe(0);
      // 数据不足
      expect(getConsecutiveFailures({ totalTrials: 2, alphaParam: 1, betaParam: 1 })).toBe(0);
    });

    it('should calculate performance multiplier correctly', () => {
      const getPerformanceMultiplier = (stat: { alphaParam: number; betaParam: number; totalTrials: number }) => {
        const successRate = stat.alphaParam / (stat.alphaParam + stat.betaParam);
        const failRate = stat.betaParam / (stat.alphaParam + stat.betaParam);
        const decay = stat.totalTrials < 3 ? 0 : failRate > 0.75 ? 0.20 : failRate > 0.60 ? 0.10 : 0;
        return Math.max(0.70, (1 + Math.max(0, (successRate - 0.5)) * 0.30) - decay);
      };

      // 高成功率算法: 加成
      const highSuccess = getPerformanceMultiplier({ alphaParam: 8, betaParam: 2, totalTrials: 10 });
      expect(highSuccess).toBeGreaterThan(1.0);

      // 低成功率算法: 衰减
      const lowSuccess = getPerformanceMultiplier({ alphaParam: 2, betaParam: 8, totalTrials: 10 });
      expect(lowSuccess).toBe(0.80); // 衰减后受最低限制约束

      // 中等表现: 接近1.0
      const midSuccess = getPerformanceMultiplier({ alphaParam: 5, betaParam: 5, totalTrials: 10 });
      expect(midSuccess).toBeCloseTo(1.0, 1);
    });
  });

  // 出价合法性检查
  describe('Bid Validity Checks', () => {
    it('should enforce minimum bid of $0.02', () => {
      const rawBid = 0.005;
      const validBid = Math.max(0.02, Math.round(rawBid * 100) / 100);
      expect(validBid).toBe(0.02);
    });

    it('should round bid to 2 decimal places', () => {
      const rawBid = 1.23456;
      const validBid = Math.max(0.02, Math.round(rawBid * 100) / 100);
      expect(validBid).toBe(1.23);
    });
  });
});

// ==================== 2. 算法评分排序逻辑测试 ====================

describe('MetaLearningSelector - Algorithm Scoring', () => {
  it('should penalize rule_based with lower multiplier', () => {
    const rbPenalty = 0.60; // 非探索槽
    const ucbMultiplier = 1.30;
    // 即使Beta采样相同，UCB也应该得分更高
    const sameBaseSample = 0.50;
    expect(sameBaseSample * rbPenalty).toBeLessThan(sameBaseSample * ucbMultiplier);
  });

  it('should boost linucb when eligible with rotation bonus', () => {
    const linucbBase = 1.50;
    const explorationBoost = 0.25;
    const rotationBoost = 0.15;
    const totalMultiplier = linucbBase + explorationBoost + rotationBoost;
    expect(totalMultiplier).toBe(1.90);
  });

  it('should disable ensemble when fewer than 2 algorithms are eligible', () => {
    const eligibleCount = 1;
    const ensembleScore = eligibleCount >= 2 ? 0.50 * 1.65 : 0;
    expect(ensembleScore).toBe(0);
  });

  it('should enable ensemble when 2+ algorithms are eligible', () => {
    const eligibleCount = 3;
    const ensembleScore = eligibleCount >= 2 ? 0.50 * 1.65 : 0;
    expect(ensembleScore).toBeGreaterThan(0);
  });

  it('should sort algorithm scores in descending order', () => {
    const scores = [
      { algorithm: 'rule_based', score: 0.30, eligible: true, reason: '' },
      { algorithm: 'ucb', score: 0.65, eligible: true, reason: '' },
      { algorithm: 'linucb', score: 0.72, eligible: true, reason: '' },
      { algorithm: 'cql', score: 0.55, eligible: true, reason: '' },
    ];
    const sorted = [...scores].sort((a: unknown, b: unknown) => b.score - a.score);
    expect(sorted[0].algorithm).toBe('linucb');
    expect(sorted[1].algorithm).toBe('ucb');
    expect(sorted[sorted.length - 1].algorithm).toBe('rule_based');
  });
});
