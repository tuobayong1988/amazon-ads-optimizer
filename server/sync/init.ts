/**
 * Sync 子模块初始化入口 (v417: 统一到sync/目录)
 * 
 * 通过 side-effect import 加载所有 prototype 扩展模块，
 * 将提取的方法注入到 AmazonSyncService.prototype 中。
 * 
 * 必须在应用启动时导入此文件（通常在入口点 _core/index.ts 中）。
 */
import './syncSp';
import './syncSb';
import './syncSd';
import './syncPerformance';
import './syncBidOperations';
import './syncWithTracking';
