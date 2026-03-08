/**
 * v360: 数据库连接管理模块
 * 
 * 从db.ts(6338行)中拆分出来的第一个子模块
 * 包含: getDb, getDirectConnection, getPoolStats
 * 
 * 注意: 当前阶段通过代理re-export保持向后兼容
 * 实际函数仍在db.ts中，此文件作为新代码的推荐导入路径
 */

// 代理re-export: 新代码应从此模块导入连接相关函数
export { getDb, getDirectConnection, getPoolStats } from '../db';
