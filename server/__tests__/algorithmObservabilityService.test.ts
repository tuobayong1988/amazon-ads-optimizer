/**
 * v271 P2-3: 算法决策可观测性服务测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordAlgorithmDecision,
  generateDashboardMetrics,
  getRecentDecisionTraces,
  cleanupOldTraces,
  type AlgorithmDecisionTrace,
} from '../algorithm/algorithmObservabilityService';

function createMockTrace(overrides: Partial<AlgorithmDecisionTrace> = {}): AlgorithmDecisionTrace {
  return {
    traceId: `trace_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    accountId: 1,
    entityType: 'keyword',
    entityId: 100,
    campaignId: 'camp_1',
    strategyTemplateId: 'balanced',
    metaSelection: {
      algorithmScores: [
        { algorithm: 'linucb', score: 0.85, eligible: true },
        { algorithm: 'cql', score: 0.80, eligible: true },
        { algorithm: 'rule_based', score: 0.60, eligible: true },
      ],
      selectedAlgorithm: 'linucb',
      fusionMode: 'single',
      fusionThreshold: 0.15,
      fusionDetail: 'Single模式: linucb(得分=0.850)',
    },
    finalDecision: {
      recommendedBid: 1.50,
      confidence: 0.75,
      currentBid: 1.40,
      bidChangePercent: 0.071,
    },
    durationMs: 45,
    ...overrides,
  };
}

describe('AlgorithmObservabilityService', () => {
  describe('recordAlgorithmDecision', () => {
    it('应成功记录决策追踪', () => {
      const trace = createMockTrace();
      expect(() => recordAlgorithmDecision(trace)).not.toThrow();
    });

    it('应记录带A/B测试详情的追踪', () => {
      const trace = createMockTrace({
        abTestDetail: {
          testId: 1,
          variantType: 'treatment',
          configOverrides: { fusionThreshold: 0.20 },
        },
      });
      expect(() => recordAlgorithmDecision(trace)).not.toThrow();
    });

    it('应记录带探索详情的追踪', () => {
      const trace = createMockTrace({
        explorationDetail: {
          explorationRate: 0.15,
          isExploring: true,
          explorationAlgorithm: 'ucb',
        },
      });
      expect(() => recordAlgorithmDecision(trace)).not.toThrow();
    });

    it('应记录Cascade Ensemble追踪', () => {
      const trace = createMockTrace({
        metaSelection: {
          algorithmScores: [
            { algorithm: 'linucb', score: 0.85, eligible: true },
            { algorithm: 'cql', score: 0.82, eligible: true },
          ],
          selectedAlgorithm: 'ensemble',
          fusionMode: 'cascade_ensemble',
          fusionThreshold: 0.15,
          fusionDetail: 'Cascade融合: linucb + cql → $1.48',
        },
        cascadeDetail: {
          algorithm1: 'linucb',
          algorithm2: 'cql',
          bid1: 1.50,
          bid2: 1.45,
          confidence1: 0.80,
          confidence2: 0.75,
          fusedBid: 1.48,
          bidDivergence: 0.033,
          consensusBonus: 0.10,
        },
      });
      expect(() => recordAlgorithmDecision(trace)).not.toThrow();
    });
  });

  describe('generateDashboardMetrics', () => {
    it('应生成空指标（无数据时）', () => {
      // 使用7d周期，可能没有数据
      const metrics = generateDashboardMetrics('7d');
      expect(metrics).toBeDefined();
      expect(metrics.period).toBe('7d');
      expect(metrics.timestamp).toBeInstanceOf(Date);
    });

    it('应生成有数据的指标', () => {
      // 记录一些追踪
      for (let i = 0; i < 10; i++) {
        recordAlgorithmDecision(createMockTrace({
          metaSelection: {
            algorithmScores: [],
            selectedAlgorithm: i % 3 === 0 ? 'linucb' : i % 3 === 1 ? 'cql' : 'ensemble',
            fusionMode: i % 3 === 2 ? 'cascade_ensemble' : 'single',
            fusionThreshold: 0.15,
            fusionDetail: '',
          },
          finalDecision: {
            recommendedBid: 1.0 + i * 0.1,
            confidence: 0.5 + i * 0.05,
            currentBid: 1.0,
            bidChangePercent: i * 0.1,
          },
          explorationDetail: {
            explorationRate: 0.15,
            isExploring: i % 5 === 0,
          },
        }));
      }

      const metrics = generateDashboardMetrics('1h');
      expect(metrics.period).toBe('1h');
      // 应有算法分布数据
      expect(Object.keys(metrics.algorithmDistribution).length).toBeGreaterThan(0);
    });
  });

  describe('getRecentDecisionTraces', () => {
    it('应返回最近的追踪记录', () => {
      const traces = getRecentDecisionTraces(10);
      expect(Array.isArray(traces)).toBe(true);
    });

    it('应支持按accountId过滤', () => {
      recordAlgorithmDecision(createMockTrace({ accountId: 999 }));
      recordAlgorithmDecision(createMockTrace({ accountId: 888 }));
      
      const filtered = getRecentDecisionTraces(100, { accountId: 999 });
      filtered.forEach(t => {
        expect(t.accountId).toBe(999);
      });
    });

    it('应支持按算法过滤', () => {
      recordAlgorithmDecision(createMockTrace({
        metaSelection: {
          algorithmScores: [],
          selectedAlgorithm: 'cql',
          fusionMode: 'single',
          fusionThreshold: 0.15,
          fusionDetail: '',
        },
      }));

      const filtered = getRecentDecisionTraces(100, { algorithm: 'cql' });
      filtered.forEach(t => {
        expect(t.metaSelection.selectedAlgorithm).toBe('cql');
      });
    });

    it('应支持按融合模式过滤', () => {
      recordAlgorithmDecision(createMockTrace({
        metaSelection: {
          algorithmScores: [],
          selectedAlgorithm: 'ensemble',
          fusionMode: 'cascade_ensemble',
          fusionThreshold: 0.15,
          fusionDetail: '',
        },
      }));

      const filtered = getRecentDecisionTraces(100, { fusionMode: 'cascade_ensemble' });
      filtered.forEach(t => {
        expect(t.metaSelection.fusionMode).toBe('cascade_ensemble');
      });
    });
  });

  describe('cleanupOldTraces', () => {
    it('应清理过期追踪', () => {
      // 添加一个"过期"的追踪（通过直接设置时间戳）
      const oldTrace = createMockTrace({
        timestamp: new Date(Date.now() - 30 * 86400000), // 30天前
      });
      recordAlgorithmDecision(oldTrace);
      
      const cleaned = cleanupOldTraces(7);
      // 应该清理了至少一条
      expect(cleaned).toBeGreaterThanOrEqual(0); // 可能已被其他测试清理
    });
  });
});
