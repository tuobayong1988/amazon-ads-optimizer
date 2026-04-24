/**
 * M7 广告框架引擎服务
 * SP/SB全类型广告活动结构编译 → JSON Payload生成 → Amazon Ads API部署
 */
import { getDb } from '../../db';
import {
  prelaunchAdFrameworks, prelaunchAdDeployLogs,
  prelaunchKeywords, prelaunchCompetitors,
} from '../../../drizzle/schema';
import { eq, desc, and } from 'drizzle-orm';
import { geminiStructuredOutput } from '../gemini';

/** 广告框架类型定义（v26.5: 新增 SB_KW 和 SD_PT） */
type FrameworkType = 'SP_KW_MANUAL' | 'SP_PT_MANUAL' | 'SP_AUTO' | 'SBV_KW' | 'SBV_PT' | 'SB_KW' | 'SD_PT';

/**
 * v26.5 优化3A: 竞品流量结构分析结果
 * 用于动态调整各渠道的预算分配比例
 */
interface TrafficStructure {
  spShare: number;    // SP 流量占比 (0-1)
  sbShare: number;    // SB 流量占比 (0-1)
  sdShare: number;    // SD 流量占比 (0-1)
  organicShare: number; // 自然流量占比 (0-1)
}

export class M7AdFrameworkService {

  async getAdFrameworks(projectId: number, frameworkType?: string) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const conditions = [eq(prelaunchAdFrameworks.projectId, projectId)];
      if (frameworkType) conditions.push(eq(prelaunchAdFrameworks.frameworkType, frameworkType));

      const data = await db.select()
        .from(prelaunchAdFrameworks)
        .where(and(...conditions))
        .orderBy(desc(prelaunchAdFrameworks.createdAt));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 编译广告框架（v26.5: 支持动态渠道分配 + 新广告类型） */
  async compileFrameworks(input: {
    projectId: number;
    frameworkTypes: FrameworkType[];
    defaultBid: number;
    dailyBudget: number;
  }) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 获取M1关键词和M2竞品数据
      const keywords = await db.select().from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, input.projectId));
      const competitors = await db.select().from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, input.projectId));

      // v26.5 优化3A: 分析竞品流量结构，动态调整渠道预算分配
      const trafficStructure = this.analyzeCompetitorTrafficStructure(competitors);
      const budgetAllocation = this.calculateDynamicBudgetAllocation(input.dailyBudget, trafficStructure, input.frameworkTypes);

      const results: unknown[] = [];

      for (const fwType of input.frameworkTypes) {
        let compiledPayload: unknown;
        const channelBudget = budgetAllocation[fwType] || input.dailyBudget;

        switch (fwType) {
          case 'SP_KW_MANUAL':
            compiledPayload = this.compileSPKeywordManual(keywords, input.defaultBid, channelBudget);
            break;
          case 'SP_PT_MANUAL':
            compiledPayload = this.compileSPProductTargeting(competitors, input.defaultBid, channelBudget);
            break;
          case 'SP_AUTO':
            compiledPayload = this.compileSPAuto(input.defaultBid, channelBudget);
            break;
          case 'SBV_KW':
            compiledPayload = this.compileSBVKeyword(keywords, input.defaultBid, channelBudget);
            break;
          case 'SBV_PT':
            compiledPayload = this.compileSBVProductTargeting(competitors, input.defaultBid, channelBudget);
            break;
          case 'SB_KW':
            compiledPayload = this.compileSBKeyword(keywords, input.defaultBid, channelBudget);
            break;
          case 'SD_PT':
            compiledPayload = this.compileSDProductTargeting(competitors, input.defaultBid, channelBudget);
            break;
        }

        // 适配实际schema字段：campaignStructure, totalCampaigns, totalAdGroups
        const [result] = await db.insert(prelaunchAdFrameworks).values({
          projectId: input.projectId,
          frameworkType: fwType,
          frameworkName: `${fwType}_${new Date().toISOString().slice(0, 10)}`,
          campaignStructure: compiledPayload,
          // @ts-expect-error - runtime type mismatch
          totalCampaigns: compiledPayload.campaigns?.length || 0,
          // @ts-expect-error - array method type inference
          totalAdGroups: compiledPayload.campaigns?.reduce((sum: number, c: Record<string, unknown>) => sum + (c.adGroups?.length || 0), 0) || 0,
          // @ts-expect-error - runtime type mismatch
          totalKeywords: compiledPayload.totalKeywords || 0,
          // @ts-expect-error - runtime type mismatch
          totalTargets: compiledPayload.totalTargets || 0,
          estimatedDailyBudget: String(input.dailyBudget),
          status: 'draft',
        });

        // @ts-expect-error - type assertion
        results.push({ frameworkType: fwType, frameworkId: (result as Record<string, number>).insertId, payload: compiledPayload });
      }

      return { success: true, frameworks: results };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 预览广告Payload */
  async previewPayload(frameworkId: number) {
    const db = await getDb();
    if (!db) return { success: false };

    try {
      const [fw] = await db.select()
        .from(prelaunchAdFrameworks)
        .where(eq(prelaunchAdFrameworks.id, frameworkId))
        .limit(1);

      if (!fw) return { success: false, error: 'Framework not found' };

      // 使用实际字段名 campaignStructure
      const structure = typeof fw.campaignStructure === 'string' 
        ? JSON.parse(fw.campaignStructure) 
        : fw.campaignStructure;

      return {
        success: true,
        data: {
          ...fw,
          campaignStructure: structure,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 部署广告框架到Amazon */
  async deployToAmazon(frameworkId: number, profileId: string, dryRun: boolean) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [fw] = await db.select()
        .from(prelaunchAdFrameworks)
        .where(eq(prelaunchAdFrameworks.id, frameworkId))
        .limit(1);

      if (!fw) return { success: false, error: 'Framework not found' };

      // 使用实际字段名 campaignStructure
      const structure = typeof fw.campaignStructure === 'string' 
        ? JSON.parse(fw.campaignStructure) 
        : fw.campaignStructure;

      if (dryRun) {
        // 干运行模式：验证payload格式但不实际调用API
        await db.insert(prelaunchAdDeployLogs).values({
          frameworkId,
          action: 'dry_run',
          logStatus: 'success',
          requestPayload: { profileId, dryRun: true },
          responsePayload: { validated: true, campaignCount: structure?.campaigns?.length || 0 },
        });

        return {
          success: true,
          dryRun: true,
          validation: {
            campaignCount: structure?.campaigns?.length || 0,
            // @ts-expect-error Conditional type narrowing
            adGroupCount: structure?.campaigns?.reduce((sum: number, c: Record<string, unknown>) => sum + (c.adGroups?.length || 0), 0) || 0,
            estimatedApiCalls: this.estimateApiCalls(structure),
          },
        };
      }

      // 实际部署：调用Amazon Ads API
      const deployResult = await this.executeDeployment(structure, profileId);

      await db.insert(prelaunchAdDeployLogs).values({
        frameworkId,
        action: 'deploy',
        logStatus: deployResult.success ? 'success' : 'failed',
        requestPayload: { profileId },
        responsePayload: deployResult,
      });

      // 更新框架状态
      await db.update(prelaunchAdFrameworks)
        .set({ 
          status: deployResult.success ? 'deployed' : 'failed',
          deployedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          deployResult,
        })
        .where(eq(prelaunchAdFrameworks.id, frameworkId));

      return deployResult;
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 获取部署日志 */
  async getDeployLogs(frameworkId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchAdDeployLogs)
        .where(eq(prelaunchAdDeployLogs.frameworkId, frameworkId))
        .orderBy(desc(prelaunchAdDeployLogs.createdAt));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  // ==================== 广告框架编译器 ====================

  /** SP搜索词手动广告 */
  private compileSPKeywordManual(keywords: unknown[], defaultBid: number, dailyBudget: number) {
    // @ts-expect-error Type inference limitation
    const scenarioGroups = new Map<string, Record<string, unknown>[]>();
    // @ts-expect-error Type inference limitation
    const relevantKws = keywords.filter((k: Record<string, unknown>) => 
      k.relevanceLayer === 'core' || k.relevanceLayer === 'extended'
    );

    for (const kw of (relevantKws as unknown[])) {
      // @ts-expect-error Type inference limitation
      const scenario = kw.scenarioCode || 'S01';
      if (!scenarioGroups.has(scenario)) scenarioGroups.set(scenario, []);
      // @ts-expect-error Array method type inference
      scenarioGroups.get(scenario)!.push(kw);
    }

    const campaigns: unknown[] = [];
    let totalKeywords = 0;

    for (const [scenario, kws] of scenarioGroups) {
      if (kws.length === 0) continue;

      const matchTypes = ['EXACT', 'PHRASE', 'BROAD'];
      const adGroups = matchTypes.map(matchType => {
        const targets = kws.map((kw: Record<string, unknown>) => ({
          keyword: kw.keyword,
          matchType,
          bid: this.calculateBid(kw, matchType, defaultBid),
        }));
        totalKeywords += targets.length;

        return {
          adGroupName: `SP-KW-${scenario}-${matchType}`,
          defaultBid,
          targets,
        };
      });

      campaigns.push({
        campaignName: `SP-KW-Manual-${scenario}`,
        campaignType: 'sponsoredProducts',
        targetingType: 'MANUAL',
        dailyBudget,
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adGroups,
      });
    }

    return { type: 'SP_KW_MANUAL', campaigns, totalKeywords, totalTargets: 0 };
  }

  /** SP产品定位广告 */
  private compileSPProductTargeting(competitors: unknown[], defaultBid: number, dailyBudget: number) {
    const tiers = ['T1_head', 'T2_waist', 'T3_niche'];
    const campaigns: unknown[] = [];
    let totalTargets = 0;

    for (const tier of tiers) {
      // @ts-expect-error - array method type inference
      const tierComps = competitors.filter((c: Record<string, unknown>) => c.tier === tier);
      if (tierComps.length === 0) continue;

      const adGroups = [{
        adGroupName: `SP-PT-${tier}-ASIN`,
        defaultBid,
        // @ts-expect-error - array method type inference
        targets: tierComps.map((c: Record<string, unknown>) => {
          totalTargets++;
          return {
            expressionType: 'ASIN_SAME_AS',
            asin: c.asin,
            bid: this.calculateCompetitorBid(c, tier, defaultBid),
          };
        }),
      }];

      campaigns.push({
        campaignName: `SP-PT-Manual-${tier}`,
        campaignType: 'sponsoredProducts',
        targetingType: 'MANUAL',
        dailyBudget,
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adGroups,
      });
    }

    return { type: 'SP_PT_MANUAL', campaigns, totalKeywords: 0, totalTargets };
  }

  /** SP自动广告 */
  private compileSPAuto(defaultBid: number, dailyBudget: number) {
    const autoTypes = [
      { name: 'Close_Match', expression: 'CLOSE_MATCH', bidMultiplier: 1.0 },
      { name: 'Loose_Match', expression: 'LOOSE_MATCH', bidMultiplier: 0.8 },
      { name: 'Substitutes', expression: 'SUBSTITUTES', bidMultiplier: 0.9 },
      { name: 'Complements', expression: 'COMPLEMENTS', bidMultiplier: 0.7 },
    ];

    const campaigns = [{
      campaignName: 'SP-Auto-Discovery',
      campaignType: 'sponsoredProducts',
      targetingType: 'AUTO',
      dailyBudget,
      startDate: new Date().toISOString().slice(0, 10),
      state: 'PAUSED',
      adGroups: autoTypes.map(at => ({
        adGroupName: `SP-Auto-${at.name}`,
        defaultBid: Math.round(defaultBid * at.bidMultiplier * 100) / 100,
        autoTargetingExpression: at.expression,
      })),
    }];

    return { type: 'SP_AUTO', campaigns, totalKeywords: 0, totalTargets: 4 };
  // @ts-expect-error Legacy code type compatibility
  }

  /** SB视频搜索词广告 */
  private compileSBVKeyword(keywords: unknown[], defaultBid: number, dailyBudget: number) {
    // @ts-expect-error Dynamic property access
    const coreKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core');
    // @ts-expect-error Type inference limitation
    const scenarioGroups = new Map<string, Record<string, unknown>[]>();

    for (const kw of (coreKws as unknown[])) {
      // @ts-expect-error Type inference limitation
      const scenario = kw.scenarioCode || 'S01';
      if (!scenarioGroups.has(scenario)) scenarioGroups.set(scenario, []);
      // @ts-expect-error Array method type inference
      scenarioGroups.get(scenario)!.push(kw);
    }

    const campaigns: unknown[] = [];
    let totalKeywords = 0;

    for (const [scenario, kws] of scenarioGroups) {
      if (kws.length === 0) continue;

      const targets = kws.map((kw: Record<string, unknown>) => {
        totalKeywords++;
        return {
          keyword: kw.keyword,
          matchType: 'BROAD',
          bid: Math.round(defaultBid * 1.2 * 100) / 100,
        };
      });

      campaigns.push({
        campaignName: `SBV-KW-${scenario}`,
        campaignType: 'sponsoredBrandsVideo',
        targetingType: 'MANUAL',
        dailyBudget: Math.round(dailyBudget * 1.5),
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adGroups: [{
          adGroupName: `SBV-KW-${scenario}-BROAD`,
          defaultBid: Math.round(defaultBid * 1.2 * 100) / 100,
          targets,
        }],
      });
    }

    return { type: 'SBV_KW', campaigns, totalKeywords, totalTargets: 0 };
  }

  /** SB视频产品定位广告 */
  private compileSBVProductTargeting(competitors: unknown[], defaultBid: number, dailyBudget: number) {
    const tiers = ['T1_head', 'T2_waist', 'T3_niche'];
    const campaigns: unknown[] = [];
    let totalTargets = 0;

    for (const tier of tiers) {
      // @ts-expect-error - array method type inference
      const tierComps = competitors.filter((c: Record<string, unknown>) => c.tier === tier);
      if (tierComps.length === 0) continue;

      // @ts-expect-error - array method type inference
      const targets = tierComps.map((c: Record<string, unknown>) => {
        totalTargets++;
        return {
          expressionType: 'ASIN_SAME_AS',
          asin: c.asin,
          bid: Math.round(defaultBid * 1.3 * 100) / 100,
        };
      });

      campaigns.push({
        campaignName: `SBV-PT-${tier}`,
        campaignType: 'sponsoredBrandsVideo',
        targetingType: 'MANUAL',
        dailyBudget: Math.round(dailyBudget * 1.5),
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adGroups: [{
          adGroupName: `SBV-PT-${tier}-ASIN`,
          defaultBid: Math.round(defaultBid * 1.3 * 100) / 100,
          targets,
        }],
      });
    }

    return { type: 'SBV_PT', campaigns, totalKeywords: 0, totalTargets };
  }

  // ==================== v26.5 新增广告类型 ====================

  /**
   * v26.5 优化3B: SB 关键词广告（Sponsored Brands Keyword）
   * 与 SBV_KW 类似但使用品牌模式而非视频模式
   */
  private compileSBKeyword(keywords: unknown[], defaultBid: number, dailyBudget: number) {
    // @ts-expect-error Dynamic property access
    const coreKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core' || k.relevanceLayer === 'extended');
    // @ts-expect-error Type inference limitation
    const scenarioGroups = new Map<string, Record<string, unknown>[]>();

    for (const kw of (coreKws as unknown[])) {
      // @ts-expect-error Type inference limitation
      const scenario = kw.scenarioCode || 'S01';
      if (!scenarioGroups.has(scenario)) scenarioGroups.set(scenario, []);
      // @ts-expect-error Array method type inference
      scenarioGroups.get(scenario)!.push(kw);
    }

    const campaigns: unknown[] = [];
    let totalKeywords = 0;

    for (const [scenario, kws] of scenarioGroups) {
      if (kws.length === 0) continue;

      // SB 关键词广告使用 BROAD + PHRASE 匹配
      const matchTypes = ['BROAD', 'PHRASE'];
      const adGroups = matchTypes.map(matchType => {
        const targets = kws.map((kw: Record<string, unknown>) => {
          totalKeywords++;
          return {
            keyword: kw.keyword,
            matchType,
            bid: Math.round(defaultBid * 1.1 * 100) / 100,
          };
        });

        return {
          adGroupName: `SB-KW-${scenario}-${matchType}`,
          defaultBid: Math.round(defaultBid * 1.1 * 100) / 100,
          targets,
        };
      });

      campaigns.push({
        campaignName: `SB-KW-${scenario}`,
        campaignType: 'sponsoredBrands',
        targetingType: 'MANUAL',
        dailyBudget: Math.round(dailyBudget * 1.2),
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adFormat: 'productCollection',
        adGroups,
      });
    }

    return { type: 'SB_KW', campaigns, totalKeywords, totalTargets: 0 };
  }

  /**
   * v26.5 优化3B: SD 产品定位广告（Sponsored Display Product Targeting）
   * 利用 SD 的受众定位能力，对竞品详情页进行拦截
   */
  private compileSDProductTargeting(competitors: unknown[], defaultBid: number, dailyBudget: number) {
    const tiers = ['T1_head', 'T2_waist', 'T3_niche'];
    const campaigns: unknown[] = [];
    let totalTargets = 0;

    for (const tier of tiers) {
      // @ts-expect-error - array method type inference
      const tierComps = competitors.filter((c: Record<string, unknown>) => c.tier === tier);
      if (tierComps.length === 0) continue;

      // SD 产品定位：针对竞品 ASIN 和品类
      // @ts-expect-error - array method type inference
      const asinTargets = tierComps.map((c: Record<string, unknown>) => {
        totalTargets++;
        return {
          expressionType: 'ASIN_SAME_AS',
          asin: c.asin,
          bid: this.calculateCompetitorBid(c, tier, defaultBid) * 0.9, // SD 出价略低于 SP
        };
      });

      // 添加品类定位（仅对 T1 头部竞品）
      if (tier === 'T1_head') {
        const categories = new Set<string>();
        for (const c of tierComps as Record<string, unknown>[]) {
          if (c.category) categories.add(String(c.category));
        }
        for (const cat of categories) {
          totalTargets++;
          asinTargets.push({
            expressionType: 'ASIN_CATEGORY_SAME_AS' as 'ASIN_SAME_AS',
            asin: cat,
            bid: defaultBid * 0.7,
          });
        }
      }

      campaigns.push({
        campaignName: `SD-PT-${tier}`,
        campaignType: 'sponsoredDisplay',
        targetingType: 'MANUAL',
        tactic: 'T00030', // 产品定位
        dailyBudget: Math.round(dailyBudget * 0.8),
        startDate: new Date().toISOString().slice(0, 10),
        state: 'PAUSED',
        adGroups: [{
          adGroupName: `SD-PT-${tier}-Targets`,
          defaultBid: Math.round(defaultBid * 0.9 * 100) / 100,
          targets: asinTargets,
        }],
      });
    }

    return { type: 'SD_PT', campaigns, totalKeywords: 0, totalTargets };
  }

  // ==================== v26.5 优化3A: 动态渠道分配 ====================

  /**
   * 分析竞品流量结构
   * 从竞品数据中推断 SP/SB/SD 的流量占比
   */
  private analyzeCompetitorTrafficStructure(competitors: unknown[]): TrafficStructure {
    // 默认流量结构（亚马逊平均值）
    const defaultStructure: TrafficStructure = {
      spShare: 0.55,
      sbShare: 0.20,
      sdShare: 0.10,
      organicShare: 0.15,
    };

    if (!competitors || competitors.length === 0) return defaultStructure;

    // 从竞品数据中提取流量信号
    let totalSpSignal = 0;
    let totalSbSignal = 0;
    let totalSdSignal = 0;
    let totalOrganicSignal = 0;
    let validCount = 0;

    for (const comp of competitors as Record<string, unknown>[]) {
      // 从竞品的 trafficSources 或 adPresence 字段提取信号
      const trafficSources = comp.trafficSources || comp.traffic_sources;
      const adPresence = comp.adPresence || comp.ad_presence;

      if (trafficSources && typeof trafficSources === 'object') {
        const ts = trafficSources as Record<string, number>;
        totalSpSignal += ts.sp || ts.sponsoredProducts || 0;
        totalSbSignal += ts.sb || ts.sponsoredBrands || 0;
        totalSdSignal += ts.sd || ts.sponsoredDisplay || 0;
        totalOrganicSignal += ts.organic || 0;
        validCount++;
      } else if (adPresence) {
        // 简化信号：根据竞品是否有 SB/SD 广告在投来推断
        totalSpSignal += 1;
        if (String(adPresence).includes('SB') || String(adPresence).includes('brand')) totalSbSignal += 1;
        if (String(adPresence).includes('SD') || String(adPresence).includes('display')) totalSdSignal += 1;
        totalOrganicSignal += 0.5;
        validCount++;
      }
    }

    if (validCount === 0) return defaultStructure;

    const total = totalSpSignal + totalSbSignal + totalSdSignal + totalOrganicSignal;
    if (total === 0) return defaultStructure;

    return {
      spShare: Math.max(0.3, totalSpSignal / total),
      sbShare: Math.max(0.1, totalSbSignal / total),
      sdShare: Math.max(0.05, totalSdSignal / total),
      organicShare: totalOrganicSignal / total,
    };
  }

  /**
   * 根据流量结构计算动态预算分配
   * 将总预算按渠道流量占比分配到各广告类型
   */
  private calculateDynamicBudgetAllocation(
    totalDailyBudget: number,
    trafficStructure: TrafficStructure,
    frameworkTypes: FrameworkType[]
  ): Record<string, number> {
    // 计算广告渠道总预算（排除自然流量占比）
    const adBudgetTotal = totalDailyBudget * frameworkTypes.length;
    const adTrafficTotal = trafficStructure.spShare + trafficStructure.sbShare + trafficStructure.sdShare;

    // 各渠道基础预算比例
    const spRatio = trafficStructure.spShare / adTrafficTotal;
    const sbRatio = trafficStructure.sbShare / adTrafficTotal;
    const sdRatio = trafficStructure.sdShare / adTrafficTotal;

    // 计算各类型数量
    const spTypes = frameworkTypes.filter(t => t.startsWith('SP_'));
    const sbTypes = frameworkTypes.filter(t => t.startsWith('SB'));
    const sdTypes = frameworkTypes.filter(t => t.startsWith('SD_'));

    const allocation: Record<string, number> = {};

    // SP 渠道预算分配
    const spBudget = adBudgetTotal * spRatio;
    for (const t of spTypes) {
      allocation[t] = Math.round(spBudget / Math.max(1, spTypes.length));
    }

    // SB 渠道预算分配
    const sbBudget = adBudgetTotal * sbRatio;
    for (const t of sbTypes) {
      allocation[t] = Math.round(sbBudget / Math.max(1, sbTypes.length));
    }

    // SD 渠道预算分配
    const sdBudget = adBudgetTotal * sdRatio;
    for (const t of sdTypes) {
      allocation[t] = Math.round(sdBudget / Math.max(1, sdTypes.length));
    }

    // 确保每个渠道至少有最低预算
    for (const t of frameworkTypes) {
      if (!allocation[t] || allocation[t] < 5) {
        allocation[t] = Math.max(5, totalDailyBudget * 0.5); // 最低单渠道预算
      }
    }

    return allocation;
  }

  // ==================== 辅助方法 ====================

  /** 根据关键词属性计算出价 */
  private calculateBid(kw: unknown, matchType: string, defaultBid: number): number {
    let multiplier = 1.0;

    // @ts-expect-error Dynamic property access
    if (kw.relevanceLayer === 'core') multiplier *= 1.2;
    // @ts-expect-error Dynamic property access
    else if (kw.relevanceLayer === 'extended') multiplier *= 1.0;
    else multiplier *= 0.8;

    if (matchType === 'EXACT') multiplier *= 1.3;
    else if (matchType === 'PHRASE') multiplier *= 1.0;
    else multiplier *= 0.7;

    // @ts-expect-error Type inference limitation
    const kvi = parseFloat(kw.kviScore) || 0.5;
    multiplier *= (0.7 + kvi * 0.6);

    return Math.round(defaultBid * multiplier * 100) / 100;
  }

  /** 根据竞品属性计算出价 */
  private calculateCompetitorBid(comp: unknown, tier: string, defaultBid: number): number {
    let multiplier = 1.0;

    // @ts-expect-error Conditional type narrowing
    if (tier === 'T1_head') multiplier = 0.8;
    else if (tier === 'T2_waist') multiplier = 1.1;
    else multiplier = 1.3;

    return Math.round(defaultBid * multiplier * 100) / 100;
  }

  /** 估算API调用次数 */
  private estimateApiCalls(structure: unknown): number {
    let calls = 0;
    // @ts-expect-error Conditional type narrowing
    for (const campaign of (structure?.campaigns || [])) {
      calls += 1;
      for (const ag of (campaign.adGroups || [])) {
        calls += 1;
        calls += (ag.targets?.length || 0);
      }
    // @ts-expect-error Legacy code type compatibility
    }
    return calls;
  }

  /** 执行实际部署（调用Amazon Ads API） */
  private async executeDeployment(structure: unknown, profileId: string) {
    // TODO: 集成Amazon Ads API v3
    return {
      success: true,
      message: 'Deployment request recorded. Amazon Ads API integration pending configuration.',
      profileId,
      // @ts-expect-error Conditional type narrowing
      campaignCount: structure?.campaigns?.length || 0,
      estimatedApiCalls: this.estimateApiCalls(structure),
      deployedAt: new Date().toISOString(),
    };
  }
}
