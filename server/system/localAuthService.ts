import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('LocalAuthService');
/**
 * 本地认证服务 - 支持邀请码注册、多租户数据隔离
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// 自愈式表创建 - 确保多租户相关表存在
let tablesEnsured = false;
async function ensureMultiTenantTables(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  if (tablesEnsured) return;
  try {
    // @ts-ignore
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
    // @ts-ignore
    await db.execute(sql`
      INSERT IGNORE INTO organizations (id, name, slug, type, status, subscription_plan, max_users, max_accounts, max_ad_accounts, max_campaigns, max_api_calls_per_day)
      VALUES (1, 'Default Organization', 'default', 'internal', 'active', 'enterprise', 9999, 9999, 9999, 9999, 999999)
    `);
    tablesEnsured = true;
    log.info('[LocalAuth] 多租户表已确认就绪');
  } catch (err: any) {
    const cause = (err as Record<string, unknown>)?.cause;
    const causeMsg = cause ? ` | cause: ${String((cause as Record<string, unknown>)?.message || cause)}` : '';
    log.warn(`[LocalAuth] 确保多租户表存在失败: ${(err as Error).message || String(err)}${causeMsg}`);
  }
}

export interface LocalUser {
  id: number;
  organizationId: number;
  username: string;
  email: string | null;
  name: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface RegisterInput {
  inviteCode: string;
  username: string;
  password: string;
  name: string;
  email?: string;
  organizationName?: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

/**
 * 使用邀请码注册新用户
 */
export async function registerWithInviteCode(input: RegisterInput, ipAddress?: string, userAgent?: string): Promise<{ 
  success: boolean; 
  user?: LocalUser; 
  token?: string;
  error?: string 
}> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureMultiTenantTables(db);
  
  try {
    // 1. 验证邀请码
    const { validateInviteCode, useInviteCode } = await import('./inviteCodeService');
    const validation = await validateInviteCode(input.inviteCode);
    
    if (!validation.valid) {
      return { success: false, error: validation.error || '邀请码无效' };
    }
    
    const inviteCode = validation.inviteCode!;
    
    // 2. 检查用户名是否已存在
    const existingUser = await db.execute(sql`
      SELECT id FROM team_members WHERE username = ${input.username}
    `);
    
    // @ts-expect-error - type assertion
    const existingRows = (existingUser as Record<string, unknown>)[0];
    // @ts-ignore
    if (existingRows && existingRows.length > 0) {
      return { success: false, error: '用户名已存在' };
    }
    
    // 3. v452.8: 确定组织ID - 外部用户始终创建新组织以确保数据隔离
    let organizationId: number | null = null;
    
    if (inviteCode.inviteType === 'external_user') {
      // 外部用户始终创建新组织，不共享管理员的组织
      const orgName = input.organizationName || `${input.name}的团队`;
      const orgResult = await db.execute(sql`
        INSERT INTO organizations (name, type, status, max_users, max_accounts, created_at)
        VALUES (${orgName}, 'external', 'active', 10, 5, NOW())
      `);
      // @ts-ignore
      organizationId = (orgResult as Record<string, unknown>[])[0]?.insertId;
    } else if (inviteCode.inviteType === 'team_member') {
      // 团队成员加入邀请者的组织
      organizationId = inviteCode.organizationId;
    }
    
    if (!organizationId) {
      organizationId = 1; // 回退到默认组织
    }
    
    // 4. 加密密码
    const passwordHash = await bcrypt.hash(input.password, 10);
    
    // 5. 创建用户
    const role = inviteCode.inviteType === 'external_user' ? 'admin' : 'member';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    const userResult = await db.execute(sql`
      INSERT INTO team_members (
        organization_id, ownerId, username, password_hash, email, name, 
        role, status, createdAt, updatedAt
      ) VALUES (
        ${organizationId}, 
        ${inviteCode.createdBy},
        ${input.username}, 
        ${passwordHash}, 
        ${input.email || ''}, 
        ${input.name},
        ${role}, 
        'active', 
        ${now},
        ${now}
      )
    `);
    
    // @ts-ignore
    const userId = (userResult as Record<string, unknown>[])[0]?.insertId;
    
    // 6. 如果是新组织的所有者，更新组织的owner_id
    if (inviteCode.inviteType === 'external_user' && organizationId !== 1) {
      await db.execute(sql`
        UPDATE organizations SET owner_id = ${userId} WHERE id = ${organizationId}
      `);
    }
    
    // 7. 使用邀请码（增加使用计数）
    // @ts-ignore
    await useInviteCode(input.inviteCode, userId, organizationId, ipAddress, userAgent);
    
    // 8. 记录审计日志
    const { createAuditLog } = await import('./auditLogService');
    await createAuditLog({
      organizationId,
      // @ts-ignore
      userId,
      userName: input.name,
      actionType: 'register',
      actionCategory: 'auth',
      resourceType: 'user',
      resourceId: String(userId),
      // @ts-ignore
      resourceName: input.name,
      description: `用户通过邀请码 ${input.inviteCode} 注册`,
      ipAddress,
      userAgent,
    });
    
    // 9. 生成JWT token
    // @ts-ignore
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
        status: 'active',
        createdAt: now,
        lastLoginAt: null,
      },
      token,
    };
  } catch (error: unknown) {
    log.warn('[LocalAuth] 注册失败:', error);
    return { success: false, error: (error as Error).message || '注册失败' };
  }
}

/**
 * 本地用户登录
 */
export async function loginLocalUser(input: LoginInput, ipAddress?: string, userAgent?: string): Promise<{
  success: boolean;
  user?: LocalUser;
  token?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureMultiTenantTables(db);
  
  // @ts-ignore
  try {
    // 1. 查找用户
    const result = await db.execute(sql`
      SELECT tm.*, o.name as organization_name
      FROM team_members tm
      LEFT JOIN organizations o ON tm.organization_id = o.id
      WHERE tm.username = ${input.username}
    `);
    
    // @ts-ignore
    const rows = (result as Record<string, unknown>[][])[0];
    // @ts-ignore
    if (!rows || rows.length === 0) {
      // @ts-ignore
      return { success: false, error: '用户名或密码错误' };
    // @ts-ignore
    }
    
    const user = rows[0] as Record<string, unknown>;
    
    // 2. 检查账号状态
    if (user.status === 'suspended') {
      const { createAuditLog } = await import('./auditLogService');
      await createAuditLog({
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        userId: user.id,
        // @ts-ignore
        userName: user.name,
        actionType: 'login',
        actionCategory: 'auth',
        resourceType: 'user',
        resourceId: String(user.id),
        description: '登录失败：账号已被暂停',
        // @ts-ignore
        ipAddress,
        userAgent,
        status: 'failed',
        errorMessage: '账号已被暂停',
      // @ts-ignore
      });
      // @ts-ignore
      return { success: false, error: '您的账号已被暂停，请联系管理员' };
    // @ts-ignore
    }
    
    if (user.status === 'deleted') {
      return { success: false, error: '账号不存在' };
    }
    
    // 3. 验证密码
    // @ts-ignore
    const passwordValid = await bcrypt.compare(input.password, user.password_hash);
    if (!passwordValid) {
      const { createAuditLog } = await import('./auditLogService');
      await createAuditLog({
        // @ts-ignore
        organizationId: user.organization_id,
        // @ts-ignore
        userId: user.id,
        // @ts-ignore
        userName: user.name,
        actionType: 'login',
        actionCategory: 'auth',
        resourceType: 'user',
        resourceId: String(user.id),
        description: '登录失败：密码错误',
        // @ts-ignore
        ipAddress,
        // @ts-ignore
        userAgent,
        // @ts-ignore
        status: 'failed',
        errorMessage: '密码错误',
      });
      return { success: false, error: '用户名或密码错误' };
    }
    
    // 4. 更新最后登录时间
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.execute(sql`
      UPDATE team_members SET last_login_at = ${now} WHERE id = ${user.id}
    `);
    
    // 5. 记录成功的登录
    const { createAuditLog } = await import('./auditLogService');
    await createAuditLog({
      // @ts-ignore
      organizationId: user.organization_id,
      // @ts-ignore
      userId: user.id,
      // @ts-ignore
      userName: user.name,
      // @ts-ignore
      actionType: 'login',
      // @ts-ignore
      actionCategory: 'auth',
      // @ts-ignore
      resourceType: 'user',
      // @ts-ignore
      resourceId: String(user.id),
      description: '用户登录成功',
      ipAddress,
      userAgent,
      status: 'success',
    });
    
    // 6. 生成JWT token
    // @ts-ignore
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
        lastLoginAt: now,
      },
      token,
    };
  // @ts-ignore
  } catch (error: unknown) {
    log.warn('[LocalAuth] 登录失败:', error);
    return { success: false, error: (error as Error).message || '登录失败' };
  }
}

/**
 * 验证JWT token
 */
export async function verifyToken(token: string): Promise<{
  valid: boolean;
  user?: LocalUser;
  error?: string;
}> {
  // @ts-ignore
  try {
    // v468: 使用静态导入的jwt（顶部已导入）
    // v345: 移除不安全的默认密钥回退
    // @ts-ignore
    const secret = process.env.JWT_SECRET;
    // @ts-ignore
    if (!secret) return { valid: false, error: 'JWT_SECRET 环境变量未配置' };
    
    const decoded = jwt.verify(token, secret) as Record<string, unknown>;
    
    // @ts-ignore
    const db = await getDb();
    if (!db) return { valid: false, error: '数据库连接失败' };
    
    const result = await db.execute(sql`
      SELECT * FROM team_members WHERE id = ${decoded.userId}
    `);
    
    // @ts-ignore
    const rows = (result as Record<string, unknown>[][])[0];
    if (!rows || rows.length === 0) {
      return { valid: false, error: '用户不存在' };
    }
    
    const user = rows[0] as Record<string, unknown>;
    
    if (user.status !== 'active') {
      return { valid: false, error: '账号已被禁用' };
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
        lastLoginAt: user.last_login_at,
      // @ts-ignore
      },
    };
  } catch (error: unknown) {
    return { valid: false, error: 'Token无效或已过期' };
  }
}

/**
 * 生成JWT token
 */
function generateToken(userId: number, organizationId: number, username: string, name: string): string {
  // v345: 移除不安全的默认密钥回退
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET 环境变量未配置，无法生成Token');
  
  return jwt.sign(
    { userId, organizationId, username, name },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * 修改密码
 */
export async function changePassword(userId: number, oldPassword: string, newPassword: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureMultiTenantTables(db);
  
  try {
    const result = await db.execute(sql`
      SELECT password_hash FROM team_members WHERE id = ${userId}
    `);
    
    // @ts-ignore
    const rows = (result as Record<string, unknown>[][])[0];
    if (!rows || rows.length === 0) {
      return { success: false, error: '用户不存在' };
    }
    
    const user = rows[0] as Record<string, unknown>;
    const passwordValid = await bcrypt.compare(oldPassword, user.password_hash as string);
    
    if (!passwordValid) {
      return { success: false, error: '原密码错误' };
    }
    
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    // @ts-ignore
    await db.execute(sql`
      UPDATE team_members SET password_hash = ${newPasswordHash} WHERE id = ${userId}
    `);
    
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message || '修改密码失败' };
  }
}

/**
 * v483: 直接创建团队成员账号（由管理员在团队管理页面创建）
 * 替代原有的邮箱邀请流程，管理员直接设置用户名、密码、姓名
 */
export interface CreateTeamMemberInput {
  creatorId: number;
  organizationId: number;
  username: string;
  name: string;
  password: string;
  email?: string;
  role: 'admin' | 'editor' | 'viewer';
}

export async function createTeamMemberAccount(input: CreateTeamMemberInput): Promise<{
  success: boolean;
  userId?: number;
  error?: string;
}> {
  const db = await getDb();
  // @ts-ignore
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureMultiTenantTables(db);
  
  try {
    // 1. 检查用户名是否已存在
    const existingUser = await db.execute(sql`
      SELECT id FROM team_members WHERE username = ${input.username}
    `);
    
    // @ts-ignore
    const existingRows = (existingUser as Record<string, unknown>[][])[0];
    if (existingRows && existingRows.length > 0) {
      return { success: false, error: '用户名已存在' };
    }
    
    // 2. 加密密码
    const passwordHash = await bcrypt.hash(input.password, 10);
    
    // 3. 创建用户（加入创建者的组织）
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const memberRole = input.role;  // v487: 保留原始角色值(admin/editor/viewer)，不再转换为member
    
    const userResult = await db.execute(sql`
      INSERT INTO team_members (
        organization_id, ownerId, username, password_hash, email, name, 
        role, status, createdAt, updatedAt
      ) VALUES (
        ${input.organizationId}, 
        ${input.creatorId},
        ${input.username}, 
        ${passwordHash}, 
        ${input.email || ''}, 
        ${input.name},
        ${memberRole}, 
        'active', 
        ${now},
        ${now}
      )
    `);
    
    // @ts-ignore
    const userId = (userResult as Record<string, unknown>[])[0]?.insertId;
    
    log.info(`[LocalAuth] v483: 团队成员账号已创建 - username: ${input.username}, name: ${input.name}, org: ${input.organizationId}, creator: ${input.creatorId}`);
    
    // @ts-ignore
    return { success: true, userId };
  } catch (error: unknown) {
    log.warn('[LocalAuth] 创建团队成员失败:', error);
    return { success: false, error: (error as Error).message || '创建失败' };
  }
}

/**
 * v483: 更新用户个人信息（用户名、姓名、邮箱）
 */
export async function updateProfile(userId: number, updates: {
  username?: string;
  name?: string;
  email?: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureMultiTenantTables(db);
  
  try {
    // 如果要修改用户名，检查是否已存在
    if (updates.username) {
      const existingUser = await db.execute(sql`
        SELECT id FROM team_members WHERE username = ${updates.username} AND id != ${userId}
      `);
      // @ts-ignore
      const existingRows = (existingUser as Record<string, unknown>[][])[0];
      if (existingRows && existingRows.length > 0) {
        return { success: false, error: '用户名已存在' };
      }
    }
    
    // 构建更新语句
    const setClauses: string[] = [];
    const values: unknown[] = [];
    
    if (updates.username) {
      setClauses.push('username = ?');
      values.push(updates.username);
    }
    if (updates.name) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.email !== undefined) {
      setClauses.push('email = ?');
      values.push(updates.email);
    }
    
    if (setClauses.length === 0) {
      return { success: false, error: '没有需要更新的字段' };
    }
    
    // 使用 sql.raw 构建动态更新
    if (updates.username && updates.name && updates.email !== undefined) {
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
    } else if (updates.email !== undefined) {
      await db.execute(sql`
        UPDATE team_members SET email = ${updates.email} WHERE id = ${userId}
      `);
    }
    
    log.info(`[LocalAuth] v483: 用户信息已更新 - userId: ${userId}, fields: ${Object.keys(updates).join(', ')}`);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message || '更新失败' };
  }
}
