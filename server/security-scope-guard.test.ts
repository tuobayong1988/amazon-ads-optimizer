import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(join(projectRoot, relativePath), 'utf8');

describe('越权风险审计回归：自动优化目标范围隔离', () => {
  it('Amazon API 写回辅助函数必须在预算、版位和出价写回前调用统一目标范围守卫', () => {
    const source = readSource('server/services/amazonApiHelper.ts');

    expect(source).toContain("from './targetScopeGuard'");
    expect(source).toContain('assertTargetEntitiesInScope');

    const assertGuardBeforeApiCall = (functionName: string, apiCallMarker: string) => {
      const start = source.indexOf(`function ${functionName}`);
      expect(start, `${functionName} 应存在`).toBeGreaterThan(-1);
      const nextExport = source.indexOf('\nexport async function ', start + 1);
      const body = source.slice(start, nextExport > -1 ? nextExport : source.length);
      const guardIndex = body.indexOf('assertTargetEntitiesInScope');
      const apiCallIndex = body.indexOf(apiCallMarker);
      expect(guardIndex, `${functionName} 应执行范围守卫`).toBeGreaterThan(-1);
      expect(apiCallIndex, `${functionName} 应包含 API 写回调用`).toBeGreaterThan(-1);
      expect(guardIndex, `${functionName} 的范围守卫必须早于 API 写回调用`).toBeLessThan(apiCallIndex);
    };

    assertGuardBeforeApiCall('syncBidAdjustmentsToAmazon', 'updateKeywordBids');
    assertGuardBeforeApiCall('syncBudgetAdjustmentToAmazon', 'updateSpCampaign');
    assertGuardBeforeApiCall('syncPlacementAdjustmentToAmazon', 'updateSpCampaign');
  });

  it('各自动优化执行器调用写回时必须传入 performanceGroupId 且启用严格目标边界', () => {
    const executorSources = [
      'server/targetEngine/bidOptimizationExecutor.ts',
      'server/targetEngine/budgetExecutor.ts',
      'server/targetEngine/daypartingExecutor.ts',
      'server/targetEngine/placementExecutor.ts',
    ].map(readSource);

    for (const source of executorSources) {
      expect(source).toContain('performanceGroupId: config.performanceGroupId');
      expect(source).toContain('strictPerformanceGroup: true');
    }
  });

  it('智能竞价候选查询必须按 accountId 与 performanceGroupId 双边界过滤关键词和商品定向候选', () => {
    const source = readSource('server/db/searchTerms.ts');

    expect(source).toContain('getBidTargets(accountId: number, performanceGroupId?: number | null)');
    expect(source).toContain('scopedCampaignConditions.push(eq(campaigns.performanceGroupId, performanceGroupId))');
    expect(source).toContain('and(...scopedCampaignConditions, eq(keywords.accountId, accountId))');
    expect(source).toContain('and(...scopedCampaignConditions, eq(productTargets.accountId, accountId))');
  });

  it('统一优化事件双写必须拒绝缺少 accountId、performanceGroupId 或关键 campaignId 的事件', () => {
    const source = readSource('server/db/optimizationEvents.ts');

    expect(source).toContain('EVENT_CATEGORIES_REQUIRING_CAMPAIGN');
    expect(source).toContain('optimization_events缺少必要范围字段');
    expect(source).toContain('optimization_events缺少campaignId');
    expect(source).toContain('performanceGroupId: eventPerformanceGroupId');
    expect(source).toContain('accountId: eventAccountId');
    expect(source).toContain('campaignId: eventCampaignId');
  });
});
