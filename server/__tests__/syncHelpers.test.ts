import { describe, it, expect } from 'vitest';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  detectConflict,
  SyncProtectionStats,
} from '../services/sync/syncHelpers';

describe('syncHelpers', () => {
  describe('SYNC_PROTECTION_CONFIG', () => {
    it('should have correct default values', () => {
      expect(SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS).toBe(24);
      expect(SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS).toBe(24);
      expect(SYNC_PROTECTION_CONFIG.BID_THRESHOLD).toBe(0.01);
    });

    it('should be readonly', () => {
      // TypeScript const assertion ensures this at compile time
      // At runtime, verify the values are as expected
      expect(typeof SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS).toBe('number');
      expect(typeof SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS).toBe('number');
      expect(typeof SYNC_PROTECTION_CONFIG.BID_THRESHOLD).toBe('number');
    });
  });

  describe('createSyncProtectionStats', () => {
    it('should create stats with all counters at zero', () => {
      const stats = createSyncProtectionStats();

      expect(stats.bidProtected).toBe(0);
      expect(stats.bidOverwritten).toBe(0);
      expect(stats.budgetProtected).toBe(0);
      expect(stats.budgetOverwritten).toBe(0);
      expect(stats.protectedEntities).toEqual([]);
    });

    it('should create independent instances', () => {
      const stats1 = createSyncProtectionStats();
      const stats2 = createSyncProtectionStats();

      stats1.bidProtected = 5;
      stats1.protectedEntities.push('entity1');

      expect(stats2.bidProtected).toBe(0);
      expect(stats2.protectedEntities).toEqual([]);
    });

    it('should allow mutation of stats', () => {
      const stats = createSyncProtectionStats();

      stats.bidProtected = 10;
      stats.bidOverwritten = 5;
      stats.budgetProtected = 3;
      stats.budgetOverwritten = 2;
      stats.protectedEntities.push('kw-123', 'kw-456');

      expect(stats.bidProtected).toBe(10);
      expect(stats.bidOverwritten).toBe(5);
      expect(stats.budgetProtected).toBe(3);
      expect(stats.budgetOverwritten).toBe(2);
      expect(stats.protectedEntities).toHaveLength(2);
    });
  });

  describe('detectConflict', () => {
    it('should detect no conflict when values match', () => {
      const existing = { bid: '1.50', budget: '100.00', state: 'enabled' };
      const newData = { bid: '1.50', budget: '100.00', state: 'enabled' };

      const result = detectConflict(existing, newData, ['bid', 'budget', 'state']);

      expect(result.hasConflict).toBe(false);
      expect(result.conflictFields).toHaveLength(0);
    });

    it('should detect conflict when values differ', () => {
      const existing = { bid: '1.50', budget: '100.00' };
      const newData = { bid: '2.00', budget: '100.00' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictFields).toContain('bid');
      expect(result.conflictFields).not.toContain('budget');
    });

    it('should detect multiple conflict fields', () => {
      const existing = { bid: '1.50', budget: '100.00', state: 'enabled' };
      const newData = { bid: '2.00', budget: '200.00', state: 'paused' };

      const result = detectConflict(existing, newData, ['bid', 'budget', 'state']);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictFields).toHaveLength(3);
    });

    it('should treat null/undefined as empty (no conflict)', () => {
      const existing = { bid: null, budget: undefined };
      const newData = { bid: '2.00', budget: '100.00' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(false);
    });

    it('should treat "0" and "0.00" as empty (no conflict)', () => {
      const existing = { bid: '0', budget: '0.00' };
      const newData = { bid: '2.00', budget: '100.00' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(false);
    });

    it('should treat empty string as empty (no conflict)', () => {
      const existing = { bid: '', budget: '  ' };
      const newData = { bid: '2.00', budget: '100.00' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(false);
    });

    it('should skip empty new values (no conflict)', () => {
      const existing = { bid: '1.50', budget: '100.00' };
      const newData = { bid: null, budget: '0' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(false);
    });

    it('should handle numeric comparison via string conversion', () => {
      const existing = { bid: 1.5, budget: 100 };
      const newData = { bid: '1.5', budget: '100' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      expect(result.hasConflict).toBe(false);
    });

    it('should only check specified fields', () => {
      const existing = { bid: '1.50', budget: '100.00', state: 'enabled' };
      const newData = { bid: '2.00', budget: '200.00', state: 'paused' };

      const result = detectConflict(existing, newData, ['state']);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictFields).toEqual(['state']);
    });

    it('should handle missing fields gracefully', () => {
      const existing = { bid: '1.50' };
      const newData = { budget: '100.00' };

      const result = detectConflict(existing, newData, ['bid', 'budget']);

      // existing.budget is undefined (empty), newData.bid is undefined (empty)
      expect(result.hasConflict).toBe(false);
    });
  });
});
