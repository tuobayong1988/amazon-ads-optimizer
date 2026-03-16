#!/usr/bin/env node
/**
 * v422: 创建符号链接/wrapper文件，让esbuild CJS bundle中的动态import()可以正确解析
 * 
 * 问题：esbuild CJS格式打包时，动态import()不会被内联，路径保留为原始相对路径。
 * 运行时这些路径相对于dist/index.js解析，但实际源文件在server/目录下。
 * 
 * 解决方案：在项目根目录和dist/目录下创建.ts wrapper文件，
 * 每个wrapper re-export对应的实际源文件。
 * tsx loader会在运行时编译这些.ts文件。
 */
const fs = require('fs');
const path = require('path');

// 动态import路径 -> 实际源文件路径的映射
const IMPORT_MAP = {
  // ../xxx 路径（从dist/index.js解析到项目根目录）
  'algorithmEfficacyService': 'server/algorithm/algorithmEfficacyService',
  'coldStartService': 'server/optimization/coldStartService',
  'contextualFeatureService': 'server/analytics/contextualFeatureService',
  'dataSyncScheduler': 'server/sync/dataSyncScheduler',
  'drizzle/schema': 'drizzle/schema',
  'nextGenBidOrchestrator': 'server/optimization/nextGenBidOrchestrator',
  'optimizationScheduler': 'server/optimization/optimizationScheduler',
  'rlDataRecorder': 'server/algorithm/rlDataRecorder',
  'unifiedSyncEngine': 'server/sync/unifiedSyncEngine',
};

// ./xxx 路径（从dist/index.js解析到dist/目录）
const DIST_IMPORT_MAP = {
  '_core/notification': 'server/_core/notification',
  'abTestService': 'server/analytics/abTestService',
  'algorithmObservabilityService': 'server/algorithm/algorithmObservabilityService',
  'amazonSyncService': 'server/sync/amazonSyncService',
  'auditService': 'server/system/auditService',
  'budgetAutoExecutionService': 'server/budget/budgetAutoExecutionService',
  'coldStartService': 'server/optimization/coldStartService',
  'dataSyncScheduler': 'server/sync/dataSyncScheduler',
  'db': 'server/db',
  'db/syncJobs': 'server/db/syncJobs',
  'deployLifecycleManager': 'server/deployLifecycleManager',
  'multiDimComboAnalyzer': 'server/optimization/multiDimComboAnalyzer',
  'notificationService': 'server/system/notificationService',
  'optimizationAutoCorrector': 'server/optimization/optimizationAutoCorrector',
  'optimizationMonitoringService': 'server/optimization/optimizationMonitoringService',
  'optimizationScheduler': 'server/optimization/optimizationScheduler',
  'optimizationSyncEngine': 'server/sync/optimizationSyncEngine',
  'optimizationTargetEngine': 'server/optimization/optimizationTargetEngine',
  'postDeployOptimizer': 'server/postDeployOptimizer',
  'rlDataRecorder': 'server/algorithm/rlDataRecorder',
  'services/amazonIdResolver': 'server/services/amazonIdResolver',
  'services/auditLogService': 'server/services/auditLogService',
  'services/commandConfirmationService': 'server/services/commandConfirmationService',
  'services/intradayPacingService': 'server/services/intradayPacingService',
  'services/selfHealingScheduler': 'server/services/selfHealingScheduler',
  'services/sync/dataIntegrityChecker': 'server/sync/infrastructure/dataIntegrityChecker',
  'services/sync/sloMonitor': 'server/sync/infrastructure/sloMonitor',
  'services/syncPriorityScheduler': 'server/services/syncPriorityScheduler',
  'shardManager': 'server/sync/shardManager',
  'strategyRecommendationService': 'server/analytics/strategyRecommendationService',
  'utils/systemVersion': 'server/utils/systemVersion',
  'weightAutoTuningService': 'server/algorithm/weightAutoTuningService',
  'algorithmEvolutionEngine': 'server/algorithm/algorithmEvolutionEngine',
  'searchTermHarvester': 'server/optimization/searchTermHarvester',
  'ngramAnalysis': 'server/analytics/ngramAnalysis',
  'sigmoidCurveFitter': 'server/algorithm/sigmoidCurveFitter',
  'abTestIntegration': 'server/analytics/abTestIntegration',
};

const projectRoot = process.cwd();

function createWrapper(targetPath, sourcePath) {
  const fullTarget = path.join(projectRoot, targetPath + '.ts');
  const fullSource = path.join(projectRoot, sourcePath);
  
  // 确保目标目录存在
  const dir = path.dirname(fullTarget);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 如果目标文件已存在（是实际源文件），跳过
  if (fs.existsSync(fullTarget) || fs.existsSync(fullTarget.replace('.ts', '.js'))) {
    return false;
  }
  
  // 计算从wrapper到源文件的相对路径
  const relPath = path.relative(dir, path.dirname(fullSource + '.ts'));
  const baseName = path.basename(sourcePath);
  const importPath = './' + path.join(relPath, baseName).replace(/\\/g, '/');
  
  const content = `// Auto-generated wrapper for dynamic import resolution (v422)\nexport * from '${importPath}';\n`;
  fs.writeFileSync(fullTarget, content);
  return true;
}

let created = 0;

// 创建根目录下的wrapper文件（for ../xxx 路径）
for (const [name, source] of Object.entries(IMPORT_MAP)) {
  if (createWrapper(name, source)) {
    created++;
    console.log(`  Created: ${name}.ts -> ${source}`);
  }
}

// 创建dist/目录下的wrapper文件（for ./xxx 路径）
for (const [name, source] of Object.entries(DIST_IMPORT_MAP)) {
  if (createWrapper('dist/' + name, source)) {
    created++;
    console.log(`  Created: dist/${name}.ts -> ${source}`);
  }
}

console.log(`\n✅ Created ${created} wrapper files for dynamic import resolution`);
