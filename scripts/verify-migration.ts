/**
 * 数据库迁移验证脚本
 * 
 * 验证数据库迁移是否成功执行,并检查数据完整性
 */

import { db } from "../server/db";

async function verifyMigration() {
  console.log("开始验证数据库迁移...\n");

  try {
    // 1. 检查新表是否存在
    console.log("1. 检查新表是否存在...");
    const newTables = [
      'organizations',
      'organization_members',
      'subscriptions',
      'api_keys',
      'usage_logs',
      'ml_models',
      'ab_experiments',
      'ab_experiment_groups',
    ];

    for (const table of newTables) {
      try {
        const result = await db.execute(`SHOW TABLES LIKE '${table}'`);
        if (result.rows.length > 0) {
          console.log(`   ✅ ${table} 表存在`);
        } else {
          console.log(`   ❌ ${table} 表不存在`);
        }
      } catch (error) {
        console.log(`   ❌ ${table} 表检查失败: ${error.message}`);
      }
    }

    // 2. 检查现有表是否添加了organizationId字段
    console.log("\n2. 检查现有表的organizationId字段...");
    const existingTables = [
      'campaigns',
      'ad_groups',
      'keywords',
      'performance_groups',
    ];

    for (const table of existingTables) {
      try {
        const result = await db.execute(`SHOW COLUMNS FROM ${table} LIKE 'organizationId'`);
        if (result.rows.length > 0) {
          console.log(`   ✅ ${table}.organizationId 字段存在`);
        } else {
          console.log(`   ⚠️  ${table}.organizationId 字段不存在`);
        }
      } catch (error) {
        console.log(`   ❌ ${table} 表检查失败: ${error.message}`);
      }
    }

    // 3. 检查默认组织是否创建
    console.log("\n3. 检查默认组织...");
    try {
      const orgs = await db.execute("SELECT * FROM organizations LIMIT 1");
      if (orgs.rows.length > 0) {
        console.log(`   ✅ 默认组织已创建: ${orgs.rows[0].name}`);
      } else {
        console.log(`   ⚠️  未找到默认组织`);
      }
    } catch (error) {
      console.log(`   ❌ 组织查询失败: ${error.message}`);
    }

    // 4. 检查数据完整性
    console.log("\n4. 检查数据完整性...");
    try {
      // 检查是否有未关联组织的数据
      const orphanCampaigns = await db.execute(
        "SELECT COUNT(*) as count FROM campaigns WHERE organizationId IS NULL"
      );
      const orphanCount = orphanCampaigns.rows[0].count;
      if (orphanCount > 0) {
        console.log(`   ⚠️  发现 ${orphanCount} 个未关联组织的广告活动`);
      } else {
        console.log(`   ✅ 所有广告活动已关联组织`);
      }
    } catch (error) {
      console.log(`   ❌ 数据完整性检查失败: ${error.message}`);
    }

    // 5. 检查索引是否创建
    console.log("\n5. 检查索引...");
    try {
      const indexes = await db.execute(
        "SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME LIKE '%organization%'"
      );
      if (indexes.rows.length > 0) {
        console.log(`   ✅ 找到 ${indexes.rows.length} 个组织相关索引`);
        indexes.rows.forEach((row: any) => {
          console.log(`      - ${row.TABLE_NAME}.${row.INDEX_NAME}`);
        });
      } else {
        console.log(`   ⚠️  未找到组织相关索引`);
      }
    } catch (error) {
      console.log(`   ❌ 索引检查失败: ${error.message}`);
    }

    console.log("\n✅ 数据库迁移验证完成!");

  } catch (error) {
    console.error("\n❌ 验证过程出错:", error);
    process.exit(1);
  }
}

// 执行验证
verifyMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("验证失败:", error);
    process.exit(1);
  });
