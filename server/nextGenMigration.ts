import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('NextGenMigration');
/**
 * NextGen Algorithm Database Migration (v198)
 * 
 * 在服务器启动时自动检查并创建NextGen算法所需的数据库表。
 * 使用 CREATE TABLE IF NOT EXISTS 确保幂等性，不会影响已有数据。
 * 
 * 列名规则（匹配 Drizzle ORM casing: 'camelCase' 配置）：
 * - 没有显式列名的字段：使用 schema 中的驼峰字段名作为数据库列名
 *   例如 accountId: int() → 列名 `accountId`
 * - 有显式列名的字段：使用指定的列名
 *   例如 episodeId: varchar("episode_id", ...) → 列名 `episode_id`
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';

// 先 DROP 旧的可能列名不正确的表（这些表是新创建的，没有业务数据）
const DROP_TABLES = [
  'DROP TABLE IF EXISTS `contextual_features`',
  'DROP TABLE IF EXISTS `rl_training_logs`',
  'DROP TABLE IF EXISTS `linucb_models`',
  'DROP TABLE IF EXISTS `causal_inference_results`',
  'DROP TABLE IF EXISTS `algorithm_selection_logs`',
  'DROP TABLE IF EXISTS `budget_optimization_results`',
  'DROP TABLE IF EXISTS `keyword_semantic_graph`',
];

const NEXTGEN_TABLES = [
  {
    name: 'contextual_features',
    ddl: `CREATE TABLE IF NOT EXISTS \`contextual_features\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`keywordId\` int DEFAULT NULL,
      \`targetId\` int DEFAULT NULL,
      \`campaignId\` varchar(64) DEFAULT NULL,
      \`adGroupId\` int DEFAULT NULL,
      \`snapshot_date\` date NOT NULL,
      \`hour_of_day\` int DEFAULT NULL,
      \`day_of_week\` int DEFAULT NULL,
      \`is_holiday\` tinyint DEFAULT 0,
      \`estimated_competition\` decimal(8,4) DEFAULT NULL,
      \`cpc_volatility_7d\` decimal(8,4) DEFAULT NULL,
      \`ctr_volatility_7d\` decimal(8,4) DEFAULT NULL,
      \`impression_share\` decimal(5,4) DEFAULT NULL,
      \`avg_cpc_7d\` decimal(10,4) DEFAULT NULL,
      \`avg_ctr_7d\` decimal(8,6) DEFAULT NULL,
      \`avg_cvr_7d\` decimal(8,6) DEFAULT NULL,
      \`product_bsr\` int DEFAULT NULL,
      \`product_price\` decimal(10,2) DEFAULT NULL,
      \`product_rating\` decimal(3,2) DEFAULT NULL,
      \`product_review_count\` int DEFAULT NULL,
      \`inventory_level\` int DEFAULT NULL,
      \`impression_trend_7d\` decimal(8,4) DEFAULT NULL,
      \`click_trend_7d\` decimal(8,4) DEFAULT NULL,
      \`order_trend_7d\` decimal(8,4) DEFAULT NULL,
      \`spend_trend_7d\` decimal(8,4) DEFAULT NULL,
      \`weighted_cvr_14d\` decimal(8,6) DEFAULT NULL,
      \`weighted_acos_14d\` decimal(8,4) DEFAULT NULL,
      \`weighted_roas_14d\` decimal(10,4) DEFAULT NULL,
      \`sigmoid_l\` decimal(15,6) DEFAULT NULL,
      \`sigmoid_k\` decimal(15,6) DEFAULT NULL,
      \`sigmoid_x0\` decimal(15,6) DEFAULT NULL,
      \`sigmoid_b\` decimal(15,6) DEFAULT NULL,
      \`curve_fit_r2\` decimal(8,6) DEFAULT NULL,
      \`curve_updated_at\` timestamp NULL DEFAULT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cf_account_date\` (\`accountId\`, \`snapshot_date\`),
      INDEX \`idx_cf_keyword\` (\`keywordId\`),
      INDEX \`idx_cf_target\` (\`targetId\`),
      INDEX \`idx_cf_campaign\` (\`campaignId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'rl_training_logs',
    ddl: `CREATE TABLE IF NOT EXISTS \`rl_training_logs\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`keywordId\` int DEFAULT NULL,
      \`targetId\` int DEFAULT NULL,
      \`campaignId\` varchar(64) DEFAULT NULL,
      \`adGroupId\` int DEFAULT NULL,
      \`episode_id\` varchar(64) DEFAULT NULL,
      \`step_index\` int DEFAULT 0,
      \`state_bid\` decimal(10,4) DEFAULT NULL,
      \`state_impressions\` int DEFAULT NULL,
      \`state_clicks\` int DEFAULT NULL,
      \`state_orders\` int DEFAULT NULL,
      \`state_spend\` decimal(10,2) DEFAULT NULL,
      \`state_sales\` decimal(10,2) DEFAULT NULL,
      \`state_acos\` decimal(8,4) DEFAULT NULL,
      \`state_cvr\` decimal(8,6) DEFAULT NULL,
      \`state_cpc\` decimal(10,4) DEFAULT NULL,
      \`state_competition\` decimal(8,4) DEFAULT NULL,
      \`state_context\` json DEFAULT NULL,
      \`action_type\` enum('bid_increase','bid_decrease','bid_hold','pause','resume') NOT NULL,
      \`action_bid_before\` decimal(10,4) DEFAULT NULL,
      \`action_bid_after\` decimal(10,4) DEFAULT NULL,
      \`action_bid_delta\` decimal(10,4) DEFAULT NULL,
      \`action_source\` enum('rule_based','ucb','linucb','cql','manual') DEFAULT 'rule_based',
      \`reward\` decimal(15,6) DEFAULT NULL,
      \`reward_type\` enum('incremental_profit','roas','acos','revenue') DEFAULT 'incremental_profit',
      \`reward_impressions\` int DEFAULT NULL,
      \`reward_clicks\` int DEFAULT NULL,
      \`reward_orders\` int DEFAULT NULL,
      \`reward_spend\` decimal(10,2) DEFAULT NULL,
      \`reward_sales\` decimal(10,2) DEFAULT NULL,
      \`reward_profit\` decimal(10,2) DEFAULT NULL,
      \`is_terminal\` tinyint DEFAULT 0,
      \`reward_filled_at\` timestamp NULL DEFAULT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rl_account\` (\`accountId\`),
      INDEX \`idx_rl_keyword\` (\`keywordId\`),
      INDEX \`idx_rl_target\` (\`targetId\`),
      INDEX \`idx_rl_episode\` (\`episode_id\`),
      INDEX \`idx_rl_action_source\` (\`action_source\`),
      INDEX \`idx_rl_reward_filled\` (\`reward_filled_at\`),
      INDEX \`idx_rl_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'linucb_models',
    ddl: `CREATE TABLE IF NOT EXISTS \`linucb_models\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`arm_id\` varchar(128) NOT NULL,
      \`arm_type\` enum('bid_aggressive','bid_moderate','bid_conservative','bid_hold','bid_decrease') NOT NULL,
      \`matrix_a\` json NOT NULL,
      \`vector_b\` json NOT NULL,
      \`feature_dim\` int NOT NULL,
      \`alpha\` decimal(8,4) DEFAULT '1.0000',
      \`total_pulls\` int DEFAULT 0,
      \`total_reward\` decimal(15,6) DEFAULT '0',
      \`avg_reward\` decimal(15,6) DEFAULT '0',
      \`last_pulled_at\` timestamp NULL DEFAULT NULL,
      \`model_version\` int DEFAULT 1,
      \`is_active\` tinyint DEFAULT 1,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_linucb_account_arm\` (\`accountId\`, \`arm_id\`),
      INDEX \`idx_linucb_active\` (\`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'causal_inference_results',
    ddl: `CREATE TABLE IF NOT EXISTS \`causal_inference_results\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`keywordId\` int DEFAULT NULL,
      \`targetId\` int DEFAULT NULL,
      \`campaignId\` varchar(64) DEFAULT NULL,
      \`analysis_date\` date NOT NULL,
      \`estimated_ite\` decimal(10,6) DEFAULT NULL,
      \`treatment_cvr\` decimal(8,6) DEFAULT NULL,
      \`control_cvr\` decimal(8,6) DEFAULT NULL,
      \`uplift_score\` decimal(10,6) DEFAULT NULL,
      \`confidence_interval\` decimal(8,4) DEFAULT NULL,
      \`incremental_revenue\` decimal(12,2) DEFAULT NULL,
      \`incremental_cost\` decimal(12,2) DEFAULT NULL,
      \`incremental_profit\` decimal(12,2) DEFAULT NULL,
      \`incremental_roas\` decimal(10,4) DEFAULT NULL,
      \`optimal_bid\` decimal(10,4) DEFAULT NULL,
      \`optimal_bid_lower\` decimal(10,4) DEFAULT NULL,
      \`optimal_bid_upper\` decimal(10,4) DEFAULT NULL,
      \`model_version\` varchar(32) DEFAULT NULL,
      \`sample_size\` int DEFAULT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ci_account_date\` (\`accountId\`, \`analysis_date\`),
      INDEX \`idx_ci_keyword\` (\`keywordId\`),
      INDEX \`idx_ci_target\` (\`targetId\`),
      INDEX \`idx_ci_uplift\` (\`uplift_score\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'algorithm_selection_logs',
    ddl: `CREATE TABLE IF NOT EXISTS \`algorithm_selection_logs\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`keywordId\` int DEFAULT NULL,
      \`targetId\` int DEFAULT NULL,
      \`campaignId\` varchar(64) DEFAULT NULL,
      \`selected_algorithm\` enum('rule_based','ucb','linucb','sigmoid_curve','cql','ensemble') NOT NULL,
      \`algorithm_scores\` json DEFAULT NULL,
      \`selection_reason\` text DEFAULT NULL,
      \`context_features\` json DEFAULT NULL,
      \`executed_bid\` decimal(10,4) DEFAULT NULL,
      \`result_reward\` decimal(15,6) DEFAULT NULL,
      \`result_filled_at\` timestamp NULL DEFAULT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_asl_account\` (\`accountId\`),
      INDEX \`idx_asl_algorithm\` (\`selected_algorithm\`),
      INDEX \`idx_asl_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'budget_optimization_results',
    ddl: `CREATE TABLE IF NOT EXISTS \`budget_optimization_results\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`performanceGroupId\` int DEFAULT NULL,
      \`optimization_date\` date NOT NULL,
      \`total_budget\` decimal(12,2) DEFAULT NULL,
      \`allocations\` json NOT NULL,
      \`expected_total_profit\` decimal(12,2) DEFAULT NULL,
      \`expected_total_roas\` decimal(10,4) DEFAULT NULL,
      \`expected_total_sales\` decimal(12,2) DEFAULT NULL,
      \`actual_total_profit\` decimal(12,2) DEFAULT NULL,
      \`actual_total_roas\` decimal(10,4) DEFAULT NULL,
      \`actual_total_sales\` decimal(12,2) DEFAULT NULL,
      \`algorithm_used\` enum('knapsack','combinatorial_bandit','marginal_utility','rule_based') DEFAULT 'marginal_utility',
      \`iteration_count\` int DEFAULT NULL,
      \`convergence_score\` decimal(8,6) DEFAULT NULL,
      \`result_filled_at\` timestamp NULL DEFAULT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_bor_account_date\` (\`accountId\`, \`optimization_date\`),
      INDEX \`idx_bor_group\` (\`performanceGroupId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  },
  {
    name: 'keyword_semantic_graph',
    ddl: `CREATE TABLE IF NOT EXISTS \`keyword_semantic_graph\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`accountId\` int NOT NULL,
      \`source_node_type\` enum('keyword','search_term','asin') NOT NULL,
      \`source_node_id\` varchar(256) NOT NULL,
      \`target_node_type\` enum('keyword','search_term','asin') NOT NULL,
      \`target_node_id\` varchar(256) NOT NULL,
      \`edge_type\` enum('triggers','semantic_similar','co_purchased','competes_with','converts_to') NOT NULL,
      \`edge_weight\` decimal(8,6) DEFAULT '1.000000',
      \`source_embedding\` json DEFAULT NULL,
      \`target_embedding\` json DEFAULT NULL,
      \`cosine_similarity\` decimal(8,6) DEFAULT NULL,
      \`shared_impressions\` int DEFAULT 0,
      \`shared_clicks\` int DEFAULT 0,
      \`shared_orders\` int DEFAULT 0,
      \`is_opportunity\` tinyint DEFAULT 0,
      \`is_negative_candidate\` tinyint DEFAULT 0,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ksg_account\` (\`accountId\`),
      INDEX \`idx_ksg_source\` (\`source_node_type\`, \`source_node_id\`),
      INDEX \`idx_ksg_target\` (\`target_node_type\`, \`target_node_id\`),
      INDEX \`idx_ksg_edge_type\` (\`edge_type\`),
      INDEX \`idx_ksg_opportunity\` (\`is_opportunity\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  }
];

export async function ensureNextGenTables(): Promise<{ success: boolean; tablesCreated: number; error?: string }> {
  try {
    const db = await getDb();
    if (!db) {
      return { success: false, tablesCreated: 0, error: 'Database not available' };
    }

    // 第一步：DROP 旧的可能列名不正确的表（这些表是新创建的，没有业务数据）
    for (const dropSql of DROP_TABLES) {
      try {
        await db.execute(sql.raw(dropSql));
      } catch (err: any) {
        log.error(`[NextGen Migration] Error dropping table:`, err.message);
      }
    }

    // 第二步：用正确的列名重新创建表
    let tablesCreated = 0;
    for (const table of NEXTGEN_TABLES) {
      try {
        await db.execute(sql.raw(table.ddl));
        tablesCreated++;
        log.info(`[NextGen Migration] Table '${table.name}' ensured successfully`);
      } catch (err: any) {
        log.error(`[NextGen Migration] Error creating table '${table.name}':`, err.message);
      }
    }

    return { success: true, tablesCreated };
  } catch (err: any) {
    return { success: false, tablesCreated: 0, error: err.message };
  }
}
