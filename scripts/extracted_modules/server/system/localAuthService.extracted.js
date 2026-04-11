// Extracted from production dist/index.js
// Original module: server/system/localAuthService.ts
// Lines: 462

var localAuthService_exports = {};
__export(localAuthService_exports, {
  changePassword: () => changePassword,
  createTeamMemberAccount: () => createTeamMemberAccount,
  loginLocalUser: () => loginLocalUser,
  registerWithInviteCode: () => registerWithInviteCode,
  updateProfile: () => updateProfile,
  verifyToken: () => verifyToken
});
async function ensureMultiTenantTables(db) {
  if (tablesEnsured2) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100),
        type VARCHAR(50) DEFAULT 'external',
        status VARCHAR(50) DEFAULT 'trial',
        subscription_plan VARCHAR(50) DEFAULT 'free',
        subscription_status VARCHAR(50) DEFAULT 'active',
        trial_ends_at DATETIME,
        subscription_ends_at DATETIME,
        owner_id INT,
        max_users INT DEFAULT 5,
        max_accounts INT DEFAULT 3,
        max_ad_accounts INT DEFAULT 3,
        max_campaigns INT DEFAULT 50,
        max_api_calls_per_day INT DEFAULT 10000,
        features JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_slug (slug),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(sql`
      INSERT IGNORE INTO organizations (id, name, slug, type, status, subscription_plan, max_users, max_accounts, max_ad_accounts, max_campaigns, max_api_calls_per_day)
      VALUES (1, 'Default Organization', 'default', 'internal', 'active', 'enterprise', 9999, 9999, 9999, 9999, 999999)
    `);
    tablesEnsured2 = true;
    log186.info("[LocalAuth] \u591A\u79DF\u6237\u8868\u5DF2\u786E\u8BA4\u5C31\u7EEA");
  } catch (err) {
    const cause = err?.cause;
    const causeMsg = cause ? ` | cause: ${String(cause?.message || cause)}` : "";
    log186.warn(`[LocalAuth] \u786E\u4FDD\u591A\u79DF\u6237\u8868\u5B58\u5728\u5931\u8D25: ${err.message || String(err)}${causeMsg}`);
  }
}
async function registerWithInviteCode(input, ipAddress, userAgent) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureMultiTenantTables(db);
  try {
    const { validateInviteCode: validateInviteCode2, useInviteCode: useInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
    const validation = await validateInviteCode2(input.inviteCode);
    if (!validation.valid) {
      return { success: false, error: validation.error || "\u9080\u8BF7\u7801\u65E0\u6548" };
    }
    const inviteCode = validation.inviteCode;
    const existingUser = await db.execute(sql`
      SELECT id FROM team_members WHERE username = ${input.username}
    `);
    const existingRows = existingUser[0];
    if (existingRows && existingRows.length > 0) {
      return { success: false, error: "\u7528\u6237\u540D\u5DF2\u5B58\u5728" };
    }
    let organizationId = null;
    if (inviteCode.inviteType === "external_user") {
      const orgName = input.organizationName || `${input.name}\u7684\u56E2\u961F`;
      const orgResult = await db.execute(sql`
        INSERT INTO organizations (name, type, status, max_users, max_accounts, created_at)
        VALUES (${orgName}, 'external', 'active', 10, 5, NOW())
      `);
      organizationId = orgResult[0]?.insertId;
    } else if (inviteCode.inviteType === "team_member") {
      organizationId = inviteCode.organizationId;
    }
    if (!organizationId) {
      organizationId = 1;
    }
    const passwordHash = await hash2(input.password, 10);
    const role = inviteCode.inviteType === "external_user" ? "admin" : "member";
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    const userResult = await db.execute(sql`
      INSERT INTO team_members (
        organization_id, ownerId, username, password_hash, email, name, 
        role, status, createdAt, updatedAt
      ) VALUES (
        ${organizationId}, 
        ${inviteCode.createdBy},
        ${input.username}, 
        ${passwordHash}, 
        ${input.email || ""}, 
        ${input.name},
        ${role}, 
        'active', 
        ${now},
        ${now}
      )
    `);
    const userId = userResult[0]?.insertId;
    if (inviteCode.inviteType === "external_user" && organizationId !== 1) {
      await db.execute(sql`
        UPDATE organizations SET owner_id = ${userId} WHERE id = ${organizationId}
      `);
    }
    await useInviteCode2(input.inviteCode, userId, organizationId, ipAddress, userAgent);
    const { createAuditLog: createAuditLog3 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
    await createAuditLog3({
      organizationId,
      // @ts-ignore
      userId,
      userName: input.name,
      actionType: "register",
      actionCategory: "auth",
      resourceType: "user",
      resourceId: String(userId),
      // @ts-ignore
      resourceName: input.name,
      description: `\u7528\u6237\u901A\u8FC7\u9080\u8BF7\u7801 ${input.inviteCode} \u6CE8\u518C`,
      ipAddress,
      userAgent
    });
    const token = generateToken(userId, organizationId, input.username, input.name);
    return {
      success: true,
      user: {
        // @ts-ignore
        id: userId,
        organizationId,
        username: input.username,
        email: input.email || null,
        name: input.name,
        role,
        status: "active",
        createdAt: now,
        lastLoginAt: null
      },
      token
    };
  } catch (error48) {
    log186.warn("[LocalAuth] \u6CE8\u518C\u5931\u8D25:", error48);
    return { success: false, error: error48.message || "\u6CE8\u518C\u5931\u8D25" };
  }
}
async function loginLocalUser(input, ipAddress, userAgent) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureMultiTenantTables(db);
  try {
    const result = await db.execute(sql`
      SELECT tm.*, o.name as organization_name
      FROM team_members tm
      LEFT JOIN organizations o ON tm.organization_id = o.id
      WHERE tm.username = ${input.username}
    `);
    const rows = result[0];
    if (!rows || rows.length === 0) {
      return { success: false, error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" };
    }
    const user = rows[0];
    if (user.status === "suspended") {
      const { createAuditLog: createAuditLog4 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
      await createAuditLog4({
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        userId: user.id,
        // @ts-ignore
        userName: user.name,
        actionType: "login",
        actionCategory: "auth",
        resourceType: "user",
        resourceId: String(user.id),
        description: "\u767B\u5F55\u5931\u8D25\uFF1A\u8D26\u53F7\u5DF2\u88AB\u6682\u505C",
        // @ts-ignore
        ipAddress,
        userAgent,
        status: "failed",
        errorMessage: "\u8D26\u53F7\u5DF2\u88AB\u6682\u505C"
        // @ts-ignore
      });
      return { success: false, error: "\u60A8\u7684\u8D26\u53F7\u5DF2\u88AB\u6682\u505C\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458" };
    }
    if (user.status === "deleted") {
      return { success: false, error: "\u8D26\u53F7\u4E0D\u5B58\u5728" };
    }
    const passwordValid = await compare(input.password, user.password_hash);
    if (!passwordValid) {
      const { createAuditLog: createAuditLog4 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
      await createAuditLog4({
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        userId: user.id,
        // @ts-ignore
        userName: user.name,
        actionType: "login",
        actionCategory: "auth",
        resourceType: "user",
        resourceId: String(user.id),
        description: "\u767B\u5F55\u5931\u8D25\uFF1A\u5BC6\u7801\u9519\u8BEF",
        // @ts-ignore
        ipAddress,
        // @ts-ignore
        userAgent,
        // @ts-ignore
        status: "failed",
        errorMessage: "\u5BC6\u7801\u9519\u8BEF"
      });
      return { success: false, error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    await db.execute(sql`
      UPDATE team_members SET last_login_at = ${now} WHERE id = ${user.id}
    `);
    const { createAuditLog: createAuditLog3 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
    await createAuditLog3({
      // @ts-ignore
      organizationId: user.organization_id,
      // @ts-ignore
      userId: user.id,
      // @ts-ignore
      userName: user.name,
      // @ts-ignore
      actionType: "login",
      // @ts-ignore
      actionCategory: "auth",
      // @ts-ignore
      resourceType: "user",
      // @ts-ignore
      resourceId: String(user.id),
      description: "\u7528\u6237\u767B\u5F55\u6210\u529F",
      ipAddress,
      userAgent,
      status: "success"
    });
    const token = generateToken(user.id, user.organization_id, user.username, user.name);
    return {
      success: true,
      user: {
        // @ts-ignore
        id: user.id,
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        username: user.username,
        // @ts-ignore
        email: user.email,
        // @ts-ignore
        name: user.name,
        // @ts-ignore
        role: user.role,
        // @ts-ignore
        status: user.status,
        // @ts-ignore
        createdAt: user.created_at,
        lastLoginAt: now
      },
      token
    };
  } catch (error48) {
    log186.warn("[LocalAuth] \u767B\u5F55\u5931\u8D25:", error48);
    return { success: false, error: error48.message || "\u767B\u5F55\u5931\u8D25" };
  }
}
async function verifyToken(token) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return { valid: false, error: "JWT_SECRET \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E" };
    const decoded = import_jsonwebtoken2.default.verify(token, secret);
    const db = await getDb();
    if (!db) return { valid: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
    const result = await db.execute(sql`
      SELECT * FROM team_members WHERE id = ${decoded.userId}
    `);
    const rows = result[0];
    if (!rows || rows.length === 0) {
      return { valid: false, error: "\u7528\u6237\u4E0D\u5B58\u5728" };
    }
    const user = rows[0];
    if (user.status !== "active") {
      return { valid: false, error: "\u8D26\u53F7\u5DF2\u88AB\u7981\u7528" };
    }
    return {
      valid: true,
      user: {
        // @ts-ignore
        id: user.id,
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        username: user.username,
        // @ts-ignore
        email: user.email,
        // @ts-ignore
        name: user.name,
        // @ts-ignore
        role: user.role,
        status: user.status,
        // @ts-ignore
        createdAt: user.created_at,
        // @ts-ignore
        lastLoginAt: user.last_login_at
        // @ts-ignore
      }
    };
  } catch (error48) {
    return { valid: false, error: "Token\u65E0\u6548\u6216\u5DF2\u8FC7\u671F" };
  }
}
function generateToken(userId, organizationId, username, name2) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u751F\u6210Token");
  return import_jsonwebtoken2.default.sign(
    { userId, organizationId, username, name: name2 },
    secret,
    { expiresIn: "7d" }
  );
}
async function changePassword(userId, oldPassword, newPassword) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureMultiTenantTables(db);
  try {
    const result = await db.execute(sql`
      SELECT password_hash FROM team_members WHERE id = ${userId}
    `);
    const rows = result[0];
    if (!rows || rows.length === 0) {
      return { success: false, error: "\u7528\u6237\u4E0D\u5B58\u5728" };
    }
    const user = rows[0];
    const passwordValid = await compare(oldPassword, user.password_hash);
    if (!passwordValid) {
      return { success: false, error: "\u539F\u5BC6\u7801\u9519\u8BEF" };
    }
    const newPasswordHash = await hash2(newPassword, 10);
    await db.execute(sql`
      UPDATE team_members SET password_hash = ${newPasswordHash} WHERE id = ${userId}
    `);
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message || "\u4FEE\u6539\u5BC6\u7801\u5931\u8D25" };
  }
}
async function createTeamMemberAccount(input) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureMultiTenantTables(db);
  try {
    const existingUser = await db.execute(sql`
      SELECT id FROM team_members WHERE username = ${input.username}
    `);
    const existingRows = existingUser[0];
    if (existingRows && existingRows.length > 0) {
      return { success: false, error: "\u7528\u6237\u540D\u5DF2\u5B58\u5728" };
    }
    const passwordHash = await hash2(input.password, 10);
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    const memberRole = input.role;
    const userResult = await db.execute(sql`
      INSERT INTO team_members (
        organization_id, ownerId, username, password_hash, email, name, 
        role, status, createdAt, updatedAt
      ) VALUES (
        ${input.organizationId}, 
        ${input.creatorId},
        ${input.username}, 
        ${passwordHash}, 
        ${input.email || ""}, 
        ${input.name},
        ${memberRole}, 
        'active', 
        ${now},
        ${now}
      )
    `);
    const userId = userResult[0]?.insertId;
    log186.info(`[LocalAuth] v483: \u56E2\u961F\u6210\u5458\u8D26\u53F7\u5DF2\u521B\u5EFA - username: ${input.username}, name: ${input.name}, org: ${input.organizationId}, creator: ${input.creatorId}`);
    return { success: true, userId };
  } catch (error48) {
    log186.warn("[LocalAuth] \u521B\u5EFA\u56E2\u961F\u6210\u5458\u5931\u8D25:", error48);
    return { success: false, error: error48.message || "\u521B\u5EFA\u5931\u8D25" };
  }
}
async function updateProfile(userId, updates) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureMultiTenantTables(db);
  try {
    if (updates.username) {
      const existingUser = await db.execute(sql`
        SELECT id FROM team_members WHERE username = ${updates.username} AND id != ${userId}
      `);
      const existingRows = existingUser[0];
      if (existingRows && existingRows.length > 0) {
        return { success: false, error: "\u7528\u6237\u540D\u5DF2\u5B58\u5728" };
      }
    }
    const setClauses = [];
    const values = [];
    if (updates.username) {
      setClauses.push("username = ?");
      values.push(updates.username);
    }
    if (updates.name) {
      setClauses.push("name = ?");
      values.push(updates.name);
    }
    if (updates.email !== void 0) {
      setClauses.push("email = ?");
      values.push(updates.email);
    }
    if (setClauses.length === 0) {
      return { success: false, error: "\u6CA1\u6709\u9700\u8981\u66F4\u65B0\u7684\u5B57\u6BB5" };
    }
    if (updates.username && updates.name && updates.email !== void 0) {
      await db.execute(sql`
        UPDATE team_members SET username = ${updates.username}, name = ${updates.name}, email = ${updates.email} WHERE id = ${userId}
      `);
    } else if (updates.username) {
      await db.execute(sql`
        UPDATE team_members SET username = ${updates.username} WHERE id = ${userId}
      `);
    } else if (updates.name) {
      await db.execute(sql`
        UPDATE team_members SET name = ${updates.name} WHERE id = ${userId}
      `);
    } else if (updates.email !== void 0) {
      await db.execute(sql`
        UPDATE team_members SET email = ${updates.email} WHERE id = ${userId}
      `);
    }
    log186.info(`[LocalAuth] v483: \u7528\u6237\u4FE1\u606F\u5DF2\u66F4\u65B0 - userId: ${userId}, fields: ${Object.keys(updates).join(", ")}`);
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message || "\u66F4\u65B0\u5931\u8D25" };
  }
}
var import_jsonwebtoken2, log186, tablesEnsured2;
var init_localAuthService = __esm({
  "server/system/localAuthService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    init_bcryptjs();
    import_jsonwebtoken2 = __toESM(require_jsonwebtoken());
    log186 = createModuleLogger("LocalAuthService");
    tablesEnsured2 = false;
    __name(ensureMultiTenantTables, "ensureMultiTenantTables");
    __name(registerWithInviteCode, "registerWithInviteCode");
    __name(loginLocalUser, "loginLocalUser");
    __name(verifyToken, "verifyToken");
    __name(generateToken, "generateToken");
    __name(changePassword, "changePassword");
    __name(createTeamMemberAccount, "createTeamMemberAccount");
    __name(updateProfile, "updateProfile");
  }
});

