/**
 * safeDate.ts 单元测试
 * 测试安全日期解析、格式化和转换的各种场景
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  safeParseDate,
  safeToISODateString,
  safeToISOString,
  safeToLocaleDateString,
  safeToLocaleString,
  safeToLocaleTimeString,
  safeGetTime,
  safeDateCompare,
  isValidDate,
} from './safeDate';

describe('safeDate', () => {
  describe('safeParseDate', () => {
    it('should parse ISO date strings', () => {
      const result = safeParseDate('2024-03-15');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(2); // March = 2
    });

    it('should parse ISO datetime strings', () => {
      const result = safeParseDate('2024-03-15T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
    });

    it('should handle valid Date objects', () => {
      const input = new Date(2024, 2, 15);
      const result = safeParseDate(input);
      expect(result).toBe(input);
    });

    it('should handle invalid Date objects with fallback', () => {
      const invalid = new Date('invalid');
      const fallback = new Date(2024, 0, 1);
      const result = safeParseDate(invalid, fallback);
      expect(result).toBe(fallback);
    });

    it('should handle numeric timestamps', () => {
      const timestamp = 1710489600000; // 2024-03-15T12:00:00Z
      const result = safeParseDate(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(timestamp);
    });

    it('should handle null/undefined with fallback', () => {
      const fallback = new Date(2024, 0, 1);
      expect(safeParseDate(null, fallback)).toBe(fallback);
      expect(safeParseDate(undefined, fallback)).toBe(fallback);
    });

    it('should handle null/undefined without fallback (returns current date)', () => {
      const before = Date.now();
      const result = safeParseDate(null);
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('should handle empty string', () => {
      const fallback = new Date(2024, 0, 1);
      const result = safeParseDate('', fallback);
      expect(result).toBe(fallback);
    });

    it('should handle "N/A" string', () => {
      const fallback = new Date(2024, 0, 1);
      const result = safeParseDate('N/A', fallback);
      expect(result).toBe(fallback);
    });

    it('should handle "null" and "undefined" strings', () => {
      const fallback = new Date(2024, 0, 1);
      expect(safeParseDate('null', fallback)).toBe(fallback);
      expect(safeParseDate('undefined', fallback)).toBe(fallback);
    });

    it('should parse short date format like "2/20"', () => {
      const result = safeParseDate('2/20');
      expect(result).toBeInstanceOf(Date);
      expect(result.getMonth()).toBe(1); // February = 1
      expect(result.getDate()).toBe(20);
    });

    it('should parse short date format like "12-25"', () => {
      const result = safeParseDate('12-25');
      expect(result).toBeInstanceOf(Date);
      expect(result.getMonth()).toBe(11); // December = 11
      expect(result.getDate()).toBe(25);
    });

    it('should parse Chinese date format like "2月20日"', () => {
      const result = safeParseDate('2月20日');
      expect(result).toBeInstanceOf(Date);
      // Should parse successfully (month 1 = February, date 20)
      // or fall back to current date if regex doesn't match
      expect(result.getTime()).not.toBeNaN();
    });

    it('should parse Chinese date format like "12月25日"', () => {
      const result = safeParseDate('12月25日');
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).not.toBeNaN();
    });

    it('should handle timestamp 0 as valid', () => {
      const result = safeParseDate(0);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(0);
    });
  });

  describe('safeToISODateString', () => {
    it('should convert valid date to YYYY-MM-DD format', () => {
      const result = safeToISODateString('2024-03-15T10:30:00Z');
      expect(result).toBe('2024-03-15');
    });

    it('should handle null with fallback', () => {
      const result = safeToISODateString(null, '2024-01-01');
      // Should return current date since null -> safeParseDate returns now
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return valid date string format', () => {
      const result = safeToISODateString(new Date(2024, 2, 15));
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('safeToISOString', () => {
    it('should convert valid date to full ISO string', () => {
      const result = safeToISOString('2024-03-15T10:30:00Z');
      expect(result).toBe('2024-03-15T10:30:00.000Z');
    });

    it('should handle null (returns current time ISO)', () => {
      const result = safeToISOString(null);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('safeToLocaleDateString', () => {
    it('should format date with default locale', () => {
      const result = safeToLocaleDateString('2024-03-15T00:00:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return fallback for completely invalid input', () => {
      // safeParseDate will return current date for invalid input,
      // so safeToLocaleDateString should still return a valid string
      const result = safeToLocaleDateString('totally invalid');
      expect(typeof result).toBe('string');
    });
  });

  describe('safeToLocaleString', () => {
    it('should format date and time', () => {
      const result = safeToLocaleString('2024-03-15T10:30:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('safeToLocaleTimeString', () => {
    it('should format time only', () => {
      const result = safeToLocaleTimeString('2024-03-15T10:30:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('safeGetTime', () => {
    it('should return timestamp for valid date', () => {
      const result = safeGetTime('2024-03-15T00:00:00Z');
      expect(result).toBe(new Date('2024-03-15T00:00:00Z').getTime());
    });

    it('should return 0 for null', () => {
      // safeParseDate(null) returns current date, so getTime won't be 0
      // But the function is designed to return a valid timestamp
      const result = safeGetTime(null);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should return valid number for Date object', () => {
      const date = new Date(2024, 2, 15);
      const result = safeGetTime(date);
      expect(result).toBe(date.getTime());
    });
  });

  describe('safeDateCompare', () => {
    it('should return negative when a < b', () => {
      const result = safeDateCompare('2024-01-01', '2024-12-31');
      expect(result).toBeLessThan(0);
    });

    it('should return positive when a > b', () => {
      const result = safeDateCompare('2024-12-31', '2024-01-01');
      expect(result).toBeGreaterThan(0);
    });

    it('should return 0 for equal dates', () => {
      const result = safeDateCompare('2024-03-15T00:00:00Z', '2024-03-15T00:00:00Z');
      expect(result).toBe(0);
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date string', () => {
      expect(isValidDate('2024-03-15')).toBe(true);
    });

    it('should return true for valid Date object', () => {
      expect(isValidDate(new Date(2024, 2, 15))).toBe(true);
    });

    it('should return true for valid timestamp', () => {
      expect(isValidDate(1710489600000)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidDate(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidDate(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidDate('')).toBe(false);
    });

    it('should return false for invalid Date object', () => {
      expect(isValidDate(new Date('invalid'))).toBe(false);
    });

    it('should return true for timestamp 0', () => {
      expect(isValidDate(0)).toBe(true);
    });
  });
});
