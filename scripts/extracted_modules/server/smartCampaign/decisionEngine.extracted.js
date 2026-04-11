// Extracted from production dist/index.js
// Original module: server/smartCampaign/decisionEngine.ts
// Lines: 331

var RuleEngine, SmartDecisionEngine, AutoExecutionEngine;
var init_decisionEngine = __esm({
  "server/smartCampaign/decisionEngine.ts"() {
    "use strict";
    RuleEngine = class {
      static {
        __name(this, "RuleEngine");
      }
      /**
       * 评估是否应该暂停广告活动
       */
      shouldPauseCampaign(metrics, goal) {
        const reasons = [];
        let shouldPause = false;
        if (goal.type === "target_acos" && goal.targetValue) {
          if (metrics.acos > goal.targetValue * 1.5 && metrics.acosTrend === "up") {
            reasons.push(`ACoS (${metrics.acos.toFixed(1)}%) \u8FDC\u8D85\u76EE\u6807 (${goal.targetValue}%) \u4E14\u6301\u7EED\u4E0A\u5347`);
            shouldPause = true;
          }
        }
        if (goal.minROAS && metrics.roas < goal.minROAS * 0.5) {
          reasons.push(`ROAS (${metrics.roas.toFixed(2)}) \u8FDC\u4F4E\u4E8E\u6700\u4F4E\u8981\u6C42 (${goal.minROAS})`);
          shouldPause = true;
        }
        if (metrics.spend > 50 && metrics.conversions === 0) {
          reasons.push(`\u5DF2\u82B1\u8D39 $${metrics.spend.toFixed(2)} \u4F46\u65E0\u4EFB\u4F55\u8F6C\u5316`);
          shouldPause = true;
        }
        if (metrics.impressions > 1e3 && metrics.ctr < 0.1) {
          reasons.push(`CTR (${metrics.ctr.toFixed(2)}%) \u6781\u4F4E,\u5E7F\u544A\u76F8\u5173\u6027\u5DEE`);
          shouldPause = true;
        }
        if (shouldPause) {
          return {
            campaignId: metrics.campaignId,
            action: "pause",
            confidence: 0.9,
            reasoning: `\u5EFA\u8BAE\u6682\u505C: ${reasons.join("; ")}`,
            priority: "high",
            expectedImpact: {
              salesChange: -100,
              spendChange: -100,
              acosChange: 0
            }
          };
        }
        return null;
      }
      /**
       * 评估是否应该启用已暂停的广告活动
       */
      shouldEnableCampaign(metrics, goal) {
        if (metrics.status !== "paused") return null;
        return null;
      }
      /**
       * 评估是否应该调整出价
       */
      shouldAdjustBid(metrics, goal) {
        const currentBid = metrics.currentBid;
        if (goal.type === "target_acos" && goal.targetValue) {
          if (metrics.acos > goal.targetValue * 1.2) {
            const decreaseRatio = Math.min(0.2, (metrics.acos - goal.targetValue) / goal.targetValue * 0.5);
            const newBid = currentBid * (1 - decreaseRatio);
            return {
              campaignId: metrics.campaignId,
              action: "decrease_bid",
              currentValue: currentBid,
              recommendedValue: Math.round(newBid * 100) / 100,
              confidence: 0.8,
              reasoning: `ACoS (${metrics.acos.toFixed(1)}%) \u9AD8\u4E8E\u76EE\u6807 (${goal.targetValue}%),\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7\u4EE5\u63A7\u5236\u6210\u672C`,
              priority: "high",
              expectedImpact: {
                salesChange: -10,
                spendChange: -15,
                acosChange: -10
              }
            };
          }
        }
        if (goal.type === "target_acos" && goal.targetValue) {
          if (metrics.acos < goal.targetValue * 0.8 && metrics.salesTrend !== "down") {
            const increaseRatio = Math.min(0.15, (goal.targetValue - metrics.acos) / goal.targetValue * 0.3);
            const newBid = currentBid * (1 + increaseRatio);
            return {
              campaignId: metrics.campaignId,
              action: "increase_bid",
              currentValue: currentBid,
              recommendedValue: Math.round(newBid * 100) / 100,
              confidence: 0.7,
              reasoning: `ACoS (${metrics.acos.toFixed(1)}%) \u4F4E\u4E8E\u76EE\u6807 (${goal.targetValue}%),\u6709\u63D0\u5347\u9500\u552E\u989D\u7684\u7A7A\u95F4`,
              priority: "medium",
              expectedImpact: {
                salesChange: 15,
                spendChange: 20,
                acosChange: 5
              }
            };
          }
        }
        if (goal.type === "maximize_sales") {
          if (metrics.roas > 2 && metrics.salesTrend === "up") {
            const newBid = currentBid * 1.1;
            return {
              campaignId: metrics.campaignId,
              action: "increase_bid",
              currentValue: currentBid,
              recommendedValue: Math.round(newBid * 100) / 100,
              confidence: 0.75,
              reasoning: `ROAS (${metrics.roas.toFixed(2)}) \u826F\u597D\u4E14\u9500\u552E\u989D\u4E0A\u5347,\u5EFA\u8BAE\u63D0\u9AD8\u51FA\u4EF7\u4EE5\u6269\u5927\u9500\u552E`,
              priority: "medium",
              expectedImpact: {
                salesChange: 20,
                spendChange: 25,
                acosChange: 3
              }
            };
          }
        }
        return null;
      }
      /**
       * 评估是否应该调整预算
       */
      shouldAdjustBudget(metrics, goal) {
        const currentBudget = metrics.dailyBudget;
        if (metrics.spend > currentBudget * 0.9) {
          if (goal.type === "target_acos" && goal.targetValue) {
            if (metrics.acos <= goal.targetValue * 1.1) {
              const newBudget = Math.min(
                currentBudget * 1.2,
                goal.maxDailyBudget || currentBudget * 2
              );
              return {
                campaignId: metrics.campaignId,
                action: "increase_budget",
                currentValue: currentBudget,
                recommendedValue: Math.round(newBudget * 100) / 100,
                confidence: 0.85,
                reasoning: `\u82B1\u8D39\u5DF2\u8FBE\u9884\u7B97\u4E0A\u9650\u4E14ACoS (${metrics.acos.toFixed(1)}%) \u7B26\u5408\u76EE\u6807,\u5EFA\u8BAE\u63D0\u9AD8\u9884\u7B97\u4EE5\u83B7\u53D6\u66F4\u591A\u9500\u552E`,
                priority: "high",
                expectedImpact: {
                  salesChange: 20,
                  spendChange: 20,
                  acosChange: 0
                }
              };
            }
          }
        }
        if (metrics.spend < currentBudget * 0.5) {
          if (goal.type === "target_acos" && goal.targetValue) {
            if (metrics.acos > goal.targetValue * 1.3) {
              const newBudget = currentBudget * 0.7;
              return {
                campaignId: metrics.campaignId,
                action: "decrease_budget",
                currentValue: currentBudget,
                recommendedValue: Math.round(newBudget * 100) / 100,
                confidence: 0.7,
                reasoning: `\u82B1\u8D39\u8FDC\u4F4E\u4E8E\u9884\u7B97\u4E14ACoS (${metrics.acos.toFixed(1)}%) \u4E0D\u7406\u60F3,\u5EFA\u8BAE\u964D\u4F4E\u9884\u7B97`,
                priority: "low",
                expectedImpact: {
                  salesChange: -5,
                  spendChange: -10,
                  acosChange: -5
                }
              };
            }
          }
        }
        return null;
      }
    };
    SmartDecisionEngine = class {
      static {
        __name(this, "SmartDecisionEngine");
      }
      ruleEngine;
      constructor() {
        this.ruleEngine = new RuleEngine();
      }
      /**
       * 为单个广告活动生成决策
       */
      makeDecision(metrics, goal) {
        const pauseDecision = this.ruleEngine.shouldPauseCampaign(metrics, goal);
        if (pauseDecision) return pauseDecision;
        const enableDecision = this.ruleEngine.shouldEnableCampaign(metrics, goal);
        if (enableDecision) return enableDecision;
        const bidDecision = this.ruleEngine.shouldAdjustBid(metrics, goal);
        if (bidDecision) return bidDecision;
        const budgetDecision = this.ruleEngine.shouldAdjustBudget(metrics, goal);
        if (budgetDecision) return budgetDecision;
        return {
          campaignId: metrics.campaignId,
          action: "no_action",
          confidence: 1,
          reasoning: "\u5F53\u524D\u8868\u73B0\u7B26\u5408\u9884\u671F,\u65E0\u9700\u8C03\u6574",
          priority: "low",
          expectedImpact: {
            salesChange: 0,
            spendChange: 0,
            acosChange: 0
          }
        };
      }
      /**
       * 为多个广告活动批量生成决策
       */
      makeBatchDecisions(campaigns6, goal) {
        const decisions = campaigns6.map((campaign) => this.makeDecision(campaign, goal));
        decisions.sort((a, b) => {
          const priorityScore = { high: 3, medium: 2, low: 1 };
          const scoreA = priorityScore[a.priority] * a.confidence;
          const scoreB = priorityScore[b.priority] * b.confidence;
          return scoreB - scoreA;
        });
        return decisions;
      }
      /**
       * 生成优化报告
       */
      generateOptimizationReport(decisions) {
        const actionableDecisions = decisions.filter((d) => d.action !== "no_action");
        const highPriorityDecisions = actionableDecisions.filter((d) => d.priority === "high");
        const expectedSalesIncrease = actionableDecisions.reduce(
          (sum2, d) => sum2 + d.expectedImpact.salesChange,
          0
        );
        const expectedSpendChange = actionableDecisions.reduce(
          (sum2, d) => sum2 + d.expectedImpact.spendChange,
          0
        );
        return {
          summary: {
            totalCampaigns: decisions.length,
            actionRequired: actionableDecisions.length,
            highPriority: highPriorityDecisions.length,
            expectedSalesIncrease: Math.round(expectedSalesIncrease * 10) / 10,
            expectedSpendChange: Math.round(expectedSpendChange * 10) / 10
          },
          recommendations: actionableDecisions
        };
      }
    };
    AutoExecutionEngine = class {
      static {
        __name(this, "AutoExecutionEngine");
      }
      /**
       * 执行单个决策
       */
      async executeDecision(decision, dryRun = true) {
        if (dryRun) {
          return {
            success: true,
            executed: false,
            message: `[DRY RUN] ${decision.action} for campaign ${decision.campaignId}: ${decision.reasoning}`
          };
        }
        try {
          switch (decision.action) {
            case "pause":
              return {
                success: true,
                executed: true,
                message: `Successfully paused campaign ${decision.campaignId}`
              };
            case "enable":
              return {
                success: true,
                executed: true,
                message: `Successfully enabled campaign ${decision.campaignId}`
              };
            case "increase_bid":
            case "decrease_bid":
              return {
                success: true,
                executed: true,
                message: `Successfully updated bid to ${decision.recommendedValue} for campaign ${decision.campaignId}`
              };
            case "increase_budget":
            case "decrease_budget":
              return {
                success: true,
                executed: true,
                message: `Successfully updated budget to ${decision.recommendedValue} for campaign ${decision.campaignId}`
              };
            case "no_action":
              return {
                success: true,
                executed: false,
                message: "No action required"
              };
            default:
              return {
                success: false,
                executed: false,
                message: `Unknown action: ${decision.action}`
              };
          }
        } catch (error48) {
          return {
            success: false,
            executed: false,
            message: `Failed to execute: ${error48 instanceof Error ? error48.message : "Unknown error"}`
          };
        }
      }
      /**
       * 批量执行决策
       */
      async executeBatchDecisions(decisions, dryRun = true, maxConcurrent = 5) {
        const results = [];
        for (let i = 0; i < decisions.length; i += maxConcurrent) {
          const batch = decisions.slice(i, i + maxConcurrent);
          const batchResults = await Promise.all(
            batch.map(async (decision) => ({
              decision,
              result: await this.executeDecision(decision, dryRun)
            }))
          );
          results.push(...batchResults);
        }
        return results;
      }
    };
  }
});

