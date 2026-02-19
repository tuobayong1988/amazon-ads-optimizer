/**
 * AMS数据处理服务单元测试
 * 
 * 测试时区转换功能是否正确工作
 */

import { describe, it, expect } from 'vitest';
import {
  convertUtcToLocalDate,
  convertUtcToLocalTimestamp,
  getTimezoneForMarketplace,
  getCurrentDateInTimezone,
  isToday,
  isValidTimezone,
  MARKETPLACE_TIMEZONE_MAP,
} from './amsDataService';

describe('AMS时区转换功能', () => {
  describe('convertUtcToLocalDate', () => {
    it('应该将UTC时间正确转换为美国太平洋时间的日期', () => {
      // UTC 2024-01-15 08:00:00 -> 美国太平洋时间 2024-01-15 00:00:00 (PST = UTC-8)
      const utcTimestamp = '2024-01-15T08:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2024-01-15');
    });

    it('应该将UTC时间正确转换为日本时间的日期', () => {
      // UTC 2024-01-15 15:00:00 -> 日本时间 2024-01-16 00:00:00 (JST = UTC+9)
      const utcTimestamp = '2024-01-15T15:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Asia/Tokyo');
      expect(result).toBe('2024-01-16');
    });

    it('应该处理跨日边界情况（美国）', () => {
      // UTC 2024-01-16 02:00:00 -> 美国太平洋时间 2024-01-15 18:00:00 (PST = UTC-8)
      const utcTimestamp = '2024-01-16T02:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2024-01-15');
    });

    it('应该处理跨日边界情况（日本）', () => {
      // UTC 2024-01-15 16:00:00 -> 日本时间 2024-01-16 01:00:00 (JST = UTC+9)
      const utcTimestamp = '2024-01-15T16:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Asia/Tokyo');
      expect(result).toBe('2024-01-16');
    });

    it('应该正确处理夏令时（美国）', () => {
      // 夏令时期间 PDT = UTC-7
      // UTC 2024-07-15 07:00:00 -> 美国太平洋时间 2024-07-15 00:00:00 (PDT = UTC-7)
      const utcTimestamp = '2024-07-15T07:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2024-07-15');
    });

    it('应该在无效时区时降级使用UTC日期', () => {
      const utcTimestamp = '2024-01-15T12:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Invalid/Timezone');
      // 降级处理应该返回UTC日期
      expect(result).toBe('2024-01-15');
    });
  });

  describe('convertUtcToLocalTimestamp', () => {
    it('应该将UTC时间转换为完整的本地时间戳', () => {
      const utcTimestamp = '2024-01-15T12:00:00Z';
      const result = convertUtcToLocalTimestamp(utcTimestamp, 'Asia/Tokyo');
      // 日本时间 = UTC + 9小时 = 21:00
      expect(result).toContain('2024-01-15T21:00:00');
    });
  });

  describe('getTimezoneForMarketplace', () => {
    it('应该优先使用数据库中的时区', () => {
      const result = getTimezoneForMarketplace('US', 'America/New_York');
      expect(result).toBe('America/New_York');
    });

    it('应该在没有数据库时区时使用映射表', () => {
      const result = getTimezoneForMarketplace('US', null);
      expect(result).toBe('America/Los_Angeles');
    });

    it('应该在未知站点时返回UTC', () => {
      const result = getTimezoneForMarketplace('UNKNOWN', null);
      expect(result).toBe('UTC');
    });

    it('应该正确映射所有主要站点', () => {
      expect(getTimezoneForMarketplace('US', null)).toBe('America/Los_Angeles');
      expect(getTimezoneForMarketplace('CA', null)).toBe('America/Toronto');
      expect(getTimezoneForMarketplace('MX', null)).toBe('America/Mexico_City');
      expect(getTimezoneForMarketplace('UK', null)).toBe('Europe/London');
      expect(getTimezoneForMarketplace('DE', null)).toBe('Europe/Berlin');
      expect(getTimezoneForMarketplace('JP', null)).toBe('Asia/Tokyo');
      expect(getTimezoneForMarketplace('AU', null)).toBe('Australia/Sydney');
    });
  });

  describe('getCurrentDateInTimezone', () => {
    it('应该返回正确格式的日期字符串', () => {
      const result = getCurrentDateInTimezone('America/Los_Angeles');
      // 验证格式为 YYYY-MM-DD
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('isToday', () => {
    it('应该正确判断是否为今天', () => {
      const today = getCurrentDateInTimezone('America/Los_Angeles');
      expect(isToday(today, 'America/Los_Angeles')).toBe(true);
      expect(isToday('2020-01-01', 'America/Los_Angeles')).toBe(false);
    });
  });

  describe('isValidTimezone', () => {
    it('应该验证有效的时区', () => {
      expect(isValidTimezone('America/Los_Angeles')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('应该拒绝无效的时区', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('NotATimezone')).toBe(false);
    });
  });

  describe('MARKETPLACE_TIMEZONE_MAP', () => {
    it('应该包含所有主要亚马逊站点', () => {
      const expectedMarketplaces = [
        'US', 'CA', 'MX', 'BR',  // 北美
        'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'TR', 'BE',  // 欧洲
        'JP', 'AU', 'SG', 'IN', 'AE', 'SA', 'EG',  // 亚太/中东
      ];
      
      for (const marketplace of expectedMarketplaces) {
        expect(MARKETPLACE_TIMEZONE_MAP).toHaveProperty(marketplace);
        expect(isValidTimezone(MARKETPLACE_TIMEZONE_MAP[marketplace])).toBe(true);
      }
    });
  });
});

describe('AMS数据处理场景测试', () => {
  describe('跨时区日期对齐', () => {
    it('美国店铺：UTC午夜应该映射到前一天', () => {
      // 场景：AMS推送的事件发生在UTC 2024-01-16 00:00:00
      // 美国太平洋时间 = UTC - 8 = 2024-01-15 16:00:00
      // 所以应该归属到 2024-01-15
      const utcTimestamp = '2024-01-16T00:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2024-01-15');
    });

    it('日本店铺：UTC下午应该映射到下一天', () => {
      // 场景：AMS推送的事件发生在UTC 2024-01-15 18:00:00
      // 日本时间 = UTC + 9 = 2024-01-16 03:00:00
      // 所以应该归属到 2024-01-16
      const utcTimestamp = '2024-01-15T18:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Asia/Tokyo');
      expect(result).toBe('2024-01-16');
    });

    it('英国店铺：冬令时期间UTC时间等于本地时间', () => {
      // 冬令时期间 GMT = UTC+0
      const utcTimestamp = '2024-01-15T12:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Europe/London');
      expect(result).toBe('2024-01-15');
    });

    it('英国店铺：夏令时期间UTC时间比本地时间晚1小时', () => {
      // 夏令时期间 BST = UTC+1
      // UTC 2024-07-15 23:30:00 -> BST 2024-07-16 00:30:00
      const utcTimestamp = '2024-07-15T23:30:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'Europe/London');
      expect(result).toBe('2024-07-16');
    });
  });

  describe('边界情况处理', () => {
    it('应该处理ISO 8601格式的时间戳', () => {
      const timestamps = [
        '2024-01-15T12:00:00Z',
        '2024-01-15T12:00:00.000Z',
        '2024-01-15T12:00:00+00:00',
      ];
      
      for (const ts of timestamps) {
        const result = convertUtcToLocalDate(ts, 'America/Los_Angeles');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('应该处理年末/年初的跨年情况', () => {
      // UTC 2024-01-01 02:00:00 -> 美国太平洋时间 2023-12-31 18:00:00
      const utcTimestamp = '2024-01-01T02:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2023-12-31');
    });

    it('应该处理月末/月初的跨月情况', () => {
      // UTC 2024-02-01 02:00:00 -> 美国太平洋时间 2024-01-31 18:00:00
      const utcTimestamp = '2024-02-01T02:00:00Z';
      const result = convertUtcToLocalDate(utcTimestamp, 'America/Los_Angeles');
      expect(result).toBe('2024-01-31');
    });
  });
});
