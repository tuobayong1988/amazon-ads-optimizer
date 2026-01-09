/**
 * 本地认证服务 - 支持邀请码注册、多租户数据隔离
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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
    
    const existingRows = (existingUser as any)[0];
    if (existingRows && existingRows.length > 0) {
      return { success: false, error: '用户名已存在' };
    }
    
    // 3. 确定组织ID
    let organizationId = inviteCode.organizationId;
    
    // 如果是外部用户邀请且没有指定组织，创建新组织
    if (inviteCode.inviteType === 'external_user' && !organizationId) {
      const orgName = input.organizationName || `${input.name}的团队`;
      const orgResult = await db.execute(sql`
        INSERT INTO organizations (name, type, status, max_users, max_accounts, created_at)
        VALUES (${orgName}, 'external', 'active', 10, 5, NOW())
      `);
      organizationId = (orgResult as any)[0]?.insertId;
    }
    
    if (!organizationId) {
      organizationId = 1; // 默认组织
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
    
    const userId = (userResult as any)[0]?.insertId;
    
    // 6. 如果是新组织的所有者，更新组织的owner_id
    if (inviteCode.inviteType === 'external_user' && organizationId !== 1) {
      await db.execute(sql`
        UPDATE organizations SET owner_id = ${userId} WHERE id = ${organizationId}
      `);
    }
    
    // 7. 使用邀请码（增加使用计数）
    await useInviteCode(input.inviteCode, userId, organizationId, ipAddress, userAgent);
    
    // 8. 记录审计日志
    const { createAuditLog } = await import('./auditLogService');
    await createAuditLog({
      organizationId,
      userId,
      userName: input.name,
      actionType: 'register',
      actionCategory: 'auth',
      resourceType: 'user',
      resourceId: String(userId),
      resourceName: input.name,
      description: `用户通过邀请码 ${input.inviteCode} 注册`,
      ipAddress,
      userAgent,
    });
    
    // 9. 生成JWT token
    const token = generateToken(userId, organizationId, input.username, input.name);
    
    return {
      success: true,
      user: {
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
  } catch (error: any) {
    console.error('[LocalAuth] 注册失败:', error);
    return { success: false, error: error.message || '注册失败' };
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
  
  try {
    // 1. 查找用户
    const result = await db.execute(sql`
      SELECT tm.*, o.name as organization_name
      FROM team_members tm
      LEFT JOIN organizations o ON tm.organization_id = o.id
      WHERE tm.username = ${input.username}
    `);
    
    const rows = (result as any)[0];
    if (!rows || rows.length === 0) {
      return { success: false, error: '用户名或密码错误' };
    }
    
    const user = rows[0];
    
    // 2. 检查账号状态
    if (user.status === 'suspended') {
      const { createAuditLog } = await import('./auditLogService');
      await createAuditLog({
        organizationId: user.organization_id,
        userId: user.id,
        userName: user.name,
        actionType: 'login',
        actionCategory: 'auth',
        resourceType: 'user',
        resourceId: String(user.id),
        description: '登录失败：账号已被暂停',
        ipAddress,
        userAgent,
        status: 'failed',
        errorMessage: '账号已被暂停',
      });
      return { success: false, error: '您的账号已被暂停，请联系管理员' };
    }
    
    if (user.status === 'deleted') {
      return { success: false, error: '账号不存在' };
    }
    
    // 3. 验证密码
    const passwordValid = await bcrypt.compare(input.password, user.password_hash);
    if (!passwordValid) {
      const { createAuditLog } = await import('./auditLogService');
      await createAuditLog({
        organizationId: user.organization_id,
        userId: user.id,
        userName: user.name,
        actionType: 'login',
        actionCategory: 'auth',
        resourceType: 'user',
        resourceId: String(user.id),
        description: '登录失败：密码错误',
        ipAddress,
        userAgent,
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
      organizationId: user.organization_id,
      userId: user.id,
      userName: user.name,
      actionType: 'login',
      actionCategory: 'auth',
      resourceType: 'user',
      resourceId: String(user.id),
      description: '用户登录成功',
      ipAddress,
      userAgent,
      status: 'success',
    });
    
    // 6. 生成JWT token
    const token = generateToken(user.id, user.organization_id, user.username, user.name);
    
    return {
      success: true,
      user: {
        id: user.id,
        organizationId: user.organization_id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: now,
      },
      token,
    };
  } catch (error: any) {
    console.error('[LocalAuth] 登录失败:', error);
    return { success: false, error: error.message || '登录失败' };
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
  try {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'default-secret-key';
    
    const decoded = jwt.default.verify(token, secret) as any;
    
    const db = await getDb();
    if (!db) return { valid: false, error: '数据库连接失败' };
    
    const result = await db.execute(sql`
      SELECT * FROM team_members WHERE id = ${decoded.userId}
    `);
    
    const rows = (result as any)[0];
    if (!rows || rows.length === 0) {
      return { valid: false, error: '用户不存在' };
    }
    
    const user = rows[0];
    
    if (user.status !== 'active') {
      return { valid: false, error: '账号已被禁用' };
    }
    
    return {
      valid: true,
      user: {
        id: user.id,
        organizationId: user.organization_id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
    };
  } catch (error: any) {
    return { valid: false, error: 'Token无效或已过期' };
  }
}

/**
 * 生成JWT token
 */
function generateToken(userId: number, organizationId: number, username: string, name: string): string {
  // Using imported jwt module
  const secret = process.env.JWT_SECRET || 'default-secret-key';
  
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
  
  try {
    const result = await db.execute(sql`
      SELECT password_hash FROM team_members WHERE id = ${userId}
    `);
    
    const rows = (result as any)[0];
    if (!rows || rows.length === 0) {
      return { success: false, error: '用户不存在' };
    }
    
    const user = rows[0];
    const passwordValid = await bcrypt.compare(oldPassword, user.password_hash);
    
    if (!passwordValid) {
      return { success: false, error: '原密码错误' };
    }
    
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await db.execute(sql`
      UPDATE team_members SET password_hash = ${newPasswordHash} WHERE id = ${userId}
    `);
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '修改密码失败' };
  }
}
