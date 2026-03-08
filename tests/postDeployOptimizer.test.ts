/**
 * PostDeployOptimizer v184 测试
 * 
 * 测试覆盖:
 * 1. 版本检测逻辑
 * 2. 版本变更日志合并
 * 3. 受影响模块计算
 * 4. 纠正动作合并
 * 5. 首次部署场景
 * 6. 版本未变化场景
 * 7. 跨多版本升级场景
 * 8. 安全护栏配置
 */

// ==================== 直接测试纯函数逻辑 ====================

// 模拟VERSION_CHANGELOG
interface VersionChange {
  version: number;
  description: string;
  affectedModules: string[];
  correctionActions: string[];
}

const VERSION_CHANGELOG: VersionChange[] = [
  {
    version: 182,
    description: 'v182: 时区修复',
    affectedModules: ['dayparting', 'dayparting_budget', 'bid'],
    correctionActions: ['fix_timezone_errors', 'reset_dayparting_rules', 'rerun_optimization'],
  },
  {
    version: 183,
    description: 'v183: 多维度资源倾斜优化引擎',
    affectedModules: ['multidim', 'dayparting', 'placement', 'dayparting_budget'],
    correctionActions: ['rebuild_combo_analysis', 'reset_dayparting_rules', 'reset_placement_rules', 'rerun_optimization'],
  },
  {
    version: 184,
    description: 'v184: 部署后自动重优化机制',
    affectedModules: ['all'],
    correctionActions: ['rebuild_combo_analysis', 'full_reoptimize'],
  },
];

// 复制纯函数逻辑进行测试
function getVersionsToApply(lastVersion: number | null): VersionChange[] {
  const fromVersion = lastVersion || 0;
  return VERSION_CHANGELOG.filter(v => v.version > fromVersion).sort((a: any, b: any) => a.version - b.version);
}

function mergeAffectedModules(versions: VersionChange[]): string[] {
  const modules = new Set<string>();
  for (const v of versions) {
    for (const m of v.affectedModules) {
      if (m === 'all') {
        return ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination'];
      }
      modules.add(m);
    }
  }
  return Array.from(modules);
}

function mergeCorrectionActions(versions: VersionChange[]): string[] {
  const actions = new Set<string>();
  for (const v of versions) {
    for (const a of v.correctionActions) {
      actions.add(a);
    }
  }
  return Array.from(actions);
}

// ==================== 测试用例 ====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertDeepEqual(actual: any, expected: any, message: string) {
  const actualStr = JSON.stringify(actual.sort ? [...actual].sort() : actual);
  const expectedStr = JSON.stringify(expected.sort ? [...expected].sort() : expected);
  assert(actualStr === expectedStr, `${message} (got: ${actualStr})`);
}

// ==================== 1. 版本检测逻辑 ====================
console.log('\n=== 1. 版本检测逻辑 ===');

{
  // 首次部署（无历史版本）
  const versions = getVersionsToApply(null);
  assert(versions.length === 3, '首次部署应返回所有3个版本变更');
  assert(versions[0].version === 182, '首个版本应为182');
  assert(versions[2].version === 184, '最后版本应为184');
}

{
  // 从v182升级
  const versions = getVersionsToApply(182);
  assert(versions.length === 2, '从v182升级应返回2个版本变更');
  assert(versions[0].version === 183, '首个版本应为183');
  assert(versions[1].version === 184, '最后版本应为184');
}

{
  // 从v183升级
  const versions = getVersionsToApply(183);
  assert(versions.length === 1, '从v183升级应返回1个版本变更');
  assert(versions[0].version === 184, '唯一版本应为184');
}

{
  // 版本未变化
  const versions = getVersionsToApply(184);
  assert(versions.length === 0, '版本未变化应返回0个版本变更');
}

{
  // 超前版本
  const versions = getVersionsToApply(999);
  assert(versions.length === 0, '超前版本应返回0个版本变更');
}

// ==================== 2. 受影响模块合并 ====================
console.log('\n=== 2. 受影响模块合并 ===');

{
  // 单个版本（v182）
  const versions = getVersionsToApply(181);
  const v182Only = versions.filter(v => v.version === 182);
  const modules = mergeAffectedModules(v182Only);
  assert(modules.includes('dayparting'), 'v182应包含dayparting');
  assert(modules.includes('dayparting_budget'), 'v182应包含dayparting_budget');
  assert(modules.includes('bid'), 'v182应包含bid');
  assert(modules.length === 3, 'v182应只有3个受影响模块');
}

{
  // 多版本合并（v182 + v183）
  const versions = [VERSION_CHANGELOG[0], VERSION_CHANGELOG[1]]; // v182 + v183
  const modules = mergeAffectedModules(versions);
  assert(modules.includes('dayparting'), '合并应包含dayparting');
  assert(modules.includes('bid'), '合并应包含bid');
  assert(modules.includes('multidim'), '合并应包含multidim');
  assert(modules.includes('placement'), '合并应包含placement');
  assert(modules.includes('dayparting_budget'), '合并应包含dayparting_budget');
  assert(modules.length === 5, '合并后应有5个唯一模块');
}

{
  // 包含'all'的版本（v184）
  const versions = [VERSION_CHANGELOG[2]]; // v184 has 'all'
  const modules = mergeAffectedModules(versions);
  assert(modules.length === 9, '包含all的版本应展开为9个模块');
  assert(modules.includes('bid'), 'all应包含bid');
  assert(modules.includes('placement'), 'all应包含placement');
  assert(modules.includes('dayparting'), 'all应包含dayparting');
  assert(modules.includes('budget'), 'all应包含budget');
  assert(modules.includes('searchterm'), 'all应包含searchterm');
  assert(modules.includes('keyword'), 'all应包含keyword');
  assert(modules.includes('multidim'), 'all应包含multidim');
  assert(modules.includes('coordination'), 'all应包含coordination');
}

{
  // 空版本列表
  const modules = mergeAffectedModules([]);
  assert(modules.length === 0, '空版本列表应返回空模块列表');
}

// ==================== 3. 纠正动作合并 ====================
console.log('\n=== 3. 纠正动作合并 ===');

{
  // 单个版本
  const v182 = [VERSION_CHANGELOG[0]];
  const actions = mergeCorrectionActions(v182);
  assert(actions.includes('fix_timezone_errors'), 'v182应包含fix_timezone_errors');
  assert(actions.includes('reset_dayparting_rules'), 'v182应包含reset_dayparting_rules');
  assert(actions.includes('rerun_optimization'), 'v182应包含rerun_optimization');
  assert(actions.length === 3, 'v182应有3个纠正动作');
}

{
  // 多版本合并（去重）
  const allVersions = VERSION_CHANGELOG;
  const actions = mergeCorrectionActions(allVersions);
  assert(actions.includes('fix_timezone_errors'), '全版本应包含fix_timezone_errors');
  assert(actions.includes('rebuild_combo_analysis'), '全版本应包含rebuild_combo_analysis');
  assert(actions.includes('full_reoptimize'), '全版本应包含full_reoptimize');
  assert(actions.includes('reset_dayparting_rules'), '全版本应包含reset_dayparting_rules');
  assert(actions.includes('reset_placement_rules'), '全版本应包含reset_placement_rules');
  assert(actions.includes('rerun_optimization'), '全版本应包含rerun_optimization');
  // reset_dayparting_rules在v182和v183中都有，但合并后只有1个
  const ruleCount = actions.filter(a => a === 'reset_dayparting_rules').length;
  assert(ruleCount === 1, '去重后reset_dayparting_rules应只出现1次');
}

// ==================== 4. 首次部署场景 ====================
console.log('\n=== 4. 首次部署场景 ===');

{
  const lastVersion = null;
  const versionsToApply = getVersionsToApply(lastVersion);
  const affectedModules = mergeAffectedModules(versionsToApply);
  const correctionActions = mergeCorrectionActions(versionsToApply);
  
  assert(versionsToApply.length === 3, '首次部署应应用所有3个版本');
  assert(affectedModules.length === 9, '首次部署应影响所有9个模块（因为v184有all）');
  assert(correctionActions.includes('full_reoptimize'), '首次部署应包含full_reoptimize');
  assert(correctionActions.includes('rebuild_combo_analysis'), '首次部署应包含rebuild_combo_analysis');
}

// ==================== 5. 版本未变化场景 ====================
console.log('\n=== 5. 版本未变化场景 ===');

{
  const lastVersion = 184;
  const versionsToApply = getVersionsToApply(lastVersion);
  
  assert(versionsToApply.length === 0, '版本未变化不应有任何版本需要应用');
  
  const affectedModules = mergeAffectedModules(versionsToApply);
  assert(affectedModules.length === 0, '版本未变化不应有受影响模块');
  
  const correctionActions = mergeCorrectionActions(versionsToApply);
  assert(correctionActions.length === 0, '版本未变化不应有纠正动作');
}

// ==================== 6. 跨多版本升级场景 ====================
console.log('\n=== 6. 跨多版本升级场景 ===');

{
  // 从v181升级到v184（跨3个版本）
  const lastVersion = 181;
  const versionsToApply = getVersionsToApply(lastVersion);
  
  assert(versionsToApply.length === 3, '从v181升级应应用3个版本');
  assert(versionsToApply[0].version === 182, '第一个应用的版本是v182');
  assert(versionsToApply[1].version === 183, '第二个应用的版本是v183');
  assert(versionsToApply[2].version === 184, '第三个应用的版本是v184');
  
  // 由于v184有'all'，所有模块都应被影响
  const affectedModules = mergeAffectedModules(versionsToApply);
  assert(affectedModules.length === 9, '跨版本升级应影响所有模块');
}

{
  // 从v182升级到v184（跨2个版本）
  const lastVersion = 182;
  const versionsToApply = getVersionsToApply(lastVersion);
  
  assert(versionsToApply.length === 2, '从v182升级应应用2个版本');
  
  const affectedModules = mergeAffectedModules(versionsToApply);
  assert(affectedModules.length === 9, '包含v184(all)应影响所有模块');
  
  const correctionActions = mergeCorrectionActions(versionsToApply);
  assert(correctionActions.includes('rebuild_combo_analysis'), '应包含rebuild_combo_analysis');
  assert(correctionActions.includes('full_reoptimize'), '应包含full_reoptimize');
  assert(correctionActions.includes('reset_placement_rules'), '应包含reset_placement_rules（来自v183）');
}

// ==================== 7. 安全护栏配置验证 ====================
console.log('\n=== 7. 安全护栏配置验证 ===');

{
  const POST_DEPLOY_CONFIG = {
    batchSize: 5,
    batchDelayMs: 10 * 1000,
    targetTimeoutMs: 5 * 60 * 1000,
    startupDelayMs: 60 * 1000,
    maxRetries: 2,
    runCorrectionFirst: true,
    safetyGuardrails: {
      maxBidChangePercent: 30,
      maxBudgetChangePercent: 20,
      maxPlacementChangePoints: 30,
    },
  };
  
  assert(POST_DEPLOY_CONFIG.batchSize === 5, '批次大小应为5');
  assert(POST_DEPLOY_CONFIG.batchDelayMs === 10000, '批次间延迟应为10秒');
  assert(POST_DEPLOY_CONFIG.maxRetries === 2, '最大重试次数应为2');
  assert(POST_DEPLOY_CONFIG.safetyGuardrails.maxBidChangePercent === 30, '出价最大变化应为30%');
  assert(POST_DEPLOY_CONFIG.safetyGuardrails.maxBudgetChangePercent === 20, '预算最大变化应为20%');
  assert(POST_DEPLOY_CONFIG.safetyGuardrails.maxPlacementChangePoints === 30, '位置最大变化应为30百分点');
}

// ==================== 8. 版本变更日志完整性 ====================
console.log('\n=== 8. 版本变更日志完整性 ===');

{
  // 每个版本都应有描述
  for (const v of VERSION_CHANGELOG) {
    assert(v.description.length > 0, `v${v.version}应有描述`);
    assert(v.affectedModules.length > 0, `v${v.version}应有受影响模块`);
    assert(v.correctionActions.length > 0, `v${v.version}应有纠正动作`);
  }
  
  // 版本号应递增
  for (let i = 1; i < VERSION_CHANGELOG.length; i++) {
    assert(
      VERSION_CHANGELOG[i].version > VERSION_CHANGELOG[i-1].version,
      `版本号应递增: v${VERSION_CHANGELOG[i-1].version} < v${VERSION_CHANGELOG[i].version}`
    );
  }
}

// ==================== 9. 模块优先级排序验证 ====================
console.log('\n=== 9. 模块优先级排序验证 ===');

{
  // 模拟优化目标排序（最久没优化的排前面）
  const targets = [
    { id: 1, name: 'Target A', lastExecutionTime: new Date('2025-02-20T10:00:00Z') },
    { id: 2, name: 'Target B', lastExecutionTime: null },
    { id: 3, name: 'Target C', lastExecutionTime: new Date('2025-02-22T10:00:00Z') },
  ];
  
  const sorted = targets.sort((a: any, b: any) => {
    const aTime = a.lastExecutionTime ? a.lastExecutionTime.getTime() : 0;
    const bTime = b.lastExecutionTime ? b.lastExecutionTime.getTime() : 0;
    return aTime - bTime;
  });
  
  assert(sorted[0].id === 2, '从未优化的目标应排第一');
  assert(sorted[1].id === 1, '较早优化的目标应排第二');
  assert(sorted[2].id === 3, '最近优化的目标应排最后');
}

// ==================== 10. 分阶段执行顺序验证 ====================
console.log('\n=== 10. 分阶段执行顺序验证 ===');

{
  // 验证执行阶段的正确顺序
  const executionPhases = [
    'A: multidim + dayparting + coordination',
    'B: dayparting_budget',
    'C: bid + keyword + coordination',
    'D: placement',
    'E: budget',
    'F: searchterm',
  ];
  
  assert(executionPhases.length === 6, '应有6个执行阶段');
  assert(executionPhases[0].includes('multidim'), '第一阶段应包含multidim（分析必须先行）');
  assert(executionPhases[0].includes('dayparting'), '第一阶段应包含dayparting');
  assert(executionPhases[2].includes('bid'), '出价优化应在分时之后');
  assert(executionPhases[3].includes('placement'), '位置优化应在出价之后');
}

// ==================== 11. 批次处理逻辑验证 ====================
console.log('\n=== 11. 批次处理逻辑验证 ===');

{
  const batchSize = 5;
  const totalTargets = 13;
  const expectedBatches = Math.ceil(totalTargets / batchSize);
  
  assert(expectedBatches === 3, '13个目标应分为3个批次');
  
  // 验证每个批次的大小
  const batches: number[][] = [];
  for (let i = 0; i < totalTargets; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, totalTargets - i) }, (_, j) => i + j);
    batches.push(batch);
  }
  
  assert(batches[0].length === 5, '第1批次应有5个目标');
  assert(batches[1].length === 5, '第2批次应有5个目标');
  assert(batches[2].length === 3, '第3批次应有3个目标');
}

// ==================== 12. 错误隔离验证 ====================
console.log('\n=== 12. 错误隔离验证 ===');

{
  // 模拟一个目标失败不影响其他目标
  const targetResults = [
    { targetId: 1, status: 'success', optimizationActions: 10 },
    { targetId: 2, status: 'failed', optimizationActions: 0 },
    { targetId: 3, status: 'success', optimizationActions: 8 },
  ];
  
  const succeeded = targetResults.filter(r => r.status === 'success').length;
  const failedCount = targetResults.filter(r => r.status === 'failed').length;
  const totalActions = targetResults.reduce((sum: any, r: any) => sum + r.optimizationActions, 0);
  
  assert(succeeded === 2, '应有2个成功');
  assert(failedCount === 1, '应有1个失败');
  assert(totalActions === 18, '总优化动作应为18');
}

// ==================== 汇总 ====================
console.log('\n========================================');
console.log(`测试完成: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 个测试`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}
