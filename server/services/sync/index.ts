/**
 * Amazon Sync Service 子模块入口 (v223)
 * 
 * 将 amazonSyncService.ts 中的独立功能拆分到子模块：
 * - syncHelpers: 辅助函数（冲突检测、保护查询等）
 * - syncWithTracking: 带变更跟踪的同步方法（prototype扩展）
 * - autoBidOptimization: 自动出价优化逻辑
 */

// 导出辅助函数
export {
  SYNC_PROTECTION_CONFIG,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
  detectConflict,
} from '../../sync/syncHelpers';

// 导出自动出价优化
export { runAutoBidOptimization } from '../../sync/autoBidOptimization';

// 导入 syncWithTracking 以注册 prototype 方法
import '../../sync/syncWithTracking';
