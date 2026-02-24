/**
 * currency.ts 单元测试
 * 测试货币符号映射、格式化和各种marketplace的处理
 */
import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_CURRENCY_MAP,
  CURRENCY_SYMBOLS,
  getCurrencySymbol,
  getCurrencySymbolByCode,
  formatCurrency,
  formatCurrencyByCode,
} from './currency';

describe('currency', () => {
  describe('MARKETPLACE_CURRENCY_MAP', () => {
    it('should map US to USD', () => {
      expect(MARKETPLACE_CURRENCY_MAP['US']).toBe('USD');
    });

    it('should map UK to GBP', () => {
      expect(MARKETPLACE_CURRENCY_MAP['UK']).toBe('GBP');
    });

    it('should map JP to JPY', () => {
      expect(MARKETPLACE_CURRENCY_MAP['JP']).toBe('JPY');
    });

    it('should map EU countries to EUR', () => {
      expect(MARKETPLACE_CURRENCY_MAP['DE']).toBe('EUR');
      expect(MARKETPLACE_CURRENCY_MAP['FR']).toBe('EUR');
      expect(MARKETPLACE_CURRENCY_MAP['IT']).toBe('EUR');
      expect(MARKETPLACE_CURRENCY_MAP['ES']).toBe('EUR');
      expect(MARKETPLACE_CURRENCY_MAP['NL']).toBe('EUR');
    });

    it('should have all major marketplaces', () => {
      const expectedMarketplaces = ['US', 'CA', 'MX', 'BR', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU', 'IN'];
      for (const mp of expectedMarketplaces) {
        expect(MARKETPLACE_CURRENCY_MAP).toHaveProperty(mp);
      }
    });
  });

  describe('CURRENCY_SYMBOLS', () => {
    it('should have $ for USD', () => {
      expect(CURRENCY_SYMBOLS['USD']).toBe('$');
    });

    it('should have £ for GBP', () => {
      expect(CURRENCY_SYMBOLS['GBP']).toBe('£');
    });

    it('should have € for EUR', () => {
      expect(CURRENCY_SYMBOLS['EUR']).toBe('€');
    });

    it('should have ¥ for JPY', () => {
      expect(CURRENCY_SYMBOLS['JPY']).toBe('¥');
    });

    it('should have ₹ for INR', () => {
      expect(CURRENCY_SYMBOLS['INR']).toBe('₹');
    });
  });

  describe('getCurrencySymbol', () => {
    it('should return $ for US marketplace', () => {
      expect(getCurrencySymbol('US')).toBe('$');
    });

    it('should return £ for UK marketplace', () => {
      expect(getCurrencySymbol('UK')).toBe('£');
    });

    it('should return € for DE marketplace', () => {
      expect(getCurrencySymbol('DE')).toBe('€');
    });

    it('should return ¥ for JP marketplace', () => {
      expect(getCurrencySymbol('JP')).toBe('¥');
    });

    it('should return $ for null/undefined marketplace', () => {
      expect(getCurrencySymbol(null)).toBe('$');
      expect(getCurrencySymbol(undefined)).toBe('$');
      expect(getCurrencySymbol('')).toBe('$');
    });

    it('should return $ for unknown marketplace', () => {
      expect(getCurrencySymbol('ZZ')).toBe('$');
    });
  });

  describe('getCurrencySymbolByCode', () => {
    it('should return $ for USD', () => {
      expect(getCurrencySymbolByCode('USD')).toBe('$');
    });

    it('should return € for EUR', () => {
      expect(getCurrencySymbolByCode('EUR')).toBe('€');
    });

    it('should return $ for null/undefined', () => {
      expect(getCurrencySymbolByCode(null)).toBe('$');
      expect(getCurrencySymbolByCode(undefined)).toBe('$');
    });

    it('should return $ for unknown currency code', () => {
      expect(getCurrencySymbolByCode('XYZ')).toBe('$');
    });
  });

  describe('formatCurrency', () => {
    it('should format basic USD amount', () => {
      const result = formatCurrency(1234.56, 'US');
      expect(result).toContain('$');
      expect(result).toContain('1');
      expect(result).toContain('234');
    });

    it('should format with GBP symbol', () => {
      const result = formatCurrency(100, 'UK');
      expect(result).toContain('£');
    });

    it('should format with EUR symbol', () => {
      const result = formatCurrency(100, 'DE');
      expect(result).toContain('€');
    });

    it('should format with JPY symbol', () => {
      const result = formatCurrency(10000, 'JP');
      expect(result).toContain('¥');
    });

    it('should use default 2 decimal places', () => {
      const result = formatCurrency(100, 'US');
      expect(result).toMatch(/\$.*100.*00/);
    });

    it('should support custom decimal places', () => {
      const result = formatCurrency(100, 'US', { decimals: 0 });
      expect(result).toContain('$');
      expect(result).toContain('100');
    });

    it('should support compact format for large numbers', () => {
      const result = formatCurrency(5000, 'US', { compact: true });
      expect(result).toBe('$5.0k');
    });

    it('should not compact numbers below 1000', () => {
      const result = formatCurrency(999, 'US', { compact: true });
      expect(result).not.toContain('k');
    });

    it('should compact negative large numbers', () => {
      const result = formatCurrency(-5000, 'US', { compact: true });
      expect(result).toBe('$-5.0k');
    });

    it('should default to $ when no marketplace provided', () => {
      const result = formatCurrency(100);
      expect(result).toContain('$');
    });
  });

  describe('formatCurrencyByCode', () => {
    it('should format with currency code', () => {
      const result = formatCurrencyByCode(100, 'EUR');
      expect(result).toContain('€');
    });

    it('should support compact format', () => {
      const result = formatCurrencyByCode(2500, 'GBP', { compact: true });
      expect(result).toBe('£2.5k');
    });

    it('should default to $ when no code provided', () => {
      const result = formatCurrencyByCode(100);
      expect(result).toContain('$');
    });
  });
});
