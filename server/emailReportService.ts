/**
 * 邮件报表服务模块
 * 负责生成和发送定期报表邮件
 */

import * as db from './db';
import { notifyOwner } from './_core/notification';

// 报表类型定义
export type ReportType = 
  | 'cross_account_summary'
  | 'account_performance'
  | 'campaign_performance'
  | 'keyword_performance'
  | 'health_alert'
  | 'optimization_summary';

// 日期范围类型
export type DateRange = 'last_7_days' | 'last_14_days' | 'last_30_days' | 'last_month' | 'custom';

// 报表数据接口
export interface ReportData {
  title: string;
  generatedAt: Date;
  dateRange: {
    start: Date;
    end: Date;
  };
  summary: Record<string, any>;
  details: any[];
  charts?: any[];
}

/**
 * 根据日期范围获取开始和结束日期
 */
export function getDateRangeFromType(dateRange: DateRange): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  
  switch (dateRange) {
    case 'last_7_days':
      start.setDate(start.getDate() - 7);
      break;
    case 'last_14_days':
      start.setDate(start.getDate() - 14);
      break;
    case 'last_30_days':
      start.setDate(start.getDate() - 30);
      break;
    case 'last_month':
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      end.setDate(0); // 上个月最后一天
      break;
    default:
      start.setDate(start.getDate() - 7);
  }
  
  return { start, end };
}

/**
 * 生成跨账号汇总报表
 */
export async function generateCrossAccountSummaryReport(
  userId: number,
  accountIds: number[],
  dateRange: DateRange
): Promise<ReportData> {
  const { start, end } = getDateRangeFromType(dateRange);
  
  // 获取用户的所有账号或指定账号
  let accounts = await db.getAdAccountsByUserId(userId);
  if (accountIds.length > 0) {
    accounts = accounts.filter(a => accountIds.includes(a.id));
  }
  
  // 汇总数据
  let totalSpend = 0;
  let totalSales = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalOrders = 0;
  
  const accountDetails = await Promise.all(
    accounts.map(async (account) => {
      const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
      let accountSpend = 0;
      let accountSales = 0;
      let accountImpressions = 0;
      let accountClicks = 0;
      let accountOrders = 0;
      
      for (const pg of performanceGroups) {
        const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
        for (const campaign of campaigns) {
          accountSpend += parseFloat(campaign.spend || '0');
          accountSales += parseFloat(campaign.sales || '0');
          accountImpressions += campaign.impressions || 0;
          accountClicks += campaign.clicks || 0;
          accountOrders += campaign.orders || 0;
        }
      }
      
      totalSpend += accountSpend;
      totalSales += accountSales;
      totalImpressions += accountImpressions;
      totalClicks += accountClicks;
      totalOrders += accountOrders;
      
      return {
        accountId: account.id,
        accountName: account.accountName,
        storeName: account.storeName,
        marketplace: account.marketplace,
        spend: accountSpend,
        sales: accountSales,
        impressions: accountImpressions,
        clicks: accountClicks,
        orders: accountOrders,
        acos: accountSales > 0 ? (accountSpend / accountSales) * 100 : 0,
        roas: accountSpend > 0 ? accountSales / accountSpend : 0,
      };
    })
  );
  
  return {
    title: '跨账号汇总报表',
    generatedAt: new Date(),
    dateRange: { start, end },
    summary: {
      totalAccounts: accounts.length,
      totalSpend,
      totalSales,
      totalImpressions,
      totalClicks,
      totalOrders,
      avgAcos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
      avgRoas: totalSpend > 0 ? totalSales / totalSpend : 0,
      avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      avgCvr: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
    },
    details: accountDetails,
  };
}

/**
 * 生成单账号表现报表
 */
export async function generateAccountPerformanceReport(
  accountId: number,
  dateRange: DateRange
): Promise<ReportData> {
  const { start, end } = getDateRangeFromType(dateRange);
  
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    throw new Error('账号不存在');
  }
  
  const performanceGroups = await db.getPerformanceGroupsByAccountId(accountId);
  
  let totalSpend = 0;
  let totalSales = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalOrders = 0;
  
  const campaignDetails: any[] = [];
  
  for (const pg of performanceGroups) {
    const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
    for (const campaign of campaigns) {
      const spend = parseFloat(campaign.spend || '0');
      const sales = parseFloat(campaign.sales || '0');
      
      totalSpend += spend;
      totalSales += sales;
      totalImpressions += campaign.impressions || 0;
      totalClicks += campaign.clicks || 0;
      totalOrders += campaign.orders || 0;
      
      campaignDetails.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        performanceGroup: pg.name,
        spend,
        sales,
        impressions: campaign.impressions || 0,
        clicks: campaign.clicks || 0,
        orders: campaign.orders || 0,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
        roas: spend > 0 ? sales / spend : 0,
      });
    }
  }
  
  return {
    title: `${account.storeName || account.accountName} 表现报表`,
    generatedAt: new Date(),
    dateRange: { start, end },
    summary: {
      accountName: account.accountName,
      storeName: account.storeName,
      marketplace: account.marketplace,
      totalSpend,
      totalSales,
      totalImpressions,
      totalClicks,
      totalOrders,
      acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
      roas: totalSpend > 0 ? totalSales / totalSpend : 0,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      cvr: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
    },
    details: campaignDetails,
  };
}

/**
 * 生成健康度告警报表
 */
export async function generateHealthAlertReport(
  userId: number,
  accountIds: number[]
): Promise<ReportData> {
  const { start, end } = getDateRangeFromType('last_7_days');
  
  let accounts = await db.getAdAccountsByUserId(userId);
  if (accountIds.length > 0) {
    accounts = accounts.filter(a => accountIds.includes(a.id));
  }
  
  const alerts: any[] = [];
  
  for (const account of accounts) {
    const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
    
    for (const pg of performanceGroups) {
      const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
      
      for (const campaign of campaigns) {
        const spend = parseFloat(campaign.spend || '0');
        const sales = parseFloat(campaign.sales || '0');
        const acos = sales > 0 ? (spend / sales) * 100 : 0;
        const ctr = (campaign.impressions || 0) > 0 
          ? ((campaign.clicks || 0) / (campaign.impressions || 1)) * 100 
          : 0;
        
        // 检查ACoS异常
        if (acos > 50) {
          alerts.push({
            type: 'high_acos',
            severity: acos > 80 ? 'critical' : 'warning',
            account: account.storeName || account.accountName,
            campaign: campaign.campaignName,
            metric: 'ACoS',
            value: acos.toFixed(2) + '%',
            threshold: '50%',
            message: `ACoS过高: ${acos.toFixed(2)}%`,
          });
        }
        
        // 检查CTR过低
        if (ctr < 0.1 && (campaign.impressions || 0) > 1000) {
          alerts.push({
            type: 'low_ctr',
            severity: 'warning',
            account: account.storeName || account.accountName,
            campaign: campaign.campaignName,
            metric: 'CTR',
            value: ctr.toFixed(3) + '%',
            threshold: '0.1%',
            message: `点击率过低: ${ctr.toFixed(3)}%`,
          });
        }
        
        // 检查无转化
        if (spend > 50 && (campaign.orders || 0) === 0) {
          alerts.push({
            type: 'no_conversion',
            severity: 'critical',
            account: account.storeName || account.accountName,
            campaign: campaign.campaignName,
            metric: '转化',
            value: '0',
            threshold: '花费>$50',
            message: `花费$${spend.toFixed(2)}但无转化`,
          });
        }
      }
    }
  }
  
  return {
    title: '健康度告警报表',
    generatedAt: new Date(),
    dateRange: { start, end },
    summary: {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
      warningAlerts: alerts.filter(a => a.severity === 'warning').length,
      accountsChecked: accounts.length,
    },
    details: alerts,
  };
}

/**
 * 生成优化汇总报表
 */
export async function generateOptimizationSummaryReport(
  userId: number,
  dateRange: DateRange
): Promise<ReportData> {
  const { start, end } = getDateRangeFromType(dateRange);
  
  // 获取竞价日志
  const accounts = await db.getAdAccountsByUserId(userId);
  const biddingLogs: any[] = [];
  
  for (const account of accounts) {
    const logs = await db.getBiddingLogsByAccountId(account.id, 100);
    biddingLogs.push(...logs.filter(log => {
      const logDate = new Date(log.createdAt);
      return logDate >= start && logDate <= end;
    }));
  }
  
  // 统计优化操作
  const bidIncreases = biddingLogs.filter(l => l.adjustmentType === 'increase');
  const bidDecreases = biddingLogs.filter(l => l.adjustmentType === 'decrease');
  
  return {
    title: '优化汇总报表',
    generatedAt: new Date(),
    dateRange: { start, end },
    summary: {
      totalAdjustments: biddingLogs.length,
      bidIncreases: bidIncreases.length,
      bidDecreases: bidDecreases.length,
      avgIncreaseAmount: bidIncreases.length > 0 
        ? bidIncreases.reduce((sum, l) => sum + Math.abs(parseFloat(l.newBid || '0') - parseFloat(l.previousBid || '0')), 0) / bidIncreases.length 
        : 0,
      avgDecreaseAmount: bidDecreases.length > 0 
        ? bidDecreases.reduce((sum, l) => sum + Math.abs(parseFloat(l.previousBid || '0') - parseFloat(l.newBid || '0')), 0) / bidDecreases.length 
        : 0,
    },
    details: biddingLogs.slice(0, 50).map(log => ({
      date: log.createdAt,
      account: log.accountId,
      campaign: log.campaignId,
      keyword: log.keywordId,
      previousBid: log.previousBid,
      newBid: log.newBid,
      adjustmentType: log.adjustmentType,
      reason: log.reason,
    })),
  };
}

/**
 * 根据报表类型生成报表
 */
export async function generateReport(
  reportType: ReportType,
  userId: number,
  accountIds: number[],
  dateRange: DateRange
): Promise<ReportData> {
  switch (reportType) {
    case 'cross_account_summary':
      return generateCrossAccountSummaryReport(userId, accountIds, dateRange);
    case 'account_performance':
      if (accountIds.length === 0) {
        throw new Error('单账号报表需要指定账号');
      }
      return generateAccountPerformanceReport(accountIds[0], dateRange);
    case 'health_alert':
      return generateHealthAlertReport(userId, accountIds);
    case 'optimization_summary':
      return generateOptimizationSummaryReport(userId, dateRange);
    default:
      return generateCrossAccountSummaryReport(userId, accountIds, dateRange);
  }
}

/**
 * 格式化报表为HTML邮件内容
 */
export function formatReportAsHtml(report: ReportData): string {
  const formatNumber = (num: number) => num.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const formatCurrency = (num: number) => '$' + formatNumber(num);
  const formatPercent = (num: number) => formatNumber(num) + '%';
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0 0 10px 0; font-size: 24px; }
        .header .date { opacity: 0.9; font-size: 14px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 0 0 10px 10px; margin-bottom: 20px; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
        .summary-item { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .summary-item .label { font-size: 12px; color: #666; margin-bottom: 5px; }
        .summary-item .value { font-size: 20px; font-weight: bold; color: #333; }
        .details { margin-top: 20px; }
        .details h2 { font-size: 18px; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; }
        tr:hover { background: #f8f9fa; }
        .alert-critical { color: #dc3545; }
        .alert-warning { color: #ffc107; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${report.title}</h1>
          <div class="date">
            报表周期: ${report.dateRange.start.toLocaleDateString('zh-CN')} - ${report.dateRange.end.toLocaleDateString('zh-CN')}
            <br>生成时间: ${report.generatedAt.toLocaleString('zh-CN')}
          </div>
        </div>
        
        <div class="summary">
          <div class="summary-grid">
  `;
  
  // 添加汇总数据
  const summaryLabels: Record<string, string> = {
    totalAccounts: '账号数量',
    totalSpend: '总花费',
    totalSales: '总销售额',
    totalImpressions: '总展示',
    totalClicks: '总点击',
    totalOrders: '总订单',
    avgAcos: '平均ACoS',
    avgRoas: '平均ROAS',
    avgCtr: '平均CTR',
    avgCvr: '平均CVR',
    totalAlerts: '告警总数',
    criticalAlerts: '严重告警',
    warningAlerts: '警告',
    totalAdjustments: '调整总数',
    bidIncreases: '加价次数',
    bidDecreases: '降价次数',
  };
  
  for (const [key, value] of Object.entries(report.summary)) {
    const label = summaryLabels[key] || key;
    let formattedValue = String(value);
    
    if (key.includes('Spend') || key.includes('Sales') || key.includes('Amount')) {
      formattedValue = formatCurrency(value as number);
    } else if (key.includes('Acos') || key.includes('Roas') || key.includes('Ctr') || key.includes('Cvr')) {
      formattedValue = formatPercent(value as number);
    } else if (typeof value === 'number') {
      formattedValue = formatNumber(value);
    }
    
    html += `
      <div class="summary-item">
        <div class="label">${label}</div>
        <div class="value">${formattedValue}</div>
      </div>
    `;
  }
  
  html += `
          </div>
        </div>
        
        <div class="details">
          <h2>详细数据</h2>
          <table>
            <thead>
              <tr>
  `;
  
  // 添加表头
  if (report.details.length > 0) {
    const firstRow = report.details[0];
    for (const key of Object.keys(firstRow)) {
      html += `<th>${key}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    // 添加数据行
    for (const row of report.details.slice(0, 20)) {
      html += '<tr>';
      for (const value of Object.values(row)) {
        let formattedValue = String(value);
        if (typeof value === 'number') {
          formattedValue = formatNumber(value);
        }
        html += `<td>${formattedValue}</td>`;
      }
      html += '</tr>';
    }
    
    if (report.details.length > 20) {
      html += `<tr><td colspan="${Object.keys(firstRow).length}" style="text-align:center;color:#666;">... 还有 ${report.details.length - 20} 条数据</td></tr>`;
    }
  }
  
  html += `
            </tbody>
          </table>
        </div>
        
        <div class="footer">
          <p>此邮件由 Amazon Ads Optimizer 自动发送</p>
          <p>如需取消订阅，请登录系统修改邮件推送设置</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return html;
}

/**
 * 发送报表邮件
 */
export async function sendReportEmail(
  subscriptionId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await db.getEmailSubscriptionById(subscriptionId);
    if (!subscription) {
      return { success: false, error: '订阅不存在' };
    }
    
    // 生成报表
    const report = await generateReport(
      subscription.reportType as ReportType,
      subscription.userId,
      (subscription.accountIds as number[]) || [],
      (subscription.dateRange as DateRange) || 'last_7_days'
    );
    
    // 格式化为HTML
    const htmlContent = formatReportAsHtml(report);
    
    // 发送邮件（使用系统通知API）
    const recipients = (subscription.recipients as string[]) || [];
    const emailSubject = `[Amazon Ads Optimizer] ${report.title} - ${new Date().toLocaleDateString('zh-CN')}`;
    
    // 使用notifyOwner发送通知（实际生产环境应该使用专门的邮件服务）
    await notifyOwner({
      title: emailSubject,
      content: `报表已生成，包含 ${report.details.length} 条数据记录。收件人: ${recipients.join(', ')}`,
    });
    
    // 记录发送日志
    await db.createEmailSendLog({
      subscriptionId,
      recipients,
      status: 'sent',
      emailSubject,
      reportData: report,
    });
    
    // 更新订阅的发送信息
    const nextSendAt = calculateNextSendTime(
      subscription.frequency,
      subscription.sendTime || '09:00',
      subscription.sendDayOfWeek ?? undefined,
      subscription.sendDayOfMonth ?? undefined
    );
    
    await db.updateEmailSubscription(subscriptionId, {
      lastSentAt: new Date(),
      nextSendAt,
      sendCount: (subscription.sendCount || 0) + 1,
    });
    
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    
    // 记录失败日志
    await db.createEmailSendLog({
      subscriptionId,
      recipients: [],
      status: 'failed',
      errorMessage,
    });
    
    return { success: false, error: errorMessage };
  }
}

/**
 * 计算下次发送时间
 */
function calculateNextSendTime(
  frequency: string,
  sendTime: string,
  sendDayOfWeek?: number,
  sendDayOfMonth?: number
): Date {
  const now = new Date();
  const [hours, minutes] = sendTime.split(':').map(Number);
  
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (frequency === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    const targetDay = sendDayOfWeek ?? 1;
    const currentDay = next.getDay();
    let daysUntilTarget = targetDay - currentDay;
    if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
      daysUntilTarget += 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (frequency === 'monthly') {
    const targetDate = sendDayOfMonth ?? 1;
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

/**
 * 处理到期的邮件订阅
 */
export async function processDueEmailSubscriptions(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const dueSubscriptions = await db.getDueEmailSubscriptions();
  
  let succeeded = 0;
  let failed = 0;
  
  for (const subscription of dueSubscriptions) {
    const result = await sendReportEmail(subscription.id);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }
  
  return {
    processed: dueSubscriptions.length,
    succeeded,
    failed,
  };
}
