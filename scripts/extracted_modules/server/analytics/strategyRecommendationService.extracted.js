// Extracted from production dist/index.js
// Original module: server/analytics/strategyRecommendationService.ts
// Lines: 356

var strategyRecommendationService_exports = {};
__export(strategyRecommendationService_exports, {
  STRATEGY_TEMPLATES: () => STRATEGY_TEMPLATES,
  recommendStrategyTemplate: () => recommendStrategyTemplate,
  updateAllCampaignRecommendations: () => updateAllCampaignRecommendations
});
function recommendStrategyTemplate(campaign) {
  const { acos, roas, ctr, cvr, spend, sales, impressions, clicks, orders, dailyBudget } = campaign;
  if (impressions < 100 || clicks < 10 || spend < 5) {
    return {
      // @ts-ignore
      campaignId: campaign.campaignId,
      recommendedTemplateId: "aggressive-growth",
      recommendedTemplateName: "\u6FC0\u8FDB\u589E\u957F",
      reason: "\u6570\u636E\u91CF\u4E0D\u8DB3\uFF08\u66DD\u5149<100\u6216\u70B9\u51FB<10\uFF09\uFF0C\u5EFA\u8BAE\u91C7\u7528\u6FC0\u8FDB\u589E\u957F\u7B56\u7565\u79EF\u7D2F\u6570\u636E",
      confidence: 30
    };
  }
  const acosVal = acos ?? (sales > 0 ? spend / sales * 100 : 100);
  const roasVal = roas ?? (spend > 0 ? sales / spend : 0);
  const ctrVal = ctr ?? (impressions > 0 ? clicks / impressions : 0);
  const cvrVal = cvr ?? (clicks > 0 ? orders / clicks : 0);
  const budgetUtilization = dailyBudget > 0 ? spend / dailyBudget * 100 : 0;
  const scores = [];
  {
    let score = 0;
    const reasons = [];
    if (acosVal > 30) {
      score += 20;
      reasons.push(`ACoS(${acosVal.toFixed(1)}%)\u8F83\u9AD8\uFF0C\u9700\u8981\u589E\u957F\u7B56\u7565`);
    }
    if (impressions < 1e3) {
      score += 25;
      reasons.push(`\u66DD\u5149\u91CF(${impressions})\u8F83\u4F4E\uFF0C\u9700\u8981\u6269\u5927\u66DD\u5149`);
    }
    if (budgetUtilization < 60) {
      score += 15;
      reasons.push(`\u9884\u7B97\u5229\u7528\u7387(${budgetUtilization.toFixed(0)}%)\u8F83\u4F4E`);
    }
    if (ctrVal > 5e-3) {
      score += 10;
      reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)\u8868\u73B0\u826F\u597D`);
    }
    if (orders < 10) {
      score += 20;
      reasons.push(`\u8BA2\u5355\u91CF(${orders})\u8F83\u5C11\uFF0C\u5904\u4E8E\u63A8\u5E7F\u521D\u671F`);
    }
    scores.push({ templateId: "aggressive-growth", score, reasons });
  }
  {
    let score = 0;
    const reasons = [];
    if (acosVal >= 15 && acosVal <= 35) {
      score += 30;
      reasons.push(`ACoS(${acosVal.toFixed(1)}%)\u5728\u5E73\u8861\u8303\u56F4\u5185`);
    }
    if (cvrVal >= 0.05 && cvrVal <= 0.15) {
      score += 20;
      reasons.push(`\u8F6C\u5316\u7387(${(cvrVal * 100).toFixed(1)}%)\u7A33\u5B9A`);
    }
    if (budgetUtilization >= 60 && budgetUtilization <= 95) {
      score += 15;
      reasons.push(`\u9884\u7B97\u5229\u7528\u7387(${budgetUtilization.toFixed(0)}%)\u9002\u4E2D`);
    }
    if (orders >= 10 && orders <= 100) {
      score += 15;
      reasons.push(`\u8BA2\u5355\u91CF(${orders})\u7A33\u5B9A`);
    }
    if (roasVal >= 2.5 && roasVal <= 5) {
      score += 10;
      reasons.push(`ROAS(${roasVal.toFixed(1)})\u8868\u73B0\u5747\u8861`);
    }
    scores.push({ templateId: "balanced", score, reasons });
  }
  {
    let score = 0;
    const reasons = [];
    if (acosVal < 20) {
      score += 25;
      reasons.push(`ACoS(${acosVal.toFixed(1)}%)\u5DF2\u7ECF\u5F88\u4F4E\uFF0C\u9002\u5408\u5229\u6DA6\u4F18\u5148`);
    }
    if (roasVal > 4) {
      score += 25;
      reasons.push(`ROAS(${roasVal.toFixed(1)})\u5F88\u9AD8\uFF0C\u5229\u6DA6\u7A7A\u95F4\u5927`);
    }
    if (cvrVal > 0.1) {
      score += 15;
      reasons.push(`\u8F6C\u5316\u7387(${(cvrVal * 100).toFixed(1)}%)\u5F88\u9AD8`);
    }
    if (budgetUtilization > 90) {
      score += 10;
      reasons.push(`\u9884\u7B97\u5229\u7528\u7387(${budgetUtilization.toFixed(0)}%)\u63A5\u8FD1\u4E0A\u9650`);
    }
    if (orders > 50) {
      score += 15;
      reasons.push(`\u8BA2\u5355\u91CF(${orders})\u5145\u8DB3\uFF0C\u4EA7\u54C1\u6210\u719F`);
    }
    scores.push({ templateId: "profit-focused", score, reasons });
  }
  {
    let score = 0;
    const reasons = [];
    const now = /* @__PURE__ */ new Date();
    const month = now.getMonth() + 1;
    if ([7, 10, 11, 12].includes(month)) {
      score += 30;
      reasons.push(`\u5F53\u524D\u5904\u4E8E\u65FA\u5B63\u6708\u4EFD(${month}\u6708)`);
    }
    if (ctrVal > 8e-3) {
      score += 15;
      reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)\u5F88\u9AD8\uFF0C\u4EA7\u54C1\u53D7\u6B22\u8FCE`);
    }
    if (cvrVal > 0.08 && impressions < 5e3) {
      score += 20;
      reasons.push(`\u8F6C\u5316\u7387\u9AD8\u4F46\u66DD\u5149\u4E0D\u8DB3\uFF0C\u9002\u5408\u51B2\u523A`);
    }
    if (budgetUtilization < 80) {
      score += 10;
      reasons.push(`\u9884\u7B97\u8FD8\u6709\u589E\u957F\u7A7A\u95F4`);
    }
    scores.push({ templateId: "seasonal-boost", score, reasons });
  }
  {
    let score = 0;
    const reasons = [];
    if (acosVal < 10) {
      score += 30;
      reasons.push(`ACoS(${acosVal.toFixed(1)}%)\u6781\u4F4E\uFF0C\u53EF\u80FD\u662F\u54C1\u724C\u8BCD\u5E7F\u544A`);
    }
    if (cvrVal > 0.15) {
      score += 25;
      reasons.push(`\u8F6C\u5316\u7387(${(cvrVal * 100).toFixed(1)}%)\u6781\u9AD8\uFF0C\u54C1\u724C\u8BCD\u7279\u5F81`);
    }
    if (roasVal > 8) {
      score += 20;
      reasons.push(`ROAS(${roasVal.toFixed(1)})\u6781\u9AD8`);
    }
    if (ctrVal > 0.01) {
      score += 10;
      reasons.push(`CTR(${(ctrVal * 100).toFixed(2)}%)\u5F88\u9AD8\uFF0C\u54C1\u724C\u8BA4\u77E5\u5EA6\u597D`);
    }
    scores.push({ templateId: "brand-defense", score, reasons });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const template = STRATEGY_TEMPLATES.find((t2) => t2.id === best.templateId);
  const secondBest = scores[1];
  const scoreDiff = best.score - secondBest.score;
  const confidence = Math.min(95, Math.max(20, 40 + scoreDiff * 2));
  return {
    // @ts-ignore
    campaignId: campaign.campaignId,
    // @ts-ignore
    recommendedTemplateId: best.templateId,
    recommendedTemplateName: template.name,
    // @ts-ignore
    reason: best.reasons.slice(0, 3).join("\uFF1B"),
    confidence
  };
}
async function updateAllCampaignRecommendations(accountId) {
  const db = await getDb();
  if (!db) return 0;
  try {
    const allCampaigns = await db.select({
      id: campaigns.id,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType,
      acos: campaigns.acos,
      roas: campaigns.roas,
      ctr: campaigns.ctr,
      cvr: campaigns.cvr,
      spend: campaigns.spend,
      sales: campaigns.sales,
      impressions: campaigns.impressions,
      clicks: campaigns.clicks,
      orders: campaigns.orders,
      dailyBudget: campaigns.dailyBudget,
      performanceGroupId: campaigns.performanceGroupId
      // @ts-ignore
    }).from(campaigns).where(eq(campaigns.accountId, accountId));
    let updated = 0;
    for (const campaign of allCampaigns) {
      const perfData = {
        // @ts-ignore
        id: campaign.id,
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        campaignType: campaign.campaignType,
        // @ts-ignore
        acos: campaign.acos ? Number(campaign.acos) : null,
        // @ts-ignore
        roas: campaign.roas ? Number(campaign.roas) : null,
        // @ts-ignore
        ctr: campaign.ctr ? Number(campaign.ctr) : null,
        // @ts-ignore
        cvr: campaign.cvr ? Number(campaign.cvr) : null,
        // @ts-ignore
        spend: Number(campaign.spend || 0),
        // @ts-ignore
        sales: Number(campaign.sales || 0),
        // @ts-ignore
        impressions: Number(campaign.impressions || 0),
        // @ts-ignore
        clicks: Number(campaign.clicks || 0),
        // @ts-ignore
        orders: Number(campaign.orders || 0),
        // @ts-ignore
        dailyBudget: Number(campaign.dailyBudget || 0),
        // @ts-ignore
        performanceGroupId: campaign.performanceGroupId
      };
      const recommendation = recommendStrategyTemplate(perfData);
      await db.update(campaigns).set({
        recommendedStrategyTemplateId: recommendation.recommendedTemplateId,
        recommendedStrategyTemplateName: recommendation.recommendedTemplateName,
        recommendationReason: recommendation.reason,
        recommendationUpdatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
      }).where(eq(campaigns.id, campaign.id));
      updated++;
    }
    log158.info(`[StrategyRecommendation] \u5DF2\u66F4\u65B0 ${updated} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u7B56\u7565\u63A8\u8350`);
    return updated;
  } catch (error48) {
    log158.warn("[StrategyRecommendation] \u66F4\u65B0\u7B56\u7565\u63A8\u8350\u5931\u8D25:", error48);
    return 0;
  }
}
var log158, STRATEGY_TEMPLATES;
var init_strategyRecommendationService = __esm({
  "server/analytics/strategyRecommendationService.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_db2();
    init_schema2();
    log158 = createModuleLogger("StrategyRecommendationService");
    STRATEGY_TEMPLATES = [
      {
        id: "aggressive-growth",
        name: "\u6FC0\u8FDB\u589E\u957F",
        description: "\u9002\u5408\u65B0\u54C1\u63A8\u5E7F\u671F\u6216\u9700\u8981\u5FEB\u901F\u62A2\u5360\u5E02\u573A\u4EFD\u989D\u7684\u573A\u666F\u3002\u63A5\u53D7\u8F83\u9AD8\u7684ACoS\u6362\u53D6\u66F4\u591A\u66DD\u5149\u548C\u9500\u91CF\u3002",
        targetAcos: 40,
        minAcos: 25,
        maxAcos: 100,
        bidMultiplier: 1.25,
        // 高于建议竞价20-30%
        budgetMultiplier: 1.5
      },
      {
        id: "balanced",
        name: "\u5E73\u8861\u589E\u957F",
        description: "\u5728\u63A7\u5236\u6210\u672C\u7684\u540C\u65F6\u8FFD\u6C42\u7A33\u5B9A\u589E\u957F\u3002\u9002\u5408\u5927\u591A\u6570\u6210\u719F\u4EA7\u54C1\u7684\u65E5\u5E38\u8FD0\u8425\u3002",
        targetAcos: 25,
        minAcos: 15,
        maxAcos: 35,
        bidMultiplier: 1,
        budgetMultiplier: 1
      },
      {
        id: "profit-focused",
        name: "\u5229\u6DA6\u4F18\u5148",
        description: "\u4E25\u683C\u63A7\u5236\u5E7F\u544A\u6210\u672C\uFF0C\u8FFD\u6C42\u6700\u5927\u5316\u5229\u6DA6\u3002\u9002\u5408\u5229\u6DA6\u7387\u8F83\u4F4E\u6216\u9700\u8981\u63A7\u5236\u652F\u51FA\u7684\u4EA7\u54C1\u3002",
        targetAcos: 15,
        minAcos: 0,
        maxAcos: 20,
        bidMultiplier: 0.85,
        budgetMultiplier: 0.8
      },
      {
        id: "seasonal-boost",
        name: "\u65FA\u5B63\u51B2\u523A",
        description: "\u9488\u5BF9Prime Day\u3001\u9ED1\u4E94\u7B49\u5927\u4FC3\u671F\u95F4\u7684\u7279\u6B8A\u7B56\u7565\u3002\u77ED\u671F\u5185\u6700\u5927\u5316\u9500\u91CF\u3002",
        targetAcos: 35,
        minAcos: 20,
        maxAcos: 50,
        bidMultiplier: 1.4,
        budgetMultiplier: 2
      },
      {
        id: "brand-defense",
        name: "\u54C1\u724C\u9632\u5FA1",
        description: "\u4FDD\u62A4\u54C1\u724C\u8BCD\u4E0D\u88AB\u7ADE\u4E89\u5BF9\u624B\u62A2\u5360\u3002\u9002\u5408\u6709\u4E00\u5B9A\u54C1\u724C\u77E5\u540D\u5EA6\u7684\u5356\u5BB6\u3002",
        targetAcos: 10,
        minAcos: 0,
        maxAcos: 15,
        bidMultiplier: 1.1,
        budgetMultiplier: 0.9
      },
      {
        id: "inventory-clearance",
        name: "\u5E93\u5B58\u6E05\u7406",
        description: "\u5FEB\u901F\u6E05\u7406FBA\u5E93\u5B58\uFF0C\u907F\u514D\u957F\u671F\u4ED3\u50A8\u8D39\u3002\u5927\u5E45\u63D0\u9AD8\u9884\u7B97\u548C\u51FA\u4EF7\uFF0C\u63A5\u53D7\u9AD8ACoS\uFF0C\u914D\u5408\u4FC3\u9500\u3002",
        targetAcos: 60,
        minAcos: 40,
        maxAcos: 150,
        bidMultiplier: 1.5,
        budgetMultiplier: 2.5
      },
      {
        id: "competitor-attack",
        name: "\u7ADE\u54C1\u653B\u51FB",
        description: "\u62A2\u5360\u6307\u5B9A\u7ADE\u54C1\u7684\u6D41\u91CF\u548C\u5E02\u573A\u4EFD\u989D\u3002\u9488\u5BF9\u7ADE\u54C1ASIN\u548C\u54C1\u724C\u8BCD\u8FDB\u884C\u9AD8\u5F3A\u5EA6\u6295\u653E\u3002",
        targetAcos: 45,
        minAcos: 30,
        maxAcos: 70,
        bidMultiplier: 1.6,
        budgetMultiplier: 1.8
      },
      {
        id: "market-expansion",
        name: "\u65B0\u5E02\u573A\u62D3\u5C55",
        description: "\u5728\u65B0\u7AD9\u70B9\u5FEB\u901F\u5EFA\u7ACB\u521D\u59CB\u9500\u91CF\u548C\u6392\u540D\u3002\u91C7\u7528\u6FC0\u8FDB\u7B56\u7565\uFF0C\u4F46\u66F4\u5173\u6CE8\u672C\u5730\u5316\u5173\u952E\u8BCD\u7684\u6D4B\u8BD5\u3002",
        targetAcos: 50,
        minAcos: 30,
        maxAcos: 80,
        bidMultiplier: 1.3,
        budgetMultiplier: 1.6
      },
      {
        id: "seasonal-pattern",
        name: "\u5B63\u8282\u6027\u6A21\u5F0F",
        description: "\u9002\u5E94\u5B63\u8282\u6027\u4EA7\u54C1\u7684\u5468\u671F\u6027\u6CE2\u52A8\u3002\u6839\u636E\u5386\u53F2\u540C\u671F\u6570\u636E\uFF0C\u81EA\u52A8\u5728\u65FA\u5B63\u524D\u63D0\u5347\u9884\u7B97\uFF0C\u6DE1\u5B63\u964D\u4F4E\u3002",
        targetAcos: 30,
        minAcos: 20,
        maxAcos: 45,
        bidMultiplier: 1.2,
        budgetMultiplier: 1.4
      },
      {
        id: "decline-management",
        name: "\u8870\u9000\u671F\u7BA1\u7406",
        description: "\u5728\u4EA7\u54C1\u751F\u547D\u5468\u671F\u672B\u671F\uFF0C\u7EF4\u6301\u5229\u6DA6\uFF0C\u5E73\u7A33\u8FC7\u6E21\u3002\u9010\u6B65\u964D\u4F4E\u9884\u7B97\uFF0C\u6682\u505C\u4F4E\u6548\u5E7F\u544A\uFF0C\u805A\u7126\u6838\u5FC3\u76C8\u5229\u8BCD\u3002",
        targetAcos: 20,
        minAcos: 10,
        maxAcos: 30,
        bidMultiplier: 0.7,
        budgetMultiplier: 0.6
      },
      {
        id: "emergency-response",
        name: "\u7D27\u6025\u54CD\u5E94",
        description: "\u5E94\u5BF9\u5DEE\u8BC4\u3001\u65AD\u8D27\u7B49\u7A81\u53D1\u8D1F\u9762\u4E8B\u4EF6\u3002\u7ACB\u5373\u6682\u505C\u76F8\u5173\u5E7F\u544A\uFF0C\u6216\u5207\u6362\u5230\u54C1\u724C\u9632\u5FA1\u6A21\u5F0F\uFF0C\u964D\u4F4E\u8D1F\u9762\u5F71\u54CD\u3002",
        targetAcos: 15,
        minAcos: 0,
        maxAcos: 25,
        bidMultiplier: 0.5,
        budgetMultiplier: 0.4
      }
    ];
    __name(recommendStrategyTemplate, "recommendStrategyTemplate");
    __name(updateAllCampaignRecommendations, "updateAllCampaignRecommendations");
  }
});

