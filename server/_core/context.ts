import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "../../drizzle/schema";

type User = InferSelectModel<typeof users>;
import { sdk } from "./sdk";
import { logSystem } from '../utils/opsLogger';

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  const url = opts.req.url || '';
  const hasAuth = !!opts.req.headers.authorization;
  logSystem('Context', `createContext called: url=${url.substring(0,80)}, hasAuth=${hasAuth}`);

  try {
    // v683: 认证超时从10秒延长到30秒（基于v682诊断报告）
    // 原因：系统高负载时（如全量同步期间），数据库连接池可能繁忙，10秒超时导致前端误报"同步超时"
    // 30秒足够覆盖数据库连接池恢复时间，同时不会让用户等待过久
    const AUTH_TIMEOUT_MS = 30000;
    const authTimeout = new Promise<null>((resolve) => 
      setTimeout(() => {
        logSystem('Context', `authenticateRequest TIMEOUT after ${AUTH_TIMEOUT_MS / 1000}s for url=${url.substring(0,50)}`);
        console.error(`[Context] authenticateRequest timeout after ${AUTH_TIMEOUT_MS / 1000}s, falling back to null user`);
        resolve(null);
      }, AUTH_TIMEOUT_MS)
    );
    user = await Promise.race([
      sdk.authenticateRequest(opts.req),
      authTimeout
    ]);
    logSystem('Context', `authenticateRequest result: hasUser=${!!user}, userId=${(user as any)?.id}`);
  } catch (error) {
    // Authentication is optional for public procedures.
    logSystem('Context', `authenticateRequest ERROR: ${(error as Error).message?.substring(0,100)}`);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
