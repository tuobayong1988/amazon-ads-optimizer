import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('InviteCodeService');
/**
 * 邀请码服务 - 支持生成、验证、管理邀请码
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import * as crypto from "crypto";

export type InviteType = 'team_member' | 'external_user';

export interface InviteCode {
  id: number;
  code: string;
  createdBy: number;
  organizationId: number | null;
  inviteType: InviteType;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  creatorName?: string;
}

export interface CreateInviteCodeInput {
  createdBy: number;
  organizationId?: number;
  inviteType?: InviteType;
  maxUses?: number;
  expiresInDays?: number;
  note?: string;
}

let tablesEnsured = false;
async function ensureTablesExist(db: any): Promise<void> {
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
    log.info('[InviteCode] 邀请码相关表已确认就绪');
  } catch (err) {
    log.error('[InviteCode] 确保表存在失败:', (err as Error).message);
  }
}

export function generateInviteCode(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return code;
}

export async function createInviteCode(input: CreateInviteCodeInput): Promise<{ success: boolean; inviteCode?: InviteCode; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    const code = generateInviteCode();
    const now = new Date();
    const expiresAt = input.expiresInDays 
      ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    
    await db.execute(sql`
      INSERT INTO invite_codes (code, created_by, organization_id, invite_type, max_uses, expires_at, note, created_at)
      VALUES (
        ${code}, 
        ${input.createdBy}, 
        ${input.organizationId || null},
        ${input.inviteType || 'external_user'},
        ${input.maxUses || 1},
        ${expiresAt ? expiresAt.toISOString().slice(0, 19).replace('T', ' ') : null},
        ${input.note || null},
        ${now.toISOString().slice(0, 19).replace('T', ' ')}
      )
    `);
    
    const result = await db.execute(sql`SELECT * FROM invite_codes WHERE code = ${code}`) as any;
    const rows = (result as Record<string, any>[][])[0];
    
    if (rows && rows.length > 0) {
      const row = rows[0] as any;
      return {
        success: true,
        inviteCode: {
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
        }
      };
    }
    
    return { success: false, error: '创建邀请码失败' };
  } catch (error: unknown) {
    log.error('[InviteCode] 创建邀请码失败:', error);
    return { success: false, error: (error as Error).message || '创建邀请码失败' };
  }
}

export async function createInviteCodesBatch(input: CreateInviteCodeInput, count: number): Promise<{ success: boolean; inviteCodes?: InviteCode[]; error?: string }> {
  if (count < 1 || count > 100) {
    return { success: false, error: '批量生成数量必须在1-100之间' };
  }
  
  const codes: InviteCode[] = [];
  for (let i = 0; i < count; i++) {
    const result = await createInviteCode(input);
    if (result.success && result.inviteCode) {
      codes.push(result.inviteCode);
    }
  }
  
  return { success: true, inviteCodes: codes };
}

export async function validateInviteCode(code: string): Promise<{ valid: boolean; error?: string; inviteCode?: InviteCode }> {
  const db = await getDb();
  if (!db) return { valid: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    const result = await db.execute(sql`
      SELECT ic.*, u.name as creator_name
      FROM invite_codes ic
      LEFT JOIN users u ON ic.created_by = u.id
      WHERE ic.code = ${code}
    `);
    
    const rows = (result as Record<string, any>[][])[0];
    if (!rows || rows.length === 0) {
      return { valid: false, error: '邀请码不存在' };
    }
    
    const row = rows[0] as any;
    
    if (!row.is_active) {
      return { valid: false, error: '邀请码已被禁用' };
    }
    
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { valid: false, error: '邀请码已过期' };
    }
    
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return { valid: false, error: '邀请码已达到最大使用次数' };
    }
    
    return {
      valid: true,
      inviteCode: {
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
      }
    };
  } catch (error: unknown) {
    log.error('[InviteCode] 验证邀请码失败:', error);
    return { valid: false, error: (error as Error).message || '验证邀请码失败' };
  }
}

export async function useInviteCode(code: string, userId: number, organizationId?: number, ipAddress?: string, userAgent?: string): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    const validation = await validateInviteCode(code);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const inviteCode = validation.inviteCode!;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await db.execute(sql`
      INSERT INTO invite_code_usages (invite_code_id, user_id, organization_id, used_at, ip_address, user_agent)
      VALUES (${inviteCode.id}, ${userId}, ${organizationId || null}, ${now}, ${ipAddress || null}, ${userAgent || null})
    `);
    
    await db.execute(sql`UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ${inviteCode.id}`) as any;
    
    return { success: true };
  } catch (error: unknown) {
    log.error('[InviteCode] 使用邀请码失败:', error);
    return { success: false, error: (error as Error).message || '使用邀请码失败' };
  }
}

export async function getInviteCodes(createdBy?: number): Promise<InviteCode[]> {
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
    
    const rows = (result as Record<string, any>[][])[0] || [];
    return rows.map((row: Record<string, any>) => ({
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
    }));
  } catch (error) {
    log.error('[InviteCode] 获取邀请码列表失败:', error);
    return [];
  }
}

export async function disableInviteCode(id: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    await db.execute(sql`UPDATE invite_codes SET is_active = 0 WHERE id = ${id}`) as any;
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function enableInviteCode(id: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    await db.execute(sql`UPDATE invite_codes SET is_active = 1 WHERE id = ${id}`) as any;
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteInviteCode(id: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  await ensureTablesExist(db);
  
  try {
    await db.execute(sql`DELETE FROM invite_codes WHERE id = ${id}`) as any;
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getInviteCodeStats(createdBy?: number): Promise<{
  total: number;
  active: number;
  used: number;
  expired: number;
  totalUsages: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  await ensureTablesExist(db);
  
  try {
    // v346: 使用Drizzle参数化查询替代sql.raw字符串拼接
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
    
    const rows = (result as Record<string, any>[][])[0];
    if (rows && rows.length > 0) {
      const row = rows[0] as any;
      return {
        total: row.total || 0,
        active: row.active || 0,
        used: row.used || 0,
        expired: row.expired || 0,
        totalUsages: row.total_usages || 0,
      };
    }
    
    return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  } catch (error) {
    log.error('[InviteCode] 获取邀请码统计失败:', error);
    return { total: 0, active: 0, used: 0, expired: 0, totalUsages: 0 };
  }
}
