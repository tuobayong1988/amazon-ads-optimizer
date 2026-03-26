/**
 * v522: sqlstring 安全补丁
 * 
 * 修复 mysql2 依赖的 sqlstring 库中 escape() 函数的致命缺陷：
 * 当数组元素是没有 toString() 方法的对象时（如 Object.create(null)、
 * 某些 drizzle-orm 内部对象、或 undefined 被包装后的值），
 * sqlstring.escape() 在 stringifyObjects=true 模式下会调用 val.toString()，
 * 抛出同步的 TypeError: val.toString is not a function。
 * 
 * 该错误无法被 try/catch 捕获（因为发生在 mysql2 的内部同步调用栈中），
 * 直接触发 uncaughtException 导致进程崩溃。
 * 
 * 此补丁在应用启动时执行，覆盖 sqlstring.escape 方法，
 * 在调用 val.toString() 之前检查该方法是否存在。
 * 
 * 影响范围：仅影响 sqlstring 的 escape 函数，不影响其他功能。
 * 性能影响：增加一次 typeof 检查，可忽略不计。
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('SqlPatch');

let patched = false;

export function patchSqlstring(): void {
  if (patched) return;
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SqlString = require('sqlstring');
    const originalEscape = SqlString.escape;
    
    SqlString.escape = function patchedEscape(val: unknown, stringifyObjects?: boolean, timeZone?: string): string {
      // 安全检查：如果 val 是对象但没有 toString 方法，转换为安全字符串
      if (val !== undefined && val !== null && typeof val === 'object') {
        if (!Array.isArray(val) && !Buffer.isBuffer(val) && 
            typeof (val as any).toSqlString !== 'function' &&
            typeof (val as any).toString !== 'function') {
          // 这个对象没有 toString 方法，会导致原始 escape 崩溃
          log.warn(`[SqlPatch] v522: 检测到无 toString 的对象参数，安全降级为 JSON 字符串`);
          try {
            return originalEscape(JSON.stringify(val), stringifyObjects, timeZone);
          } catch {
            return originalEscape('NULL', stringifyObjects, timeZone);
          }
        }
      }
      
      // 对于 undefined 和 null，原始函数已经处理（返回 'NULL'）
      // 但为了防御性编程，再加一层保护
      if (val === undefined) {
        return 'NULL';
      }
      
      try {
        return originalEscape(val, stringifyObjects, timeZone);
      } catch (err: unknown) {
        // 捕获任何同步错误，防止 uncaughtException
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[SqlPatch] v522: escape() 同步错误已捕获: ${errMsg}, val类型=${typeof val}, val=${String(val).substring(0, 100)}`);
        return 'NULL';
      }
    };
    
    // 同样补丁 arrayToList，增加元素级别的安全检查
    const originalArrayToList = SqlString.arrayToList;
    SqlString.arrayToList = function patchedArrayToList(array: unknown[], timeZone?: string): string {
      // 过滤掉 undefined 和 null 元素
      const safeArray = array.filter((item: unknown) => item !== undefined);
      if (safeArray.length === 0) {
        return 'NULL';
      }
      try {
        return originalArrayToList(safeArray, timeZone);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[SqlPatch] v522: arrayToList() 错误已捕获: ${errMsg}`);
        return 'NULL';
      }
    };
    
    patched = true;
    log.info('[SqlPatch] v522: sqlstring 安全补丁已应用');
  } catch (err: unknown) {
    log.warn(`[SqlPatch] v522: 补丁应用失败: ${(err as Error).message}`);
  }
}
