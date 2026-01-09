import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "oauth",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("appRouter", () => {
  describe("auth.me", () => {
    it("returns user when authenticated", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.me();

      expect(result).toBeDefined();
      expect(result?.email).toBe("test@example.com");
      expect(result?.name).toBe("Test User");
    });

    it("returns null when not authenticated", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.me();

      expect(result).toBeNull();
    });
  });

  describe("protected procedures", () => {
    it("adAccount.list throws for unauthenticated user", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.adAccount.list()).rejects.toThrow();
    });

    it("performanceGroup.list throws for unauthenticated user", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.performanceGroup.list({ accountId: 1 })).rejects.toThrow();
    });

    it("campaign.list throws for unauthenticated user", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.campaign.list({ accountId: 1 })).rejects.toThrow();
    });

    it("biddingLog.list throws for unauthenticated user", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.biddingLog.list({ accountId: 1, limit: 10, offset: 0 })).rejects.toThrow();
    });

    it("import.list throws for unauthenticated user", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.import.list()).rejects.toThrow();
    });
  });

  describe("router structure", () => {
    it("has adAccount router", () => {
      expect(appRouter._def.procedures).toHaveProperty("adAccount.list");
      expect(appRouter._def.procedures).toHaveProperty("adAccount.create");
      expect(appRouter._def.procedures).toHaveProperty("adAccount.update");
    });

    it("has performanceGroup router", () => {
      expect(appRouter._def.procedures).toHaveProperty("performanceGroup.list");
      expect(appRouter._def.procedures).toHaveProperty("performanceGroup.create");
      expect(appRouter._def.procedures).toHaveProperty("performanceGroup.update");
    });

    it("has campaign router", () => {
      expect(appRouter._def.procedures).toHaveProperty("campaign.list");
      expect(appRouter._def.procedures).toHaveProperty("campaign.update");
    });

    it("has biddingLog router", () => {
      expect(appRouter._def.procedures).toHaveProperty("biddingLog.list");
    });

    it("has import router", () => {
      expect(appRouter._def.procedures).toHaveProperty("import.list");
      expect(appRouter._def.procedures).toHaveProperty("import.create");
    });

    it("has optimization router", () => {
      expect(appRouter._def.procedures).toHaveProperty("optimization.runOptimization");
    });
  });
});
