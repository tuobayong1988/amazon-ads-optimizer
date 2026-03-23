/**
 * v500: Sync Coordinator - Stub
 * 为未完成的同步协调器提供接口定义
 */
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('SyncCoordinator');

export async function acquireGlobalMutex(_key: string, _ttl?: number): Promise<boolean> {
  return true;
}

export async function releaseGlobalMutex(_key: string): Promise<void> {
  // no-op
}

export async function cleanupExpiredOverrides(): Promise<void> {
  // no-op
}

export function getCoordinatorStatus(): Record<string, unknown> {
  return { status: 'stub', message: 'syncCoordinator not yet implemented' };
}

export function shouldAbortAutoSync(): boolean {
  return false;
}
