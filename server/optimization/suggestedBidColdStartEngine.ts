/**
 * v500: Suggested Bid Cold Start Engine - Stub
 * 为未完成的冷启动出价引擎提供接口定义
 */
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('ColdStartBid');

export interface ColdStartBidResult {
  bid: number;
  source: string;
  confidence: number;
}

export function isInColdStartPeriod(_keywordId: number, _daysActive: number): boolean {
  return false;
}

export function getColdStartBidOverride(
  _keywordId: number,
  _currentBid: number,
  _suggestedBid: number | null,
  _context?: Record<string, unknown>
): ColdStartBidResult | null {
  return null;
}
