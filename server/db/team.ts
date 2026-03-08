/**
 * v361: 团队与权限管理
 * 从db.ts拆分的子模块
 */

import { and, desc, eq } from 'drizzle-orm';
import { AccountPermission, InsertAccountPermission, InsertTeamMember, TeamMember, accountPermissions, teamMembers } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Team Member Functions ====================

export async function createTeamMember(data: InsertTeamMember): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(teamMembers).values(data);
  const insertId = result[0].insertId;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, insertId));
  return member || null;
}

export async function getTeamMembersByOwner(ownerId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(eq(teamMembers.ownerId, ownerId))
    .orderBy(desc(teamMembers.createdAt));
}

export async function getTeamMemberById(id: number): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return member || null;
}

export async function getTeamMemberByToken(token: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(eq(teamMembers.inviteToken, token));
  return member || null;
}

export async function getTeamMemberByEmail(ownerId: number, email: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, email)));
  return member || null;
}

export async function updateTeamMember(id: number, data: Partial<InsertTeamMember>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
  return true;
}

export async function deleteTeamMember(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 同时删除该成员的所有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, id));
  await db.delete(teamMembers).where(eq(teamMembers.id, id));
  return true;
}

export async function getTeamMembershipsForUser(userId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(and(eq(teamMembers.memberId, userId), eq(teamMembers.status, "active")));
}

// ==================== Account Permission Functions ====================

// ==================== Account Permission Functions ====================

export async function createAccountPermission(data: InsertAccountPermission): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(accountPermissions).values(data);
  const insertId = result[0].insertId;
  const [permission] = await db.select().from(accountPermissions).where(eq(accountPermissions.id, insertId));
  return permission || null;
}

export async function getPermissionsByTeamMember(teamMemberId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.teamMemberId, teamMemberId));
}

export async function getPermissionsByAccount(accountId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.accountId, accountId));
}

export async function getPermission(teamMemberId: number, accountId: number): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [permission] = await db.select().from(accountPermissions)
    .where(and(
      eq(accountPermissions.teamMemberId, teamMemberId),
      eq(accountPermissions.accountId, accountId)
    ));
  return permission || null;
}

export async function updateAccountPermission(id: number, data: Partial<InsertAccountPermission>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(accountPermissions).set(data).where(eq(accountPermissions.id, id));
  return true;
}

export async function deleteAccountPermission(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.id, id));
  return true;
}

export async function deletePermissionsByTeamMember(teamMemberId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  return true;
}

export async function setAccountPermissions(teamMemberId: number, permissions: Array<{ accountId: number; permissionLevel: "full" | "edit" | "view"; canExport?: boolean; canManageCampaigns?: boolean; canAdjustBids?: boolean; canManageNegatives?: boolean }>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 删除现有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  
  // 添加新权限
  if (permissions.length > 0) {
    await db.insert(accountPermissions).values(
      permissions.map(p => ({
        teamMemberId,
        accountId: p.accountId,
        permissionLevel: p.permissionLevel,
        canExport: (p.canExport ?? true) ? 1 : 0,
        canManageCampaigns: (p.canManageCampaigns ?? (p.permissionLevel !== "view")) ? 1 : 0,
        canAdjustBids: (p.canAdjustBids ?? (p.permissionLevel !== "view")) ? 1 : 0,
        canManageNegatives: (p.canManageNegatives ?? (p.permissionLevel !== "view")) ? 1 : 0,
      }))
    );
  }
  
  return true;
}

// ==================== Email Report Subscription Functions ====================
