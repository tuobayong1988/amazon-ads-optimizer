// Extracted from production dist/index.js
// Original module: server/system/notificationService.ts
// Lines: 234

var notificationService_exports = {};
__export(notificationService_exports, {
  analyzeHealthMetrics: () => analyzeHealthMetrics,
  defaultNotificationConfig: () => defaultNotificationConfig,
  generateDailyReportContent: () => generateDailyReportContent,
  isQuietHours: () => isQuietHours,
  sendBatchAlerts: () => sendBatchAlerts,
  sendDailyReport: () => sendDailyReport,
  sendNotification: () => sendNotification
});
function isQuietHours(config2) {
  const now = /* @__PURE__ */ new Date();
  const currentHour = now.getHours();
  if (config2.quietHoursStart > config2.quietHoursEnd) {
    return currentHour >= config2.quietHoursStart || currentHour < config2.quietHoursEnd;
  } else {
    return currentHour >= config2.quietHoursStart && currentHour < config2.quietHoursEnd;
  }
}
async function sendNotification(notification) {
  try {
    const severityEmoji = {
      info: "\u2139\uFE0F",
      warning: "\u26A0\uFE0F",
      critical: "\u{1F6A8}"
    };
    const formattedTitle = `${severityEmoji[notification.severity]} [${notification.severity.toUpperCase()}] ${notification.title}`;
    let content = notification.message;
    if (notification.relatedEntityType && notification.relatedEntityId) {
      content += `

\u76F8\u5173\u5B9E\u4F53: ${notification.relatedEntityType} #${notification.relatedEntityId}`;
    }
    content += `

\u65F6\u95F4: ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
    const result = await notifyOwner({
      title: formattedTitle,
      content
    });
    return result;
  } catch (error48) {
    const errMsg = error48.message || JSON.stringify(error48);
    if (errMsg.includes("not configured")) {
      log24.warn(`[NotificationService] \u901A\u77E5\u670D\u52A1\u672A\u914D\u7F6E\uFF0C\u8DF3\u8FC7\u53D1\u9001`);
    } else {
      log24.warn(`[NotificationService] Failed to send notification: ${errMsg}`);
    }
    return false;
  }
}
function analyzeHealthMetrics(metrics, config2) {
  const alerts = [];
  if (metrics.currentAcos > config2.acosThreshold) {
    const changePercent = metrics.previousAcos > 0 ? (metrics.currentAcos - metrics.previousAcos) / metrics.previousAcos * 100 : 100;
    alerts.push({
      type: "acos_spike",
      severity: metrics.currentAcos > config2.acosThreshold * 1.5 ? "critical" : "warning",
      campaignId: metrics.campaignId,
      campaignName: metrics.campaignName,
      currentValue: metrics.currentAcos,
      previousValue: metrics.previousAcos,
      changePercent,
      threshold: config2.acosThreshold,
      message: `\u5E7F\u544A\u6D3B\u52A8 "${metrics.campaignName}" \u7684ACoS\u5DF2\u8FBE\u5230 ${metrics.currentAcos.toFixed(1)}%\uFF0C\u8D85\u8FC7\u9608\u503C ${config2.acosThreshold}%`
    });
  }
  if (metrics.previousCtr > 0) {
    const ctrDropPercent = (metrics.previousCtr - metrics.currentCtr) / metrics.previousCtr * 100;
    if (ctrDropPercent >= config2.ctrDropThreshold) {
      alerts.push({
        type: "ctr_drop",
        severity: ctrDropPercent > config2.ctrDropThreshold * 1.5 ? "critical" : "warning",
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentCtr,
        previousValue: metrics.previousCtr,
        changePercent: -ctrDropPercent,
        threshold: config2.ctrDropThreshold,
        message: `\u5E7F\u544A\u6D3B\u52A8 "${metrics.campaignName}" \u7684\u70B9\u51FB\u7387\u4E0B\u964D\u4E86 ${ctrDropPercent.toFixed(1)}%\uFF0C\u4ECE ${metrics.previousCtr.toFixed(2)}% \u964D\u81F3 ${metrics.currentCtr.toFixed(2)}%`
      });
    }
  }
  if (metrics.previousConversionRate > 0) {
    const convDropPercent = (metrics.previousConversionRate - metrics.currentConversionRate) / metrics.previousConversionRate * 100;
    if (convDropPercent >= config2.conversionDropThreshold) {
      alerts.push({
        type: "conversion_drop",
        severity: convDropPercent > config2.conversionDropThreshold * 1.5 ? "critical" : "warning",
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentConversionRate,
        previousValue: metrics.previousConversionRate,
        changePercent: -convDropPercent,
        threshold: config2.conversionDropThreshold,
        message: `\u5E7F\u544A\u6D3B\u52A8 "${metrics.campaignName}" \u7684\u8F6C\u5316\u7387\u4E0B\u964D\u4E86 ${convDropPercent.toFixed(1)}%\uFF0C\u4ECE ${metrics.previousConversionRate.toFixed(2)}% \u964D\u81F3 ${metrics.currentConversionRate.toFixed(2)}%`
      });
    }
  }
  if (metrics.previousSpend > 0) {
    const spendSpikePercent = (metrics.currentSpend - metrics.previousSpend) / metrics.previousSpend * 100;
    if (spendSpikePercent >= config2.spendSpikeThreshold) {
      alerts.push({
        type: "spend_spike",
        severity: spendSpikePercent > config2.spendSpikeThreshold * 1.5 ? "critical" : "warning",
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        currentValue: metrics.currentSpend,
        previousValue: metrics.previousSpend,
        changePercent: spendSpikePercent,
        threshold: config2.spendSpikeThreshold,
        message: `\u5E7F\u544A\u6D3B\u52A8 "${metrics.campaignName}" \u7684\u82B1\u8D39\u6FC0\u589E ${spendSpikePercent.toFixed(1)}%\uFF0C\u4ECE $${metrics.previousSpend.toFixed(2)} \u589E\u81F3 $${metrics.currentSpend.toFixed(2)}`
      });
    }
  }
  return alerts;
}
async function sendBatchAlerts(alerts) {
  let sent = 0;
  let failed = 0;
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");
  for (const alert of criticalAlerts) {
    const success2 = await sendNotification({
      userId: 0,
      // Will be set by the caller
      type: "alert",
      severity: "critical",
      title: `\u4E25\u91CD\u8B66\u544A: ${alert.type === "acos_spike" ? "ACoS\u98D9\u5347" : alert.type === "ctr_drop" ? "\u70B9\u51FB\u7387\u9AA4\u964D" : alert.type === "conversion_drop" ? "\u8F6C\u5316\u7387\u4E0B\u6ED1" : "\u82B1\u8D39\u6FC0\u589E"}`,
      message: alert.message,
      relatedEntityType: "campaign",
      relatedEntityId: alert.campaignId
    });
    if (success2) sent++;
    else failed++;
  }
  if (warningAlerts.length > 0) {
    const summaryMessage = warningAlerts.map((a) => `\u2022 ${a.message}`).join("\n");
    const success2 = await sendNotification({
      userId: 0,
      type: "alert",
      severity: "warning",
      title: `\u5E7F\u544A\u5065\u5EB7\u5EA6\u8B66\u544A (${warningAlerts.length}\u9879)`,
      message: `\u68C0\u6D4B\u5230\u4EE5\u4E0B\u5065\u5EB7\u5EA6\u95EE\u9898:

${summaryMessage}`
    });
    if (success2) sent++;
    else failed++;
  }
  return { sent, failed };
}
function generateDailyReportContent(data) {
  let content = `\u{1F4CA} **${data.accountName} \u6BCF\u65E5\u5E7F\u544A\u62A5\u544A**
`;
  content += `\u65E5\u671F: ${data.date}

`;
  content += `**\u{1F4C8} \u6574\u4F53\u8868\u73B0**
`;
  content += `\u2022 \u6D3B\u8DC3\u5E7F\u544A\u6D3B\u52A8: ${data.activeCampaigns}/${data.totalCampaigns}
`;
  content += `\u2022 \u603B\u82B1\u8D39: $${data.totalSpend.toFixed(2)}
`;
  content += `\u2022 \u603B\u9500\u552E\u989D: $${data.totalSales.toFixed(2)}
`;
  content += `\u2022 \u5E73\u5747ACoS: ${data.averageAcos.toFixed(1)}%
`;
  content += `\u2022 \u5E73\u5747ROAS: ${data.averageRoas.toFixed(2)}

`;
  if (data.topPerformers.length > 0) {
    content += `**\u{1F3C6} \u8868\u73B0\u6700\u4F73**
`;
    data.topPerformers.forEach((p, i) => {
      content += `${i + 1}. ${p.name} - ROAS: ${p.roas.toFixed(2)}, \u9500\u552E: $${p.sales.toFixed(2)}
`;
    });
    content += "\n";
  }
  if (data.needsAttention.length > 0) {
    content += `**\u26A0\uFE0F \u9700\u8981\u5173\u6CE8**
`;
    data.needsAttention.forEach((item) => {
      content += `\u2022 ${item.name}: ${item.issue}
`;
    });
    content += "\n";
  }
  content += `**\u{1F916} \u81EA\u52A8\u4F18\u5316**
`;
  content += `\u2022 \u751F\u6210\u5EFA\u8BAE: ${data.optimizationsSuggested}
`;
  content += `\u2022 \u5DF2\u5E94\u7528: ${data.optimizationsApplied}
`;
  return content;
}
async function sendDailyReport(data) {
  const content = generateDailyReportContent(data);
  return await sendNotification({
    userId: 0,
    type: "report",
    severity: "info",
    title: `\u{1F4CA} ${data.accountName} \u6BCF\u65E5\u5E7F\u544A\u62A5\u544A - ${data.date}`,
    message: content
  });
}
var log24, defaultNotificationConfig;
var init_notificationService = __esm({
  "server/system/notificationService.ts"() {
    "use strict";
    init_logger();
    init_notification();
    log24 = createModuleLogger("NotificationService");
    defaultNotificationConfig = {
      emailEnabled: true,
      inAppEnabled: true,
      acosThreshold: 50,
      ctrDropThreshold: 30,
      conversionDropThreshold: 30,
      spendSpikeThreshold: 50,
      frequency: "daily",
      quietHoursStart: 22,
      quietHoursEnd: 8
    };
    __name(isQuietHours, "isQuietHours");
    __name(sendNotification, "sendNotification");
    __name(analyzeHealthMetrics, "analyzeHealthMetrics");
    __name(sendBatchAlerts, "sendBatchAlerts");
    __name(generateDailyReportContent, "generateDailyReportContent");
    __name(sendDailyReport, "sendDailyReport");
  }
});

