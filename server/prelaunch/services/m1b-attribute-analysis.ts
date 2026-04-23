/**
 * M1B 搜索行为属性分析服务
 * 
 * 在 M1（关键词采集/分类）之后、M2（竞品发现）之前执行。
 * 
 * 核心逻辑：
 * 1. 从高相关关键词中提取四个属性维度（颜色、尺码、款式、数量）
 * 2. 统计每个维度的"携带率"（即搜索词中包含该属性的比例）
 * 3. 判断用户是否有清晰的属性需求意识（携带率阈值判断）
 * 4. 提取自有产品的属性锚点
 * 5. 将分析结果持久化，供 M2 竞品过滤使用
 * 
 * 业务意义：
 * - 如果用户搜索"5 pack outdoor gloves"，说明用户有明确的数量需求
 * - 如果我们卖的是3双，竞品卖的是5双，则该竞品不应成为我们的广告定向对象
 * - 但如果大多数搜索词不携带数量信息，则数量不应作为竞品过滤条件
 * 
 * v3.1 优化：
 * - P0-2: checkCompetitorAttributeMatch 改为使用竞品自身数据（标题+bullet_points+description）
 * - P1-2: style 维度细化为 form_variant（形态变体）和 functional_feature（功能特征），避免误判
 * - P2-1: 小样本保护 — 关键词数 < 100 时提高携带率阈值至 35%
 * - P2-2: 品牌词预过滤 — 属性提取前排除品牌名中的伪属性
 */
import { getDb, type DbInstanceNonNull } from '../../db';
import { prelaunchKeywords, prelaunchProjects } from '../../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { geminiStructuredOutput } from '../gemini';
import { createModuleLogger } from '../../utils/logger';

const log = createModuleLogger('M1B-AttributeAnalysis');

// ============================================================
// 类型定义
// ============================================================

/** 四个属性维度 */
export type AttributeDimension = 'color' | 'size' | 'style' | 'quantity';

/** 单个关键词的属性提取结果 */
export interface KeywordAttributeExtraction {
  keyword: string;
  keywordId: number;
  attributes: {
    color: string | null;    // 提取到的颜色值，如 "red", "black"
    size: string | null;     // 提取到的尺码值，如 "large", "xl", "king size"
    style: string | null;    // 提取到的款式值，如 "fingerless", "waterproof"
    quantity: string | null;  // 提取到的数量值，如 "5 pack", "3 pairs"
  };
}

/** 属性维度的统计结果 */
export interface AttributeDimensionStats {
  dimension: AttributeDimension;
  totalKeywords: number;          // 分析的关键词总数
  carryingCount: number;          // 携带该属性的关键词数量
  carryingRate: number;           // 携带率 (0-1)
  isSignificant: boolean;         // 是否达到显著性阈值（即用户有清晰需求意识）
  topValues: { value: string; count: number; share: number }[];  // 该维度最常见的值
  shouldFilter: boolean;          // 是否应作为竞品过滤条件
}

/** 自有产品属性锚点 */
export interface OwnProductAttributes {
  color: string | null;
  size: string | null;
  style: string | null;
  quantity: string | null;
  rawExtraction: Record<string, unknown>;  // LLM 原始提取结果
}

/** M1B 完整分析结果 */
export interface AttributeAnalysisResult {
  projectId: number;
  analyzedAt: string;
  totalKeywordsAnalyzed: number;
  dimensionStats: AttributeDimensionStats[];
  ownProductAttributes: OwnProductAttributes;
  activeFilterDimensions: AttributeDimension[];  // 最终生效的过滤维度
  analysisRationale: string;  // LLM 对整体分析的解释
}

/** v3.1: 竞品自身数据（用于属性匹配检查） */
export interface CompetitorOwnData {
  title: string;
  bulletPoints?: string;
  description?: string;
  productOverview?: { key: string; value: string }[];
  brand?: string;
}

// ============================================================
// 配置常量
// ============================================================

/**
 * 属性携带率阈值 — 超过此阈值则认为用户有清晰的属性需求意识
 * 
 * 设为 0.25 (25%)：如果超过 1/4 的高相关搜索词携带了某个属性，
 * 说明该品类的用户在搜索时普遍会指定该属性。
 * 
 * 这个阈值不宜太高（会漏掉有意义的属性过滤），
 * 也不宜太低（会过度过滤导致竞品池太小）。
 */
const CARRYING_RATE_THRESHOLD = 0.25;

/**
 * v3.1 P2-1: 小样本保护阈值
 * 
 * 当高相关关键词数量低于此值时，提高携带率阈值至 SMALL_SAMPLE_THRESHOLD，
 * 避免在样本不足时做出过于激进的过滤决策。
 */
const SMALL_SAMPLE_KEYWORD_COUNT = 100;
const SMALL_SAMPLE_CARRYING_RATE_THRESHOLD = 0.35;

/**
 * 属性提取的批次大小 — 每次发送给 LLM 的关键词数量
 */
const EXTRACTION_BATCH_SIZE = 40;

// ============================================================
// M1B 属性分析服务
// ============================================================

export class M1BAttributeAnalysisService {

  /**
   * 运行 M1B 完整流水线
   * 
   * @param projectId 项目 ID
   * @returns 属性分析结果
   */
  async runPipeline(projectId: number): Promise<{ success: boolean; data?: AttributeAnalysisResult; error?: string }> {
    const dbRaw = await getDb();
    if (!dbRaw) return { success: false, error: 'Database not available' };
    const db = dbRaw!;

    try {
      log.info(`[M1B] Starting attribute analysis for project ${projectId}`);

      // Step 1: 获取所有高相关关键词（core + extended）
      const keywords = await this.getHighRelevanceKeywords(db, projectId);
      if (keywords.length === 0) {
        log.warn(`[M1B] No high-relevance keywords found for project ${projectId}`);
        return { success: false, error: 'No high-relevance keywords available. Run M1 first.' };
      }
      log.info(`[M1B] Found ${keywords.length} high-relevance keywords to analyze`);

      // v3.1 P2-2: 获取品牌名列表，用于属性提取时的品牌词预过滤
      const brandNames = await this.collectBrandNames(db, projectId);
      log.info(`[M1B] Collected ${brandNames.length} brand names for pre-filtering`);

      // Step 2: 批量提取关键词中的属性信息（v3.1: 增加品牌词预过滤）
      const extractions = await this.extractAttributesFromKeywords(keywords, brandNames);
      log.info(`[M1B] Extracted attributes from ${extractions.length} keywords`);

      // Step 3: 统计每个维度的携带率
      const dimensionStats = this.calculateDimensionStats(extractions);

      // Step 4: 获取项目信息并提取自有产品属性
      const ownAttributes = await this.extractOwnProductAttributes(db, projectId);

      // Step 5: 综合判断哪些维度应该作为竞品过滤条件（v3.1: 增加小样本保护）
      const activeFilterDimensions = this.determineActiveFilters(dimensionStats, ownAttributes, keywords.length);

      // Step 6: 生成分析解释
      const rationale = await this.generateAnalysisRationale(
        dimensionStats, ownAttributes, activeFilterDimensions, keywords.length
      );

      // Step 7: 持久化分析结果
      const result: AttributeAnalysisResult = {
        projectId,
        analyzedAt: new Date().toISOString(),
        totalKeywordsAnalyzed: keywords.length,
        dimensionStats,
        ownProductAttributes: ownAttributes,
        activeFilterDimensions,
        analysisRationale: rationale,
      };

      await this.persistAnalysisResult(db, projectId, result, extractions);

      log.info(`[M1B] Attribute analysis complete. Active filter dimensions: [${activeFilterDimensions.join(', ')}]`);

      return { success: true, data: result };

    } catch (error: unknown) {
      log.warn(`[M1B] Pipeline error: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取分析结果（供 M2 调用）
   */
  async getAnalysisResult(projectId: number): Promise<AttributeAnalysisResult | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      const result = await db.execute(sql.raw(
        `SELECT * FROM prelaunch_attribute_analysis WHERE project_id = ${projectId} ORDER BY id DESC LIMIT 1`
      ));
      const rows = result as unknown as unknown[][];

      if (!rows || !rows[0] || !(rows[0] as unknown[]).length) return null;

      const record = (rows[0] as unknown[])[0] as Record<string, unknown>;
      return {
        projectId: record.project_id as number,
        analyzedAt: record.analyzed_at as string,
        totalKeywordsAnalyzed: record.total_keywords_analyzed as number,
        dimensionStats: typeof record.dimension_stats === 'string'
          ? JSON.parse(record.dimension_stats)
          : record.dimension_stats as AttributeDimensionStats[],
        ownProductAttributes: typeof record.own_product_attributes === 'string'
          ? JSON.parse(record.own_product_attributes)
          : record.own_product_attributes as OwnProductAttributes,
        activeFilterDimensions: typeof record.active_filter_dimensions === 'string'
          ? JSON.parse(record.active_filter_dimensions)
          : record.active_filter_dimensions as AttributeDimension[],
        analysisRationale: record.analysis_rationale as string,
      };
    } catch {
      return null;
    }
  }

  /**
   * 更新用户确认的自有产品属性（供 P3 前端确认交互使用）
   * 
   * 用户在前端确认/修改 M1B 自动提取的产品属性后，
   * 调用此方法更新分析结果中的 ownProductAttributes。
   */
  async updateConfirmedAttributes(
    projectId: number,
    confirmedAttributes: { color?: string | null; size?: string | null; style?: string | null; quantity?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const attrJson = JSON.stringify({
        ...confirmedAttributes,
        rawExtraction: { source: 'user_confirmed' },
      }).replace(/'/g, "\\'");

      await db.execute(sql.raw(`
        UPDATE prelaunch_attribute_analysis 
        SET own_product_attributes = '${attrJson}'
        WHERE project_id = ${projectId}
        ORDER BY id DESC LIMIT 1
      `));

      log.info(`[M1B] Updated confirmed attributes for project ${projectId}`);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** Step 1: 获取高相关关键词 */
  private async getHighRelevanceKeywords(db: DbInstanceNonNull, projectId: number) {
    const rows = await db.select({
      id: prelaunchKeywords.id,
      keyword: prelaunchKeywords.keyword,
      relevanceLayer: prelaunchKeywords.relevanceLayer,
      searchVolume: prelaunchKeywords.searchVolume,
      kviScore: prelaunchKeywords.kviScore,
    })
      .from(prelaunchKeywords)
      .where(and(
        eq(prelaunchKeywords.projectId, projectId),
        sql`${prelaunchKeywords.relevanceLayer} IN ('core', 'extended')`,
      ));

    return rows as { id: number; keyword: string; relevanceLayer: string; searchVolume: number; kviScore: string }[];
  }

  /**
   * v3.1 P2-2: 收集品牌名列表
   * 
   * 从竞品数据和项目信息中收集品牌名，用于在属性提取时
   * 排除品牌名中的伪属性（如品牌名 "Blue Diamond" 中的 "Blue" 不应被识别为颜色）。
   */
  private async collectBrandNames(db: DbInstanceNonNull, projectId: number): Promise<string[]> {
    try {
      const brands = await db.execute(sql.raw(
        `SELECT DISTINCT brand FROM prelaunch_competitors WHERE project_id = ${projectId} AND brand IS NOT NULL AND brand != ''`
      ));
      const rows = brands as unknown as unknown[][];
      if (!rows || !rows[0]) return [];
      return (rows[0] as Record<string, unknown>[]).map(r => String(r.brand || '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Step 2: 批量提取关键词中的属性信息
   * 
   * 使用 Gemini 对每批关键词进行属性提取。
   * 对于每个关键词，识别其中是否包含颜色、尺码、款式、数量信息。
   * 
   * v3.1 P1-2: style 维度细化定义 — 区分"形态变体"和"功能特征"
   * v3.1 P2-2: 增加品牌词预过滤指令
   */
  private async extractAttributesFromKeywords(
    keywords: { id: number; keyword: string }[],
    brandNames: string[] = []
  ): Promise<KeywordAttributeExtraction[]> {
    const allExtractions: KeywordAttributeExtraction[] = [];
    const brandNamesStr = brandNames.length > 0
      ? `\n\nKNOWN BRAND NAMES (DO NOT extract attributes from these words): ${brandNames.slice(0, 30).join(', ')}`
      : '';

    for (let i = 0; i < keywords.length; i += EXTRACTION_BATCH_SIZE) {
      const batch = keywords.slice(i, i + EXTRACTION_BATCH_SIZE);
      const kwList = batch.map(k => k.keyword).join('\n');

      const prompt = `You are an Amazon product search behavior analyst. Analyze each search keyword and extract any explicit attribute information the user specified in their search query.

For each keyword, extract these 4 attribute dimensions:
1. **color**: Any color mentioned (e.g., "red", "black", "navy blue", "multicolor"). Return null if no color is specified.
2. **size**: Any size/dimension mentioned (e.g., "large", "xl", "king size", "12 inch", "small"). Return null if no size is specified.
3. **style**: Product FORM VARIANT or STRUCTURAL DESIGN that fundamentally changes the product shape/construction (e.g., "fingerless", "foldable", "v-neck", "clip-on", "pull-on", "over-ear", "in-ear"). 
   - DO extract: structural/form variants that change the product's physical form
   - DO NOT extract: functional features (waterproof, breathable, insulated) — these are features, not style variants
   - DO NOT extract: use-case/scenario descriptors (hiking, running, camping) — these are usage contexts
   - DO NOT extract: material descriptors (leather, cotton, nylon) — these are materials
   Return null if no form variant is specified.
4. **quantity**: Any quantity/pack count mentioned (e.g., "5 pack", "3 pairs", "set of 6", "dozen", "bulk"). Return null if no quantity is specified.

IMPORTANT RULES:
- Only extract attributes that are EXPLICITLY stated in the search term
- Do NOT infer attributes that are not directly mentioned
- "hiking gloves" → style: null (hiking is a use-case, not a form variant)
- "fingerless hiking gloves" → style: "fingerless" (fingerless IS a form variant)
- "waterproof hiking gloves" → style: null (waterproof is a functional feature, not a form variant)
- "over-ear headphones" → style: "over-ear" (over-ear IS a form variant)
- "bluetooth headphones" → style: null (bluetooth is a technology feature)
- "men's gloves" → size: null, style: null (men's is a demographic)
- "5 pack socks" → quantity: "5 pack"
- "large dog bed" → size: "large"
- "red running shoes" → color: "red"${brandNamesStr}

Keywords to analyze:
${kwList}

Return JSON array with one entry per keyword:
[{"keyword":"...","color":null,"size":null,"style":"fingerless","quantity":null}]`;

      try {
        const extracted = await geminiStructuredOutput<
          { keyword: string; color: string | null; size: string | null; style: string | null; quantity: string | null }[]
        >('', prompt, { temperature: 0.05 });

        for (const ext of extracted) {
          const matchedKw = batch.find(k => k.keyword.toLowerCase() === ext.keyword?.toLowerCase());
          if (matchedKw) {
            // v3.1 P2-2: 后置品牌词过滤 — 如果提取的颜色值恰好是品牌名的一部分，则置为 null
            let extractedColor = ext.color || null;
            if (extractedColor && brandNames.length > 0) {
              const colorLower = extractedColor.toLowerCase();
              for (const brand of brandNames) {
                if (brand.toLowerCase().includes(colorLower) || colorLower.includes(brand.toLowerCase())) {
                  log.info(`[M1B] Filtered brand-color collision: "${extractedColor}" in brand "${brand}" for keyword "${matchedKw.keyword}"`);
                  extractedColor = null;
                  break;
                }
              }
            }

            allExtractions.push({
              keyword: matchedKw.keyword,
              keywordId: matchedKw.id,
              attributes: {
                color: extractedColor,
                size: ext.size || null,
                style: ext.style || null,
                quantity: ext.quantity || null,
              },
            });
          }
        }
      } catch (err) {
        log.warn(`[M1B] Attribute extraction batch failed: ${(err as Error).message}`);
        // 对于失败的批次，将关键词标记为无属性
        for (const kw of batch) {
          allExtractions.push({
            keyword: kw.keyword,
            keywordId: kw.id,
            attributes: { color: null, size: null, style: null, quantity: null },
          });
        }
      }
    }

    return allExtractions;
  }

  /**
   * Step 3: 统计每个维度的携带率
   * 
   * 对于每个属性维度，计算：
   * - 有多少关键词携带了该属性
   * - 携带率是多少
   * - 最常见的属性值有哪些
   * - 是否达到显著性阈值
   * 
   * v3.1 P2-1: 小样本保护 — 关键词数 < 100 时使用更高的阈值
   */
  private calculateDimensionStats(extractions: KeywordAttributeExtraction[]): AttributeDimensionStats[] {
    const dimensions: AttributeDimension[] = ['color', 'size', 'style', 'quantity'];
    const totalKeywords = extractions.length;

    // v3.1 P2-1: 根据样本量动态调整阈值
    const effectiveThreshold = totalKeywords < SMALL_SAMPLE_KEYWORD_COUNT
      ? SMALL_SAMPLE_CARRYING_RATE_THRESHOLD
      : CARRYING_RATE_THRESHOLD;

    if (totalKeywords < SMALL_SAMPLE_KEYWORD_COUNT) {
      log.info(`[M1B] Small sample detected (${totalKeywords} < ${SMALL_SAMPLE_KEYWORD_COUNT}), using higher threshold: ${effectiveThreshold * 100}%`);
    }

    return dimensions.map(dim => {
      // 统计携带该属性的关键词
      const carrying = extractions.filter(e => e.attributes[dim] !== null && e.attributes[dim] !== '');
      const carryingCount = carrying.length;
      const carryingRate = totalKeywords > 0 ? carryingCount / totalKeywords : 0;

      // 统计各属性值的频次
      const valueCounts = new Map<string, number>();
      for (const ext of carrying) {
        const val = (ext.attributes[dim] || '').toLowerCase().trim();
        if (val) {
          valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
        }
      }

      // 排序取 Top 10
      const topValues = Array.from(valueCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({
          value,
          count,
          share: carryingCount > 0 ? Math.round((count / carryingCount) * 10000) / 10000 : 0,
        }));

      const isSignificant = carryingRate >= effectiveThreshold;

      return {
        dimension: dim,
        totalKeywords,
        carryingCount,
        carryingRate: Math.round(carryingRate * 10000) / 10000,
        isSignificant,
        topValues,
        shouldFilter: false,  // 将在 determineActiveFilters 中最终决定
      };
    });
  }

  /**
   * Step 4: 提取自有产品的属性锚点
   * 
   * 从项目的 ASIN 产品信息（标题、五点描述等）中提取我们产品的属性值。
   * 这些值将作为竞品属性比对的基准。
   */
  private async extractOwnProductAttributes(db: DbInstanceNonNull, projectId: number): Promise<OwnProductAttributes> {
    // 获取项目信息
    const [project] = await db.select()
      .from(prelaunchProjects)
      .where(eq(prelaunchProjects.id, projectId))
      .limit(1);

    if (!project) {
      return { color: null, size: null, style: null, quantity: null, rawExtraction: {} };
    }

    // 从 seed_keywords 和 project_name 中推断产品属性
    const projectInfo = project as Record<string, unknown>;
    const projectName = projectInfo.projectName || projectInfo.project_name || '';
    const asin = projectInfo.asin || '';
    const category = projectInfo.category || '';
    const seedKeywords = projectInfo.seedKeywords || projectInfo.seed_keywords;
    const seedKwStr = Array.isArray(seedKeywords) ? seedKeywords.join(', ') : String(seedKeywords || '');

    // v3.1: 检查是否有用户确认的属性（P3 前端确认后存储）
    const confirmedAttrs = projectInfo.confirmedAttributes || projectInfo.confirmed_attributes;
    if (confirmedAttrs) {
      try {
        const parsed = typeof confirmedAttrs === 'string' ? JSON.parse(confirmedAttrs) : confirmedAttrs;
        if (parsed && (parsed.color || parsed.size || parsed.style || parsed.quantity)) {
          log.info(`[M1B] Using user-confirmed attributes for project ${projectId}`);
          return {
            color: parsed.color || null,
            size: parsed.size || null,
            style: parsed.style || null,
            quantity: parsed.quantity || null,
            rawExtraction: { source: 'user_confirmed', ...parsed },
          };
        }
      } catch { /* ignore parse error, fall through to LLM extraction */ }
    }

    const prompt = `You are an Amazon product analyst. Based on the following product information, extract the product's specific attributes.

Product Name/Title: ${projectName}
ASIN: ${asin}
Category: ${category}
Seed Keywords: ${seedKwStr}

Extract these 4 attribute dimensions for THIS SPECIFIC product:
1. **color**: What specific color(s) is this product? (e.g., "black", "red and blue"). Return null if unclear.
2. **size**: What specific size is this product? (e.g., "large", "12 inch", "queen size"). Return null if unclear.
3. **style**: What specific FORM VARIANT is this product? (e.g., "fingerless", "over-ear", "foldable", "clip-on"). Only structural/form variants, NOT functional features. Return null if unclear.
4. **quantity**: What quantity/pack count is this product sold in? (e.g., "5 pack", "3 pairs", "single"). Return null if unclear.

Return JSON object:
{"color":null,"size":null,"style":null,"quantity":null,"confidence":"low|medium|high","reasoning":"brief explanation"}`;

    try {
      const result = await geminiStructuredOutput<Record<string, unknown>>('', prompt, { temperature: 0.1 });
      return {
        color: (result.color as string) || null,
        size: (result.size as string) || null,
        style: (result.style as string) || null,
        quantity: (result.quantity as string) || null,
        rawExtraction: result,
      };
    } catch {
      return { color: null, size: null, style: null, quantity: null, rawExtraction: {} };
    }
  }

  /**
   * Step 5: 综合判断哪些维度应该作为竞品过滤条件
   * 
   * 一个维度要成为有效的过滤条件，必须同时满足两个条件：
   * 1. 该维度的携带率达到显著性阈值（用户有清晰的属性需求意识）
   * 2. 我们自己的产品在该维度上有明确的属性值（否则无法比对）
   * 
   * v3.1 P2-1: 小样本保护 — 关键词数 < 100 时使用更高的阈值
   */
  private determineActiveFilters(
    dimensionStats: AttributeDimensionStats[],
    ownAttributes: OwnProductAttributes,
    totalKeywords: number
  ): AttributeDimension[] {
    const activeFilters: AttributeDimension[] = [];

    // v3.1 P2-1: 根据样本量动态调整阈值
    const effectiveThreshold = totalKeywords < SMALL_SAMPLE_KEYWORD_COUNT
      ? SMALL_SAMPLE_CARRYING_RATE_THRESHOLD
      : CARRYING_RATE_THRESHOLD;

    for (const stat of dimensionStats) {
      const dim = stat.dimension;
      const ownValue = ownAttributes[dim];

      // 条件1: 携带率达到阈值（使用动态阈值）
      const hasSignificantCarrying = stat.carryingRate >= effectiveThreshold;

      // 条件2: 自有产品有明确的属性值
      const hasOwnValue = ownValue !== null && ownValue !== '' && ownValue !== undefined;

      if (hasSignificantCarrying && hasOwnValue) {
        stat.shouldFilter = true;
        activeFilters.push(dim);
        log.info(`[M1B] Dimension "${dim}" activated as filter: carryingRate=${stat.carryingRate}, threshold=${effectiveThreshold}, ownValue="${ownValue}"`);
      } else {
        stat.shouldFilter = false;
        if (hasSignificantCarrying && !hasOwnValue) {
          log.info(`[M1B] Dimension "${dim}" has significant carrying rate (${stat.carryingRate}) but own product has no clear value — NOT filtering`);
        } else if (!hasSignificantCarrying) {
          log.info(`[M1B] Dimension "${dim}" carrying rate too low (${stat.carryingRate} < ${effectiveThreshold}) — NOT filtering`);
        }
      }
    }

    return activeFilters;
  }

  /**
   * Step 6: 生成分析解释
   */
  private async generateAnalysisRationale(
    dimensionStats: AttributeDimensionStats[],
    ownAttributes: OwnProductAttributes,
    activeFilters: AttributeDimension[],
    totalKeywords: number
  ): Promise<string> {
    const statsStr = dimensionStats.map(s =>
      `${s.dimension}: carrying rate = ${(s.carryingRate * 100).toFixed(1)}% (${s.carryingCount}/${s.totalKeywords}), significant = ${s.isSignificant}, top values = [${s.topValues.slice(0, 3).map(v => `"${v.value}" (${v.count})`).join(', ')}]`
    ).join('\n');

    const ownStr = `color="${ownAttributes.color || 'N/A'}", size="${ownAttributes.size || 'N/A'}", style="${ownAttributes.style || 'N/A'}", quantity="${ownAttributes.quantity || 'N/A'}"`;

    const effectiveThreshold = totalKeywords < SMALL_SAMPLE_KEYWORD_COUNT
      ? SMALL_SAMPLE_CARRYING_RATE_THRESHOLD
      : CARRYING_RATE_THRESHOLD;

    const prompt = `Summarize this search behavior attribute analysis for an Amazon product launch team (2-3 sentences in English):

Total high-relevance keywords analyzed: ${totalKeywords}
Effective threshold: ${(effectiveThreshold * 100).toFixed(0)}% ${totalKeywords < SMALL_SAMPLE_KEYWORD_COUNT ? '(elevated due to small sample)' : '(standard)'}

Dimension Statistics:
${statsStr}

Own Product Attributes: ${ownStr}

Active Filter Dimensions: [${activeFilters.join(', ')}]

Explain WHY each dimension was activated or not activated as a competitor filter, based on the search behavior data. Be concise and actionable.`;

    try {
      return await (await import('../gemini')).geminiChat(prompt, '', { temperature: 0.2 });
    } catch {
      return `Analyzed ${totalKeywords} keywords. Active filters: [${activeFilters.join(', ')}]. Threshold: ${effectiveThreshold * 100}%.`;
    }
  }

  /**
   * Step 7: 持久化分析结果
   */
  private async persistAnalysisResult(
    db: DbInstanceNonNull,
    projectId: number,
    result: AttributeAnalysisResult,
    extractions: KeywordAttributeExtraction[]
  ) {
    // 写入主分析结果表
    await db.execute(sql.raw(`
      INSERT INTO prelaunch_attribute_analysis 
        (project_id, total_keywords_analyzed, dimension_stats, own_product_attributes, 
         active_filter_dimensions, analysis_rationale, analyzed_at)
      VALUES 
        (${projectId}, ${result.totalKeywordsAnalyzed}, 
         '${JSON.stringify(result.dimensionStats).replace(/'/g, "\\'")}',
         '${JSON.stringify(result.ownProductAttributes).replace(/'/g, "\\'")}',
         '${JSON.stringify(result.activeFilterDimensions).replace(/'/g, "\\'")}',
         '${result.analysisRationale.replace(/'/g, "\\'")}',
         NOW())
    `));

    // 批量更新关键词的属性提取结果到 prelaunch_keywords 表
    // 使用 raw_data 字段存储（避免新增列的迁移风险）
    for (const ext of extractions) {
      const hasAnyAttribute = ext.attributes.color || ext.attributes.size || ext.attributes.style || ext.attributes.quantity;
      if (hasAnyAttribute) {
        try {
          // 读取现有 raw_data 并合并属性信息
          await db.execute(sql.raw(`
            UPDATE prelaunch_keywords 
            SET raw_data = JSON_SET(
              COALESCE(raw_data, '{}'),
              '$.extractedAttributes', CAST('${JSON.stringify(ext.attributes).replace(/'/g, "\\'")}' AS JSON)
            )
            WHERE id = ${ext.keywordId}
          `));
        } catch {
          // 如果 JSON_SET 失败（raw_data 不是有效 JSON），直接覆盖
          await db.execute(sql.raw(`
            UPDATE prelaunch_keywords 
            SET raw_data = '${JSON.stringify({ extractedAttributes: ext.attributes }).replace(/'/g, "\\'")}'
            WHERE id = ${ext.keywordId}
          `));
        }
      }
    }
  }

  /**
   * v3.1 P0-2: 从竞品的 rawData 中提取竞品自身信息
   * 
   * 竞品在 M2 发现阶段通过 Oxylabs 获取的 rawProductData 中
   * 包含了 title, bullet_points, description, product_overview 等信息。
   * 这些数据比使用项目关键词更能准确反映竞品自身的属性。
   */
  extractCompetitorOwnData(rawData: unknown): CompetitorOwnData {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : (rawData || {});
      return {
        title: data.title || '',
        bulletPoints: data.bullet_points || data.bulletPoints || '',
        description: data.description || '',
        productOverview: Array.isArray(data.product_overview) ? data.product_overview : [],
        brand: data.brand || data.manufacturer || '',
      };
    } catch {
      return { title: '', bulletPoints: '', description: '', productOverview: [], brand: '' };
    }
  }

  /**
   * v3.1 P0-2 重构: 检查竞品是否通过属性过滤
   * 
   * 供 M2 调用。使用竞品自身数据（标题 + bullet points + description + product overview）
   * 替代原来的项目关键词，更准确地判断竞品的属性值。
   * 
   * @param competitorTitle - 竞品标题
   * @param competitorOwnData - 竞品自身数据（从 rawData 提取）
   * @param ownAttributes - 我们自有产品的属性锚点
   * @param activeFilterDimensions - 当前激活的过滤维度
   * @returns filterResult 包含是否通过、各维度匹配详情、建议的评分调整
   */
  async checkCompetitorAttributeMatch(
    competitorTitle: string,
    competitorOwnData: CompetitorOwnData | string[],
    ownAttributes: OwnProductAttributes,
    activeFilterDimensions: AttributeDimension[]
  ): Promise<{
    passed: boolean;
    matchDetails: Record<AttributeDimension, {
      ownValue: string | null;
      competitorValue: string | null;
      matched: boolean;
      reason: string;
    }>;
    scoreAdjustment: number;  // -1.0 到 0 的调整值（负值表示降分）
    overallReason: string;
  }> {
    if (activeFilterDimensions.length === 0) {
      return {
        passed: true,
        matchDetails: {} as Record<AttributeDimension, { ownValue: string | null; competitorValue: string | null; matched: boolean; reason: string }>,
        scoreAdjustment: 0,
        overallReason: 'No active attribute filter dimensions for this category.',
      };
    }

    // v3.1 P0-2: 构建竞品信息上下文
    // 如果传入的是 CompetitorOwnData 对象（新版），使用竞品自身数据
    // 如果传入的是 string[] （旧版兼容），使用关键词列表
    let competitorContext: string;

    if (Array.isArray(competitorOwnData)) {
      // 旧版兼容：使用关键词列表
      const kwSample = competitorOwnData.slice(0, 20).join('\n');
      competitorContext = `Competitor's Top Traffic Keywords:\n${kwSample}`;
    } else {
      // v3.1 新版：使用竞品自身数据
      const parts: string[] = [];
      if (competitorOwnData.bulletPoints) {
        parts.push(`Bullet Points: ${competitorOwnData.bulletPoints}`);
      }
      if (competitorOwnData.description) {
        parts.push(`Description: ${String(competitorOwnData.description).slice(0, 500)}`);
      }
      if (competitorOwnData.productOverview && competitorOwnData.productOverview.length > 0) {
        const overviewStr = competitorOwnData.productOverview
          .map(o => `${o.key}: ${o.value}`)
          .join(', ');
        parts.push(`Product Overview: ${overviewStr}`);
      }
      if (competitorOwnData.brand) {
        parts.push(`Brand: ${competitorOwnData.brand}`);
      }
      competitorContext = parts.length > 0
        ? `Competitor Product Details:\n${parts.join('\n')}`
        : `(No additional product details available)`;
    }

    const prompt = `You are an Amazon product attribute analyst. Analyze this competitor product to determine its key attributes and compare with our product.

Competitor Title: ${competitorTitle}
${competitorContext}

Our Product Attributes:
- color: ${ownAttributes.color || 'N/A'}
- size: ${ownAttributes.size || 'N/A'}
- style: ${ownAttributes.style || 'N/A'} (form variant only, not functional features)
- quantity: ${ownAttributes.quantity || 'N/A'}

Active Filter Dimensions (dimensions where users have clear attribute preferences): [${activeFilterDimensions.join(', ')}]

For EACH active filter dimension, determine:
1. What is the competitor's value for this dimension? (based on title + product details)
2. Does it match our product's value?
3. If not matched, how severe is the mismatch? ("minor" = close enough or compatible, "major" = fundamentally different target audience)

MATCHING GUIDELINES:
- For quantity: "3 pack" vs "5 pack" = MAJOR mismatch (different quantity expectations)
- For quantity: "3 pack" vs "3 pairs" = match (same quantity, different wording)
- For color: "black" vs "dark gray" = MINOR mismatch (close enough)
- For color: "red" vs "blue" = MAJOR mismatch (completely different)
- For size: "large" vs "xl" = MINOR mismatch (adjacent sizes)
- For size: "small" vs "king size" = MAJOR mismatch (fundamentally different)
- For style: "fingerless" vs "full finger" = MAJOR mismatch (different product form)
- For style: "over-ear" vs "in-ear" = MAJOR mismatch (different product form)

Return JSON:
{
  "dimensions": {
    "${activeFilterDimensions[0] || 'color'}": {
      "competitorValue": "...",
      "matched": true/false,
      "mismatchSeverity": "none|minor|major",
      "reason": "brief explanation"
    }
  },
  "overallPassed": true/false,
  "overallReason": "brief summary"
}`;

    try {
      const result = await geminiStructuredOutput<{
        dimensions: Record<string, {
          competitorValue: string;
          matched: boolean;
          mismatchSeverity: string;
          reason: string;
        }>;
        overallPassed: boolean;
        overallReason: string;
      }>('', prompt, { temperature: 0.1 });

      // 构建匹配详情
      const matchDetails: Record<string, {
        ownValue: string | null;
        competitorValue: string | null;
        matched: boolean;
        reason: string;
      }> = {};

      let majorMismatches = 0;
      let minorMismatches = 0;

      for (const dim of activeFilterDimensions) {
        const dimResult = result.dimensions?.[dim];
        matchDetails[dim] = {
          ownValue: ownAttributes[dim],
          competitorValue: dimResult?.competitorValue || null,
          matched: dimResult?.matched ?? true,
          reason: dimResult?.reason || '',
        };

        if (dimResult && !dimResult.matched) {
          if (dimResult.mismatchSeverity === 'major') majorMismatches++;
          else minorMismatches++;
        }
      }

      // 计算评分调整
      // major mismatch: -0.4 per dimension
      // minor mismatch: -0.15 per dimension
      const scoreAdjustment = Math.max(-1.0, -(majorMismatches * 0.4 + minorMismatches * 0.15));

      // 如果有任何 major mismatch，则不通过
      const passed = majorMismatches === 0;

      return {
        passed,
        matchDetails: matchDetails as Record<AttributeDimension, { ownValue: string | null; competitorValue: string | null; matched: boolean; reason: string }>,
        scoreAdjustment,
        overallReason: result.overallReason || `Major mismatches: ${majorMismatches}, Minor: ${minorMismatches}`,
      };

    } catch (err) {
      log.warn(`[M1B] Competitor attribute check failed: ${(err as Error).message}`);
      // 失败时默认通过（不阻断流程）
      return {
        passed: true,
        matchDetails: {} as Record<AttributeDimension, { ownValue: string | null; competitorValue: string | null; matched: boolean; reason: string }>,
        scoreAdjustment: 0,
        overallReason: 'Attribute check failed, defaulting to pass.',
      };
    }
  }
}
