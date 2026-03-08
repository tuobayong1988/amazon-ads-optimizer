/**
 * 多租户中间件
 * 提供租户隔离和权限控制
 */

import { TRPCError } from '@trpc/server';
import type { TrpcContext as Context } from '../_core/context';

export interface TenantContext extends Context {
  organizationId: number;
  organization: Organization;
  userRole: UserRole;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial';
  subscriptionPlan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  maxUsers: number;
  maxAdAccounts: number;
  maxCampaigns: number;
  maxApiCallsPerDay: number;
  features: Record<string, boolean>;
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Permission {
  resource: string;
  actions: Array<'read' | 'write' | 'delete'>;
}

/**
 * 租户上下文中间件
 * 注入租户信息到请求上下文
 */
export async function tenantMiddleware(ctx: Context): Promise<TenantContext> {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }

  // 获取用户的组织ID
  const organizationId = (ctx.user as Record<string, any>).organizationId;
  if (!organizationId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User not associated with any organization',
    });
  }

  // 获取组织信息
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Organization not found',
    });
  }

  // 检查组织状态
  if (organization.status === 'suspended') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Organization is suspended. Please contact support.',
    });
  }

  // 检查试用期
  if (organization.status === 'trial' && organization.trialEndsAt) {
    const now = new Date();
    const trialEnd = new Date(organization.trialEndsAt);
    if (now > trialEnd) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Trial period has ended. Please upgrade your subscription.',
      });
    }
  }

  // 获取用户角色
  const userRole = await getUserRole(ctx.user.id, organizationId);

  return {
    ...ctx,
    organizationId,
    organization,
    userRole,
  };
}

/**
 * 配额检查中间件
 * 检查并记录API使用量
 */
export async function quotaMiddleware(ctx: TenantContext): Promise<void> {
  const { organizationId, organization } = ctx;

  // 获取今日使用量
  const usage = await getTodayUsage(organizationId);

  // 检查API调用配额
  if (usage.apiCalls >= organization.maxApiCallsPerDay) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `API quota exceeded. Limit: ${organization.maxApiCallsPerDay} calls/day`,
    });
  }

  // 记录API调用
  await incrementApiCalls(organizationId);
}

/**
 * 权限检查中间件
 * 验证用户是否有权限执行操作
 */
export function requirePermission(
  resource: string,
  action: 'read' | 'write' | 'delete'
) {
  return async (ctx: TenantContext): Promise<void> => {
    const { userRole } = ctx;

    if (!hasPermission(userRole, resource, action)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Insufficient permissions. Required: ${action} on ${resource}`,
      });
    }
  };
}

/**
 * 功能开关中间件
 * 检查组织是否启用了特定功能
 */
export function requireFeature(featureName: string) {
  return async (ctx: TenantContext): Promise<void> => {
    const { organization } = ctx;

    if (!organization.features[featureName]) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Feature "${featureName}" is not available in your plan. Please upgrade.`,
      });
    }
  };
}

/**
 * 资源配额检查
 * 检查是否超过资源限制
 */
export async function checkResourceQuota(
  ctx: TenantContext,
  resourceType: 'users' | 'ad_accounts' | 'campaigns',
  currentCount: number
): Promise<void> {
  const { organization } = ctx;

  let limit: number;
  switch (resourceType) {
    case 'users':
      limit = organization.maxUsers;
      break;
    case 'ad_accounts':
      limit = organization.maxAdAccounts;
      break;
    case 'campaigns':
      limit = organization.maxCampaigns;
      break;
    default:
      return;
  }

  if (currentCount >= limit) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `${resourceType} limit reached (${limit}). Please upgrade your plan.`,
    });
  }
}

// ==================== Helper Functions ====================

/**
 * 获取组织信息
 */
async function getOrganization(organizationId: number): Promise<Organization | null> {
  // 实际实现需要查询数据库
  // 这里返回模拟数据
  return {
    id: organizationId,
    name: 'Demo Organization',
    slug: 'demo-org',
    status: 'active',
    subscriptionPlan: 'professional',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    subscriptionEndsAt: null,
    maxUsers: 10,
    maxAdAccounts: 10,
    maxCampaigns: 200,
    maxApiCallsPerDay: 50000,
    features: {
      ml_optimization: true,
      smart_campaign: true,
      advanced_analytics: true,
      api_access: true,
      white_label: false,
    },
  };
}

/**
 * 获取用户在组织中的角色
 */
async function getUserRole(userId: number, organizationId: number): Promise<UserRole> {
  // 实际实现需要查询organization_members表
  return 'admin';
}

/**
 * 获取今日使用量
 */
async function getTodayUsage(organizationId: number): Promise<{
  apiCalls: number;
  activeCampaigns: number;
  totalSpend: number;
}> {
  // 实际实现需要查询usage_stats表
  return {
    apiCalls: 1000,
    activeCampaigns: 50,
    totalSpend: 5000,
  };
}

/**
 * 增加API调用计数
 */
async function incrementApiCalls(organizationId: number): Promise<void> {
  // 实际实现需要更新usage_stats表
  // 可以使用Redis缓存提高性能
}

/**
 * 检查权限
 */
function hasPermission(
  role: UserRole,
  resource: string,
  action: 'read' | 'write' | 'delete'
): boolean {
  // Owner有所有权限
  if (role === 'owner') return true;

  // Admin可以读写,但不能删除组织
  if (role === 'admin') {
    if (resource === 'organization' && action === 'delete') {
      return false;
    }
    return true;
  }

  // Member只能读写数据,不能管理用户和配置
  if (role === 'member') {
    if (action === 'delete') return false;
    if (resource === 'organization' || resource === 'users' || resource === 'settings') {
      return false;
    }
    return true;
  }

  // Viewer只读
  if (role === 'viewer') {
    return action === 'read';
  }

  return false;
}

/**
 * 权限装饰器
 * 用于保护TRPC过程
 */
export function withTenant() {
  return async (ctx: Context) => {
    return tenantMiddleware(ctx);
  };
}

export function withQuota() {
  return async (ctx: TenantContext) => {
    await quotaMiddleware(ctx);
    return ctx;
  };
}

export function withFeature(featureName: string) {
  return async (ctx: TenantContext) => {
    await requireFeature(featureName)(ctx);
    return ctx;
  };
}
