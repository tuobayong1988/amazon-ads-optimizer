/**
 * 预发布引擎数据库自动迁移模块
 * 
 * 在系统启动时自动检查并创建预发布引擎所需的所有数据库表。
 * 使用 CREATE TABLE IF NOT EXISTS 确保幂等性，不会影响已有数据。
 * 
 * 包含的表（共17张）：
 * - prelaunch_projects: 项目主表
 * - prelaunch_keywords: M1搜索词库
 * - prelaunch_keyword_clusters: M1关键词聚类
 * - prelaunch_keyword_relations: M1关键词关系
 * - prelaunch_cosmo_triples: M1 COSMO因果链
 * - prelaunch_competitors: M2竞品库
 * - prelaunch_competitor_user_language: M2竞品用户语言库
 * - prelaunch_competitor_scenario_matrix: M2竞品场景矩阵
 * - prelaunch_personas: M3用户画像
 * - prelaunch_copy_versions: M4X文案版本
 * - prelaunch_copy_feedback: M4X文案反馈
 * - prelaunch_qna_seeds: M4X Rufus Q&A种子
 * - prelaunch_visual_briefs: M5视觉框架
 * - prelaunch_video_scripts: M6视频脚本
 * - prelaunch_banner_creatives: M6 Banner创意
 * - prelaunch_ad_frameworks: M7广告框架
 * - prelaunch_ad_deploy_logs: M7部署日志
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('PrelaunchDbMigration');

/**
 * 检查MySQL错误是否为"已存在"类型（表/列已存在），可安全忽略
 */
function isAlreadyExistsError(err: Error): boolean {
  const message = String(err?.message || '');
  // @ts-expect-error - error message access
  const causeMessage = String(err?.cause?.message || err?.cause || '');
  const combined = message + ' ' + causeMessage;
  return combined.includes('Duplicate column') ||
         combined.includes('already exists') ||
         combined.includes('1060') ||
         combined.includes('1050');
}

/**
 * 所有预发布引擎表的 CREATE TABLE IF NOT EXISTS DDL
 */
const PRELAUNCH_TABLES: { name: string; ddl: string }[] = [
  {
    name: 'prelaunch_projects',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_projects (
      id INT NOT NULL AUTO_INCREMENT,
      account_id INT NOT NULL,
      project_name VARCHAR(200) NOT NULL,
      asin VARCHAR(20),
      marketplace VARCHAR(10) DEFAULT 'US',
      category VARCHAR(200),
      seed_keywords JSON,
      status ENUM('draft', 'running', 'completed', 'archived') DEFAULT 'draft',
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_prelaunch_proj_account (account_id),
      INDEX idx_prelaunch_proj_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_keywords',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_keywords (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      keyword VARCHAR(500) NOT NULL,
      search_volume INT,
      search_volume_growth DECIMAL(8,4),
      competitor_density INT,
      avg_price DECIMAL(10,2),
      relevance_layer ENUM('core', 'extended', 'long_tail', 'irrelevant') DEFAULT 'core',
      dimension_type VARCHAR(50),
      scenario_code VARCHAR(10),
      intent_tag VARCHAR(50),
      kvi_score DECIMAL(8,4),
      kvi_volume DECIMAL(8,4),
      kvi_relevance DECIMAL(8,4),
      kvi_opportunity DECIMAL(8,4),
      cluster_id INT,
      dr_am_score DECIMAL(8,4),
      scenario_confidence DECIMAL(8,4),
      data_source VARCHAR(50),
      raw_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plkw_project (project_id),
      INDEX idx_plkw_relevance (relevance_layer),
      INDEX idx_plkw_scenario (scenario_code),
      INDEX idx_plkw_kvi (kvi_score)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_keyword_clusters',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_keyword_clusters (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      cluster_label VARCHAR(200) NOT NULL,
      intent_summary TEXT,
      member_count INT DEFAULT 0,
      avg_kvi DECIMAL(8,4),
      top_scenario VARCHAR(10),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plkc_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_keyword_relations',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_keyword_relations (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      source_keyword_id INT NOT NULL,
      target_keyword_id INT NOT NULL,
      relation_type VARCHAR(50) NOT NULL,
      strength DECIMAL(8,4),
      evidence TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plkr_project (project_id),
      INDEX idx_plkr_source (source_keyword_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_cosmo_triples',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_cosmo_triples (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      cause_node VARCHAR(300) NOT NULL,
      effect_node VARCHAR(300) NOT NULL,
      outcome_node VARCHAR(300),
      relation_label VARCHAR(100),
      confidence DECIMAL(8,4),
      source_keyword_ids JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plct_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_competitors',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_competitors (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      asin VARCHAR(20) NOT NULL,
      title TEXT,
      brand VARCHAR(200),
      price DECIMAL(10,2),
      rating DECIMAL(4,2),
      review_count INT,
      bsr INT,
      trs_score DECIMAL(8,4),
      trs_relevance DECIMAL(8,4),
      trs_brand_power DECIMAL(8,4),
      trs_market_share DECIMAL(8,4),
      trs_breakdown JSON,
      tier ENUM('T1_head', 'T2_waist', 'T3_niche') DEFAULT 'T2_waist',
      competitor_type VARCHAR(50),
      data_source VARCHAR(50),
      raw_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plcomp_project (project_id),
      INDEX idx_plcomp_asin (asin),
      INDEX idx_plcomp_tier (tier)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_competitor_user_language',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_competitor_user_language (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      competitor_id INT NOT NULL,
      phrase_type VARCHAR(50) NOT NULL,
      phrase TEXT NOT NULL,
      sentiment ENUM('positive', 'negative', 'neutral') DEFAULT 'neutral',
      frequency INT DEFAULT 1,
      source_review_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plcul_project (project_id),
      INDEX idx_plcul_competitor (competitor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_competitor_scenario_matrix',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_competitor_scenario_matrix (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      competitor_id INT NOT NULL,
      scenario_code VARCHAR(10) NOT NULL,
      traffic_share DECIMAL(8,4),
      attack_feasibility DECIMAL(8,4),
      suggested_strategy VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plcsm_project (project_id),
      INDEX idx_plcsm_competitor (competitor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_personas',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_personas (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      persona_name VARCHAR(200) NOT NULL,
      demographics JSON,
      psychographics JSON,
      buying_behavior JSON,
      pain_points JSON,
      motivations JSON,
      preferred_channels JSON,
      narrative_profile TEXT,
      confidence DECIMAL(8,4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plpers_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_copy_versions',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_copy_versions (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      generation INT DEFAULT 0,
      copy_type VARCHAR(50) NOT NULL,
      title TEXT,
      bullet_points JSON,
      description TEXT,
      backend_keywords TEXT,
      a_plus JSON,
      fitness_score DECIMAL(8,4),
      parent_id INT,
      mutation_log JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plcv_project (project_id),
      INDEX idx_plcv_generation (generation)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_copy_feedback',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_copy_feedback (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      copy_version_id INT NOT NULL,
      signal_type VARCHAR(50) NOT NULL,
      signal_source VARCHAR(50),
      metric_name VARCHAR(50),
      metric_value DECIMAL(12,6),
      raw_payload JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plcf_project (project_id),
      INDEX idx_plcf_version (copy_version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_qna_seeds',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_qna_seeds (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      source_type VARCHAR(50),
      cosmo_triple_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plqna_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_visual_briefs',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_visual_briefs (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      slot_position INT NOT NULL,
      slot_role VARCHAR(100),
      headline VARCHAR(300),
      visual_description TEXT,
      key_elements JSON,
      color_palette JSON,
      reference_images JSON,
      generated_image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plvb_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_video_scripts',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_video_scripts (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      video_type VARCHAR(50) NOT NULL,
      scenario_code VARCHAR(10),
      script_framework VARCHAR(50),
      hook TEXT,
      body TEXT,
      cta TEXT,
      duration INT,
      storyboard JSON,
      generated_frame_urls JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plvs_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_banner_creatives',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_banner_creatives (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      banner_type VARCHAR(50) NOT NULL,
      headline VARCHAR(300),
      sub_headline VARCHAR(300),
      cta_text VARCHAR(100),
      visual_prompt TEXT,
      generated_image_url TEXT,
      dimensions VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plbc_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_ad_frameworks',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_ad_frameworks (
      id INT NOT NULL AUTO_INCREMENT,
      project_id INT NOT NULL,
      framework_type VARCHAR(50) NOT NULL,
      framework_name VARCHAR(200) NOT NULL,
      campaign_structure JSON,
      total_campaigns INT DEFAULT 0,
      total_ad_groups INT DEFAULT 0,
      total_keywords INT DEFAULT 0,
      total_targets INT DEFAULT 0,
      estimated_daily_budget DECIMAL(10,2),
      ad_framework_status ENUM('draft', 'approved', 'deploying', 'deployed', 'failed') DEFAULT 'draft',
      deployed_at DATETIME,
      deploy_result JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_plaf_project (project_id),
      INDEX idx_plaf_type (framework_type),
      INDEX idx_plaf_status (ad_framework_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'prelaunch_ad_deploy_logs',
    ddl: `CREATE TABLE IF NOT EXISTS prelaunch_ad_deploy_logs (
      id INT NOT NULL AUTO_INCREMENT,
      framework_id INT NOT NULL,
      action VARCHAR(50) NOT NULL,
      entity_type VARCHAR(50),
      entity_name VARCHAR(200),
      amazon_id VARCHAR(100),
      request_payload JSON,
      response_payload JSON,
      log_status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_pladl_framework (framework_id),
      INDEX idx_pladl_status (log_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
];

/**
 * 执行预发布引擎数据库自动迁移
 * 在系统启动时调用，确保所有预发布引擎表存在
 */
export async function runPrelaunchDbMigration(): Promise<{ success: boolean; results: string[] }> {
  const results: string[] = [];

  try {
    const database = await getDb();
    if (!database) {
      log.warn('数据库不可用，跳过预发布引擎表迁移');
      return { success: false, results: ['数据库不可用'] };
    }

    log.info(`开始预发布引擎数据库迁移检查（共 ${PRELAUNCH_TABLES.length} 张表）...`);

    for (const table of PRELAUNCH_TABLES) {
      try {
        await database.execute(sql.raw(table.ddl));
        results.push(`${table.name}: 表已就绪`);
      } catch (err: unknown) {
        // @ts-expect-error - runtime type mismatch
        if (isAlreadyExistsError(err)) {
          results.push(`${table.name}: 表已存在（跳过）`);
        } else {
          results.push(`${table.name}: 创建失败 - ${(err as Error).message}`);
          log.error(`${table.name} 创建失败: ${(err as Error).message}`);
        }
      }
    }

    log.info(`预发布引擎数据库迁移完成: ${results.filter(r => r.includes('已就绪') || r.includes('已存在')).length}/${PRELAUNCH_TABLES.length} 张表就绪`);
    return { success: true, results };

  } catch (error: unknown) {
    log.error(`预发布引擎数据库迁移异常: ${(error as Error).message}`);
    return { success: false, results: [`迁移异常: ${(error as Error).message}`] };
  }
}
