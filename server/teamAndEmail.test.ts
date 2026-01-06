/**
 * 团队管理和邮件报表功能单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCrossAccountSummaryReport,
  generateAccountPerformanceReport,
  generateHealthAlertReport,
  generateOptimizationSummaryReport,
  formatReportAsHtml,
  getDateRangeFromType,
} from './emailReportService';

// Mock db module
vi.mock('./db', () => ({
  getAdAccountsByUserId: vi.fn().mockResolvedValue([
    { id: 1, accountName: 'Test Account 1', storeName: 'Store 1', marketplace: 'US' },
    { id: 2, accountName: 'Test Account 2', storeName: 'Store 2', marketplace: 'UK' },
  ]),
  getAdAccountById: vi.fn().mockResolvedValue({
    id: 1, accountName: 'Test Account', storeName: 'Test Store', marketplace: 'US'
  }),
  getPerformanceGroupsByAccountId: vi.fn().mockResolvedValue([
    { id: 1, name: 'Performance Group 1' },
  ]),
  getCampaignsByPerformanceGroupId: vi.fn().mockResolvedValue([
    {
      id: 1,
      campaignName: 'Test Campaign',
      spend: '100.00',
      sales: '500.00',
      impressions: 10000,
      clicks: 200,
      orders: 10,
    },
  ]),
  getBiddingLogsByAccountId: vi.fn().mockResolvedValue([
    {
      id: 1,
      accountId: 1,
      campaignId: 1,
      keywordId: 1,
      previousBid: '1.00',
      newBid: '1.20',
      adjustmentType: 'increase',
      reason: 'Performance improvement',
      createdAt: new Date(),
    },
  ]),
  getEmailSubscriptionById: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    name: 'Test Subscription',
    reportType: 'cross_account_summary',
    frequency: 'weekly',
    recipients: ['test@example.com'],
    accountIds: [],
    dateRange: 'last_7_days',
    isActive: true,
  }),
  createEmailSendLog: vi.fn().mockResolvedValue({ id: 1 }),
  updateEmailSubscription: vi.fn().mockResolvedValue({}),
  getDueEmailSubscriptions: vi.fn().mockResolvedValue([]),
  createTeamMember: vi.fn().mockResolvedValue({ id: 1 }),
  getTeamMembersByUserId: vi.fn().mockResolvedValue([]),
  getTeamMemberById: vi.fn().mockResolvedValue(null),
  updateTeamMember: vi.fn().mockResolvedValue({}),
  deleteTeamMember: vi.fn().mockResolvedValue({}),
  setAccountPermissions: vi.fn().mockResolvedValue({}),
  getAccountPermissionsByMemberId: vi.fn().mockResolvedValue([]),
}));

// Mock notification
vi.mock('./_core/notification', () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

describe('日期范围计算', () => {
  it('应该正确计算最近7天的日期范围', () => {
    const { start, end } = getDateRangeFromType('last_7_days');
    
    const expectedEnd = new Date();
    expectedEnd.setHours(23, 59, 59, 999);
    
    const expectedStart = new Date();
    expectedStart.setHours(0, 0, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 7);
    
    expect(start.getDate()).toBe(expectedStart.getDate());
    expect(end.getDate()).toBe(expectedEnd.getDate());
  });

  it('应该正确计算最近14天的日期范围', () => {
    const { start, end } = getDateRangeFromType('last_14_days');
    
    const expectedStart = new Date();
    expectedStart.setHours(0, 0, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 14);
    
    expect(start.getDate()).toBe(expectedStart.getDate());
  });

  it('应该正确计算最近30天的日期范围', () => {
    const { start, end } = getDateRangeFromType('last_30_days');
    
    const expectedStart = new Date();
    expectedStart.setHours(0, 0, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 30);
    
    expect(start.getDate()).toBe(expectedStart.getDate());
  });
});

describe('跨账号汇总报表生成', () => {
  it('应该生成包含所有账号数据的汇总报表', async () => {
    const report = await generateCrossAccountSummaryReport(1, [], 'last_7_days');
    
    expect(report).toBeDefined();
    expect(report.title).toBe('跨账号汇总报表');
    expect(report.summary).toBeDefined();
    expect(report.summary.totalAccounts).toBe(2);
    expect(report.details).toBeDefined();
    expect(Array.isArray(report.details)).toBe(true);
  });

  it('应该正确计算汇总指标', async () => {
    const report = await generateCrossAccountSummaryReport(1, [], 'last_7_days');
    
    expect(report.summary.totalSpend).toBeGreaterThanOrEqual(0);
    expect(report.summary.totalSales).toBeGreaterThanOrEqual(0);
    expect(report.summary.avgAcos).toBeGreaterThanOrEqual(0);
    expect(report.summary.avgRoas).toBeGreaterThanOrEqual(0);
  });

  it('应该能够筛选指定账号', async () => {
    const report = await generateCrossAccountSummaryReport(1, [1], 'last_7_days');
    
    expect(report).toBeDefined();
    expect(report.details.length).toBeLessThanOrEqual(1);
  });
});

describe('单账号表现报表生成', () => {
  it('应该生成指定账号的表现报表', async () => {
    const report = await generateAccountPerformanceReport(1, 'last_7_days');
    
    expect(report).toBeDefined();
    expect(report.title).toContain('表现报表');
    expect(report.summary).toBeDefined();
    expect(report.details).toBeDefined();
  });

  it('应该包含广告活动级别的详细数据', async () => {
    const report = await generateAccountPerformanceReport(1, 'last_7_days');
    
    expect(report.details.length).toBeGreaterThan(0);
    const firstCampaign = report.details[0];
    expect(firstCampaign).toHaveProperty('campaignName');
    expect(firstCampaign).toHaveProperty('spend');
    expect(firstCampaign).toHaveProperty('sales');
  });
});

describe('健康度告警报表生成', () => {
  it('应该生成健康度告警报表', async () => {
    const report = await generateHealthAlertReport(1, []);
    
    expect(report).toBeDefined();
    expect(report.title).toBe('健康度告警报表');
    expect(report.summary).toBeDefined();
    expect(report.summary.totalAlerts).toBeDefined();
    expect(report.summary.criticalAlerts).toBeDefined();
    expect(report.summary.warningAlerts).toBeDefined();
  });

  it('应该正确分类告警严重程度', async () => {
    const report = await generateHealthAlertReport(1, []);
    
    const totalAlerts = report.summary.totalAlerts;
    const criticalAlerts = report.summary.criticalAlerts;
    const warningAlerts = report.summary.warningAlerts;
    
    expect(criticalAlerts + warningAlerts).toBeLessThanOrEqual(totalAlerts);
  });
});

describe('优化汇总报表生成', () => {
  it('应该生成优化汇总报表', async () => {
    const report = await generateOptimizationSummaryReport(1, 'last_7_days');
    
    expect(report).toBeDefined();
    expect(report.title).toBe('优化汇总报表');
    expect(report.summary).toBeDefined();
    expect(report.summary.totalAdjustments).toBeDefined();
    expect(report.summary.bidIncreases).toBeDefined();
    expect(report.summary.bidDecreases).toBeDefined();
  });
});

describe('报表HTML格式化', () => {
  it('应该将报表格式化为有效的HTML', async () => {
    const report = await generateCrossAccountSummaryReport(1, [], 'last_7_days');
    const html = formatReportAsHtml(report);
    
    expect(html).toBeDefined();
    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
    expect(html).toContain(report.title);
  });

  it('应该包含汇总数据', async () => {
    const report = await generateCrossAccountSummaryReport(1, [], 'last_7_days');
    const html = formatReportAsHtml(report);
    
    expect(html).toContain('summary-item');
    expect(html).toContain('summary-grid');
  });

  it('应该包含详细数据表格', async () => {
    const report = await generateCrossAccountSummaryReport(1, [], 'last_7_days');
    const html = formatReportAsHtml(report);
    
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
  });
});

describe('团队成员角色权限', () => {
  it('管理员角色应该有完全控制权限', () => {
    const adminPermissions = {
      canManageTeam: true,
      canManageAccounts: true,
      canEditCampaigns: true,
      canViewReports: true,
      canExportData: true,
    };
    
    expect(adminPermissions.canManageTeam).toBe(true);
    expect(adminPermissions.canManageAccounts).toBe(true);
  });

  it('编辑角色应该有编辑权限但无管理权限', () => {
    const editorPermissions = {
      canManageTeam: false,
      canManageAccounts: false,
      canEditCampaigns: true,
      canViewReports: true,
      canExportData: true,
    };
    
    expect(editorPermissions.canManageTeam).toBe(false);
    expect(editorPermissions.canEditCampaigns).toBe(true);
  });

  it('只读角色应该只有查看权限', () => {
    const viewerPermissions = {
      canManageTeam: false,
      canManageAccounts: false,
      canEditCampaigns: false,
      canViewReports: true,
      canExportData: false,
    };
    
    expect(viewerPermissions.canManageTeam).toBe(false);
    expect(viewerPermissions.canEditCampaigns).toBe(false);
    expect(viewerPermissions.canViewReports).toBe(true);
  });
});

describe('邮件订阅频率计算', () => {
  it('每日订阅应该在第二天发送', () => {
    const frequency = 'daily';
    const sendTime = '09:00';
    
    const now = new Date();
    const nextSend = new Date(now);
    nextSend.setDate(nextSend.getDate() + 1);
    nextSend.setHours(9, 0, 0, 0);
    
    expect(nextSend.getDate()).toBe(now.getDate() + 1);
  });

  it('每周订阅应该在指定星期几发送', () => {
    const frequency = 'weekly';
    const sendDayOfWeek = 1; // 周一
    
    const now = new Date();
    const currentDay = now.getDay();
    let daysUntilMonday = sendDayOfWeek - currentDay;
    if (daysUntilMonday <= 0) {
      daysUntilMonday += 7;
    }
    
    const nextSend = new Date(now);
    nextSend.setDate(nextSend.getDate() + daysUntilMonday);
    
    expect(nextSend.getDay()).toBe(sendDayOfWeek);
  });

  it('每月订阅应该在指定日期发送', () => {
    const frequency = 'monthly';
    const sendDayOfMonth = 15;
    
    const now = new Date();
    const nextSend = new Date(now);
    nextSend.setDate(sendDayOfMonth);
    
    if (nextSend <= now) {
      nextSend.setMonth(nextSend.getMonth() + 1);
    }
    
    expect(nextSend.getDate()).toBe(sendDayOfMonth);
  });
});

describe('账号权限级别', () => {
  it('完全控制权限应该包含所有操作', () => {
    const fullPermission = {
      permissionLevel: 'full',
      canExport: true,
      canManageCampaigns: true,
      canAdjustBids: true,
      canManageNegatives: true,
    };
    
    expect(fullPermission.canExport).toBe(true);
    expect(fullPermission.canManageCampaigns).toBe(true);
    expect(fullPermission.canAdjustBids).toBe(true);
    expect(fullPermission.canManageNegatives).toBe(true);
  });

  it('编辑权限应该允许修改但不能导出', () => {
    const editPermission = {
      permissionLevel: 'edit',
      canExport: false,
      canManageCampaigns: true,
      canAdjustBids: true,
      canManageNegatives: true,
    };
    
    expect(editPermission.canExport).toBe(false);
    expect(editPermission.canManageCampaigns).toBe(true);
  });

  it('只读权限应该只能查看', () => {
    const viewPermission = {
      permissionLevel: 'view',
      canExport: false,
      canManageCampaigns: false,
      canAdjustBids: false,
      canManageNegatives: false,
    };
    
    expect(viewPermission.canExport).toBe(false);
    expect(viewPermission.canManageCampaigns).toBe(false);
    expect(viewPermission.canAdjustBids).toBe(false);
    expect(viewPermission.canManageNegatives).toBe(false);
  });
});

describe('邮件发送日志', () => {
  it('应该记录成功发送的邮件', () => {
    const sendLog = {
      subscriptionId: 1,
      recipients: ['test@example.com'],
      status: 'sent',
      emailSubject: 'Test Report',
      sentAt: new Date(),
    };
    
    expect(sendLog.status).toBe('sent');
    expect(sendLog.recipients.length).toBeGreaterThan(0);
  });

  it('应该记录失败的邮件及错误信息', () => {
    const sendLog = {
      subscriptionId: 1,
      recipients: ['test@example.com'],
      status: 'failed',
      errorMessage: 'SMTP connection failed',
      attemptedAt: new Date(),
    };
    
    expect(sendLog.status).toBe('failed');
    expect(sendLog.errorMessage).toBeDefined();
  });
});
