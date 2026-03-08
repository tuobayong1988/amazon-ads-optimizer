/**
 * v358: 统一同步结果类型定义
 * 
 * 解决"返回0代替抛错"的静默失败问题。
 * 所有sync函数必须返回SyncResult，强制区分：
 * - "成功获取了0条数据" (success=true, synced=0)
 * - "因错误而获取0条数据" (success=false, synced=0, error='...')
 * 
 * 这是高可靠改造方案Phase A的核心组件。
 */

/**
 * 单次同步操作的结果
 */
export interface SyncResult {
  /** 同步是否成功完成（无错误） */
  success: boolean;
  /** 成功同步的记录数 */
  synced: number;
  /** 如果失败，错误信息 */
  error?: string;
  /** 人类可读的结果描述 */
  message: string;
}

/**
 * 批处理同步的结果（包含部分成功信息）
 */
export interface BatchSyncResult extends SyncResult {
  /** 总批次数 */
  totalBatches: number;
  /** 成功的批次数 */
  successfulBatches: number;
  /** 失败的批次数 */
  failedBatches: number;
  /** 失败批次的详细信息 */
  failedBatchDetails: FailedBatchDetail[];
}

/**
 * 失败批次的详细信息，用于后续重试
 */
export interface FailedBatchDetail {
  /** 批次的起始日期 */
  startDate: string;
  /** 批次的结束日期 */
  endDate: string;
  /** 报告类型 */
  reportType?: string;
  /** 失败原因 */
  error: string;
  /** 已重试次数 */
  attempts: number;
}

/**
 * 同步步骤的结果（用于syncAll的步骤级追踪）
 */
export interface SyncStepResult {
  /** 步骤名称 */
  stepName: string;
  /** 步骤是否成功 */
  success: boolean;
  /** 同步的记录数 */
  synced: number;
  /** 错误信息 */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/**
 * 整体同步运行的结果
 */
export interface SyncRunResult {
  /** 整体是否成功（所有步骤都成功） */
  success: boolean;
  /** 完成的步骤数 */
  completedSteps: number;
  /** 失败的步骤数 */
  failedSteps: number;
  /** 总同步记录数 */
  totalSynced: number;
  /** 各步骤的详细结果 */
  stepResults: SyncStepResult[];
  /** 总耗时（毫秒） */
  totalDurationMs: number;
  /** 错误摘要 */
  errorSummary?: string;
}

/**
 * 创建成功的SyncResult
 */
export function createSuccessResult(synced: number, message?: string): SyncResult {
  return {
    success: true,
    synced,
    message: message || `成功同步 ${synced} 条记录`,
  };
}

/**
 * 创建失败的SyncResult
 */
export function createFailureResult(error: string, synced: number = 0): SyncResult {
  return {
    success: false,
    synced,
    error,
    message: `同步失败: ${error}`,
  };
}

/**
 * 创建"无数据库连接"的SyncResult
 */
export function createNoDbResult(): SyncResult {
  return {
    success: false,
    synced: 0,
    error: 'DATABASE_UNAVAILABLE',
    message: '数据库连接不可用',
  };
}

/**
 * 创建批处理的SyncResult
 */
export function createBatchResult(
  totalBatches: number,
  successfulBatches: number,
  totalSynced: number,
  failedBatchDetails: FailedBatchDetail[] = []
): BatchSyncResult {
  const failedBatches = totalBatches - successfulBatches;
  return {
    success: failedBatches === 0,
    synced: totalSynced,
    totalBatches,
    successfulBatches,
    failedBatches,
    failedBatchDetails,
    message: failedBatches === 0
      ? `全部 ${totalBatches} 个批次同步成功，共 ${totalSynced} 条记录`
      : `${successfulBatches}/${totalBatches} 个批次成功，${failedBatches} 个批次失败，共 ${totalSynced} 条记录`,
  };
}
