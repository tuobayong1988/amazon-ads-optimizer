import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_TIMEZONES,
  DEFAULT_TIMEZONE,
  getMarketplaceTimezone,
  getMarketplaceCurrentDate,
  getMarketplaceDateRange,
  getMarketplaceYesterday,
  isMarketplaceToday,
  isMarketplaceYesterday,
} from './timezone';

describe('站点时区工具', () => {
  describe('MARKETPLACE_TIMEZONES', () => {
    it('应该包含北美站点时区', () => {
      expect(MARKETPLACE_TIMEZONES['US']).toBe('America/Los_Angeles');
      expect(MARKETPLACE_TIMEZONES['CA']).toBe('America/Los_Angeles');
      expect(MARKETPLACE_TIMEZONES['MX']).toBe('America/Los_Angeles');
    });

    it('应该包含欧洲站点时区', () => {
      expect(MARKETPLACE_TIMEZONES['UK']).toBe('Europe/London');
      expect(MARKETPLACE_TIMEZONES['DE']).toBe('Europe/Berlin');
      expect(MARKETPLACE_TIMEZONES['FR']).toBe('Europe/Paris');
    });

    it('应该包含亚太站点时区', () => {
      expect(MARKETPLACE_TIMEZONES['JP']).toBe('Asia/Tokyo');
      expect(MARKETPLACE_TIMEZONES['AU']).toBe('Australia/Sydney');
    });
  });

  describe('getMarketplaceTimezone', () => {
    it('应该返回已知站点的时区', () => {
      expect(getMarketplaceTimezone('US')).toBe('America/Los_Angeles');
      expect(getMarketplaceTimezone('JP')).toBe('Asia/Tokyo');
      expect(getMarketplaceTimezone('UK')).toBe('Europe/London');
    });

    it('应该对未知站点返回默认时区', () => {
      expect(getMarketplaceTimezone('UNKNOWN')).toBe(DEFAULT_TIMEZONE);
      expect(getMarketplaceTimezone('')).toBe(DEFAULT_TIMEZONE);
    });

    it('应该忽略大小写', () => {
      expect(getMarketplaceTimezone('us')).toBe('America/Los_Angeles');
      expect(getMarketplaceTimezone('Us')).toBe('America/Los_Angeles');
    });
  });

  describe('getMarketplaceCurrentDate', () => {
    it('应该返回YYYY-MM-DD格式的日期', () => {
      const date = getMarketplaceCurrentDate('US');
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('不同站点可能返回不同日期', () => {
      // 由于时区差异，JP和US可能在不同日期
      const usDate = getMarketplaceCurrentDate('US');
      const jpDate = getMarketplaceCurrentDate('JP');
      // 两者都应该是有效日期
      expect(new Date(usDate).toString()).not.toBe('Invalid Date');
      expect(new Date(jpDate).toString()).not.toBe('Invalid Date');
    });
  });

  describe('getMarketplaceDateRange', () => {
    it('应该返回正确的日期范围', () => {
      const { startDate, endDate } = getMarketplaceDateRange('US', 7);
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // 结束日期应该大于或等于开始日期
      expect(new Date(endDate) >= new Date(startDate)).toBe(true);
    });

    it('应该返回指定天数的范围', () => {
      const { startDate, endDate } = getMarketplaceDateRange('US', 30);
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      // 差异应该接近30天（可能有1天误差）
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(31);
    });
  });

  describe('getMarketplaceYesterday', () => {
    it('应该返回YYYY-MM-DD格式的日期', () => {
      const yesterday = getMarketplaceYesterday('US');
      expect(yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('昨天应该比今天早一天', () => {
      const today = getMarketplaceCurrentDate('US');
      const yesterday = getMarketplaceYesterday('US');
      const todayDate = new Date(today);
      const yesterdayDate = new Date(yesterday);
      const diffDays = Math.round((todayDate.getTime() - yesterdayDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(1);
    });
  });

  describe('isMarketplaceToday', () => {
    it('应该正确判断今天', () => {
      const today = getMarketplaceCurrentDate('US');
      expect(isMarketplaceToday(today, 'US')).toBe(true);
    });

    it('应该正确判断非今天', () => {
      expect(isMarketplaceToday('2020-01-01', 'US')).toBe(false);
    });
  });

  describe('isMarketplaceYesterday', () => {
    it('应该正确判断昨天', () => {
      const yesterday = getMarketplaceYesterday('US');
      expect(isMarketplaceYesterday(yesterday, 'US')).toBe(true);
    });

    it('应该正确判断非昨天', () => {
      expect(isMarketplaceYesterday('2020-01-01', 'US')).toBe(false);
    });
  });
});
