import { describe, it, expect } from 'vitest';
import {
  sanitizeAndValidateKeyword,
  isAsinSearchTerm,
  canAddPositiveKeyword,
  batchValidateKeywords,
} from '../utils/keywordValidator';

describe('keywordValidator', () => {
  describe('sanitizeAndValidateKeyword', () => {
    it('should accept valid simple keywords', () => {
      const result = sanitizeAndValidateKeyword('running shoes');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).toBe('running shoes');
    });

    it('should trim whitespace', () => {
      const result = sanitizeAndValidateKeyword('  running shoes  ');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).toBe('running shoes');
    });

    it('should collapse multiple spaces', () => {
      const result = sanitizeAndValidateKeyword('running   shoes   for   men');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).toBe('running shoes for men');
    });

    it('should allow hyphens', () => {
      const result = sanitizeAndValidateKeyword('long-sleeve t-shirt');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).toBe('long-sleeve t-shirt');
    });

    it('should remove Amazon-prohibited special characters', () => {
      const result = sanitizeAndValidateKeyword('shoes! @#$% running');
      expect(result.isValid).toBe(true);
      // Special chars replaced with spaces, then collapsed
      expect(result.sanitizedText).not.toContain('!');
      expect(result.sanitizedText).not.toContain('@');
      expect(result.sanitizedText).not.toContain('#');
    });

    it('should remove Unicode control characters', () => {
      const result = sanitizeAndValidateKeyword('shoes\u200Brunning\uFEFF');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).not.toContain('\u200B');
      expect(result.sanitizedText).not.toContain('\uFEFF');
    });

    it('should reject empty strings after sanitization', () => {
      const result = sanitizeAndValidateKeyword('!!!@@@###');
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EMPTY_AFTER_SANITIZE');
    });

    it('should reject empty input', () => {
      const result = sanitizeAndValidateKeyword('');
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EMPTY_AFTER_SANITIZE');
    });

    it('should reject keywords exceeding 80 characters', () => {
      const longKeyword = 'a'.repeat(81);
      const result = sanitizeAndValidateKeyword(longKeyword);
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EXCEEDS_MAX_LENGTH');
    });

    it('should accept keywords at exactly 80 characters', () => {
      const keyword = 'a'.repeat(80);
      const result = sanitizeAndValidateKeyword(keyword);
      expect(result.isValid).toBe(true);
    });

    it('should reject positive keywords exceeding 10 words', () => {
      const result = sanitizeAndValidateKeyword(
        'one two three four five six seven eight nine ten eleven',
        'positive'
      );
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EXCEEDS_MAX_WORDS');
    });

    it('should accept positive keywords with exactly 10 words', () => {
      const result = sanitizeAndValidateKeyword(
        'one two three four five six seven eight nine ten',
        'positive'
      );
      expect(result.isValid).toBe(true);
    });

    it('should reject negative phrase keywords exceeding 4 words', () => {
      const result = sanitizeAndValidateKeyword(
        'one two three four five',
        'negative_phrase'
      );
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EXCEEDS_MAX_WORDS_NEG_PHRASE');
    });

    it('should accept negative phrase keywords with 4 words', () => {
      const result = sanitizeAndValidateKeyword(
        'one two three four',
        'negative_phrase'
      );
      expect(result.isValid).toBe(true);
    });

    it('should reject negative exact keywords exceeding 10 words', () => {
      const result = sanitizeAndValidateKeyword(
        'one two three four five six seven eight nine ten eleven',
        'negative_exact'
      );
      expect(result.isValid).toBe(false);
      expect(result.reasonCode).toBe('EXCEEDS_MAX_WORDS_NEG_EXACT');
    });

    it('should handle null/undefined input gracefully', () => {
      const result = sanitizeAndValidateKeyword(null as any);
      expect(result.isValid).toBe(false);
    });

    it('should allow accented characters', () => {
      const result = sanitizeAndValidateKeyword('café résumé');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedText).toBe('café résumé');
    });
  });

  describe('isAsinSearchTerm', () => {
    it('should detect standard ASIN format', () => {
      expect(isAsinSearchTerm('B0ABCDEFGH')).toBe(true);
    });

    it('should detect lowercase ASIN', () => {
      expect(isAsinSearchTerm('b0abcdefgh')).toBe(true);
    });

    it('should detect ASIN with whitespace', () => {
      expect(isAsinSearchTerm('  B0ABCDEFGH  ')).toBe(true);
    });

    it('should reject non-ASIN strings', () => {
      expect(isAsinSearchTerm('running shoes')).toBe(false);
    });

    it('should reject strings starting with B but not B0', () => {
      expect(isAsinSearchTerm('B1ABCDEFGH')).toBe(false);
    });

    it('should reject too-short ASIN-like strings', () => {
      expect(isAsinSearchTerm('B0ABC')).toBe(false);
    });

    it('should accept longer ASIN variants', () => {
      expect(isAsinSearchTerm('B0ABCDEFGHIJ')).toBe(true);
    });
  });

  describe('canAddPositiveKeyword', () => {
    it('should allow positive keywords for manual campaigns', () => {
      expect(canAddPositiveKeyword('manual')).toBe(true);
    });

    it('should disallow positive keywords for auto campaigns', () => {
      expect(canAddPositiveKeyword('auto')).toBe(false);
    });

    it('should allow positive keywords for other types', () => {
      expect(canAddPositiveKeyword('custom')).toBe(true);
    });
  });

  describe('batchValidateKeywords', () => {
    it('should separate valid and rejected keywords', () => {
      const keywords = [
        { text: 'running shoes', matchType: 'broad' },
        { text: '', matchType: 'exact' },
        { text: 'yoga mat', matchType: 'phrase' },
      ];

      const result = batchValidateKeywords(keywords);

      expect(result.valid).toHaveLength(2);
      expect(result.rejected).toHaveLength(1);
    });

    it('should preserve original data in results', () => {
      const keywords = [
        { text: 'running shoes', matchType: 'broad', bid: 1.5 },
      ];

      const result = batchValidateKeywords(keywords);

      expect(result.valid[0].data.matchType).toBe('broad');
      expect(result.valid[0].data.bid).toBe(1.5);
    });

    it('should sanitize text in valid results', () => {
      const keywords = [
        { text: '  running   shoes!  ', matchType: 'broad' },
      ];

      const result = batchValidateKeywords(keywords);

      expect(result.valid[0].sanitizedText).toBe('running shoes');
      expect(result.valid[0].originalText).toBe('  running   shoes!  ');
    });

    it('should handle empty input array', () => {
      const result = batchValidateKeywords([]);
      expect(result.valid).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it('should respect mode parameter', () => {
      const keywords = [
        { text: 'one two three four five' }, // 5 words - too many for negative_phrase
      ];

      const phraseResult = batchValidateKeywords(keywords, 'negative_phrase');
      const exactResult = batchValidateKeywords(keywords, 'negative_exact');

      expect(phraseResult.rejected).toHaveLength(1);
      expect(exactResult.valid).toHaveLength(1);
    });
  });
});
