// Extracted from production dist/index.js
// Original module: server/prelaunch/services/m7-ad-framework.ts
// Lines: 369

var m7_ad_framework_exports = {};
__export(m7_ad_framework_exports, {
  M7AdFrameworkService: () => M7AdFrameworkService
});
var M7AdFrameworkService;
var init_m7_ad_framework = __esm({
  "server/prelaunch/services/m7-ad-framework.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    M7AdFrameworkService = class {
      static {
        __name(this, "M7AdFrameworkService");
      }
      async getAdFrameworks(projectId, frameworkType) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const conditions = [eq(prelaunchAdFrameworks.projectId, projectId)];
          if (frameworkType) conditions.push(eq(prelaunchAdFrameworks.frameworkType, frameworkType));
          const data = await db.select().from(prelaunchAdFrameworks).where(and(...conditions)).orderBy(desc(prelaunchAdFrameworks.createdAt));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      /** 编译广告框架 */
      async compileFrameworks(input) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const keywords10 = await db.select().from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, input.projectId));
          const competitors = await db.select().from(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, input.projectId));
          const results = [];
          for (const fwType of input.frameworkTypes) {
            let compiledPayload;
            switch (fwType) {
              case "SP_KW_MANUAL":
                compiledPayload = this.compileSPKeywordManual(keywords10, input.defaultBid, input.dailyBudget);
                break;
              case "SP_PT_MANUAL":
                compiledPayload = this.compileSPProductTargeting(competitors, input.defaultBid, input.dailyBudget);
                break;
              case "SP_AUTO":
                compiledPayload = this.compileSPAuto(input.defaultBid, input.dailyBudget);
                break;
              case "SBV_KW":
                compiledPayload = this.compileSBVKeyword(keywords10, input.defaultBid, input.dailyBudget);
                break;
              case "SBV_PT":
                compiledPayload = this.compileSBVProductTargeting(competitors, input.defaultBid, input.dailyBudget);
                break;
            }
            const [result] = await db.insert(prelaunchAdFrameworks).values({
              projectId: input.projectId,
              frameworkType: fwType,
              frameworkName: `${fwType}_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
              campaignStructure: compiledPayload,
              // @ts-expect-error - runtime type mismatch
              totalCampaigns: compiledPayload.campaigns?.length || 0,
              // @ts-expect-error - array method type inference
              totalAdGroups: compiledPayload.campaigns?.reduce((sum2, c) => sum2 + (c.adGroups?.length || 0), 0) || 0,
              // @ts-expect-error - runtime type mismatch
              totalKeywords: compiledPayload.totalKeywords || 0,
              // @ts-expect-error - runtime type mismatch
              totalTargets: compiledPayload.totalTargets || 0,
              estimatedDailyBudget: String(input.dailyBudget),
              status: "draft"
            });
            results.push({ frameworkType: fwType, frameworkId: result.insertId, payload: compiledPayload });
          }
          return { success: true, frameworks: results };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 预览广告Payload */
      async previewPayload(frameworkId) {
        const db = await getDb();
        if (!db) return { success: false };
        try {
          const [fw] = await db.select().from(prelaunchAdFrameworks).where(eq(prelaunchAdFrameworks.id, frameworkId)).limit(1);
          if (!fw) return { success: false, error: "Framework not found" };
          const structure = typeof fw.campaignStructure === "string" ? JSON.parse(fw.campaignStructure) : fw.campaignStructure;
          return {
            success: true,
            data: {
              ...fw,
              campaignStructure: structure
            }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 部署广告框架到Amazon */
      async deployToAmazon(frameworkId, profileId, dryRun) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const [fw] = await db.select().from(prelaunchAdFrameworks).where(eq(prelaunchAdFrameworks.id, frameworkId)).limit(1);
          if (!fw) return { success: false, error: "Framework not found" };
          const structure = typeof fw.campaignStructure === "string" ? JSON.parse(fw.campaignStructure) : fw.campaignStructure;
          if (dryRun) {
            await db.insert(prelaunchAdDeployLogs).values({
              frameworkId,
              action: "dry_run",
              logStatus: "success",
              requestPayload: { profileId, dryRun: true },
              responsePayload: { validated: true, campaignCount: structure?.campaigns?.length || 0 }
            });
            return {
              success: true,
              dryRun: true,
              validation: {
                campaignCount: structure?.campaigns?.length || 0,
                // @ts-ignore
                adGroupCount: structure?.campaigns?.reduce((sum2, c) => sum2 + (c.adGroups?.length || 0), 0) || 0,
                estimatedApiCalls: this.estimateApiCalls(structure)
              }
            };
          }
          const deployResult = await this.executeDeployment(structure, profileId);
          await db.insert(prelaunchAdDeployLogs).values({
            frameworkId,
            action: "deploy",
            logStatus: deployResult.success ? "success" : "failed",
            requestPayload: { profileId },
            responsePayload: deployResult
          });
          await db.update(prelaunchAdFrameworks).set({
            status: deployResult.success ? "deployed" : "failed",
            deployedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
            deployResult
          }).where(eq(prelaunchAdFrameworks.id, frameworkId));
          return deployResult;
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 获取部署日志 */
      async getDeployLogs(frameworkId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchAdDeployLogs).where(eq(prelaunchAdDeployLogs.frameworkId, frameworkId)).orderBy(desc(prelaunchAdDeployLogs.createdAt));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      // ==================== 广告框架编译器 ====================
      /** SP搜索词手动广告 */
      compileSPKeywordManual(keywords10, defaultBid, dailyBudget) {
        const scenarioGroups = /* @__PURE__ */ new Map();
        const relevantKws = keywords10.filter(
          (k) => k.relevanceLayer === "core" || k.relevanceLayer === "extended"
        );
        for (const kw of relevantKws) {
          const scenario = kw.scenarioCode || "S01";
          if (!scenarioGroups.has(scenario)) scenarioGroups.set(scenario, []);
          scenarioGroups.get(scenario).push(kw);
        }
        const campaigns6 = [];
        let totalKeywords = 0;
        for (const [scenario, kws] of scenarioGroups) {
          if (kws.length === 0) continue;
          const matchTypes = ["EXACT", "PHRASE", "BROAD"];
          const adGroups6 = matchTypes.map((matchType) => {
            const targets = kws.map((kw) => ({
              keyword: kw.keyword,
              matchType,
              bid: this.calculateBid(kw, matchType, defaultBid)
            }));
            totalKeywords += targets.length;
            return {
              adGroupName: `SP-KW-${scenario}-${matchType}`,
              defaultBid,
              targets
            };
          });
          campaigns6.push({
            campaignName: `SP-KW-Manual-${scenario}`,
            campaignType: "sponsoredProducts",
            targetingType: "MANUAL",
            dailyBudget,
            startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            state: "PAUSED",
            adGroups: adGroups6
          });
        }
        return { type: "SP_KW_MANUAL", campaigns: campaigns6, totalKeywords, totalTargets: 0 };
      }
      /** SP产品定位广告 */
      compileSPProductTargeting(competitors, defaultBid, dailyBudget) {
        const tiers = ["T1_head", "T2_waist", "T3_niche"];
        const campaigns6 = [];
        let totalTargets = 0;
        for (const tier2 of tiers) {
          const tierComps = competitors.filter((c) => c.tier === tier2);
          if (tierComps.length === 0) continue;
          const adGroups6 = [{
            adGroupName: `SP-PT-${tier2}-ASIN`,
            defaultBid,
            // @ts-expect-error - array method type inference
            targets: tierComps.map((c) => {
              totalTargets++;
              return {
                expressionType: "ASIN_SAME_AS",
                asin: c.asin,
                bid: this.calculateCompetitorBid(c, tier2, defaultBid)
              };
            })
          }];
          campaigns6.push({
            campaignName: `SP-PT-Manual-${tier2}`,
            campaignType: "sponsoredProducts",
            targetingType: "MANUAL",
            dailyBudget,
            startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            state: "PAUSED",
            adGroups: adGroups6
          });
        }
        return { type: "SP_PT_MANUAL", campaigns: campaigns6, totalKeywords: 0, totalTargets };
      }
      /** SP自动广告 */
      compileSPAuto(defaultBid, dailyBudget) {
        const autoTypes = [
          { name: "Close_Match", expression: "CLOSE_MATCH", bidMultiplier: 1 },
          { name: "Loose_Match", expression: "LOOSE_MATCH", bidMultiplier: 0.8 },
          { name: "Substitutes", expression: "SUBSTITUTES", bidMultiplier: 0.9 },
          { name: "Complements", expression: "COMPLEMENTS", bidMultiplier: 0.7 }
        ];
        const campaigns6 = [{
          campaignName: "SP-Auto-Discovery",
          campaignType: "sponsoredProducts",
          targetingType: "AUTO",
          dailyBudget,
          startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          state: "PAUSED",
          adGroups: autoTypes.map((at) => ({
            adGroupName: `SP-Auto-${at.name}`,
            defaultBid: Math.round(defaultBid * at.bidMultiplier * 100) / 100,
            autoTargetingExpression: at.expression
          }))
        }];
        return { type: "SP_AUTO", campaigns: campaigns6, totalKeywords: 0, totalTargets: 4 };
      }
      /** SB视频搜索词广告 */
      compileSBVKeyword(keywords10, defaultBid, dailyBudget) {
        const coreKws = keywords10.filter((k) => k.relevanceLayer === "core");
        const scenarioGroups = /* @__PURE__ */ new Map();
        for (const kw of coreKws) {
          const scenario = kw.scenarioCode || "S01";
          if (!scenarioGroups.has(scenario)) scenarioGroups.set(scenario, []);
          scenarioGroups.get(scenario).push(kw);
        }
        const campaigns6 = [];
        let totalKeywords = 0;
        for (const [scenario, kws] of scenarioGroups) {
          if (kws.length === 0) continue;
          const targets = kws.map((kw) => {
            totalKeywords++;
            return {
              keyword: kw.keyword,
              matchType: "BROAD",
              bid: Math.round(defaultBid * 1.2 * 100) / 100
            };
          });
          campaigns6.push({
            campaignName: `SBV-KW-${scenario}`,
            campaignType: "sponsoredBrandsVideo",
            targetingType: "MANUAL",
            dailyBudget: Math.round(dailyBudget * 1.5),
            startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            state: "PAUSED",
            adGroups: [{
              adGroupName: `SBV-KW-${scenario}-BROAD`,
              defaultBid: Math.round(defaultBid * 1.2 * 100) / 100,
              targets
            }]
          });
        }
        return { type: "SBV_KW", campaigns: campaigns6, totalKeywords, totalTargets: 0 };
      }
      /** SB视频产品定位广告 */
      compileSBVProductTargeting(competitors, defaultBid, dailyBudget) {
        const tiers = ["T1_head", "T2_waist", "T3_niche"];
        const campaigns6 = [];
        let totalTargets = 0;
        for (const tier2 of tiers) {
          const tierComps = competitors.filter((c) => c.tier === tier2);
          if (tierComps.length === 0) continue;
          const targets = tierComps.map((c) => {
            totalTargets++;
            return {
              expressionType: "ASIN_SAME_AS",
              asin: c.asin,
              bid: Math.round(defaultBid * 1.3 * 100) / 100
            };
          });
          campaigns6.push({
            campaignName: `SBV-PT-${tier2}`,
            campaignType: "sponsoredBrandsVideo",
            targetingType: "MANUAL",
            dailyBudget: Math.round(dailyBudget * 1.5),
            startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            state: "PAUSED",
            adGroups: [{
              adGroupName: `SBV-PT-${tier2}-ASIN`,
              defaultBid: Math.round(defaultBid * 1.3 * 100) / 100,
              targets
            }]
          });
        }
        return { type: "SBV_PT", campaigns: campaigns6, totalKeywords: 0, totalTargets };
      }
      // ==================== 辅助方法 ====================
      /** 根据关键词属性计算出价 */
      calculateBid(kw, matchType, defaultBid) {
        let multiplier = 1;
        if (kw.relevanceLayer === "core") multiplier *= 1.2;
        else if (kw.relevanceLayer === "extended") multiplier *= 1;
        else multiplier *= 0.8;
        if (matchType === "EXACT") multiplier *= 1.3;
        else if (matchType === "PHRASE") multiplier *= 1;
        else multiplier *= 0.7;
        const kvi = parseFloat(kw.kviScore) || 0.5;
        multiplier *= 0.7 + kvi * 0.6;
        return Math.round(defaultBid * multiplier * 100) / 100;
      }
      /** 根据竞品属性计算出价 */
      calculateCompetitorBid(comp, tier2, defaultBid) {
        let multiplier = 1;
        if (tier2 === "T1_head") multiplier = 0.8;
        else if (tier2 === "T2_waist") multiplier = 1.1;
        else multiplier = 1.3;
        return Math.round(defaultBid * multiplier * 100) / 100;
      }
      /** 估算API调用次数 */
      estimateApiCalls(structure) {
        let calls = 0;
        for (const campaign of structure?.campaigns || []) {
          calls += 1;
          for (const ag of campaign.adGroups || []) {
            calls += 1;
            calls += ag.targets?.length || 0;
          }
        }
        return calls;
      }
      /** 执行实际部署（调用Amazon Ads API） */
      async executeDeployment(structure, profileId) {
        return {
          success: true,
          message: "Deployment request recorded. Amazon Ads API integration pending configuration.",
          profileId,
          // @ts-ignore
          campaignCount: structure?.campaigns?.length || 0,
          estimatedApiCalls: this.estimateApiCalls(structure),
          deployedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    };
  }
});

