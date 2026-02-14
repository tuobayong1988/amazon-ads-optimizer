import { readFileSync, existsSync } from 'fs';
import { router } from './_core/trpc';

export const readLogRouter = router({
  getSyncLog: router.procedure.query(async () => {
    const logPath = '/tmp/sync-debug.log';
    
    if (!existsSync(logPath)) {
      return {
        success: false,
        error: 'Log file not found',
        path: logPath
      };
    }
    
    try {
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split('\n');
      
      return {
        success: true,
        path: logPath,
        totalLines: lines.length,
        lastLines: lines.slice(-100), // 最后100行
        fullContent: content
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        path: logPath
      };
    }
  })
});
