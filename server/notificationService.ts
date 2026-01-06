/**
 * Notification Service - Handle alerts and notifications
 */

import { notifyOwner } from "./_core/notification";

// Notification types
export interface AlertNotification {
  userId: number;
  accountId?: number;
  type: 'alert' | 'report' | 'system';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
}

export interface NotificationConfig {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  acosThreshold: number;
  ctrDropThreshold: number;
  conversionDropThreshold: number;
  spendSpikeThreshold: number;
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
  quietHoursStart: number;
  quietHoursEnd: number;
}

// Default notification config
export const defaultNotificationConfig: NotificationConfig = {
  emailEnabled: true,
  inAppEnabled: true,
  acosThreshold: 50,
  ctrDropThreshold: 30,
  conversionDropThreshold: 30,
  spendSpikeThreshold: 50,
  frequency: 'daily',
  quietHoursStart: 22,
  quietHoursEnd: 8,
};

/**
 * Check if current time is within quiet hours
 */
export function isQuietHours(config: NotificationConfig): boolean {
  const now = new Date();
  const currentHour = now.getHours();
  
  if (config.quietHoursStart > config.quietHoursEnd) {
    // Quiet hours span midnight (e.g., 22:00 - 08:00)
    return currentHour >= config.quietHoursStart || currentHour < config.quietHoursEnd;
  } else {
    // Quiet hours within same day
    return currentHour >= config.quietHoursStart && currentHour < config.quietHoursEnd;
  }
}

/**
 * Send notification to owner
 */
export async function sendNotification(notification: AlertNotification): Promise<boolean> {
  try {
    // Format the notification content
    const severityEmoji = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨'
    };
    
    const formattedTitle = `${severityEmoji[notification.severity]} [${notification.severity.toUpperCase()}] ${notification.title}`;
    
    let content = notification.message;
    
    if (notification.relatedEntityType && notification.relatedEntityId) {
      content += `\n\n相关实体: ${notification.relatedEntityType} #${notification.relatedEntityId}`;
    }
    
    content += `\n\n时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    
    // Send via built-in notification system
    const result = await notifyOwner({
      title: formattedTitle,
      content: content
    });
    
    return result;
  } catch (error) {
    console.error('[NotificationService] Failed to send notification:', error);
    return false;
  }
}

/**
 * Check health metrics and generate alerts
 */
export interface HealthMetrics {
  campaignId: number;
  campaignName: string;
  currentAcos: number;
  previousAcos: number;
  currentCtr: number;
  previousCtr: number;
  currentConversionRate: number;
  previousConversionRate: number;
  currentSpend: number;
  previousSpend: number;
}

export interface HealthAlert {
  type: 'acos_spike' | 'ctr_drop' | 'conversion_drop' | 'spend_spike';
  severity: 'warning' | 'critical';
  campaignId: number;
  campaignName: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  threshold: number;
  message: string;
}

/**
 * Analyze health metrics and generate alerts
 */
export function analyzeHealthMetrics(
  metrics: HealthMetrics,
  config: NotificationConfig
): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  
  // Check ACoS spike
  if (metrics.currentAcos > config.acosThreshold) {
    const changePercent = metrics.previousAcos > 0 
      ? ((metrics.currentAcos - metrics.previousAcos) / metrics.previousAcos) * 100 
      : 100;
    
    alerts.push({
      type: 'acos_spike',
      severity: metrics.currentAcos > config.acosThreshold * 1.5 ? 'critical' : 'warning',
      campaignId: metrics.campaignId,
      campaignName: metrics.campaignName,
      currentValue: metrics.currentAcos,
      previousValue: metrics.previousAcos,
      changePercent,
      threshold: config.acosThreshold,
      message: `广告活动 "${metrics.campaignName}" 的ACoS已达到 ${metrics.currentAcos.toFixed(1)}%，超过阈值 ${config.acosThreshold}%`
    });
  }
  
  // Check CTR drop
  if (metrics.previousCtr > 0) {
    const ctrDropPercent = ((metrics.previousCtr - metrics.currentCtr) / metrics.previousCtr) * 100;
    if (ctrDropPercent >= config.ctrDropThreshold) {
      alerts.push({
        type: 'ctr_drop',
        severity: ctrDropPercent > config.ctrDropThreshold * 1.5 ? 'critical' : 'warning',
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentCtr,
        previousValue: metrics.previousCtr,
        changePercent: -ctrDropPercent,
        threshold: config.ctrDropThreshold,
        message: `广告活动 "${metrics.campaignName}" 的点击率下降了 ${ctrDropPercent.toFixed(1)}%，从 ${metrics.previousCtr.toFixed(2)}% 降至 ${metrics.currentCtr.toFixed(2)}%`
      });
    }
  }
  
  // Check conversion rate drop
  if (metrics.previousConversionRate > 0) {
    const convDropPercent = ((metrics.previousConversionRate - metrics.currentConversionRate) / metrics.previousConversionRate) * 100;
    if (convDropPercent >= config.conversionDropThreshold) {
      alerts.push({
        type: 'conversion_drop',
        severity: convDropPercent > config.conversionDropThreshold * 1.5 ? 'critical' : 'warning',
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentConversionRate,
        previousValue: metrics.previousConversionRate,
        changePercent: -convDropPercent,
        threshold: config.conversionDropThreshold,
        message: `广告活动 "${metrics.campaignName}" 的转化率下降了 ${convDropPercent.toFixed(1)}%，从 ${metrics.previousConversionRate.toFixed(2)}% 降至 ${metrics.currentConversionRate.toFixed(2)}%`
      });
    }
  }
  
  // Check spend spike
  if (metrics.previousSpend > 0) {
    const spendSpikePercent = ((metrics.currentSpend - metrics.previousSpend) / metrics.previousSpend) * 100;
    if (spendSpikePercent >= config.spendSpikeThreshold) {
      alerts.push({
        type: 'spend_spike',
        severity: spendSpikePercent > config.spendSpikeThreshold * 1.5 ? 'critical' : 'warning',
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentSpend,
        previousValue: metrics.previousSpend,
        changePercent: spendSpikePercent,
        threshold: config.spendSpikeThreshold,
        message: `广告活动 "${metrics.campaignName}" 的花费激增 ${spendSpikePercent.toFixed(1)}%，从 $${metrics.previousSpend.toFixed(2)} 增至 $${metrics.currentSpend.toFixed(2)}`
      });
    }
  }
  
  return alerts;
}

/**
 * Send batch alerts
 */
export async function sendBatchAlerts(alerts: HealthAlert[]): Promise<{
  sent: number;
  failed: number;
}> {
  let sent = 0;
  let failed = 0;
  
  // Group alerts by severity
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');
  
  // Send critical alerts immediately
  for (const alert of criticalAlerts) {
    const success = await sendNotification({
      userId: 0, // Will be set by the caller
      type: 'alert',
      severity: 'critical',
      title: `严重警告: ${alert.type === 'acos_spike' ? 'ACoS飙升' : alert.type === 'ctr_drop' ? '点击率骤降' : alert.type === 'conversion_drop' ? '转化率下滑' : '花费激增'}`,
      message: alert.message,
      relatedEntityType: 'campaign',
      relatedEntityId: alert.campaignId
    });
    
    if (success) sent++;
    else failed++;
  }
  
  // Batch warning alerts into a summary
  if (warningAlerts.length > 0) {
    const summaryMessage = warningAlerts.map(a => `• ${a.message}`).join('\n');
    const success = await sendNotification({
      userId: 0,
      type: 'alert',
      severity: 'warning',
      title: `广告健康度警告 (${warningAlerts.length}项)`,
      message: `检测到以下健康度问题:\n\n${summaryMessage}`
    });
    
    if (success) sent++;
    else failed++;
  }
  
  return { sent, failed };
}

/**
 * Generate daily health report
 */
export interface DailyReportData {
  accountName: string;
  date: string;
  totalCampaigns: number;
  activeCampaigns: number;
  totalSpend: number;
  totalSales: number;
  averageAcos: number;
  averageRoas: number;
  topPerformers: Array<{ name: string; roas: number; sales: number }>;
  needsAttention: Array<{ name: string; issue: string }>;
  optimizationsSuggested: number;
  optimizationsApplied: number;
}

export function generateDailyReportContent(data: DailyReportData): string {
  let content = `📊 **${data.accountName} 每日广告报告**\n`;
  content += `日期: ${data.date}\n\n`;
  
  content += `**📈 整体表现**\n`;
  content += `• 活跃广告活动: ${data.activeCampaigns}/${data.totalCampaigns}\n`;
  content += `• 总花费: $${data.totalSpend.toFixed(2)}\n`;
  content += `• 总销售额: $${data.totalSales.toFixed(2)}\n`;
  content += `• 平均ACoS: ${data.averageAcos.toFixed(1)}%\n`;
  content += `• 平均ROAS: ${data.averageRoas.toFixed(2)}\n\n`;
  
  if (data.topPerformers.length > 0) {
    content += `**🏆 表现最佳**\n`;
    data.topPerformers.forEach((p, i) => {
      content += `${i + 1}. ${p.name} - ROAS: ${p.roas.toFixed(2)}, 销售: $${p.sales.toFixed(2)}\n`;
    });
    content += '\n';
  }
  
  if (data.needsAttention.length > 0) {
    content += `**⚠️ 需要关注**\n`;
    data.needsAttention.forEach(item => {
      content += `• ${item.name}: ${item.issue}\n`;
    });
    content += '\n';
  }
  
  content += `**🤖 自动优化**\n`;
  content += `• 生成建议: ${data.optimizationsSuggested}\n`;
  content += `• 已应用: ${data.optimizationsApplied}\n`;
  
  return content;
}

export async function sendDailyReport(data: DailyReportData): Promise<boolean> {
  const content = generateDailyReportContent(data);
  
  return await sendNotification({
    userId: 0,
    type: 'report',
    severity: 'info',
    title: `📊 ${data.accountName} 每日广告报告 - ${data.date}`,
    message: content
  });
}
