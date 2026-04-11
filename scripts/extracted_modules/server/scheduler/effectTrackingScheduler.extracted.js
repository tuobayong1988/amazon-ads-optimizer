// Extracted from production dist/index.js
// Original module: server/scheduler/effectTrackingScheduler.ts
// Lines: 287

var effectTrackingScheduler_exports = {};
__export(effectTrackingScheduler_exports, {
  TRACKING_PERIODS: () => TRACKING_PERIODS,
  collectKeywordPerformance: () => collectKeywordPerformance,
  getRecordsToTrack: () => getRecordsToTrack,
  getSchedulerStatus: () => getSchedulerStatus,
  getTrackingStatsSummary: () => getTrackingStatsSummary,
  runAllTrackingTasks: () => runAllTrackingTasks,
  runEffectTrackingTask: () => runEffectTrackingTask,
  startEffectTrackingScheduler: () => startEffectTrackingScheduler,
  stopEffectTrackingScheduler: () => stopEffectTrackingScheduler,
  triggerEffectTrackingTask: () => triggerEffectTrackingTask,
  updateTrackingData: () => updateTrackingData
});
async function getRecordsToTrack(period) {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1e3);
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
  let trackingField;
  if (period === TRACKING_PERIODS.DAY_7) {
    trackingField = "actual_profit_7d";
  } else if (period === TRACKING_PERIODS.DAY_14) {
    trackingField = "actual_profit_14d";
  } else {
    trackingField = "actual_profit_30d";
  }
  const endOfDayStr = new Date(endOfDay).toISOString().slice(0, 19).replace("T", " ");
  const startOfDayStr = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
  const records = await db.select().from(bidAdjustmentHistory).where(
    and(
      sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
      sql`${bidAdjustmentHistory.appliedAt} <= ${endOfDayStr}`,
      sql`${bidAdjustmentHistory.appliedAt} >= ${startOfDayStr}`
    )
  );
  return records.filter((record2) => {
    if (period === TRACKING_PERIODS.DAY_7) {
      return record2.actualProfit7D === null;
    } else if (period === TRACKING_PERIODS.DAY_14) {
      return record2.actualProfit14D === null;
    } else {
      return record2.actualProfit30D === null;
    }
  });
}
async function collectKeywordPerformance(keywordId, startDate, endDate) {
  const db = await getDb();
  const metrics = [];
  const totalClicks = metrics.reduce((sum2, m) => sum2 + (m.clicks || 0), 0);
  const totalImpressions = metrics.reduce((sum2, m) => sum2 + (m.impressions || 0), 0);
  const totalSpend = metrics.reduce((sum2, m) => sum2 + parseFloat(String(m.spend || 0)), 0);
  const totalSales = metrics.reduce((sum2, m) => sum2 + parseFloat(String(m.sales || 0)), 0);
  const totalOrders = metrics.reduce((sum2, m) => sum2 + (m.orders || 0), 0);
  const acos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
  const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const profit = totalSales - totalSpend;
  return {
    // @ts-ignore
    clicks: totalClicks,
    // @ts-ignore
    impressions: totalImpressions,
    // @ts-ignore
    spend: totalSpend,
    // @ts-ignore
    sales: totalSales,
    // @ts-ignore
    orders: totalOrders,
    acos: Math.round(acos * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    profit: Math.round(profit * 100) / 100
  };
}
async function updateTrackingData(historyId, period, trackingData) {
  const db = await getDb();
  if (!db) return;
  const updateData = {};
  if (period === TRACKING_PERIODS.DAY_7) {
    updateData.actualProfit7D = trackingData.profit.toString();
    updateData.actualClicks7d = trackingData.clicks;
    updateData.actualSales7d = trackingData.sales.toString();
    updateData.actualAcos7d = trackingData.acos.toString();
  } else if (period === TRACKING_PERIODS.DAY_14) {
    updateData.actualProfit14D = trackingData.profit.toString();
    updateData.actualClicks14d = trackingData.clicks;
    updateData.actualSales14d = trackingData.sales.toString();
    updateData.actualAcos14d = trackingData.acos.toString();
  } else {
    updateData.actualProfit30D = trackingData.profit.toString();
    updateData.actualClicks30d = trackingData.clicks;
    updateData.actualSales30d = trackingData.sales.toString();
    updateData.actualAcos30d = trackingData.acos.toString();
  }
  await db.update(bidAdjustmentHistory).set(updateData).where(eq(bidAdjustmentHistory.id, historyId));
}
async function runEffectTrackingTask(period) {
  const results = [];
  const records = await getRecordsToTrack(period);
  for (const record2 of records) {
    try {
      const adjustedAt = new Date(record2.adjustedAt);
      const startDate = adjustedAt;
      const endDate = new Date(adjustedAt.getTime() + period * 24 * 60 * 60 * 1e3);
      const trackingData = await collectKeywordPerformance(
        // @ts-ignore
        record2.keywordId,
        startDate,
        // @ts-ignore
        endDate
        // @ts-ignore
      );
      await updateTrackingData(record2.id, period, trackingData);
      const estimatedProfit = parseFloat(record2.estimatedProfitChange || "0");
      const actualProfit = trackingData.profit;
      const profitDifference = actualProfit - estimatedProfit;
      const accuracyRate = estimatedProfit !== 0 ? Math.min(100, Math.max(0, (1 - Math.abs(profitDifference) / Math.abs(estimatedProfit)) * 100)) : actualProfit >= 0 ? 100 : 0;
      results.push({
        // @ts-ignore
        historyId: record2.id,
        // @ts-ignore
        keywordId: record2.keywordId,
        period,
        estimatedProfit,
        actualProfit,
        profitDifference,
        accuracyRate: Math.round(accuracyRate * 100) / 100,
        trackingData
      });
    } catch (error48) {
      log82.warn(`Failed to track record ${record2.id}:`, error48);
    }
  }
  return results;
}
async function runAllTrackingTasks() {
  const day7 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_7);
  const day14 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_14);
  const day30 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_30);
  return { day7, day14, day30 };
}
async function getTrackingStatsSummary() {
  const db = await getDb();
  if (!db) return { totalTracked: 0, avgAccuracy7d: 0, avgAccuracy14d: 0, avgAccuracy30d: 0, totalEstimatedProfit: 0, totalActualProfit: 0, overallAccuracy: 0 };
  const records = await db.select().from(bidAdjustmentHistory).where(sql`${bidAdjustmentHistory.status} != 'rolled_back'`);
  let totalTracked = 0;
  let sum7d = 0, count7d = 0;
  let sum14d = 0, count14d = 0;
  let sum30d = 0, count30d = 0;
  let totalEstimated = 0;
  let totalActual = 0;
  for (const record2 of records) {
    const estimated = parseFloat(record2.estimatedProfitChange || "0");
    totalEstimated += estimated;
    if (record2.actualProfit7D !== null) {
      const actual = parseFloat(record2.actualProfit7D);
      const accuracy = estimated !== 0 ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100)) : actual >= 0 ? 100 : 0;
      sum7d += accuracy;
      count7d++;
      totalTracked++;
    }
    if (record2.actualProfit14D !== null) {
      const actual = parseFloat(record2.actualProfit14D);
      const accuracy = estimated !== 0 ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100)) : actual >= 0 ? 100 : 0;
      sum14d += accuracy;
      count14d++;
    }
    if (record2.actualProfit30D !== null) {
      const actual = parseFloat(record2.actualProfit30D);
      totalActual += actual;
      const accuracy = estimated !== 0 ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100)) : actual >= 0 ? 100 : 0;
      sum30d += accuracy;
      count30d++;
    }
  }
  const overallAccuracy = totalEstimated !== 0 ? Math.min(100, Math.max(0, (1 - Math.abs(totalActual - totalEstimated) / Math.abs(totalEstimated)) * 100)) : totalActual >= 0 ? 100 : 0;
  return {
    totalTracked,
    avgAccuracy7d: count7d > 0 ? Math.round(sum7d / count7d * 100) / 100 : 0,
    avgAccuracy14d: count14d > 0 ? Math.round(sum14d / count14d * 100) / 100 : 0,
    avgAccuracy30d: count30d > 0 ? Math.round(sum30d / count30d * 100) / 100 : 0,
    totalEstimatedProfit: Math.round(totalEstimated * 100) / 100,
    totalActualProfit: Math.round(totalActual * 100) / 100,
    overallAccuracy: Math.round(overallAccuracy * 100) / 100
  };
}
function startEffectTrackingScheduler(intervalMs = 60 * 60 * 1e3) {
  if (schedulerStatus.isRunning) {
    log82.info("\u6548\u679C\u8FFD\u8E2A\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u5728\u8FD0\u884C\u4E2D");
    return;
  }
  schedulerStatus.isRunning = true;
  schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
  executeScheduledTask();
  schedulerInterval = setInterval(() => {
    schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
    executeScheduledTask();
  }, intervalMs);
  log82.info(`\u6548\u679C\u8FFD\u8E2A\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u6267\u884C\u95F4\u9694: ${intervalMs / 1e3 / 60} \u5206\u949F`);
}
function stopEffectTrackingScheduler() {
  if (!schedulerStatus.isRunning) {
    log82.info("\u6548\u679C\u8FFD\u8E2A\u5B9A\u65F6\u4EFB\u52A1\u672A\u5728\u8FD0\u884C");
    return;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  schedulerStatus.isRunning = false;
  schedulerStatus.nextRunTime = null;
  log82.info("\u6548\u679C\u8FFD\u8E2A\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u505C\u6B62");
}
function getSchedulerStatus() {
  return { ...schedulerStatus };
}
async function executeScheduledTask() {
  try {
    log82.info(`[${(/* @__PURE__ */ new Date()).toISOString()}] \u5F00\u59CB\u6267\u884C\u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1...`);
    const results = await runAllTrackingTasks();
    const totalProcessed = results.day7.length + results.day14.length + results.day30.length;
    schedulerStatus.lastRunTime = /* @__PURE__ */ new Date();
    schedulerStatus.totalProcessed += totalProcessed;
    schedulerStatus.errors = [];
    log82.info(`[${(/* @__PURE__ */ new Date()).toISOString()}] \u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1\u5B8C\u6210: 7\u5929=${results.day7.length}, 14\u5929=${results.day14.length}, 30\u5929=${results.day30.length}`);
  } catch (error48) {
    const errorMsg = `\u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1\u6267\u884C\u5931\u8D25: ${error48.message}`;
    log82.warn(errorMsg);
    schedulerStatus.errors.push(errorMsg);
  }
}
async function triggerEffectTrackingTask() {
  try {
    const results = await runAllTrackingTasks();
    return {
      success: true,
      message: "\u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1\u6267\u884C\u6210\u529F",
      results: {
        day7: results.day7.length,
        day14: results.day14.length,
        day30: results.day30.length
      }
    };
  } catch (error48) {
    return {
      success: false,
      message: `\u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1\u6267\u884C\u5931\u8D25: ${error48.message}`
    };
  }
}
var log82, TRACKING_PERIODS, schedulerStatus, schedulerInterval;
var init_effectTrackingScheduler = __esm({
  "server/scheduler/effectTrackingScheduler.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log82 = createModuleLogger("EffectTrackingScheduler");
    TRACKING_PERIODS = {
      DAY_7: 7,
      DAY_14: 14,
      DAY_30: 30
    };
    __name(getRecordsToTrack, "getRecordsToTrack");
    __name(collectKeywordPerformance, "collectKeywordPerformance");
    __name(updateTrackingData, "updateTrackingData");
    __name(runEffectTrackingTask, "runEffectTrackingTask");
    __name(runAllTrackingTasks, "runAllTrackingTasks");
    __name(getTrackingStatsSummary, "getTrackingStatsSummary");
    schedulerStatus = {
      isRunning: false,
      lastRunTime: null,
      nextRunTime: null,
      totalProcessed: 0,
      errors: []
    };
    schedulerInterval = null;
    __name(startEffectTrackingScheduler, "startEffectTrackingScheduler");
    __name(stopEffectTrackingScheduler, "stopEffectTrackingScheduler");
    __name(getSchedulerStatus, "getSchedulerStatus");
    __name(executeScheduledTask, "executeScheduledTask");
    __name(triggerEffectTrackingTask, "triggerEffectTrackingTask");
  }
});

