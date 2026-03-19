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
    // v447: 给整个authenticateRequest加上10秒总超时，防止连接池耗尽时导致tRPC无限hang
    const authTimeout = new Promise<null>((resolve) => 
      setTimeout(() => {
        logSystem('Context', `authenticateRequest TIMEOUT after 10s for url=${url.substring(0,50)}`);
        console.error('[Context] authenticateRequest timeout after 10s, falling back to null user');
        resolve(null);
      }, 10000)
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
