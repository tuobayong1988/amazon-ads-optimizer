/**
 * v183: 多维度组合分析引擎 (Multi-Dimension Combo Analyzer)
 * 
 * 核心功能:
 * 1. 从 keywordPlacementHourlyPerformance 表查询交叉维度数据
 * 2. 应用时间衰减加权，近期数据权重更高
 * 3. 识别三类绩效组合: 黄金(golden)、铅石(leaden)、潜力(potential)、标准(standard)
 * 4. 为每个投放词生成动态竞价乘数、位置乘数、时间乘数
 * 5. 将分析结果写入 multiDimComboAnalysis 表供执行引擎使用
 * 
 * 设计原则:
 * - 渐进式调整: 所有乘数变化不超过单次20%
 * - 数据保护: 数据不足的投放词采用保护性策略(乘数=1.0)
 * - 时间衰减: 近7天权重最高，30天前权重最低
 * - 纠错机制: 每次分析都重新评估，自动纠正过往错误分类
 */

import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { keywordPlacementHourlyPerformance, multiDimComboAnalysis, keywords, productTargets, campaigns } from '../drizzle/schema';

// ==================== 类型定义 ====================

/** 时间窗口定义 */
interface TimeWindow {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  avgRoas: number;
  avgAcos: number;
  totalSpend: number;
  totalSales: number;
}

/** 位置绩效摘要 */
interface PlacementSummary {
  placement: 'top_of_search' | 'product_page' | 'rest_of_search';
  weightedRoas: number;
  weightedAcos: number;
  totalSpend: number;
  totalSales: number;
  totalClicks: number;
  totalOrders: number;
  dataPoints: number;
}

/** 投放词组合分析结果 */
export interface ComboAnalysisResult {
  keywordId: number | null;
  targetId: number | null;
  keywordText: string;
  campaignId: number;
  comboCategory: 'golden' | 'leaden' | 'potential' | 'standard';
  bestPlacement: 'top_of_search' | 'product_page' | 'rest_of_search' | null;
  worstPlacement: 'top_of_search' | 'product_page' | 'rest_of_search' | null;
  bestTimeWindows: TimeWindow[];
  worstTimeWindows: TimeWindow[];
  placementSummaries: PlacementSummary[];
  suggestedBidMultiplier: number;
  suggestedPlacementMultiplier: number;
  suggestedTimeMultiplier: number;
  totalClicks: number;
  totalOrders: number;
  dataPoints: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'insufficient';
}

/** Campaign级别分析结果 */
export interface CampaignComboAnalysis {
  campaignId: number;
  campaignName: string;
  goldenCombos: ComboAnalysisResult[];
  leadenCombos: ComboAnalysisResult[];
  potentialCombos: ComboAnalysisResult[];
  standardCombos: ComboAnalysisResult[];
  overallConfidence: 'high' | 'medium' | 'low' | 'insufficient';
  totalKeywordsAnalyzed: number;
  suggestedBudgetMultiplier: number;
}

// ==================== 时间衰减权重 ====================

/**
 * 计算时间衰减权重
 * 近7天: 权重1.0
 * 7-14天: 权重0.7
 * 14-21天: 权重0.4
 * 21-30天: 权重0.2
 */
function getTimeDecayWeight(daysAgo: number): number {
  if (daysAgo <= 7) return 1.0;
  if (daysAgo <= 14) return 0.7;
  if (daysAgo <= 21) return 0.4;
  if (daysAgo <= 30) return 0.2;
  return 0.1;
}

// ==================== 核心分析函数 ====================

/**
 * 分析单个Campaign下所有投放词的多维度组合绩效
 */
export async function analyzeCampaignCombos(
  db: ReturnType<typeof drizzle>,
  campaignId: number,
  accountId: number,
  targetAcos: number = 30,
  lookbackDays: number = 30
): Promise<CampaignComboAnalysis | null> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  // 获取campaign信息
  const campaignInfo = await db.select({ campaignName: campaigns.campaignName })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const campaignName = campaignInfo[0]?.campaignName || `Campaign ${campaignId}`;

  // 1. 查询交叉维度原始数据 (按投放词+位置+星期+小时聚合)
  const rawData = await db.select({
    keywordId: keywordPlacementHourlyPerformance.keywordId,
    targetId: keywordPlacementHourlyPerformance.targetId,
    placement: keywordPlacementHourlyPerformance.placement,
    dayOfWeek: keywordPlacementHourlyPerformance.dayOfWeek,
    hour: keywordPlacementHourlyPerformance.hour,
    date: keywordPlacementHourlyPerformance.date,
    impressions: keywordPlacementHourlyPerformance.impressions,
    clicks: keywordPlacementHourlyPerformance.clicks,
    spend: keywordPlacementHourlyPerformance.spend,
    sales: keywordPlacementHourlyPerformance.sales,
    orders: keywordPlacementHourlyPerformance.orders,
  })
  .from(keywordPlacementHourlyPerformance)
  .where(and(
    eq(keywordPlacementHourlyPerformance.campaignId, campaignId),
    eq(keywordPlacementHourlyPerformance.accountId, accountId),
    gte(keywordPlacementHourlyPerformance.date, startStr),
    lte(keywordPlacementHourlyPerformance.date, endStr),
  ));

  if (rawData.length === 0) {
    console.log(`[ComboAnalyzer] Campaign ${campaignId} 无交叉维度数据，跳过`);
    return null;
  }

  // 2. 按投放词分组
  const keywordGroups = new Map<string, typeof rawData>();
  for (const row of rawData) {
    const key = row.keywordId ? `kw_${row.keywordId}` : `tgt_${row.targetId}`;
    if (!keywordGroups.has(key)) {
      keywordGroups.set(key, []);
    }
    keywordGroups.get(key)!.push(row);
  }

  // 3. 获取投放词文本信息
  const keywordTexts = new Map<string, string>();
  const keywordIds = [...keywordGroups.keys()]
    .filter(k => k.startsWith('kw_'))
    .map(k => parseInt(k.replace('kw_', '')));
  
  if (keywordIds.length > 0) {
    const kwInfos = await db.select({ id: keywords.id, keywordText: keywords.keywordText })
      .from(keywords)
      .where(sql`${keywords.id} IN (${sql.join(keywordIds.map(id => sql`${id}`), sql`, `)})`);
    for (const kw of kwInfos) {
      keywordTexts.set(`kw_${kw.id}`, kw.keywordText);
    }
  }

  const targetIds = [...keywordGroups.keys()]
    .filter(k => k.startsWith('tgt_'))
    .map(k => parseInt(k.replace('tgt_', '')));
  
  if (targetIds.length > 0) {
    const tgtInfos = await db.select({ id: productTargets.id, targetExpression: productTargets.targetExpression })
      .from(productTargets)
      .where(sql`${productTargets.id} IN (${sql.join(targetIds.map(id => sql`${id}`), sql`, `)})`);
    for (const tgt of tgtInfos) {
      keywordTexts.set(`tgt_${tgt.id}`, tgt.targetExpression || `Target ${tgt.id}`);
    }
  }

  // 4. 对每个投放词进行多维度分析
  const allResults: ComboAnalysisResult[] = [];

  for (const [key, rows] of keywordGroups) {
    const result = analyzeKeywordCombo(
      key, rows, keywordTexts.get(key) || key, campaignId, targetAcos, endDate
    );
    allResults.push(result);
  }

  // 5. 分类
  const goldenCombos = allResults.filter(r => r.comboCategory === 'golden');
  const leadenCombos = allResults.filter(r => r.comboCategory === 'leaden');
  const potentialCombos = allResults.filter(r => r.comboCategory === 'potential');
  const standardCombos = allResults.filter(r => r.comboCategory === 'standard');

  // 6. 计算Campaign级别的预算乘数
  const suggestedBudgetMultiplier = calculateCampaignBudgetMultiplier(
    goldenCombos, leadenCombos, potentialCombos, standardCombos, targetAcos
  );

  // 7. 计算整体置信度
  const totalClicks = allResults.reduce((s, r) => s + r.totalClicks, 0);
  const totalOrders = allResults.reduce((s, r) => s + r.totalOrders, 0);
  const overallConfidence: 'high' | 'medium' | 'low' | 'insufficient' =
    totalClicks >= 200 && totalOrders >= 20 ? 'high' :
    totalClicks >= 50 && totalOrders >= 5 ? 'medium' :
    totalClicks >= 10 ? 'low' : 'insufficient';

  console.log(`[ComboAnalyzer] Campaign ${campaignName}: ${goldenCombos.length}个黄金, ${leadenCombos.length}个铅石, ${potentialCombos.length}个潜力, ${standardCombos.length}个标准 (置信度: ${overallConfidence})`);

  return {
    campaignId,
    campaignName,
    goldenCombos,
    leadenCombos,
    potentialCombos,
    standardCombos,
    overallConfidence,
    totalKeywordsAnalyzed: allResults.length,
    suggestedBudgetMultiplier,
  };
}

/**
 * 分析单个投放词的多维度组合绩效
 */
function analyzeKeywordCombo(
  key: string,
  rows: any[],
  keywordText: string,
  campaignId: number,
  targetAcos: number,
  referenceDate: Date
): ComboAnalysisResult {
  const keywordId = key.startsWith('kw_') ? parseInt(key.replace('kw_', '')) : null;
  const targetId = key.startsWith('tgt_') ? parseInt(key.replace('tgt_', '')) : null;

  // 应用时间衰减加权
  const weightedRows = rows.map(row => {
    const rowDate = new Date(row.date);
    const daysAgo = Math.floor((referenceDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));
    const weight = getTimeDecayWeight(daysAgo);
    return {
      ...row,
      weight,
      wSpend: parseFloat(row.spend || '0') * weight,
      wSales: parseFloat(row.sales || '0') * weight,
      wClicks: (row.clicks || 0) * weight,
      wOrders: (row.orders || 0) * weight,
      wImpressions: (row.impressions || 0) * weight,
    };
  });

  // === 位置维度分析 ===
  const placementMap = new Map<string, PlacementSummary>();
  for (const placement of ['top_of_search', 'product_page', 'rest_of_search'] as const) {
    const placementRows = weightedRows.filter(r => r.placement === placement);
    const totalSpend = placementRows.reduce((s, r) => s + r.wSpend, 0);
    const totalSales = placementRows.reduce((s, r) => s + r.wSales, 0);
    const totalClicks = placementRows.reduce((s, r) => s + r.wClicks, 0);
    const totalOrders = placementRows.reduce((s, r) => s + r.wOrders, 0);

    placementMap.set(placement, {
      placement,
      weightedRoas: totalSpend > 0 ? totalSales / totalSpend : 0,
      weightedAcos: totalSales > 0 ? (totalSpend / totalSales) * 100 : (totalSpend > 0 ? 999 : 0),
      totalSpend,
      totalSales,
      totalClicks,
      totalOrders,
      dataPoints: placementRows.length,
    });
  }

  const placementSummaries = [...placementMap.values()];
  const validPlacements = placementSummaries.filter(p => p.totalClicks >= 3);
  const sortedPlacements = [...validPlacements].sort((a, b) => b.weightedRoas - a.weightedRoas);
  const bestPlacement = sortedPlacements.length > 0 ? sortedPlacements[0].placement : null;
  const worstPlacement = sortedPlacements.length > 1 ? sortedPlacements[sortedPlacements.length - 1].placement : null;

  // === 时间维度分析 ===
  // 按 (dayOfWeek, hour) 聚合
  const timeSlotMap = new Map<string, { dayOfWeek: number; hour: number; wSpend: number; wSales: number; wClicks: number; wOrders: number; count: number }>();
  for (const row of weightedRows) {
    const slotKey = `${row.dayOfWeek}_${row.hour}`;
    if (!timeSlotMap.has(slotKey)) {
      timeSlotMap.set(slotKey, { dayOfWeek: row.dayOfWeek, hour: row.hour, wSpend: 0, wSales: 0, wClicks: 0, wOrders: 0, count: 0 });
    }
    const slot = timeSlotMap.get(slotKey)!;
    slot.wSpend += row.wSpend;
    slot.wSales += row.wSales;
    slot.wClicks += row.wClicks;
    slot.wOrders += row.wOrders;
    slot.count++;
  }

  // 找出最佳和最差时间窗口
  const timeSlots = [...timeSlotMap.values()];
  const validTimeSlots = timeSlots.filter(t => t.wClicks >= 2);
  const sortedByRoas = [...validTimeSlots].sort((a, b) => {
    const roasA = a.wSpend > 0 ? a.wSales / a.wSpend : 0;
    const roasB = b.wSpend > 0 ? b.wSales / b.wSpend : 0;
    return roasB - roasA;
  });

  const bestTimeWindows: TimeWindow[] = sortedByRoas.slice(0, 5).map(t => ({
    dayOfWeek: t.dayOfWeek,
    startHour: t.hour,
    endHour: t.hour,
    avgRoas: t.wSpend > 0 ? t.wSales / t.wSpend : 0,
    avgAcos: t.wSales > 0 ? (t.wSpend / t.wSales) * 100 : 999,
    totalSpend: t.wSpend,
    totalSales: t.wSales,
  }));

  const worstTimeWindows: TimeWindow[] = sortedByRoas.slice(-5).reverse().map(t => ({
    dayOfWeek: t.dayOfWeek,
    startHour: t.hour,
    endHour: t.hour,
    avgRoas: t.wSpend > 0 ? t.wSales / t.wSpend : 0,
    avgAcos: t.wSales > 0 ? (t.wSpend / t.wSales) * 100 : 999,
    totalSpend: t.wSpend,
    totalSales: t.wSales,
  }));

  // === 综合指标计算 ===
  const totalSpend = weightedRows.reduce((s, r) => s + r.wSpend, 0);
  const totalSales = weightedRows.reduce((s, r) => s + r.wSales, 0);
  const totalClicks = weightedRows.reduce((s, r) => s + r.wClicks, 0);
  const totalOrders = weightedRows.reduce((s, r) => s + r.wOrders, 0);
  const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const overallAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : (totalSpend > 0 ? 999 : 0);

  // === 组合分类 ===
  const { category, bidMultiplier, placementMultiplier, timeMultiplier, confidence } = classifyCombo(
    totalClicks, totalOrders, totalSpend, totalSales, overallRoas, overallAcos,
    bestPlacement, bestTimeWindows, targetAcos, rows.length
  );

  return {
    keywordId,
    targetId,
    keywordText,
    campaignId,
    comboCategory: category,
    bestPlacement,
    worstPlacement,
    bestTimeWindows,
    worstTimeWindows,
    placementSummaries,
    suggestedBidMultiplier: bidMultiplier,
    suggestedPlacementMultiplier: placementMultiplier,
    suggestedTimeMultiplier: timeMultiplier,
    totalClicks: Math.round(totalClicks),
    totalOrders: Math.round(totalOrders),
    dataPoints: rows.length,
    confidenceLevel: confidence,
  };
}

/**
 * 组合分类算法
 * 
 * 分类标准:
 * - golden: ROAS >= 目标ROAS的120%, 且数据充分(clicks>=20, orders>=3)
 * - leaden: ACoS >= 目标ACoS的150% 或 花费>=$5但0转化, 且数据充分(clicks>=15)
 * - potential: 数据不足以判断(clicks<15), 但有一定表现
 * - standard: 其他所有情况
 */
function classifyCombo(
  totalClicks: number,
  totalOrders: number,
  totalSpend: number,
  totalSales: number,
  roas: number,
  acos: number,
  bestPlacement: string | null,
  bestTimeWindows: TimeWindow[],
  targetAcos: number,
  dataPoints: number
): {
  category: 'golden' | 'leaden' | 'potential' | 'standard';
  bidMultiplier: number;
  placementMultiplier: number;
  timeMultiplier: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
} {
  // 数据置信度
  const confidence: 'high' | 'medium' | 'low' | 'insufficient' =
    totalClicks >= 50 && totalOrders >= 8 ? 'high' :
    totalClicks >= 20 && totalOrders >= 3 ? 'medium' :
    totalClicks >= 10 ? 'low' : 'insufficient';

  const targetRoas = targetAcos > 0 ? 100 / targetAcos : 3.33;

  // 数据不足 → 保护性策略
  if (confidence === 'insufficient') {
    return {
      category: 'potential',
      bidMultiplier: 1.0,
      placementMultiplier: 1.0,
      timeMultiplier: 1.0,
      confidence,
    };
  }

  // 黄金组合: 高投产
  if (roas >= targetRoas * 1.2 && totalOrders >= 3 && confidence !== 'low') {
    // 根据超标程度计算乘数，但限制最大20%增幅
    const roasRatio = Math.min(roas / targetRoas, 3.0);
    const bidMultiplier = Math.min(1.20, 1.0 + (roasRatio - 1.2) * 0.1);
    const placementMultiplier = bestPlacement ? Math.min(1.15, 1.0 + (roasRatio - 1.0) * 0.05) : 1.0;
    const timeMultiplier = bestTimeWindows.length > 0 ? Math.min(1.15, 1.0 + (roasRatio - 1.0) * 0.05) : 1.0;

    return { category: 'golden', bidMultiplier, placementMultiplier, timeMultiplier, confidence };
  }

  // 铅石组合: 低投产
  const isHighSpendNoConversion = totalSpend >= 5 && totalOrders === 0 && totalClicks >= 15;
  const isHighAcos = acos >= targetAcos * 1.5 && totalClicks >= 15;

  if (isHighSpendNoConversion || isHighAcos) {
    // 降低幅度也限制在20%以内
    const acosRatio = acos > 0 ? Math.min(acos / targetAcos, 5.0) : 3.0;
    const bidMultiplier = Math.max(0.80, 1.0 - (acosRatio - 1.5) * 0.05);
    const placementMultiplier = Math.max(0.85, 1.0 - (acosRatio - 1.5) * 0.03);
    const timeMultiplier = Math.max(0.85, 1.0 - (acosRatio - 1.5) * 0.03);

    return { category: 'leaden', bidMultiplier, placementMultiplier, timeMultiplier, confidence };
  }

  // 低置信度 → 潜力组合
  if (confidence === 'low') {
    return {
      category: 'potential',
      bidMultiplier: 1.0,
      placementMultiplier: 1.0,
      timeMultiplier: 1.0,
      confidence,
    };
  }

  // 标准组合: 表现一般
  // 微调: 根据与目标的偏差做小幅调整(±5%)
  const deviation = (targetAcos - acos) / targetAcos;
  const bidMultiplier = Math.max(0.95, Math.min(1.05, 1.0 + deviation * 0.05));

  return {
    category: 'standard',
    bidMultiplier,
    placementMultiplier: 1.0,
    timeMultiplier: 1.0,
    confidence,
  };
}

/**
 * 计算Campaign级别的预算乘数
 * 
 * 逻辑:
 * - 黄金组合花费占比高 → 增加预算(最多+15%)
 * - 铅石组合花费占比高 → 降低预算(最多-10%)
 * - 其他情况 → 保持不变
 */
function calculateCampaignBudgetMultiplier(
  golden: ComboAnalysisResult[],
  leaden: ComboAnalysisResult[],
  potential: ComboAnalysisResult[],
  standard: ComboAnalysisResult[],
  targetAcos: number
): number {
  const allCombos = [...golden, ...leaden, ...potential, ...standard];
  if (allCombos.length === 0) return 1.0;

  const totalSpend = allCombos.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);

  if (totalSpend <= 0) return 1.0;

  const goldenSpend = golden.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);

  const leadenSpend = leaden.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);

  const goldenRatio = goldenSpend / totalSpend;
  const leadenRatio = leadenSpend / totalSpend;

  // 黄金组合花费占比 > 40% → 增加预算
  if (goldenRatio > 0.4 && leadenRatio < 0.2) {
    return Math.min(1.15, 1.0 + (goldenRatio - 0.4) * 0.3);
  }

  // 铅石组合花费占比 > 40% → 降低预算
  if (leadenRatio > 0.4) {
    return Math.max(0.90, 1.0 - (leadenRatio - 0.4) * 0.2);
  }

  return 1.0;
}

// ==================== 实时查询函数 ====================

/**
 * 获取当前时段某个投放词的最佳动态乘数
 * 用于分时竞价执行时实时查询
 */
export async function getRealtimeMultipliers(
  db: ReturnType<typeof drizzle>,
  campaignId: number,
  keywordId: number | null,
  targetId: number | null,
  currentDayOfWeek: number,
  currentHour: number
): Promise<{
  bidMultiplier: number;
  placementMultiplier: number;
  timeMultiplier: number;
  comboCategory: string;
  confidence: string;
} | null> {
  // 从分析结果表中查询
  const conditions = [eq(multiDimComboAnalysis.campaignId, campaignId)];
  if (keywordId) {
    conditions.push(eq(multiDimComboAnalysis.keywordId, keywordId));
  } else if (targetId) {
    conditions.push(eq(multiDimComboAnalysis.targetId, targetId));
  }

  const result = await db.select()
    .from(multiDimComboAnalysis)
    .where(and(...conditions))
    .orderBy(desc(multiDimComboAnalysis.analyzedAt))
    .limit(1);

  if (result.length === 0) return null;

  const analysis = result[0];
  const baseBidMultiplier = parseFloat(String(analysis.suggestedBidMultiplier || '1.000'));
  const basePlacementMultiplier = parseFloat(String(analysis.suggestedPlacementMultiplier || '1.000'));
  let baseTimeMultiplier = parseFloat(String(analysis.suggestedTimeMultiplier || '1.000'));

  // 根据当前时段微调时间乘数
  const bestWindows = analysis.bestTimeWindows as TimeWindow[] || [];
  const worstWindows = analysis.worstTimeWindows as TimeWindow[] || [];

  const isInBestWindow = bestWindows.some(w => 
    w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
  );
  const isInWorstWindow = worstWindows.some(w => 
    w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
  );

  if (isInBestWindow) {
    baseTimeMultiplier = Math.min(baseTimeMultiplier * 1.10, 1.20);
  } else if (isInWorstWindow) {
    baseTimeMultiplier = Math.max(baseTimeMultiplier * 0.90, 0.80);
  }

  return {
    bidMultiplier: baseBidMultiplier,
    placementMultiplier: basePlacementMultiplier,
    timeMultiplier: baseTimeMultiplier,
    comboCategory: analysis.comboCategory,
    confidence: analysis.confidenceLevel || 'insufficient',
  };
}

// ==================== 分析结果持久化 ====================

/**
 * 将分析结果写入数据库
 */
export async function persistAnalysisResults(
  db: ReturnType<typeof drizzle>,
  accountId: number,
  analysis: CampaignComboAnalysis
): Promise<number> {
  const allCombos = [
    ...analysis.goldenCombos,
    ...analysis.leadenCombos,
    ...analysis.potentialCombos,
    ...analysis.standardCombos,
  ];

  if (allCombos.length === 0) return 0;

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  // 先删除该campaign的旧分析结果
  await db.delete(multiDimComboAnalysis)
    .where(and(
      eq(multiDimComboAnalysis.accountId, accountId),
      eq(multiDimComboAnalysis.campaignId, analysis.campaignId),
    ));

  // 批量插入新结果
  let inserted = 0;
  for (const combo of allCombos) {
    const topOfSearch = combo.placementSummaries.find(p => p.placement === 'top_of_search');
    const productPage = combo.placementSummaries.find(p => p.placement === 'product_page');
    const restOfSearch = combo.placementSummaries.find(p => p.placement === 'rest_of_search');

    try {
      await db.insert(multiDimComboAnalysis).values({
        accountId,
        campaignId: combo.campaignId,
        keywordId: combo.keywordId,
        targetId: combo.targetId,
        keywordText: combo.keywordText.substring(0, 500),
        comboCategory: combo.comboCategory,
        bestPlacement: combo.bestPlacement,
        worstPlacement: combo.worstPlacement,
        bestTimeWindows: combo.bestTimeWindows,
        worstTimeWindows: combo.worstTimeWindows,
        topOfSearchRoas: topOfSearch ? String(topOfSearch.weightedRoas.toFixed(2)) : null,
        topOfSearchAcos: topOfSearch ? String(topOfSearch.weightedAcos.toFixed(4)) : null,
        topOfSearchSpend: topOfSearch ? String(topOfSearch.totalSpend.toFixed(2)) : null,
        topOfSearchSales: topOfSearch ? String(topOfSearch.totalSales.toFixed(2)) : null,
        productPageRoas: productPage ? String(productPage.weightedRoas.toFixed(2)) : null,
        productPageAcos: productPage ? String(productPage.weightedAcos.toFixed(4)) : null,
        productPageSpend: productPage ? String(productPage.totalSpend.toFixed(2)) : null,
        productPageSales: productPage ? String(productPage.totalSales.toFixed(2)) : null,
        restOfSearchRoas: restOfSearch ? String(restOfSearch.weightedRoas.toFixed(2)) : null,
        restOfSearchAcos: restOfSearch ? String(restOfSearch.weightedAcos.toFixed(4)) : null,
        restOfSearchSpend: restOfSearch ? String(restOfSearch.totalSpend.toFixed(2)) : null,
        restOfSearchSales: restOfSearch ? String(restOfSearch.totalSales.toFixed(2)) : null,
        suggestedBidMultiplier: String(combo.suggestedBidMultiplier.toFixed(3)),
        suggestedPlacementMultiplier: String(combo.suggestedPlacementMultiplier.toFixed(3)),
        suggestedTimeMultiplier: String(combo.suggestedTimeMultiplier.toFixed(3)),
        totalClicks: combo.totalClicks,
        totalOrders: combo.totalOrders,
        dataPoints: combo.dataPoints,
        confidenceLevel: combo.confidenceLevel,
        analysisStartDate: startDate.toISOString().split('T')[0],
        analysisEndDate: new Date().toISOString().split('T')[0],
        analyzedAt: now,
      });
      inserted++;
    } catch (err: any) {
      console.error(`[ComboAnalyzer] 写入分析结果失败: ${err.message}`);
    }
  }

  console.log(`[ComboAnalyzer] Campaign ${analysis.campaignName}: 写入${inserted}条分析结果`);
  return inserted;
}

// ==================== 主入口函数 ====================

/**
 * 执行多维度组合分析（供调度器调用）
 */
export async function executeMultiDimComboAnalysis(
  db: ReturnType<typeof drizzle>,
  accountId: number,
  campaignIds: number[],
  config: {
    targetAcos?: number;
    lookbackDays?: number;
  }
): Promise<{
  campaignsAnalyzed: number;
  totalCombosFound: number;
  goldenCount: number;
  leadenCount: number;
  potentialCount: number;
  standardCount: number;
  details: CampaignComboAnalysis[];
}> {
  const targetAcos = config.targetAcos || 30;
  const lookbackDays = config.lookbackDays || 30;

  let campaignsAnalyzed = 0;
  let totalCombosFound = 0;
  let goldenCount = 0;
  let leadenCount = 0;
  let potentialCount = 0;
  let standardCount = 0;
  const details: CampaignComboAnalysis[] = [];

  for (const campaignId of campaignIds) {
    try {
      const analysis = await analyzeCampaignCombos(db, campaignId, accountId, targetAcos, lookbackDays);
      if (!analysis) continue;

      // 持久化分析结果
      await persistAnalysisResults(db, accountId, analysis);

      campaignsAnalyzed++;
      totalCombosFound += analysis.totalKeywordsAnalyzed;
      goldenCount += analysis.goldenCombos.length;
      leadenCount += analysis.leadenCombos.length;
      potentialCount += analysis.potentialCombos.length;
      standardCount += analysis.standardCombos.length;
      details.push(analysis);
    } catch (err: any) {
      console.error(`[ComboAnalyzer] Campaign ${campaignId} 分析失败: ${err.message}`);
    }
  }

  console.log(`[ComboAnalyzer] 分析完成: ${campaignsAnalyzed}个campaign, ${totalCombosFound}个组合 (黄金:${goldenCount}, 铅石:${leadenCount}, 潜力:${potentialCount}, 标准:${standardCount})`);

  return {
    campaignsAnalyzed,
    totalCombosFound,
    goldenCount,
    leadenCount,
    potentialCount,
    standardCount,
    details,
  };
}


// ==================== 批量查询函数 ====================

/**
 * v183: 获取某个账号下所有投放词的组合分析结果
 * 供分时竞价执行引擎批量加载使用
 */
export async function getComboAnalysisForAccount(
  db: ReturnType<typeof drizzle>,
  accountId: number
): Promise<any[]> {
  const results = await db.select()
    .from(multiDimComboAnalysis)
    .where(eq(multiDimComboAnalysis.accountId, accountId));
  return results;
}

/**
 * v183: 获取某个Campaign下所有投放词的组合分析结果
 * 供位置优化引擎使用
 */
export async function getComboAnalysisForCampaign(
  db: ReturnType<typeof drizzle>,
  accountId: number,
  campaignId: number
): Promise<any[]> {
  const results = await db.select()
    .from(multiDimComboAnalysis)
    .where(and(
      eq(multiDimComboAnalysis.accountId, accountId),
      eq(multiDimComboAnalysis.campaignId, campaignId),
    ));
  return results;
}
