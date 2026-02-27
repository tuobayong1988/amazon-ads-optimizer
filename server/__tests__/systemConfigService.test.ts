/**
 * v271 P3-2: 系统配置外部化服务测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConfig,
  getConfigDetail,
  updateConfig,
  batchUpdateConfig,
  resetConfig,
  resetAllConfig,
  getAllConfig,
  getChangeLog,
  exportConfig,
  importConfig,
} from '../systemConfigService';

describe('SystemConfigService', () => {
  beforeEach(() => {
    resetAllConfig('test');
  });

  describe('getConfig', () => {
    it('应返回默认配置值', () => {
      const cooldownHours = getConfig<number>('safety.cooldown_hours');
      expect(cooldownHours).toBe(6);
    });

    it('应返回算法参数默认值', () => {
      const fusionThreshold = getConfig<number>('algorithm.fusion_threshold');
      expect(fusionThreshold).toBe(0.15);
    });

    it('应返回业务参数默认值', () => {
      const minBid = getConfig<number>('business.min_bid');
      expect(minBid).toBe(0.02);
    });

    it('未知参数应抛出错误', () => {
      expect(() => getConfig('unknown.param')).toThrow('未知配置参数');
    });
  });

  describe('getConfigDetail', () => {
    it('应返回完整的配置参数信息', () => {
      const detail = getConfigDetail('safety.cooldown_hours');
      expect(detail).toBeDefined();
      expect(detail!.key).toBe('safety.cooldown_hours');
      expect(detail!.category).toBe('safety');
      expect(detail!.description).toBeTruthy();
      expect(detail!.range).toBeDefined();
      expect(detail!.range!.min).toBeLessThan(detail!.range!.max);
    });

    it('未知参数应返回undefined', () => {
      const detail = getConfigDetail('unknown.param');
      expect(detail).toBeUndefined();
    });
  });

  describe('updateConfig', () => {
    it('应成功更新配置值', () => {
      const result = updateConfig('safety.cooldown_hours', 8, 'test', '测试更新');
      expect(result).toBe(true);
      expect(getConfig<number>('safety.cooldown_hours')).toBe(8);
    });

    it('超出范围的值应被拒绝', () => {
      const result = updateConfig('safety.cooldown_hours', 100, 'test', '超出范围');
      expect(result).toBe(false);
      expect(getConfig<number>('safety.cooldown_hours')).toBe(6); // 保持默认值
    });

    it('低于范围下限的值应被拒绝', () => {
      const result = updateConfig('safety.cooldown_hours', 0, 'test', '低于下限');
      expect(result).toBe(false);
    });

    it('未知参数应返回false', () => {
      const result = updateConfig('unknown.param', 1, 'test');
      expect(result).toBe(false);
    });

    it('应记录变更日志', () => {
      updateConfig('safety.cooldown_hours', 8, 'admin', '调整冷却时间');
      const logs = getChangeLog();
      const lastLog = logs[logs.length - 1];
      expect(lastLog.key).toBe('safety.cooldown_hours');
      expect(lastLog.previousValue).toBe(6);
      expect(lastLog.newValue).toBe(8);
      expect(lastLog.changedBy).toBe('admin');
      expect(lastLog.reason).toBe('调整冷却时间');
    });
  });

  describe('batchUpdateConfig', () => {
    it('应批量更新多个参数', () => {
      const result = batchUpdateConfig([
        { key: 'safety.cooldown_hours', value: 8 },
        { key: 'algorithm.fusion_threshold', value: 0.20 },
        { key: 'business.min_bid', value: 0.03 },
      ], 'batch_test', '批量更新');

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(getConfig<number>('safety.cooldown_hours')).toBe(8);
      expect(getConfig<number>('algorithm.fusion_threshold')).toBe(0.20);
      expect(getConfig<number>('business.min_bid')).toBe(0.03);
    });

    it('部分失败时应返回正确计数', () => {
      const result = batchUpdateConfig([
        { key: 'safety.cooldown_hours', value: 8 },
        { key: 'unknown.param', value: 1 },
      ], 'batch_test');

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });

  describe('resetConfig', () => {
    it('应重置参数到默认值', () => {
      updateConfig('safety.cooldown_hours', 12, 'test');
      expect(getConfig<number>('safety.cooldown_hours')).toBe(12);

      resetConfig('safety.cooldown_hours', 'test');
      expect(getConfig<number>('safety.cooldown_hours')).toBe(6);
    });

    it('未知参数应返回false', () => {
      expect(resetConfig('unknown.param')).toBe(false);
    });
  });

  describe('getAllConfig', () => {
    it('应返回所有配置参数', () => {
      const all = getAllConfig();
      expect(all.length).toBeGreaterThan(0);
    });

    it('应支持按分类过滤', () => {
      const safety = getAllConfig('safety');
      safety.forEach(p => {
        expect(p.category).toBe('safety');
      });

      const algorithm = getAllConfig('algorithm');
      algorithm.forEach(p => {
        expect(p.category).toBe('algorithm');
      });
    });

    it('每个参数应有完整的元数据', () => {
      const all = getAllConfig();
      all.forEach(p => {
        expect(p.key).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(p.category).toBeTruthy();
        expect(p.updatedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('exportConfig & importConfig', () => {
    it('应正确导出和导入配置', () => {
      updateConfig('safety.cooldown_hours', 10, 'test');
      updateConfig('algorithm.fusion_threshold', 0.25, 'test');

      const exported = exportConfig();
      expect(exported['safety.cooldown_hours']).toBe(10);
      expect(exported['algorithm.fusion_threshold']).toBe(0.25);

      // 重置后导入
      resetAllConfig('test');
      expect(getConfig<number>('safety.cooldown_hours')).toBe(6);

      const importResult = importConfig(exported, 'import_test');
      expect(importResult.success).toBeGreaterThan(0);
      expect(getConfig<number>('safety.cooldown_hours')).toBe(10);
      expect(getConfig<number>('algorithm.fusion_threshold')).toBe(0.25);
    });
  });

  describe('参数范围验证', () => {
    it('所有数值参数应有合法范围定义', () => {
      const all = getAllConfig();
      all.forEach(p => {
        if (typeof p.value === 'number') {
          expect(p.range).toBeDefined();
          expect(p.range!.min).toBeLessThan(p.range!.max);
          // 默认值应在合法范围内
          expect(p.value).toBeGreaterThanOrEqual(p.range!.min);
          expect(p.value).toBeLessThanOrEqual(p.range!.max);
        }
      });
    });
  });
});
