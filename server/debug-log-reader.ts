import { router, publicProcedure } from "./trpc";
import * as fs from 'fs';
import * as z from 'zod';

export const debugLogRouter = router({
  readSyncLog: publicProcedure
    .input(z.object({
      lines: z.number().optional().default(500),
    }))
    .query(async ({ input }) => {
      const logFile = '/tmp/sync-debug.log';
      
      try {
        if (!fs.existsSync(logFile)) {
          return {
            success: false,
            message: '日志文件不存在',
            content: null,
          };
        }
        
        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n');
        const lastLines = lines.slice(-input.lines);
        
        return {
          success: true,
          message: `读取最后 ${lastLines.length} 行`,
          content: lastLines.join('\n'),
          totalLines: lines.length,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          content: null,
        };
      }
    }),
    
  clearSyncLog: publicProcedure.mutation(async () => {
    const logFile = '/tmp/sync-debug.log';
    
    try {
      if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
      }
      return {
        success: true,
        message: '日志文件已清除',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }),
});
