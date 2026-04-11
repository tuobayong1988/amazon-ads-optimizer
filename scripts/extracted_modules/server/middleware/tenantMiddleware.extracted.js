// Extracted from production dist/index.js
// Original module: server/middleware/tenantMiddleware.ts
// Lines: 88

async function tenantMiddleware(ctx) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required"
    });
  }
  const organizationId = ctx.user.organizationId;
  if (!organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User not associated with any organization"
    });
  }
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Organization not found"
    });
  }
  if (organization.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization is suspended. Please contact support."
    });
  }
  if (organization.status === "trial" && organization.trialEndsAt) {
    const now = /* @__PURE__ */ new Date();
    const trialEnd = new Date(organization.trialEndsAt);
    if (now > trialEnd) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Trial period has ended. Please upgrade your subscription."
      });
    }
  }
  const userRole = await getUserRole(ctx.user.id, organizationId);
  return {
    ...ctx,
    // @ts-ignore
    organizationId,
    organization,
    userRole
  };
}
async function getOrganization(organizationId) {
  return {
    id: organizationId,
    name: "Demo Organization",
    slug: "demo-org",
    status: "active",
    subscriptionPlan: "professional",
    subscriptionStatus: "active",
    trialEndsAt: null,
    subscriptionEndsAt: null,
    maxUsers: 10,
    maxAdAccounts: 10,
    maxCampaigns: 200,
    maxApiCallsPerDay: 5e4,
    features: {
      ml_optimization: true,
      smart_campaign: true,
      advanced_analytics: true,
      api_access: true,
      white_label: false
    }
  };
}
async function getUserRole(userId, organizationId) {
  return "admin";
}
function withTenant() {
  return async (ctx) => {
    return tenantMiddleware(ctx);
  };
}
var init_tenantMiddleware = __esm({
  "server/middleware/tenantMiddleware.ts"() {
    "use strict";
    init_dist();
    __name(tenantMiddleware, "tenantMiddleware");
    __name(getOrganization, "getOrganization");
    __name(getUserRole, "getUserRole");
    __name(withTenant, "withTenant");
  }
});

