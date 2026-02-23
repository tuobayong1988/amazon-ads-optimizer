#!/usr/bin/env ts-node
/**
 * Amazon Ads Optimizer — ID Safety Static Analyzer (v208)
 * 
 * 静态分析脚本：扫描代码中的ID混用模式
 * 
 * 用法：
 *   npx ts-node scripts/check-id-safety.ts
 *   或在CI/CD中：
 *   npx ts-node scripts/check-id-safety.ts --strict
 * 
 * 检查规则：
 * 1. campaigns.id 不应出现在跨表JOIN条件中
 * 2. campaign.id 不应传给需要Amazon ID的查询函数
 * 3. campaignId: campaign.id 不应出现在INSERT语句中
 * 4. 所有campaign循环应使用 extractCampaignIds()
 * 5. 不应有 campaign.campaignId || campaign.id 回退逻辑
 */

import * as fs from 'fs';
import * as path from 'path';

interface Violation {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

const SERVER_DIR = path.join(__dirname, '..', 'server');
const violations: Violation[] = [];

// ==================== 规则定义 ====================

const RULES = [
  {
    id: 'ID-001',
    name: 'JOIN条件中使用campaigns.id',
    severity: 'error' as const,
    // 匹配 campaigns.id 与 adGroups/ag 的 campaignId 比较
    patterns: [
      /campaigns\.id\s*,\s*(?:ag|adGroup|adGroups)\.campaignId/,
      /(?:ag|adGroup|adGroups)\.campaignId\s*,\s*campaigns\.id/,
      /eq\s*\(\s*campaigns\.id\s*,\s*(?:ag|adGroup)\.campaignId\s*\)/,
      /eq\s*\(\s*(?:ag|adGroup)\.campaignId\s*,\s*campaigns\.id\s*\)/,
      /c\.id\s*=\s*ag\.campaignId/i,
      /ag\.campaignId\s*=\s*c\.id/i,
    ],
    message: 'campaigns.id（本地int）不能与adGroups.campaignId（Amazon varchar）比较。应使用campaigns.campaignId',
  },
  {
    id: 'ID-002',
    name: '查询函数传入campaign.id',
    severity: 'error' as const,
    patterns: [
      /getKeywordsByCampaignId\s*\(\s*campaign\.id\s*\)/,
      /getAdGroupsByCampaignId\s*\(\s*campaign\.id\s*\)/,
      /getDailyPerformanceByDateRange\s*\([^)]*campaign\.id\s*\)/,
      /getSearchTermsByCampaignId\s*\(\s*campaign\.id\s*\)/,
    ],
    message: '查询函数需要Amazon campaignId（varchar），不能传入campaign.id（本地int）。应使用campaign.campaignId',
  },
  {
    id: 'ID-003',
    name: 'INSERT中campaignId使用本地ID',
    severity: 'error' as const,
    patterns: [
      /campaignId:\s*campaign\.id\b(?!\s*,\s*\/\/\s*LOCAL)/,
      /campaignId:\s*String\s*\(\s*campaign\.id\s*\)/,
    ],
    message: 'INSERT语句中campaignId字段应存储Amazon ID（campaign.campaignId），不能存储本地int（campaign.id）',
  },
  {
    id: 'ID-004',
    name: '回退逻辑',
    severity: 'warning' as const,
    patterns: [
      /campaign\.campaignId\s*\|\|\s*campaign\.id/,
      /campaign\.campaignId\s*\?\?\s*campaign\.id/,
    ],
    message: '不应使用回退逻辑。所有campaign对象都应有campaignId字段。请使用extractCampaignIds()提取',
  },
  {
    id: 'ID-005',
    name: 'campaign循环未使用extractCampaignIds',
    severity: 'warning' as const,
    patterns: [
      /for\s*\(\s*const\s+campaign\s+of\s+campaigns\s*\)\s*\{(?![\s\S]{0,200}extractCampaignIds)/,
    ],
    message: 'campaign循环应在入口处调用extractCampaignIds()提取双ID',
  },
  {
    id: 'ID-006',
    name: 'eq条件中campaign.id与varchar字段比较',
    severity: 'error' as const,
    patterns: [
      /eq\s*\(\s*(?:dailyPerformance|searchTerms|negativeKeywords|biddingLogs|placementPerformance)\.campaignId\s*,\s*(?:String\s*\(\s*)?campaign\.id/,
    ],
    message: 'varchar类型的campaignId字段不能与campaign.id（本地int）比较',
  },
];

// ==================== 文件扫描 ====================

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(path.join(__dirname, '..'), filePath);
  
  // 跳过idTypes.ts自身和测试文件
  if (relPath.includes('idTypes.ts') || relPath.includes('idResolver.ts') || relPath.includes('.test.')) {
    return;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // 跳过注释行
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: lineNum,
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            code: line.trim(),
          });
          break; // 同一行同一规则只报一次
        }
      }
    }
  }
}

function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        scanDirectory(fullPath);
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      scanFile(fullPath);
    }
  }
}

// ==================== 主程序 ====================

console.log('🔍 Amazon Ads Optimizer — ID Safety Static Analyzer v208');
console.log('═══════════════════════════════════════════════════════════');
console.log(`扫描目录: ${SERVER_DIR}`);
console.log('');

scanDirectory(SERVER_DIR);

// 输出结果
const errors = violations.filter(v => v.severity === 'error');
const warnings = violations.filter(v => v.severity === 'warning');

if (violations.length === 0) {
  console.log('✅ 未发现ID安全问题！所有代码符合ID规范。');
} else {
  if (errors.length > 0) {
    console.log(`⛔ 发现 ${errors.length} 个错误：`);
    console.log('');
    for (const v of errors) {
      console.log(`  ${v.file}:${v.line} [${v.rule}]`);
      console.log(`    ${v.message}`);
      console.log(`    代码: ${v.code}`);
      console.log('');
    }
  }
  
  if (warnings.length > 0) {
    console.log(`⚠️  发现 ${warnings.length} 个警告：`);
    console.log('');
    for (const v of warnings) {
      console.log(`  ${v.file}:${v.line} [${v.rule}]`);
      console.log(`    ${v.message}`);
      console.log(`    代码: ${v.code}`);
      console.log('');
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`总计: ${errors.length} 错误, ${warnings.length} 警告`);
}

// --strict 模式下，有错误则退出码为1（用于CI/CD）
if (process.argv.includes('--strict') && errors.length > 0) {
  process.exit(1);
}
