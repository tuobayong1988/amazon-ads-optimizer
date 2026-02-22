/**
 * v183.1: 多维度组合分析引擎 (Multi-Dimension Combo Analyzer)
 * 
 * 核心功能:
 * 1. 优先从 keywordPlacementHourlyPerformance 表查询交叉维度数据
 * 2. 当交叉维度表无数据时，自动从 hourlyPerformance + placementPerformance 合成数据
 * 3. 应用时间衰减加权，近期数据权重更高
 * 4. 识别四类绩效组合: 黄金(golden)、铅石(leaden)、潜力(potential)、标准(standard)
 * 5. 为每个投放词生成动态竞价乘数、位置乘数、时间乘数
 * 6. 将分析结果写入 multiDimComboAnalysis 表供执行引擎使用
 * 7. 自我迭代: 对比上一轮分析结果，追踪分类变化，限制乘数剧烈波动
 * 8. 输出Campaign级别预算乘数，供预算执行引擎使用
 * 
 * 设计原则:
 * - 渐进式调整: 所有乘数变化不超过单次20%
 * - 数据保护: 数据不足的投放词采用保护性策略(乘数=1.0)
 * - 时间衰减: 近7天权重最高，30天前权重最低
 * - 纠错机制: 每次分析都重新评估，自动纠正过往错误分类
 * - 平滑过渡: 新旧乘数通过加权平均实现平滑过渡
 */

import { eq, and, sql, gte, lte, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  keywordPlacementHourlyPerformance,
  multiDimComboAnalysis,
  keywords,
  productTargets,
  campaigns,
  hourlyPerformance,
  placementPerformance,
  adGroups,
} from '../drizzle/schema';

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
  // v183.1: 自我迭代追踪
  previousCategory?: 'golden' | 'leaden' | 'potential' | 'standard' | null;
  categoryChanged?: boolean;
  dataSource?: 'cross_dimension' | 'synthesized' | 'mixed';
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
  dataSource: 'cross_dimension' | 'synthesized' | 'mixed';
  // v183.1: 自我迭代统计
  categoryChanges: { keywordText: string; from: string; to: string }[];
}

/** 统一的原始数据行格式（交叉维度表和合成数据共用） */
interface RawDataRow {
  keywordId: number | null;
  targetId: number | null;
  placement: 'top_of_search' | 'product_page' | 'rest_of_search';
  dayOfWeek: number;
  hour: number;
  date: string;
  impressions: number;
  clicks: number;
  spend: string;
  sales: string;
  orders: number;
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

// ==================== 数据合成函数 ====================

/**
 * v183.1: 从现有 hourlyPerformance + placementPerformance 表合成交叉维度数据
 * 
 * 合成策略:
 * 1. hourlyPerformance 提供: 投放词 × 小时 × 星期 维度的绩效数据
 * 2. placementPerformance 提供: Campaign级别的位置分布比例
 * 3. 合成: 将每个投放词的时间维度数据，按Campaign的位置分布比例拆分到各位置
 * 
 * 这是一个合理的近似：同一Campaign下的投放词通常共享相似的位置分布模式
 */
async function synthesizeFromExistingData(
  db: ReturnType<typeof drizzle>,
  campaignId: number,
  accountId: number,
  startStr: string,
  endStr: string
): Promise<RawDataRow[]> {
  // 1. 获取campaign的Amazon ID（placementPerformance使用Amazon ID）
  const campaignInfo = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
  })
  .from(campaigns)
  .where(eq(campaigns.id, campaignId))
  .limit(1);

  if (campaignInfo.length === 0) return [];
  const amazonCampaignId = campaignInfo[0].campaignId;

  // 2. 查询 hourlyPerformance 数据（投放词 × 小时 × 星期）
  const hourlyData = await db.select({
    keywordId: hourlyPerformance.keywordId,
    hour: hourlyPerformance.hour,
    dayOfWeek: hourlyPerformance.dayOfWeek,
    date: hourlyPerformance.date,
    impressions: hourlyPerformance.impressions,
    clicks: hourlyPerformance.clicks,
    spend: hourlyPerformance.spend,
    sales: hourlyPerformance.sales,
    orders: hourlyPerformance.orders,
  })
  .from(hourlyPerformance)
  .where(and(
    eq(hourlyPerformance.campaignId, String(campaignId)),
    eq(hourlyPerformance.accountId, accountId),
    gte(hourlyPerformance.date, startStr),
    lte(hourlyPerformance.date, endStr),
  ));

  if (hourlyData.length === 0) {
    console.log(`[ComboAnalyzer] Campaign ${campaignId} hourlyPerformance 也无数据`);
    return [];
  }

  // 3. 查询 placementPerformance 数据（Campaign级别位置分布）
  const placementData = await db.select({
    placement: placementPerformance.placement,
    impressions: placementPerformance.impressions,
    clicks: placementPerformance.clicks,
    spend: placementPerformance.spend,
    sales: placementPerformance.sales,
    orders: placementPerformance.orders,
  })
  .from(placementPerformance)
  .where(and(
    eq(placementPerformance.campaignId, String(amazonCampaignId)),
    eq(placementPerformance.accountId, accountId),
    gte(placementPerformance.date, startStr),
    lte(placementPerformance.date, endStr),
  ));

  // 4. 计算位置分布比例
  const placementRatios = calculatePlacementRatios(placementData);
  
  console.log(`[ComboAnalyzer] Campaign ${campaignId} 合成数据: ${hourlyData.length}条hourly记录, ` +
    `位置比例: TOS=${(placementRatios.top_of_search * 100).toFixed(1)}%, ` +
    `PP=${(placementRatios.product_page * 100).toFixed(1)}%, ` +
    `ROS=${(placementRatios.rest_of_search * 100).toFixed(1)}%`);

  // 5. 合成交叉维度数据
  const synthesized: RawDataRow[] = [];
  
  for (const row of hourlyData) {
    if (!row.keywordId) continue; // 跳过没有投放词ID的记录
    
    const spend = parseFloat(row.spend || '0');
    const sales = parseFloat(row.sales || '0');
    const clicks = row.clicks || 0;
    const impressions = row.impressions || 0;
    const orders = row.orders || 0;
    const dateStr = typeof row.date === 'string' ? row.date.split('T')[0] : new Date(row.date).toISOString().split('T')[0];

    // 按位置比例拆分
    for (const placement of ['top_of_search', 'product_page', 'rest_of_search'] as const) {
      const ratio = placementRatios[placement];
      if (ratio <= 0) continue;

      synthesized.push({
        keywordId: row.keywordId,
        targetId: null,
        placement,
        dayOfWeek: row.dayOfWeek,
        hour: row.hour,
        date: dateStr,
        impressions: Math.round(impressions * ratio),
        clicks: Math.round(clicks * ratio),
        spend: (spend * ratio).toFixed(2),
        sales: (sales * ratio).toFixed(2),
        orders: Math.round(orders * ratio),
      });
    }
  }

  console.log(`[ComboAnalyzer] Campaign ${campaignId} 合成了 ${synthesized.length} 条交叉维度记录`);
  return synthesized;
}

/**
 * 计算位置分布比例
 * 如果没有placementPerformance数据，使用行业默认值
 */
function calculatePlacementRatios(
  placementData: any[]
): Record<'top_of_search' | 'product_page' | 'rest_of_search', number> {
  if (placementData.length === 0) {
    // 行业默认分布（基于Amazon SP广告的典型分布）
    return {
      top_of_search: 0.35,
      product_page: 0.30,
      rest_of_search: 0.35,
    };
  }

  // 按花费计算各位置的比例（花费更能反映真实的流量分布）
  const spendByPlacement: Record<string, number> = {
    top_of_search: 0,
    product_page: 0,
    rest_of_search: 0,
  };

  for (const row of placementData) {
    const placement = row.placement as string;
    const spend = parseFloat(row.spend || '0');
    if (spendByPlacement[placement] !== undefined) {
      spendByPlacement[placement] += spend;
    }
  }

  const totalSpend = Object.values(spendByPlacement).reduce((a, b) => a + b, 0);
  
  if (totalSpend <= 0) {
    // 如果花费都是0，按点击数分配
    const clicksByPlacement: Record<string, number> = {
      top_of_search: 0,
      product_page: 0,
      rest_of_search: 0,
    };
    for (const row of placementData) {
      const placement = row.placement as string;
      if (clicksByPlacement[placement] !== undefined) {
        clicksByPlacement[placement] += (row.clicks || 0);
      }
    }
    const totalClicks = Object.values(clicksByPlacement).reduce((a, b) => a + b, 0);
    if (totalClicks <= 0) {
      return { top_of_search: 0.35, product_page: 0.30, rest_of_search: 0.35 };
    }
    return {
      top_of_search: clicksByPlacement.top_of_search / totalClicks,
      product_page: clicksByPlacement.product_page / totalClicks,
      rest_of_search: clicksByPlacement.rest_of_search / totalClicks,
    };
  }

  return {
    top_of_search: spendByPlacement.top_of_search / totalSpend,
    product_page: spendByPlacement.product_page / totalSpend,
    rest_of_search: spendByPlacement.rest_of_search / totalSpend,
  };
}

// ==================== 自我迭代函数 ====================

/**
 * v183.1: 加载上一轮分析结果，用于对比和平滑过渡
 */
async function loadPreviousAnalysis(
  db: ReturnType<typeof drizzle>,
  accountId: number,
  campaignId: number
): Promise<Map<string, { category: string; bidMultiplier: number; placementMultiplier: number; timeMultiplier: number }>> {
  const prevResults = await db.select({
    keywordId: multiDimComboAnalysis.keywordId,
    targetId: multiDimComboAnalysis.targetId,
    comboCategory: multiDimComboAnalysis.comboCategory,
    suggestedBidMultiplier: multiDimComboAnalysis.suggestedBidMultiplier,
    suggestedPlacementMultiplier: multiDimComboAnalysis.suggestedPlacementMultiplier,
    suggestedTimeMultiplier: multiDimComboAnalysis.suggestedTimeMultiplier,
  })
  .from(multiDimComboAnalysis)
  .where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(campaignId)),
  ));

  const map = new Map<string, { category: string; bidMultiplier: number; placementMultiplier: number; timeMultiplier: number }>();
  for (const row of prevResults) {
    const key = row.keywordId ? `kw_${row.keywordId}` : `tgt_${row.targetId}`;
    map.set(key, {
      category: row.comboCategory,
      bidMultiplier: parseFloat(String(row.suggestedBidMultiplier || '1.000')),
      placementMultiplier: parseFloat(String(row.suggestedPlacementMultiplier || '1.000')),
      timeMultiplier: parseFloat(String(row.suggestedTimeMultiplier || '1.000')),
    });
  }
  return map;
}

/**
 * v183.1: 平滑过渡乘数
 * 新乘数 = 旧乘数 × (1 - smoothFactor) + 新计算乘数 × smoothFactor
 * smoothFactor = 0.6 表示新数据占60%权重，旧数据占40%权重
 * 这确保乘数不会在两次分析之间剧烈波动
 */
function smoothMultiplier(newValue: number, oldValue: number, smoothFactor: number = 0.6): number {
  if (oldValue === 1.0 && newValue === 1.0) return 1.0;
  // 如果旧值是默认值1.0（首次分析），直接使用新值
  if (Math.abs(oldValue - 1.0) < 0.001) return newValue;
  return oldValue * (1 - smoothFactor) + newValue * smoothFactor;
}

// ==================== 核心分析函数 ====================

/**
 * 分析单个Campaign下所有投放词的多维度组合绩效
 * v183.1: 支持从现有数据合成 + 自我迭代
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

  // v183.1: 加载上一轮分析结果（用于自我迭代）
  const previousAnalysis = await loadPreviousAnalysis(db, accountId, campaignId);

  // 1. 优先尝试从交叉维度表查询数据
  let rawData: RawDataRow[] = [];
  let dataSource: 'cross_dimension' | 'synthesized' | 'mixed' = 'cross_dimension';

  const crossDimData = await db.select({
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
    eq(keywordPlacementHourlyPerformance.campaignId, String(campaignId)),
    eq(keywordPlacementHourlyPerformance.accountId, accountId),
    gte(keywordPlacementHourlyPerformance.date, startStr),
    lte(keywordPlacementHourlyPerformance.date, endStr),
  ));

  if (crossDimData.length > 0) {
    rawData = crossDimData.map(row => ({
      keywordId: row.keywordId,
      targetId: row.targetId,
      placement: row.placement as 'top_of_search' | 'product_page' | 'rest_of_search',
      dayOfWeek: row.dayOfWeek,
      hour: row.hour,
      date: typeof row.date === 'string' ? row.date : String(row.date),
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      spend: String(row.spend || '0'),
      sales: String(row.sales || '0'),
      orders: row.orders || 0,
    }));
    dataSource = 'cross_dimension';
    console.log(`[ComboAnalyzer] Campaign ${campaignName}: 使用交叉维度表数据 (${rawData.length}条)`);
  }

  // 2. v183.1: 如果交叉维度表无数据，从现有表合成
  if (rawData.length === 0) {
    rawData = await synthesizeFromExistingData(db, campaignId, accountId, startStr, endStr);
    dataSource = 'synthesized';
    
    if (rawData.length === 0) {
      console.log(`[ComboAnalyzer] Campaign ${campaignName}: 无任何可用数据，跳过`);
      return null;
    }
    console.log(`[ComboAnalyzer] Campaign ${campaignName}: 使用合成数据 (${rawData.length}条)`);
  }

  // 如果交叉维度表有部分数据，也合成补充
  if (crossDimData.length > 0 && crossDimData.length < 50) {
    const synthesized = await synthesizeFromExistingData(db, campaignId, accountId, startStr, endStr);
    if (synthesized.length > crossDimData.length) {
      // 合并：交叉维度数据优先，合成数据补充
      const existingKeys = new Set(rawData.map(r => 
        `${r.keywordId || ''}_${r.targetId || ''}_${r.placement}_${r.dayOfWeek}_${r.hour}_${r.date}`
      ));
      for (const row of synthesized) {
        const key = `${row.keywordId || ''}_${row.targetId || ''}_${row.placement}_${row.dayOfWeek}_${row.hour}_${row.date}`;
        if (!existingKeys.has(key)) {
          rawData.push(row);
        }
      }
      dataSource = 'mixed';
      console.log(`[ComboAnalyzer] Campaign ${campaignName}: 混合数据 (交叉:${crossDimData.length} + 合成补充, 总计:${rawData.length}条)`);
    }
  }

  // 3. 按投放词分组
  const keywordGroups = new Map<string, RawDataRow[]>();
  for (const row of rawData) {
    const key = row.keywordId ? `kw_${row.keywordId}` : (row.targetId ? `tgt_${row.targetId}` : null);
    if (!key) continue;
    if (!keywordGroups.has(key)) {
      keywordGroups.set(key, []);
    }
    keywordGroups.get(key)!.push(row);
  }

  // 4. 获取投放词文本信息
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

  // 5. 对每个投放词进行多维度分析（含自我迭代平滑）
  const allResults: ComboAnalysisResult[] = [];
  const categoryChanges: { keywordText: string; from: string; to: string }[] = [];

  for (const [key, rows] of keywordGroups) {
    const prevResult = previousAnalysis.get(key);
    const result = analyzeKeywordCombo(
      key, rows, keywordTexts.get(key) || key, campaignId, targetAcos, endDate, prevResult || null
    );
    result.dataSource = dataSource;

    // v183.1: 追踪分类变化
    if (prevResult) {
      result.previousCategory = prevResult.category as any;
      result.categoryChanged = result.comboCategory !== prevResult.category;
      if (result.categoryChanged) {
        categoryChanges.push({
          keywordText: result.keywordText,
          from: prevResult.category,
          to: result.comboCategory,
        });
      }
    }

    allResults.push(result);
  }

  // 6. 分类
  const goldenCombos = allResults.filter(r => r.comboCategory === 'golden');
  const leadenCombos = allResults.filter(r => r.comboCategory === 'leaden');
  const potentialCombos = allResults.filter(r => r.comboCategory === 'potential');
  const standardCombos = allResults.filter(r => r.comboCategory === 'standard');

  // 7. 计算Campaign级别的预算乘数
  const suggestedBudgetMultiplier = calculateCampaignBudgetMultiplier(
    goldenCombos, leadenCombos, potentialCombos, standardCombos, targetAcos
  );

  // 8. 计算整体置信度
  const totalClicks = allResults.reduce((s, r) => s + r.totalClicks, 0);
  const totalOrders = allResults.reduce((s, r) => s + r.totalOrders, 0);
  const overallConfidence: 'high' | 'medium' | 'low' | 'insufficient' =
    totalClicks >= 200 && totalOrders >= 20 ? 'high' :
    totalClicks >= 50 && totalOrders >= 5 ? 'medium' :
    totalClicks >= 10 ? 'low' : 'insufficient';

  // v183.1: 详细日志包含自我迭代信息
  console.log(`[ComboAnalyzer] Campaign ${campaignName} [${dataSource}]: ` +
    `${goldenCombos.length}个黄金, ${leadenCombos.length}个铅石, ${potentialCombos.length}个潜力, ${standardCombos.length}个标准 ` +
    `(置信度: ${overallConfidence}, 预算乘数: ${suggestedBudgetMultiplier.toFixed(3)}, ` +
    `分类变化: ${categoryChanges.length}个)`);

  if (categoryChanges.length > 0) {
    for (const change of categoryChanges.slice(0, 5)) {
      console.log(`  [迭代] "${change.keywordText}": ${change.from} → ${change.to}`);
    }
    if (categoryChanges.length > 5) {
      console.log(`  [迭代] ...还有${categoryChanges.length - 5}个分类变化`);
    }
  }

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
    dataSource,
    categoryChanges,
  };
}

/**
 * 分析单个投放词的多维度组合绩效
 * v183.1: 支持与上一轮结果平滑过渡
 */
function analyzeKeywordCombo(
  key: string,
  rows: RawDataRow[],
  keywordText: string,
  campaignId: number,
  targetAcos: number,
  referenceDate: Date,
  prevResult: { category: string; bidMultiplier: number; placementMultiplier: number; timeMultiplier: number } | null
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
  const { category, bidMultiplier: rawBidMult, placementMultiplier: rawPlaceMult, timeMultiplier: rawTimeMult, confidence } = classifyCombo(
    totalClicks, totalOrders, totalSpend, totalSales, overallRoas, overallAcos,
    bestPlacement, bestTimeWindows, targetAcos, rows.length
  );

  // v183.1: 平滑过渡 - 如果有上一轮结果，做加权平均
  let bidMultiplier = rawBidMult;
  let placementMultiplier = rawPlaceMult;
  let timeMultiplier = rawTimeMult;

  if (prevResult) {
    bidMultiplier = smoothMultiplier(rawBidMult, prevResult.bidMultiplier, 0.6);
    placementMultiplier = smoothMultiplier(rawPlaceMult, prevResult.placementMultiplier, 0.6);
    timeMultiplier = smoothMultiplier(rawTimeMult, prevResult.timeMultiplier, 0.6);
    
    // 确保平滑后的值仍在安全范围内
    bidMultiplier = Math.max(0.80, Math.min(1.20, bidMultiplier));
    placementMultiplier = Math.max(0.85, Math.min(1.15, placementMultiplier));
    timeMultiplier = Math.max(0.85, Math.min(1.15, timeMultiplier));
  }

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
  const conditions = [eq(multiDimComboAnalysis.campaignId, String(campaignId))];
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
      eq(multiDimComboAnalysis.campaignId, String(analysis.campaignId)),
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

  console.log(`[ComboAnalyzer] Campaign ${analysis.campaignName}: 写入${inserted}条分析结果 (数据源: ${analysis.dataSource})`);
  return inserted;
}

// ==================== 主入口函数 ====================

/**
 * 执行多维度组合分析（供调度器调用）
 * v183.1: 返回Campaign级别预算乘数映射
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
  // v183.1: Campaign级别预算乘数映射
  campaignBudgetMultipliers: Map<number, number>;
  // v183.1: 自我迭代统计
  totalCategoryChanges: number;
}> {
  const targetAcos = config.targetAcos || 30;
  const lookbackDays = config.lookbackDays || 30;

  let campaignsAnalyzed = 0;
  let totalCombosFound = 0;
  let goldenCount = 0;
  let leadenCount = 0;
  let potentialCount = 0;
  let standardCount = 0;
  let totalCategoryChanges = 0;
  const details: CampaignComboAnalysis[] = [];
  const campaignBudgetMultipliers = new Map<number, number>();

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
      totalCategoryChanges += analysis.categoryChanges.length;
      details.push(analysis);

      // v183.1: 记录Campaign级别预算乘数
      campaignBudgetMultipliers.set(campaignId, analysis.suggestedBudgetMultiplier);
    } catch (err: any) {
      console.error(`[ComboAnalyzer] Campaign ${campaignId} 分析失败: ${err.message}`);
    }
  }

  console.log(`[ComboAnalyzer] 分析完成: ${campaignsAnalyzed}个campaign, ${totalCombosFound}个组合 ` +
    `(黄金:${goldenCount}, 铅石:${leadenCount}, 潜力:${potentialCount}, 标准:${standardCount}) ` +
    `分类变化:${totalCategoryChanges}个`);

  return {
    campaignsAnalyzed,
    totalCombosFound,
    goldenCount,
    leadenCount,
    potentialCount,
    standardCount,
    details,
    campaignBudgetMultipliers,
    totalCategoryChanges,
  };
}


// ==================== 批量查询函数 ====================

/**
 * v183: 获取某个账号下所有投放词的组合分析结果
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
      eq(multiDimComboAnalysis.campaignId, String(campaignId)),
    ));
  return results;
}

/**
 * v183.1: 获取Campaign级别的预算乘数
 * 供预算执行引擎使用
 */
export async function getCampaignBudgetMultiplier(
  db: ReturnType<typeof drizzle>,
  accountId: number,
  campaignId: number
): Promise<number> {
  // 查询该Campaign下所有投放词的分析结果，计算预算乘数
  const results = await db.select({
    comboCategory: multiDimComboAnalysis.comboCategory,
    topOfSearchSpend: multiDimComboAnalysis.topOfSearchSpend,
    productPageSpend: multiDimComboAnalysis.productPageSpend,
    restOfSearchSpend: multiDimComboAnalysis.restOfSearchSpend,
  })
  .from(multiDimComboAnalysis)
  .where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(campaignId)),
  ));

  if (results.length === 0) return 1.0;

  let totalSpend = 0;
  let goldenSpend = 0;
  let leadenSpend = 0;

  for (const row of results) {
    const spend = parseFloat(String(row.topOfSearchSpend || '0')) +
                  parseFloat(String(row.productPageSpend || '0')) +
                  parseFloat(String(row.restOfSearchSpend || '0'));
    totalSpend += spend;
    if (row.comboCategory === 'golden') goldenSpend += spend;
    if (row.comboCategory === 'leaden') leadenSpend += spend;
  }

  if (totalSpend <= 0) return 1.0;

  const goldenRatio = goldenSpend / totalSpend;
  const leadenRatio = leadenSpend / totalSpend;

  if (goldenRatio > 0.4 && leadenRatio < 0.2) {
    return Math.min(1.15, 1.0 + (goldenRatio - 0.4) * 0.3);
  }
  if (leadenRatio > 0.4) {
    return Math.max(0.90, 1.0 - (leadenRatio - 0.4) * 0.2);
  }

  return 1.0;
}
