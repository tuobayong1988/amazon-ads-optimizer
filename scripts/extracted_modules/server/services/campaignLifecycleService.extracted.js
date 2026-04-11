// Extracted from production dist/index.js
// Original module: server/services/campaignLifecycleService.ts
// Lines: 267

function determineCampaignLifecycle(campaign) {
  const now = /* @__PURE__ */ new Date();
  const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : now;
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1e3 * 60 * 60 * 24));
  const totalClicks = parseInt(campaign.clicks) || 0;
  const totalOrders = parseInt(campaign.orders) || 0;
  const totalImpressions = parseInt(campaign.impressions) || 0;
  let stage;
  let reason;
  if (daysSinceCreation < LIFECYCLE_THRESHOLDS.launch.maxDays && (totalClicks < LIFECYCLE_THRESHOLDS.launch.maxClicks || totalOrders < LIFECYCLE_THRESHOLDS.launch.maxOrders)) {
    stage = "launch";
    const reasons = [];
    reasons.push(`\u521B\u5EFA\u4EC5${daysSinceCreation}\u5929(<${LIFECYCLE_THRESHOLDS.launch.maxDays}\u5929)`);
    if (totalClicks < LIFECYCLE_THRESHOLDS.launch.maxClicks) {
      reasons.push(`\u7D2F\u8BA1\u70B9\u51FB${totalClicks}\u6B21(<${LIFECYCLE_THRESHOLDS.launch.maxClicks}\u6B21)`);
    }
    if (totalOrders < LIFECYCLE_THRESHOLDS.launch.maxOrders) {
      reasons.push(`\u7D2F\u8BA1\u8F6C\u5316${totalOrders}\u6B21(<${LIFECYCLE_THRESHOLDS.launch.maxOrders}\u6B21)`);
    }
    reason = `\u542F\u52A8\u671F: ${reasons.join(", ")}`;
  } else if (daysSinceCreation >= LIFECYCLE_THRESHOLDS.growth.maxDays && totalClicks >= LIFECYCLE_THRESHOLDS.growth.maxClicks && totalOrders >= LIFECYCLE_THRESHOLDS.growth.maxOrders) {
    stage = "mature";
    reason = `\u6210\u719F\u671F: \u8FD0\u884C${daysSinceCreation}\u5929, ${totalClicks}\u6B21\u70B9\u51FB, ${totalOrders}\u6B21\u8F6C\u5316`;
  } else {
    stage = "growth";
    reason = `\u6210\u957F\u671F: \u8FD0\u884C${daysSinceCreation}\u5929, ${totalClicks}\u6B21\u70B9\u51FB, ${totalOrders}\u6B21\u8F6C\u5316`;
  }
  return {
    // @ts-ignore
    campaignId: campaign.campaignId,
    // @ts-ignore
    campaignName: campaign.campaignName || "",
    // @ts-ignore
    campaignType: campaign.campaignType || "sp_manual",
    stage,
    reason,
    daysSinceCreation,
    totalClicks,
    totalOrders,
    totalImpressions
  };
}
async function getTargetLifecycleStage(targetId) {
  const campaigns6 = await getCampaignsByPerformanceGroupId(targetId);
  if (campaigns6.length === 0) {
    return {
      overallStage: "launch",
      campaigns: [],
      config: LIFECYCLE_CONFIGS.launch,
      summary: "\u65E0\u5E7F\u544A\u6D3B\u52A8"
    };
  }
  const lifecycleInfos = campaigns6.map((c) => determineCampaignLifecycle(c));
  let overallStage = "mature";
  const launchCount = lifecycleInfos.filter((l) => l.stage === "launch").length;
  const growthCount = lifecycleInfos.filter((l) => l.stage === "growth").length;
  const matureCount = lifecycleInfos.filter((l) => l.stage === "mature").length;
  if (launchCount > 0) {
    overallStage = "launch";
  } else if (growthCount > 0) {
    overallStage = "growth";
  }
  const summary = `${campaigns6.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8: \u542F\u52A8\u671F=${launchCount}, \u6210\u957F\u671F=${growthCount}, \u6210\u719F\u671F=${matureCount} \u2192 \u7EFC\u5408\u9636\u6BB5: ${overallStage}`;
  return {
    overallStage,
    campaigns: lifecycleInfos,
    config: LIFECYCLE_CONFIGS[overallStage],
    summary
  };
}
function shouldExecuteModule(moduleName, lastExecutedAt, stage) {
  const config2 = LIFECYCLE_CONFIGS[stage];
  let intervalHours;
  switch (moduleName) {
    case "bid":
      intervalHours = config2.bid.intervalHours;
      break;
    case "negativeKeyword":
      intervalHours = config2.negativeKeyword.intervalHours;
      break;
    case "searchTermHarvest":
      intervalHours = config2.searchTermHarvest.intervalHours;
      break;
    case "placement":
      intervalHours = config2.placement.intervalHours;
      break;
    case "budget":
      intervalHours = config2.budget.intervalHours;
      break;
    case "dayparting":
      intervalHours = config2.dayparting.intervalHours;
      break;
    default:
      intervalHours = 12;
  }
  if (!lastExecutedAt) {
    return {
      shouldExecute: true,
      reason: `\u9996\u6B21\u6267\u884C (${moduleName}, ${stage}\u9636\u6BB5, \u95F4\u9694${intervalHours}\u5C0F\u65F6)`,
      nextExecuteAt: new Date(Date.now() + intervalHours * 60 * 60 * 1e3)
    };
  }
  const now = /* @__PURE__ */ new Date();
  const elapsedMs = now.getTime() - lastExecutedAt.getTime();
  const intervalMs = intervalHours * 60 * 60 * 1e3;
  if (elapsedMs >= intervalMs) {
    return {
      shouldExecute: true,
      reason: `\u5DF2\u8FC7${Math.round(elapsedMs / (60 * 60 * 1e3))}\u5C0F\u65F6 >= ${intervalHours}\u5C0F\u65F6\u95F4\u9694 (${stage}\u9636\u6BB5)`,
      nextExecuteAt: new Date(now.getTime() + intervalMs)
    };
  }
  const nextExecuteAt = new Date(lastExecutedAt.getTime() + intervalMs);
  const remainingHours = Math.round((intervalMs - elapsedMs) / (60 * 60 * 1e3) * 10) / 10;
  return {
    shouldExecute: false,
    reason: `\u8DDD\u4E0A\u6B21\u6267\u884C\u4EC5${Math.round(elapsedMs / (60 * 60 * 1e3))}\u5C0F\u65F6, \u9700\u7B49\u5F85${remainingHours}\u5C0F\u65F6 (${stage}\u9636\u6BB5, \u95F4\u9694${intervalHours}\u5C0F\u65F6)`,
    nextExecuteAt
  };
}
var LIFECYCLE_THRESHOLDS, LIFECYCLE_CONFIGS;
var init_campaignLifecycleService = __esm({
  "server/services/campaignLifecycleService.ts"() {
    "use strict";
    init_db2();
    LIFECYCLE_THRESHOLDS = {
      launch: {
        maxDays: 14,
        maxClicks: 50,
        maxOrders: 5
      },
      growth: {
        maxDays: 30,
        maxClicks: 200,
        maxOrders: 20
      }
      // mature: 超过growth的所有标准
    };
    LIFECYCLE_CONFIGS = {
      // ==================== 启动期：高频探索，小步快跑 ====================
      launch: {
        stage: "launch",
        bid: {
          intervalHours: 2,
          // v242f: 每2小时检查一次（与调度器频率一致），避免部署重启导致跳过
          lookbackDays: 3,
          // 只看近3天数据，快速迭代
          minClicksForAction: 5,
          // 5次点击就可以做初步判断
          maxAdjustmentPercent: 10,
          // 单次最多调整10%，小步快跑
          maxDailyAdjustmentPercent: 20
          // 24小时最多累计调整20%
        },
        negativeKeyword: {
          intervalHours: 12,
          // v337.4: 48h→12h，启动期也需要及时否定高花费零转化词
          minClicksToNegate: 15,
          // 需要15次点击且0转化才否定
          minSpendToNegate: 10
          // 或花费超过$10且0转化
        },
        searchTermHarvest: {
          intervalHours: 24,
          // v337.4: 72h→24h，加速高转化词的收割
          minConversionsToHarvest: 3
          // 至少3次转化才迁移
        },
        placement: {
          intervalHours: 24,
          // 每天一次，数据太少不宜频繁调整位置
          minClicksForDecision: 30
          // 位置层级需要更多数据
        },
        budget: {
          intervalHours: 4
          // 每4小时，监控低预算的消耗情况
        },
        dayparting: {
          intervalHours: 1
          // 每小时，分时策略按小时执行
        }
      },
      // ==================== 成长期：中频调整，逐步收紧 ====================
      growth: {
        stage: "growth",
        bid: {
          intervalHours: 6,
          // 每6小时，数据开始积累
          lookbackDays: 7,
          // 看7天数据
          minClicksForAction: 10,
          // 10次点击才调整
          maxAdjustmentPercent: 15,
          // 单次最多15%
          maxDailyAdjustmentPercent: 25
        },
        negativeKeyword: {
          intervalHours: 8,
          // v337.4: 24h→8h，成长期每8小时检查一次否定
          minClicksToNegate: 12,
          // 12次点击且0转化
          minSpendToNegate: 8
        },
        searchTermHarvest: {
          intervalHours: 12,
          // v337.4: 48h→12h，成长期每12小时收割一次
          minConversionsToHarvest: 2
          // 2次转化即可迁移
        },
        placement: {
          intervalHours: 12,
          // 每12小时
          minClicksForDecision: 50
        },
        budget: {
          intervalHours: 4
        },
        dayparting: {
          intervalHours: 1
        }
      },
      // ==================== 成熟期：低频稳优，精细化调整 ====================
      mature: {
        stage: "mature",
        bid: {
          intervalHours: 12,
          // 每12小时，数据稳定无需频繁干预
          lookbackDays: 7,
          // SP看7天（SB/SD会在执行时扩展到14天）
          minClicksForAction: 20,
          // 20次点击才调整，确保统计显著性
          maxAdjustmentPercent: 20,
          // 单次最多20%，基于稳定数据可以大胆调整
          maxDailyAdjustmentPercent: 30
        },
        negativeKeyword: {
          intervalHours: 8,
          // v337.4: 24h→8h，成熟期每8小时检查一次否定
          minClicksToNegate: 10,
          // 10次点击且0转化即否定
          minSpendToNegate: 5
        },
        searchTermHarvest: {
          intervalHours: 12,
          // v337.4: 24h→12h，成熟期每12小时收割一次
          minConversionsToHarvest: 2
        },
        placement: {
          intervalHours: 12,
          // 每12小时
          minClicksForDecision: 50
        },
        budget: {
          intervalHours: 4
        },
        dayparting: {
          intervalHours: 1
        }
      }
    };
    __name(determineCampaignLifecycle, "determineCampaignLifecycle");
    __name(getTargetLifecycleStage, "getTargetLifecycleStage");
    __name(shouldExecuteModule, "shouldExecuteModule");
  }
});

