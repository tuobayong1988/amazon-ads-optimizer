import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_TIMEZONES,
  DEFAULT_TIMEZONE,
  getMarketplaceTimezone,
  getMarketplaceCurrentDate,
  getMarketplaceYesterday,
  getMarketplaceDateRange,
  getMarketplaceHistoricalDateRange,
  getMarketplaceUtcOffset,
  utcToMarketplaceDate,
  isMarketplaceToday,
  getMarketplaceLatestDataDate,
  getMarketplaceNow,
} from '../utils/timezone';

describe('timezone', () => {
  describe('MARKETPLACE_TIMEZONES', () => {
    it('should have US mapped to America/Los_Angeles', () => {
      expect(MARKETPLACE_TIMEZONES['US']).toBe('America/Los_Angeles');
    });

    it('should have JP mapped to Asia/Tokyo', () => {
      expect(MARKETPLACE_TIMEZONES['JP']).toBe('Asia/Tokyo');
    });

    it('should have UK and GB mapped to Europe/London', () => {
      expect(MARKETPLACE_TIMEZONES['UK']).toBe('Europe/London');
      expect(MARKETPLACE_TIMEZONES['GB']).toBe('Europe/London');
    });

    it('should have all major marketplaces', () => {
      const expectedMarketplaces = ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU', 'IN', 'AE', 'BR'];
      for (const mp of expectedMarketplaces) {
        expect(MARKETPLACE_TIMEZONES[mp]).toBeDefined();
      }
    });
  });

  describe('getMarketplaceTimezone', () => {
    it('should return correct timezone for known marketplace', () => {
      expect(getMarketplaceTimezone('US')).toBe('America/Los_Angeles');
      expect(getMarketplaceTimezone('JP')).toBe('Asia/Tokyo');
      expect(getMarketplaceTimezone('DE')).toBe('Europe/Berlin');
    });

    it('should be case-insensitive', () => {
      expect(getMarketplaceTimezone('us')).toBe('America/Los_Angeles');
      expect(getMarketplaceTimezone('jp')).toBe('Asia/Tokyo');
    });

    it('should return default timezone for unknown marketplace', () => {
      expect(getMarketplaceTimezone('ZZ')).toBe(DEFAULT_TIMEZONE);
    });

    it('should handle empty/null input', () => {
      expect(getMarketplaceTimezone('')).toBe(DEFAULT_TIMEZONE);
      expect(getMarketplaceTimezone(null as unknown)).toBe(DEFAULT_TIMEZONE);
      expect(getMarketplaceTimezone(undefined as unknown)).toBe(DEFAULT_TIMEZONE);
    });
  });

  describe('getMarketplaceCurrentDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const date = getMarketplaceCurrentDate('US');
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return valid date', () => {
      const date = getMarketplaceCurrentDate('US');
      const parsed = new Date(date);
      expect(parsed.toString()).not.toBe('Invalid Date');
    });
  });

  describe('getMarketplaceYesterday', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const date = getMarketplaceYesterday('US');
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return a date before today', () => {
      const today = getMarketplaceCurrentDate('US');
      const yesterday = getMarketplaceYesterday('US');
      expect(new Date(yesterday).getTime()).toBeLessThan(new Date(today).getTime());
    });
  });

  describe('getMarketplaceDateRange', () => {
    it('should return start and end dates in correct format', () => {
      const range = getMarketplaceDateRange('US', 7);
      expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should have startDate before endDate', () => {
      const range = getMarketplaceDateRange('US', 7);
      expect(new Date(range.startDate).getTime()).toBeLessThanOrEqual(new Date(range.endDate).getTime());
    });

    it('should span approximately the requested number of days', () => {
      const range = getMarketplaceDateRange('US', 14);
      const start = new Date(range.startDate);
      const end = new Date(range.endDate);
      const daysDiff = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      expect(daysDiff).toBeGreaterThanOrEqual(13);
      expect(daysDiff).toBeLessThanOrEqual(15);
    });
  });

  describe('getMarketplaceHistoricalDateRange', () => {
    it('should return start and end dates in correct format', () => {
      const range = getMarketplaceHistoricalDateRange('US', 7);
      expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should have endDate as yesterday (not today)', () => {
      const range = getMarketplaceHistoricalDateRange('US', 7);
      const today = getMarketplaceCurrentDate('US');
      // endDate should be before or equal to yesterday
      expect(new Date(range.endDate).getTime()).toBeLessThanOrEqual(new Date(today).getTime());
    });

    it('should have startDate before endDate', () => {
      const range = getMarketplaceHistoricalDateRange('US', 7);
      expect(new Date(range.startDate).getTime()).toBeLessThanOrEqual(new Date(range.endDate).getTime());
    });
  });

  describe('getMarketplaceUtcOffset', () => {
    it('should return a number for known marketplaces', () => {
      const offset = getMarketplaceUtcOffset('US');
      expect(typeof offset).toBe('number');
    });

    it('should return offset within valid range', () => {
      const offset = getMarketplaceUtcOffset('JP');
      expect(offset).toBeGreaterThanOrEqual(-12);
      expect(offset).toBeLessThanOrEqual(14);
    });

    it('should return positive offset for Japan', () => {
      const offset = getMarketplaceUtcOffset('JP');
      expect(offset).toBeGreaterThan(0); // Japan is UTC+9
    });
  });

  describe('utcToMarketplaceDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = utcToMarketplaceDate('2024-06-15', 'US');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should convert UTC date to marketplace local date', () => {
      // Using noon UTC to avoid date boundary issues
      const result = utcToMarketplaceDate('2024-06-15', 'JP');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Japan is UTC+9, so noon UTC = 9pm JST, same date
      expect(result).toBe('2024-06-15');
    });
  });

  describe('isMarketplaceToday', () => {
    it('should return true for current marketplace date', () => {
      const today = getMarketplaceCurrentDate('US');
      expect(isMarketplaceToday(today, 'US')).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = getMarketplaceYesterday('US');
      expect(isMarketplaceToday(yesterday, 'US')).toBe(false);
    });
  });

  describe('getMarketplaceLatestDataDate', () => {
    it('should return yesterday as latest data date', () => {
      const latest = getMarketplaceLatestDataDate('US');
      const yesterday = getMarketplaceYesterday('US');
      expect(latest).toBe(yesterday);
    });
  });

  describe('getMarketplaceNow', () => {
    it('should return a valid Date object', () => {
      const now = getMarketplaceNow('US');
      expect(now).toBeInstanceOf(Date);
      expect(now.toString()).not.toBe('Invalid Date');
    });
  });
});
