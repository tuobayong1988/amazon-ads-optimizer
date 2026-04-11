// Extracted from production dist/index.js
// Original module: server/system/inviteCodeService.ts
// Lines: 436

var inviteCodeService_exports = {};
__export(inviteCodeService_exports, {
  createInviteCode: () => createInviteCode,
  createInviteCodesBatch: () => createInviteCodesBatch,
  deleteInviteCode: () => deleteInviteCode,
  disableInviteCode: () => disableInviteCode,
  enableInviteCode: () => enableInviteCode,
  generateInviteCode: () => generateInviteCode,
  getInviteCodeStats: () => getInviteCodeStats,
  getInviteCodes: () => getInviteCodes,
  useInviteCode: () => useInviteCode,
  validateInviteCode: () => validateInviteCode
});
function computeInviteCodeStatus(row) {
  if (!row.is_active || row.is_active === 0) {
    return "disabled";
  }
  if (row.expires_at) {
    const expiresDate = new Date(row.expires_at);
    if (expiresDate.getTime() < Date.now()) {
      return "expired";
    }
  }
  const maxUses = Number(row.max_uses) || 0;
  const usedCount = Number(row.used_count) || 0;
  if (maxUses > 0 && usedCount >= maxUses) {
    return "used_up";
  }
  return "active";
}
async function dropInviteCodesForeignKeys(db) {
  if (fkDropAttempted) return;
  fkDropAttempted = true;
  try {
    const fkResult = await db.execute(sql`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invite_codes' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    `);
    const fkRows = fkResult[0] || [];
    log185.info(`[InviteCode] \u53D1\u73B0 ${fkRows.length} \u4E2AFK\u7EA6\u675F\u9700\u8981\u79FB\u9664`);
    for (const fk of fkRows) {
      const fkName = fk.CONSTRAINT_NAME || fk.constraint_name;
      if (!fkName) continue;
      try {
        log185.info(`[InviteCode] \u6B63\u5728\u79FB\u9664FK\u7EA6\u675F: ${fkName}`);
        await db.execute(sql.raw(`ALTER TABLE invite_codes DROP FOREIGN KEY \`${fkName}\``));
        log185.info(`[InviteCode] \u5DF2\u6210\u529F\u79FB\u9664FK\u7EA6\u675F: ${fkName}`);
      } catch (dropErr) {
        log185.warn(`[InviteCode] \u79FB\u9664FK ${fkName} \u5931\u8D25: ${dropErr?.message || dropErr?.cause?.message || JSON.stringify(dropErr)}`);
      }
    }
  } catch (queryErr) {
    log185.warn(`[InviteCode] \u67E5\u8BE2FK\u7EA6\u675F\u5931\u8D25: ${queryErr?.message || queryErr?.cause?.message || JSON.stringify(queryErr)}`);
  }
}
async function ensureTablesExist(db) {
  if (tablesEnsured) return;
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(32) NOT NULL,
        created_by INT NOT NULL,
        organization_id INT,
        invite_type VARCHAR(50) DEFAULT 'external_user',
        max_uses INT DEFAULT 1,
        used_count INT DEFAULT 0,
        used_by INT,
        expires_at DATETIME NULL,
        is_active TINYINT DEFAULT 1,
        note VARCHAR(255),
        used_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invite_code_usages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invite_code_id INT NOT NULL,
        user_id INT NOT NULL,
        organization_id INT,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        INDEX idx_invite_code (invite_code_id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    tablesEnsured = true;
    log185.info("[InviteCode] \u9080\u8BF7\u7801\u76F8\u5173\u8868\u5DF2\u786E\u8BA4\u5C31\u7EEA");
  } catch (err) {
    log185.warn(`[InviteCode] \u786E\u4FDD\u8868\u5B58\u5728\u5931\u8D25(\u53EF\u80FD\u8868\u5DF2\u5B58\u5728): ${err?.message || err?.cause?.message || JSON.stringify(err)}`);
    tablesEnsured = true;
  }
  await dropInviteCodesForeignKeys(db);
}
function generateInviteCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const randomBytes3 = crypto4.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[randomBytes3[i] % chars.length];
  }
  return code;
}
async function createInviteCode(input) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    const code = generateInviteCode();
    const now = /* @__PURE__ */ new Date();
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1e3) : null;
    await db.execute(sql`
      INSERT INTO invite_codes (code, created_by, organization_id, invite_type, max_uses, expires_at, note, created_at)
      VALUES (
        ${code}, 
        ${input.createdBy}, 
        ${input.organizationId || null},
        ${input.inviteType || "external_user"},
        ${input.maxUses || 1},
        ${expiresAt ? expiresAt.toISOString().slice(0, 19).replace("T", " ") : null},
        ${input.note || null},
        ${now.toISOString().slice(0, 19).replace("T", " ")}
      )
    `);
    const result = await db.execute(sql`SELECT * FROM invite_codes WHERE code = ${code}`);
    const rows = result[0];
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        // @ts-ignore
        success: true,
        // @ts-ignore
        inviteCode: {
          // @ts-ignore
          id: row.id,
          // @ts-ignore
          code: row.code,
          // @ts-ignore
          createdBy: row.created_by,
          // @ts-ignore
          organizationId: row.organization_id,
          // @ts-ignore
          inviteType: row.invite_type,
          // @ts-ignore
          maxUses: row.max_uses,
          // @ts-ignore
          usedCount: row.used_count,
          // @ts-ignore
          expiresAt: row.expires_at,
          isActive: row.is_active === 1,
          // @ts-ignore
          note: row.note,
          // @ts-ignore
          createdAt: row.created_at,
          // @ts-ignore
          status: computeInviteCodeStatus(row)
        }
      };
    }
    return { success: false, error: "\u521B\u5EFA\u9080\u8BF7\u7801\u5931\u8D25" };
  } catch (error48) {
    const e = error48;
    const mysqlErr = e?.cause?.message || e?.cause?.sqlMessage || e?.errno || e?.code || "unknown";
    const detail = JSON.stringify({ msg: e?.message, cause: e?.cause?.message, code: e?.cause?.code, errno: e?.cause?.errno, sqlState: e?.cause?.sqlState });
    log185.warn(`[InviteCode] \u521B\u5EFA\u9080\u8BF7\u7801\u5931\u8D25: ${e?.message} | MySQL: ${mysqlErr} | Detail: ${detail}`);
    return { success: false, error: `${error48.message} | MySQL: ${mysqlErr}` };
  }
}
async function createInviteCodesBatch(input, count11) {
  if (count11 < 1 || count11 > 100) {
    return { success: false, error: "\u6279\u91CF\u751F\u6210\u6570\u91CF\u5FC5\u987B\u57281-100\u4E4B\u95F4" };
  }
  const codes = [];
  for (let i = 0; i < count11; i++) {
    const result = await createInviteCode(input);
    if (result.success && result.inviteCode) {
      codes.push(result.inviteCode);
    }
  }
  return { success: true, inviteCodes: codes };
}
async function validateInviteCode(code) {
  const db = await getDb();
  if (!db) return { valid: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    const result = await db.execute(sql`
      SELECT ic.*, u.name as creator_name
      FROM invite_codes ic
      LEFT JOIN users u ON ic.created_by = u.id
      WHERE ic.code = ${code}
    `);
    const rows = result[0];
    if (!rows || rows.length === 0) {
      return { valid: false, error: "\u9080\u8BF7\u7801\u4E0D\u5B58\u5728" };
    }
    const row = rows[0];
    if (!row.is_active) {
      return { valid: false, error: "\u9080\u8BF7\u7801\u5DF2\u88AB\u7981\u7528" };
    }
    if (row.expires_at && new Date(row.expires_at) < /* @__PURE__ */ new Date()) {
      return { valid: false, error: "\u9080\u8BF7\u7801\u5DF2\u8FC7\u671F" };
    }
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return { valid: false, error: "\u9080\u8BF7\u7801\u5DF2\u8FBE\u5230\u6700\u5927\u4F7F\u7528\u6B21\u6570" };
    }
    return {
      valid: true,
      inviteCode: {
        // @ts-ignore
        id: row.id,
        // @ts-ignore
        code: row.code,
        // @ts-ignore
        createdBy: row.created_by,
        // @ts-ignore
        organizationId: row.organization_id,
        // @ts-ignore
        inviteType: row.invite_type,
        // @ts-ignore
        maxUses: row.max_uses,
        // @ts-ignore
        usedCount: row.used_count,
        // @ts-ignore
        expiresAt: row.expires_at,
        isActive: row.is_active === 1,
        // @ts-ignore
        note: row.note,
        // @ts-ignore
        createdAt: row.created_at,
        // @ts-ignore
        creatorName: row.creator_name,
        // @ts-ignore
        status: computeInviteCodeStatus(row)
      }
    };
  } catch (error48) {
    log185.warn("[InviteCode] \u9A8C\u8BC1\u9080\u8BF7\u7801\u5931\u8D25:", error48);
    return { valid: false, error: error48.message || "\u9A8C\u8BC1\u9080\u8BF7\u7801\u5931\u8D25" };
  }
}
async function useInviteCode(code, userId, organizationId, ipAddress, userAgent) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    const validation = await validateInviteCode(code);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const inviteCode = validation.inviteCode;
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    await db.execute(sql`
      INSERT INTO invite_code_usages (invite_code_id, user_id, organization_id, used_at, ip_address, user_agent)
      VALUES (${inviteCode.id}, ${userId}, ${organizationId || null}, ${now}, ${ipAddress || null}, ${userAgent || null})
    `);
    await db.execute(sql`UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ${inviteCode.id}`);
    return { success: true };
  } catch (error48) {
    log185.warn("[InviteCode] \u4F7F\u7528\u9080\u8BF7\u7801\u5931\u8D25:", error48);
    return { success: false, error: error48.message || "\u4F7F\u7528\u9080\u8BF7\u7801\u5931\u8D25" };
  }
}
async function getInviteCodes(createdBy) {
  const db = await getDb();
  if (!db) return [];
  await ensureTablesExist(db);
  try {
    let result;
    if (createdBy) {
      result = await db.execute(sql`
        SELECT ic.*, u.name as creator_name
        FROM invite_codes ic
        LEFT JOIN users u ON ic.created_by = u.id
        WHERE ic.created_by = ${createdBy}
        ORDER BY ic.created_at DESC
      `);
    } else {
      result = await db.execute(sql`
        SELECT ic.*, u.name as creator_name
        FROM invite_codes ic
        LEFT JOIN users u ON ic.created_by = u.id
        ORDER BY ic.created_at DESC
      `);
    }
    const rows = result[0] || [];
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      createdBy: row.created_by,
      organizationId: row.organization_id,
      inviteType: row.invite_type,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at,
      isActive: row.is_active === 1,
      note: row.note,
      createdAt: row.created_at,
      creatorName: row.creator_name,
      // @ts-ignore
      status: computeInviteCodeStatus(row)
    }));
  } catch (error48) {
    log185.warn("[InviteCode] \u83B7\u53D6\u9080\u8BF7\u7801\u5217\u8868\u5931\u8D25:", error48);
    return [];
  }
}
async function disableInviteCode(id) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    await db.execute(sql`UPDATE invite_codes SET is_active = 0 WHERE id = ${id}`);
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message };
  }
}
async function enableInviteCode(id) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    await db.execute(sql`UPDATE invite_codes SET is_active = 1 WHERE id = ${id}`);
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message };
  }
}
async function deleteInviteCode(id) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  await ensureTablesExist(db);
  try {
    await db.execute(sql`DELETE FROM invite_codes WHERE id = ${id}`);
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message };
  }
}
async function getInviteCodeStats(createdBy) {
  const db = await getDb();
  if (!db) return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  await ensureTablesExist(db);
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    const whereClause = createdBy ? sql`WHERE created_by = ${createdBy}` : sql``;
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 AND (expires_at IS NULL OR expires_at > ${now}) AND (max_uses = 0 OR used_count < max_uses) THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN used_count > 0 THEN 1 ELSE 0 END) as used,
        SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ${now} THEN 1 ELSE 0 END) as expired,
        SUM(used_count) as total_usages
      FROM invite_codes ${whereClause}
    `);
    const rows = result[0];
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        // @ts-ignore
        total: row.total || 0,
        // @ts-ignore
        active: row.active || 0,
        // @ts-ignore
        used: row.used || 0,
        // @ts-ignore
        expired: row.expired || 0,
        // @ts-ignore
        totalUsages: row.total_usages || 0
      };
    }
    return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  } catch (error48) {
    log185.warn("[InviteCode] \u83B7\u53D6\u9080\u8BF7\u7801\u7EDF\u8BA1\u5931\u8D25:", error48);
    return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  }
}
var crypto4, log185, tablesEnsured, fkDropAttempted;
var init_inviteCodeService = __esm({
  "server/system/inviteCodeService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    crypto4 = __toESM(require("crypto"));
    log185 = createModuleLogger("InviteCodeService");
    __name(computeInviteCodeStatus, "computeInviteCodeStatus");
    tablesEnsured = false;
    fkDropAttempted = false;
    __name(dropInviteCodesForeignKeys, "dropInviteCodesForeignKeys");
    __name(ensureTablesExist, "ensureTablesExist");
    __name(generateInviteCode, "generateInviteCode");
    __name(createInviteCode, "createInviteCode");
    __name(createInviteCodesBatch, "createInviteCodesBatch");
    __name(validateInviteCode, "validateInviteCode");
    __name(useInviteCode, "useInviteCode");
    __name(getInviteCodes, "getInviteCodes");
    __name(disableInviteCode, "disableInviteCode");
    __name(enableInviteCode, "enableInviteCode");
    __name(deleteInviteCode, "deleteInviteCode");
    __name(getInviteCodeStats, "getInviteCodeStats");
  }
});

