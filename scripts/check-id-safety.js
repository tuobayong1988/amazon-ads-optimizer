#!/usr/bin/env node
/**
 * Amazon Ads Optimizer — ID Safety Static Analyzer (v208)
 * 
 * 静态分析脚本：扫描代码中的ID混用模式
 * 
 * 用法：
 *   node scripts/check-id-safety.js
 *   CI/CD严格模式：
 *   node scripts/check-id-safety.js --strict
 * 
 * 检查规则：
 * ID-001: campaigns.id 不应出现在跨表JOIN条件中
 * ID-002: campaign.id 不应传给需要Amazon ID的查询函数
 * ID-003: campaignId: campaign.id 不应出现在INSERT语句中
 * ID-004: 不应有 campaign.campaignId || campaign.id 回退逻辑
 * ID-005: eq条件中campaign.id与varchar字段比较
 * ID-006: 原生SQL中campaign_id = ${campaign.id}
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const violations = [];

// ==================== 规则定义 ====================

const RULES = [
  {
    id: 'ID-001',
    name: 'JOIN条件中使用campaigns.id与campaignId比较',
    severity: 'error',
    patterns: [
      /campaigns\.id\s*,\s*(?:ag|adGroup|adGroups)\.campaignId/,
      /(?:ag|adGroup|adGroups)\.campaignId\s*,\s*campaigns\.id/,
      /eq\s*\(\s*campaigns\.id\s*,\s*(?:ag|adGroup)\.campaignId\s*\)/,
      /eq\s*\(\s*(?:ag|adGroup)\.campaignId\s*,\s*campaigns\.id\s*\)/,
      /c\.id\s*=\s*ag\.campaignId/,
      /ag\.campaignId\s*=\s*c\.id(?!\w)/,
    ],
    message: 'campaigns.id（本地int）不能与adGroups.campaignId（Amazon varchar）比较。应使用campaigns.campaignId',
  },
  {
    id: 'ID-002',
    name: '查询函数传入campaign.id',
    severity: 'error',
    patterns: [
      /getKeywordsByCampaignId\s*\(\s*campaign\.id\b/,
      /getAdGroupsByCampaignId\s*\(\s*campaign\.id\b/,
      /getSearchTermsByCampaignId\s*\(\s*campaign\.id\b/,
    ],
    message: '查询函数需要Amazon campaignId，不能传入campaign.id（本地int）。应使用campaign.campaignId',
  },
  {
    id: 'ID-003',
    name: 'INSERT中campaignId使用本地ID',
    severity: 'error',
    patterns: [
      /campaignId:\s*campaign\.id\b/,
      /campaignId:\s*String\s*\(\s*campaign\.id\s*\)/,
    ],
    message: 'INSERT中campaignId字段应存储Amazon ID（campaign.campaignId），不能存储本地int（campaign.id）',
  },
  {
    id: 'ID-004',
    name: '回退逻辑',
    severity: 'warning',
    patterns: [
      /campaign\.campaignId\s*\|\|\s*campaign\.id/,
      /campaign\.campaignId\s*\?\?\s*campaign\.id/,
    ],
    message: '不应使用回退逻辑。请使用extractCampaignIds()提取双ID',
  },
  {
    id: 'ID-005',
    name: 'eq条件中campaign.id与varchar字段比较',
    severity: 'error',
    patterns: [
      /eq\s*\(\s*(?:dailyPerformance|searchTerms|negativeKeywords|biddingLogs|placementPerformance)\.campaignId\s*,\s*(?:String\s*\(\s*)?campaign\.id/,
    ],
    message: 'varchar类型的campaignId字段不能与campaign.id（本地int）比较',
  },
  {
    id: 'ID-006',
    name: '原生SQL中campaign_id使用本地ID',
    severity: 'error',
    patterns: [
      /campaignId\s*=\s*\$\{campaign\.id\}/,
      /campaign_id\s*=\s*\$\{campaign\.id\}/,
    ],
    message: '原生SQL中campaignId应使用Amazon ID（campaign.campaignId）',
  },
  {
    id: 'ID-007',
    name: 'CAST(campaigns.id AS CHAR) JOIN条件',
    severity: 'error',
    patterns: [
      /CAST\s*\(\s*\$\{campaigns\.id\}\s*AS\s*CHAR\s*\)/,
      /CAST\s*\(\s*campaigns\.id\s*AS\s*CHAR\s*\)/,
    ],
    message: '不应使用CAST(campaigns.id AS CHAR)做JOIN。应使用eq(adGroups.campaignId, campaigns.campaignId)',
  },
  {
    id: 'ID-008',
    name: 'getCampaignById传入Amazon ID',
    severity: 'error',
    patterns: [
      /getCampaignById\s*\(\s*(?:adGroup|ag|ptAdGroup)\.campaignId/,
    ],
    message: 'getCampaignById期望本地int ID，不能传入adGroup.campaignId（Amazon varchar）。应使用getCampaignByAmazonCampaignId',
  },
];

// ==================== 文件扫描 ====================

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(path.join(__dirname, '..'), filePath);
  
  // 跳过ID系统自身文件、测试文件、脚本文件
  if (relPath.includes('idTypes.ts') || 
      relPath.includes('idResolver.ts') || 
      relPath.includes('migrateCampaignIds') ||
      relPath.includes('check-id-safety') ||
      relPath.includes('.test.') ||
      relPath.includes('ID_SYSTEM_AUDIT')) {
    return;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // 跳过注释行
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: lineNum,
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            code: trimmed.substring(0, 120),
          });
          break; // 同一行同一规则只报一次
        }
      }
    }
  }
}

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', '.next', '_archived_v149'].includes(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      scanFile(fullPath);
    }
  }
}

// ==================== 主程序 ====================

console.log('');
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
  console.log('');
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
  console.log('');
}

// --strict 模式下，有错误则退出码为1（用于CI/CD）
if (process.argv.includes('--strict') && errors.length > 0) {
  console.log('❌ 严格模式：存在错误，退出码为1');
  process.exit(1);
}
