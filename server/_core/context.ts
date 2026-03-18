import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "../../drizzle/schema";

type User = InferSelectModel<typeof users>;
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // v447: 给整个authenticateRequest加上10秒总超时，防止连接池耗尽时导致tRPC无限hang
    const authTimeout = new Promise<null>((resolve) => 
      setTimeout(() => {
        console.error('[Context] authenticateRequest timeout after 10s, falling back to null user');
        resolve(null);
      }, 10000)
    );
    user = await Promise.race([
      sdk.authenticateRequest(opts.req),
      authTimeout
    ]);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
