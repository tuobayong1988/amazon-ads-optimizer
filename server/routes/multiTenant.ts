/**
 * 多租户管理API路由
 */

import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import { withTenant, withQuota, type TenantContext } from '../middleware/tenantMiddleware';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_multiTenant');

export const multiTenantRouter = router({
  /**
   * 获取当前组织信息
   */
  // @ts-ignore
  getOrganization: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .query(async ({ ctx }: any) => {
      const tenantCtx = ctx as TenantContext;
      return {
        organization: tenantCtx.organization,
        userRole: tenantCtx.userRole,
      };
    }),

  /**
   * 获取使用统计
   */
  // @ts-ignore
  getUsageStats: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    // @ts-ignore
    .query(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, organization } = tenantCtx;

      // 获取使用统计
      const stats = await getUsageStatistics(
        organizationId,
        input.startDate,
        input.endDate
      );

      // 计算配额使用率
      const quotaUsage = {
        apiCalls: {
          used: stats.totalApiCalls,
          limit: organization.maxApiCallsPerDay,
          percentage: (stats.totalApiCalls / organization.maxApiCallsPerDay) * 100,
        },
        campaigns: {
          used: stats.activeCampaigns,
          limit: organization.maxCampaigns,
          percentage: (stats.activeCampaigns / organization.maxCampaigns) * 100,
        },
        users: {
          used: stats.activeUsers,
          limit: organization.maxUsers,
          percentage: (stats.activeUsers / organization.maxUsers) * 100,
        },
      };

      return {
        stats,
        quotaUsage,
      };
    }),

  /**
   * 获取组织成员列表
   */
  // @ts-ignore
  getMembers: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .query(async ({ ctx }: any) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId } = tenantCtx;

      const members = await getOrganizationMembers(organizationId);
      return members;
    }),

  /**
   * 邀请新成员
   */
  // @ts-ignore
  inviteMember: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(['admin', 'member', 'viewer']),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, organization, userRole } = tenantCtx;

      // 检查权限
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Only owners and admins can invite members');
      }

      // 检查用户配额
      const currentMembers = await getOrganizationMembers(organizationId);
      if (currentMembers.length >= organization.maxUsers) {
        throw new Error(
          `User limit reached (${organization.maxUsers}). Please upgrade your plan.`
        );
      }

      // 创建邀请
      const invitation = await createInvitation({
        organizationId,
        email: input.email,
        role: input.role,
        invitedBy: ctx.user!.id,
      });

      // 发送邀请邮件
      await sendInvitationEmail(invitation);

      return {
        success: true,
        invitation,
      };
    }),

  /**
   * 更新成员角色
   */
  // @ts-ignore
  updateMemberRole: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        memberId: z.number(),
        role: z.enum(['admin', 'member', 'viewer']),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole } = tenantCtx;

      // 只有owner可以更改角色
      if (userRole !== 'owner') {
        throw new Error('Only organization owners can change member roles');
      }

      await updateMemberRole(organizationId, input.memberId, input.role);

      return { success: true };
    }),

  /**
   * 移除成员
   */
  // @ts-ignore
  removeMember: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        memberId: z.number(),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole } = tenantCtx;

      // 检查权限
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Only owners and admins can remove members');
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
  // @ts-ignore
  updateSubscription: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        planSlug: z.string(),
        billingCycle: z.enum(['monthly', 'yearly']),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole } = tenantCtx;

      // 只有owner可以更改订阅
      if (userRole !== 'owner') {
        throw new Error('Only organization owners can change subscription');
      }

      const plan = await getSubscriptionPlanBySlug(input.planSlug);
      if (!plan) {
        throw new Error('Invalid subscription plan');
      }

      // 创建支付会话(实际应用中需要集成Stripe等支付网关)
      const paymentSession = await createPaymentSession({
        organizationId,
        planId: plan.id,
        billingCycle: input.billingCycle,
      });

      return {
        success: true,
        paymentUrl: paymentSession.url,
      };
    }),

  /**
   * 获取计费历史
   */
  // @ts-ignore
  getBillingHistory: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .query(async ({ ctx }: any) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole } = tenantCtx;

      // 只有owner和admin可以查看计费历史
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Insufficient permissions');
      }

      const history = await getBillingHistory(organizationId);
      return history;
    }),

  /**
   * 获取API密钥
   */
  // @ts-ignore
  getApiKeys: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .query(async ({ ctx }: any) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId } = tenantCtx;

      const apiKeys = await getApiKeys(organizationId);
      return apiKeys;
    }),

  /**
   * 创建API密钥
   */
  // @ts-ignore
  createApiKey: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        name: z.string(),
        permissions: z.array(z.string()).optional(),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole, organization } = tenantCtx;

      // 检查权限
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Only owners and admins can create API keys');
      }

      // 检查功能是否启用
      if (!organization.features.api_access) {
        throw new Error('API access is not available in your plan');
      }

      const apiKey = await createApiKey({
        organizationId,
        name: input.name,
        permissions: input.permissions || [],
        createdBy: ctx.user!.id,
      });

      return {
        success: true,
        apiKey,
      };
    }),

  /**
   * 撤销API密钥
   */
  // @ts-ignore
  revokeApiKey: protectedProcedure
    // @ts-ignore
    .use(async ({ ctx, next }) => {
      const tenantCtx = await withTenant()(ctx);
      return next({ ctx: tenantCtx });
    })
    .input(
      z.object({
        keyId: z.number(),
      })
    )
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      const tenantCtx = ctx as TenantContext;
      const { organizationId, userRole } = tenantCtx;

      // 检查权限
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Only owners and admins can revoke API keys');
      }

      await revokeApiKey(organizationId, input.keyId);

      return { success: true };
    }),
});

// ==================== Helper Functions ====================

async function getUsageStatistics(
  organizationId: number,
  startDate?: string,
  endDate?: string
) {
  // 实际实现需要查询usage_stats表
  return {
    totalApiCalls: 15000,
    activeCampaigns: 75,
    activeUsers: 5,
    totalSpend: 25000,
    period: {
      start: startDate || new Date().toISOString(),
      end: endDate || new Date().toISOString(),
    },
  };
}

async function getOrganizationMembers(organizationId: number) {
  // 实际实现需要查询organization_members表
  return [
    {
      id: 1,
      userId: 1,
      name: 'John Doe',
      email: 'john@example.com',
      role: 'owner',
      joinedAt: '2024-01-01T00:00:00Z',
    },
  ];
}

async function createInvitation(data: Record<string, any>) {
  // 实际实现需要插入invitations表
  return {
    id: 1,
    ...data,
    token: 'invite_token_123',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function sendInvitationEmail(invitation: any) {
  // 实际实现需要发送邮件
  log.info('Sending invitation email to:', invitation.email);
}

async function updateMemberRole(
  organizationId: number,
  memberId: number,
  role: string
) {
  // 实际实现需要更新organization_members表
}

async function removeMember(organizationId: number, memberId: number) {
  // 实际实现需要删除organization_members记录
}

async function getSubscriptionPlans() {
  // 实际实现需要查询subscription_plans表
  return [
    {
      id: 1,
      name: 'Free',
      slug: 'free',
      priceMonthly: 0,
      priceYearly: 0,
      maxUsers: 1,
      maxAdAccounts: 1,
      maxCampaigns: 10,
      features: {},
    },
    {
      id: 2,
      name: 'Starter',
      slug: 'starter',
      priceMonthly: 29,
      priceYearly: 290,
      maxUsers: 3,
      maxAdAccounts: 3,
      maxCampaigns: 50,
      features: {},
    },
    {
      id: 3,
      name: 'Professional',
      slug: 'professional',
      priceMonthly: 99,
      priceYearly: 990,
      maxUsers: 10,
      maxAdAccounts: 10,
      maxCampaigns: 200,
      features: {
        ml_optimization: true,
        smart_campaign: true,
      },
    },
  ];
}

async function getSubscriptionPlanBySlug(slug: string) {
  const plans = await getSubscriptionPlans();
  return plans.find((p: any) => p.slug === slug);
}

async function createPaymentSession(data: Record<string, any>) {
  // 实际实现需要集成Stripe等支付网关
  return {
    id: 'session_123',
    url: 'https://checkout.stripe.com/pay/session_123',
  };
}

async function getBillingHistory(organizationId: number) {
  // 实际实现需要查询billing_history表
  return [
    {
      id: 1,
      date: '2024-01-01',
      amount: 99,
      status: 'paid',
      invoiceUrl: 'https://example.com/invoice/1',
    },
  ];
}

async function getApiKeys(organizationId: number) {
  // 实际实现需要查询api_keys表
  return [
    {
      id: 1,
      name: 'Production API Key',
      keyPrefix: 'sk_prod_',
      createdAt: '2024-01-01T00:00:00Z',
      lastUsedAt: '2024-01-15T10:30:00Z',
    },
  ];
}

async function createApiKey(data: Record<string, any>) {
  // 实际实现需要插入api_keys表并生成密钥
  return {
    id: 1,
    ...data,
    key: 'sk_prod_1234567890abcdef',
    keyPrefix: 'sk_prod_',
    createdAt: new Date().toISOString(),
  };
}

async function revokeApiKey(organizationId: number, keyId: number) {
  // 实际实现需要更新api_keys表
}
