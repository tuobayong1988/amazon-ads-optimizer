import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createInviteCode, validateInviteCode, getInviteCodes, disableInviteCode } from './inviteCodeService';
import { registerWithInviteCode, loginLocalUser } from './localAuthService';
import { getDb } from './db';
import { sql } from 'drizzle-orm';

describe('邀请码系统测试', () => {
  let testInviteCode: string;
  let testInviteCodeId: number;

  afterAll(async () => {
    // 清理测试数据
    const db = await getDb();
    if (db && testInviteCode) {
      await db.execute(sql`DELETE FROM invite_codes WHERE code = ${testInviteCode}`);
    }
  });

  it('应该能创建邀请码', async () => {
    const result = await createInviteCode({
      createdBy: 1,
      inviteType: 'external_user',
      maxUses: 5,
      expiresInDays: 30,
      note: '测试邀请码',
      organizationId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.inviteCode).toBeDefined();
    expect(result.inviteCode?.code).toHaveLength(8);
    testInviteCode = result.inviteCode!.code;
    testInviteCodeId = result.inviteCode!.id;
  });

  it('应该能验证有效的邀请码', async () => {
    const result = await validateInviteCode(testInviteCode);
    expect(result.valid).toBe(true);
    expect(result.inviteCode?.inviteType).toBe('external_user');
  });

  it('应该拒绝无效的邀请码', async () => {
    const result = await validateInviteCode('INVALID123');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('应该能列出邀请码', async () => {
    const codes = await getInviteCodes(1);
    expect(Array.isArray(codes)).toBe(true);
    expect(codes.some((c: any) => c.code === testInviteCode)).toBe(true);
  });

  it('应该能禁用邀请码', async () => {
    // 先创建一个新的邀请码用于禁用测试
    const createResult = await createInviteCode({
      createdBy: 1,
      inviteType: 'team_member',
      maxUses: 1,
      organizationId: 1,
    });
    
    const codeToDisable = createResult.inviteCode!.code;
    const disableResult = await disableInviteCode(createResult.inviteCode!.id, 1);
    expect(disableResult.success).toBe(true);

    // 验证已禁用的邀请码
    const validateResult = await validateInviteCode(codeToDisable);
    expect(validateResult.valid).toBe(false);
    
    // 清理
    const db = await getDb();
    if (db) {
      await db.execute(sql`DELETE FROM invite_codes WHERE code = ${codeToDisable}`);
    }
  });
});

describe('本地用户注册登录测试', () => {
  let testUsername: string;
  let testInviteCode: string;

  beforeAll(async () => {
    // 创建测试用邀请码
    const result = await createInviteCode({
      createdBy: 1,
      inviteType: 'external_user',
      maxUses: 1,
      organizationId: 1,
    });
    testInviteCode = result.inviteCode!.code;
    testUsername = 'test_user_' + Date.now();
  });

  afterAll(async () => {
    // 清理测试数据
    const db = await getDb();
    if (db) {
      await db.execute(sql`DELETE FROM team_members WHERE username = ${testUsername}`);
      await db.execute(sql`DELETE FROM invite_codes WHERE code = ${testInviteCode}`);
    }
  });

  it('应该能使用邀请码注册新用户', async () => {
    const result = await registerWithInviteCode({
      inviteCode: testInviteCode,
      username: testUsername,
      password: 'testpassword123',
      name: '测试用户',
      email: 'test@example.com',
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.user?.username).toBe(testUsername);
  });

  it('应该拒绝重复的用户名注册', async () => {
    // 先创建新邀请码
    const inviteResult = await createInviteCode({
      createdBy: 1,
      inviteType: 'external_user',
      maxUses: 1,
      organizationId: 1,
    });

    const result = await registerWithInviteCode({
      inviteCode: inviteResult.inviteCode!.code,
      username: testUsername, // 重复的用户名
      password: 'testpassword123',
      name: '另一个用户',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('已存在');
    
    // 清理
    const db = await getDb();
    if (db) {
      await db.execute(sql`DELETE FROM invite_codes WHERE code = ${inviteResult.inviteCode!.code}`);
    }
  });

  it('应该能使用正确的凭证登录', async () => {
    const result = await loginLocalUser({
      username: testUsername,
      password: 'testpassword123',
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.user?.username).toBe(testUsername);
  });

  it('应该拒绝错误的密码', async () => {
    const result = await loginLocalUser({
      username: testUsername,
      password: 'wrongpassword',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('应该拒绝不存在的用户名', async () => {
    const result = await loginLocalUser({
      username: 'nonexistent_user',
      password: 'anypassword',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
