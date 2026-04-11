// Extracted from production dist/index.js
// Original module: server/db/team.ts
// Lines: 138

async function createTeamMember(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(teamMembers).values(data);
  const insertId = result[0].insertId;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, insertId));
  return member || null;
}
async function getTeamMembersByOwner(ownerId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teamMembers).where(eq(teamMembers.ownerId, ownerId)).orderBy(desc(teamMembers.createdAt));
}
async function getTeamMemberById(id) {
  const db = await getDb();
  if (!db) return null;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return member || null;
}
async function getTeamMemberByToken(token) {
  const db = await getDb();
  if (!db) return null;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.inviteToken, token));
  return member || null;
}
async function getTeamMemberByEmail(ownerId, email3) {
  const db = await getDb();
  if (!db) return null;
  const [member] = await db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, email3)));
  return member || null;
}
async function updateTeamMember(id, data) {
  const db = await getDb();
  if (!db) return false;
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
  return true;
}
async function deleteTeamMember(id) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, id));
  await db.delete(teamMembers).where(eq(teamMembers.id, id));
  return true;
}
async function getTeamMembershipsForUser(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teamMembers).where(and(eq(teamMembers.memberId, userId), eq(teamMembers.status, "active")));
}
async function createAccountPermission(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(accountPermissions).values(data);
  const insertId = result[0].insertId;
  const [permission] = await db.select().from(accountPermissions).where(eq(accountPermissions.id, insertId));
  return permission || null;
}
async function getPermissionsByTeamMember(teamMemberId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
}
async function getPermissionsByAccount(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountPermissions).where(eq(accountPermissions.accountId, accountId));
}
async function getPermission(teamMemberId, accountId) {
  const db = await getDb();
  if (!db) return null;
  const [permission] = await db.select().from(accountPermissions).where(and(
    eq(accountPermissions.teamMemberId, teamMemberId),
    eq(accountPermissions.accountId, accountId)
  ));
  return permission || null;
}
async function updateAccountPermission(id, data) {
  const db = await getDb();
  if (!db) return false;
  await db.update(accountPermissions).set(data).where(eq(accountPermissions.id, id));
  return true;
}
async function deleteAccountPermission(id) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountPermissions).where(eq(accountPermissions.id, id));
  return true;
}
async function deletePermissionsByTeamMember(teamMemberId) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  return true;
}
async function setAccountPermissions(teamMemberId, permissions) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  if (permissions.length > 0) {
    await db.insert(accountPermissions).values(
      permissions.map((p) => ({
        teamMemberId,
        accountId: p.accountId,
        permissionLevel: p.permissionLevel,
        canExport: p.canExport ?? true ? 1 : 0,
        canManageCampaigns: p.canManageCampaigns ?? p.permissionLevel !== "view" ? 1 : 0,
        canAdjustBids: p.canAdjustBids ?? p.permissionLevel !== "view" ? 1 : 0,
        canManageNegatives: p.canManageNegatives ?? p.permissionLevel !== "view" ? 1 : 0
      }))
    );
  }
  return true;
}
var init_team = __esm({
  "server/db/team.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createTeamMember, "createTeamMember");
    __name(getTeamMembersByOwner, "getTeamMembersByOwner");
    __name(getTeamMemberById, "getTeamMemberById");
    __name(getTeamMemberByToken, "getTeamMemberByToken");
    __name(getTeamMemberByEmail, "getTeamMemberByEmail");
    __name(updateTeamMember, "updateTeamMember");
    __name(deleteTeamMember, "deleteTeamMember");
    __name(getTeamMembershipsForUser, "getTeamMembershipsForUser");
    __name(createAccountPermission, "createAccountPermission");
    __name(getPermissionsByTeamMember, "getPermissionsByTeamMember");
    __name(getPermissionsByAccount, "getPermissionsByAccount");
    __name(getPermission, "getPermission");
    __name(updateAccountPermission, "updateAccountPermission");
    __name(deleteAccountPermission, "deleteAccountPermission");
    __name(deletePermissionsByTeamMember, "deletePermissionsByTeamMember");
    __name(setAccountPermissions, "setAccountPermissions");
  }
});

