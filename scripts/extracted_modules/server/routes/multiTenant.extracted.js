// Extracted from production dist/index.js
// Original module: server/routes/multiTenant.ts
// Lines: 430

async function getUsageStatistics(organizationId, startDate, endDate) {
  return {
    totalApiCalls: 15e3,
    activeCampaigns: 75,
    activeUsers: 5,
    totalSpend: 25e3,
    period: {
      start: startDate || (/* @__PURE__ */ new Date()).toISOString(),
      end: endDate || (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
async function getOrganizationMembers(organizationId) {
  return [
    {
      id: 1,
      userId: 1,
      name: "John Doe",
      email: "john@example.com",
      role: "owner",
      joinedAt: "2024-01-01T00:00:00Z"
    }
  ];
}
async function createInvitation(data) {
  return {
    id: 1,
    ...data,
    token: "invite_token_123",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString()
  };
}
async function sendInvitationEmail(invitation) {
  log192.info("Sending invitation email to:", invitation.email);
}
async function updateMemberRole(organizationId, memberId, role) {
}
async function removeMember(organizationId, memberId) {
}
async function getSubscriptionPlans() {
  return [
    {
      id: 1,
      name: "Free",
      slug: "free",
      priceMonthly: 0,
      priceYearly: 0,
      maxUsers: 1,
      maxAdAccounts: 1,
      maxCampaigns: 10,
      features: {}
    },
    {
      id: 2,
      name: "Starter",
      slug: "starter",
      priceMonthly: 29,
      priceYearly: 290,
      maxUsers: 3,
      maxAdAccounts: 3,
      maxCampaigns: 50,
      features: {}
    },
    {
      id: 3,
      name: "Professional",
      slug: "professional",
      priceMonthly: 99,
      priceYearly: 990,
      maxUsers: 10,
      maxAdAccounts: 10,
      maxCampaigns: 200,
      features: {
        ml_optimization: true,
        smart_campaign: true
      }
    }
    // @ts-ignore
  ];
}
async function getSubscriptionPlanBySlug(slug) {
  const plans = await getSubscriptionPlans();
  return plans.find((p) => p.slug === slug);
}
async function createPaymentSession(data) {
  return {
    id: "session_123",
    url: "https://checkout.stripe.com/pay/session_123"
  };
}
async function getBillingHistory(organizationId) {
  return [
    {
      id: 1,
      date: "2024-01-01",
      amount: 99,
      status: "paid",
      invoiceUrl: "https://example.com/invoice/1"
    }
  ];
}
async function getApiKeys(organizationId) {
  return [
    {
      id: 1,
      name: "Production API Key",
      keyPrefix: "sk_prod_",
      createdAt: "2024-01-01T00:00:00Z",
      lastUsedAt: "2024-01-15T10:30:00Z"
    }
  ];
}
async function createApiKey(data) {
  return {
    id: 1,
    ...data,
    key: "sk_prod_1234567890abcdef",
    keyPrefix: "sk_prod_",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function revokeApiKey(organizationId, keyId) {
}
var log192, multiTenantRouter;
var init_multiTenant = __esm({
  "server/routes/multiTenant.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_tenantMiddleware();
    init_logger();
    log192 = createModuleLogger("Route_multiTenant");
    multiTenantRouter = router({
      /**
       * 获取当前组织信息
       */
      getOrganization: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).query(async ({ ctx }) => {
        const tenantCtx = ctx;
        return {
          organization: tenantCtx.organization,
          userRole: tenantCtx.userRole
        };
      }),
      /**
       * 获取使用统计
       */
      getUsageStats: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          startDate: external_exports.string().optional(),
          endDate: external_exports.string().optional()
        })
      ).query(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, organization } = tenantCtx;
        const stats4 = await getUsageStatistics(
          organizationId,
          input.startDate,
          input.endDate
        );
        const quotaUsage = {
          apiCalls: {
            used: stats4.totalApiCalls,
            limit: organization.maxApiCallsPerDay,
            percentage: stats4.totalApiCalls / organization.maxApiCallsPerDay * 100
          },
          campaigns: {
            used: stats4.activeCampaigns,
            limit: organization.maxCampaigns,
            percentage: stats4.activeCampaigns / organization.maxCampaigns * 100
          },
          users: {
            used: stats4.activeUsers,
            limit: organization.maxUsers,
            percentage: stats4.activeUsers / organization.maxUsers * 100
          }
        };
        return {
          stats: stats4,
          quotaUsage
        };
      }),
      /**
       * 获取组织成员列表
       */
      getMembers: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).query(async ({ ctx }) => {
        const tenantCtx = ctx;
        const { organizationId } = tenantCtx;
        const members = await getOrganizationMembers(organizationId);
        return members;
      }),
      /**
       * 邀请新成员
       */
      inviteMember: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          email: external_exports.string().email(),
          role: external_exports.enum(["admin", "member", "viewer"])
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, organization, userRole } = tenantCtx;
        if (userRole !== "owner" && userRole !== "admin") {
          throw new Error("Only owners and admins can invite members");
        }
        const currentMembers = await getOrganizationMembers(organizationId);
        if (currentMembers.length >= organization.maxUsers) {
          throw new Error(
            `User limit reached (${organization.maxUsers}). Please upgrade your plan.`
          );
        }
        const invitation = await createInvitation({
          organizationId,
          email: input.email,
          role: input.role,
          invitedBy: ctx.user.id
        });
        await sendInvitationEmail(invitation);
        return {
          success: true,
          invitation
        };
      }),
      /**
       * 更新成员角色
       */
      updateMemberRole: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          memberId: external_exports.number(),
          role: external_exports.enum(["admin", "member", "viewer"])
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole } = tenantCtx;
        if (userRole !== "owner") {
          throw new Error("Only organization owners can change member roles");
        }
        await updateMemberRole(organizationId, input.memberId, input.role);
        return { success: true };
      }),
      /**
       * 移除成员
       */
      removeMember: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          memberId: external_exports.number()
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole } = tenantCtx;
        if (userRole !== "owner" && userRole !== "admin") {
          throw new Error("Only owners and admins can remove members");
        }
        await removeMember(organizationId, input.memberId);
        return { success: true };
      }),
      /**
       * 获取可用订阅计划
       */
      getSubscriptionPlans: publicProcedure.query(async () => {
        const plans = await getSubscriptionPlans();
        return plans;
      }),
      /**
       * 更新订阅计划
       */
      updateSubscription: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          planSlug: external_exports.string(),
          billingCycle: external_exports.enum(["monthly", "yearly"])
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole } = tenantCtx;
        if (userRole !== "owner") {
          throw new Error("Only organization owners can change subscription");
        }
        const plan = await getSubscriptionPlanBySlug(input.planSlug);
        if (!plan) {
          throw new Error("Invalid subscription plan");
        }
        const paymentSession = await createPaymentSession({
          organizationId,
          planId: plan.id,
          billingCycle: input.billingCycle
        });
        return {
          success: true,
          paymentUrl: paymentSession.url
        };
      }),
      /**
       * 获取计费历史
       */
      getBillingHistory: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).query(async ({ ctx }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole } = tenantCtx;
        if (userRole !== "owner" && userRole !== "admin") {
          throw new Error("Insufficient permissions");
        }
        const history = await getBillingHistory(organizationId);
        return history;
      }),
      /**
       * 获取API密钥
       */
      getApiKeys: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).query(async ({ ctx }) => {
        const tenantCtx = ctx;
        const { organizationId } = tenantCtx;
        const apiKeys = await getApiKeys(organizationId);
        return apiKeys;
      }),
      /**
       * 创建API密钥
       */
      createApiKey: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          name: external_exports.string(),
          permissions: external_exports.array(external_exports.string()).optional()
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole, organization } = tenantCtx;
        if (userRole !== "owner" && userRole !== "admin") {
          throw new Error("Only owners and admins can create API keys");
        }
        if (!organization.features.api_access) {
          throw new Error("API access is not available in your plan");
        }
        const apiKey = await createApiKey({
          organizationId,
          name: input.name,
          permissions: input.permissions || [],
          createdBy: ctx.user.id
        });
        return {
          success: true,
          apiKey
        };
      }),
      /**
       * 撤销API密钥
       */
      revokeApiKey: protectedProcedure.use(async ({ ctx, next }) => {
        const tenantCtx = await withTenant()(ctx);
        return next({ ctx: tenantCtx });
      }).input(
        external_exports.object({
          keyId: external_exports.number()
        })
      ).mutation(async ({ ctx, input }) => {
        const tenantCtx = ctx;
        const { organizationId, userRole } = tenantCtx;
        if (userRole !== "owner" && userRole !== "admin") {
          throw new Error("Only owners and admins can revoke API keys");
        }
        await revokeApiKey(organizationId, input.keyId);
        return { success: true };
      }),
      /**
       * v452.9: 获取 RLS（行级安全）状态
       * 仅系统管理员可访问
       */
      getRLSStatus: protectedProcedure.query(async ({ ctx }) => {
        if (ctx.user.role !== "admin" || ctx.user.organizationId !== 1) {
          return { initialized: false, viewCount: 0, auditLogCount: 0, recentViolations: 0, error: "\u65E0\u6743\u8BBF\u95EE" };
        }
        const { getRLSStatus: getRLSStatus2 } = await Promise.resolve().then(() => (init_dbRLS(), dbRLS_exports));
        return getRLSStatus2();
      }),
      /**
       * v452.9: 获取 RLS 审计日志（记录所有被拦截的跨租户访问尝试）
       */
      getRLSAuditLog: protectedProcedure.input(external_exports.object({
        userId: external_exports.number().optional(),
        limit: external_exports.number().min(1).max(500).default(100)
      })).query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" || ctx.user.organizationId !== 1) {
          return { logs: [], error: "\u65E0\u6743\u8BBF\u95EE" };
        }
        const { getRLSAuditLog: getRLSAuditLog2 } = await Promise.resolve().then(() => (init_dbRLS(), dbRLS_exports));
        const logs = await getRLSAuditLog2({ userId: input.userId, limit: input.limit });
        return { logs };
      })
    });
    __name(getUsageStatistics, "getUsageStatistics");
    __name(getOrganizationMembers, "getOrganizationMembers");
    __name(createInvitation, "createInvitation");
    __name(sendInvitationEmail, "sendInvitationEmail");
    __name(updateMemberRole, "updateMemberRole");
    __name(removeMember, "removeMember");
    __name(getSubscriptionPlans, "getSubscriptionPlans");
    __name(getSubscriptionPlanBySlug, "getSubscriptionPlanBySlug");
    __name(createPaymentSession, "createPaymentSession");
    __name(getBillingHistory, "getBillingHistory");
    __name(getApiKeys, "getApiKeys");
    __name(createApiKey, "createApiKey");
    __name(revokeApiKey, "revokeApiKey");
  }
});

