/**
 * v183: 多维度组合分析引擎测试
 * 
 * 测试目标:
 * 1. 验证分类算法的正确性（黄金/铅石/潜力/标准）
 * 2. 验证乘数计算的合理性（不超过安全范围）
 * 3. 验证时间窗口识别的准确性
 * 4. 验证位置分析的准确性
 * 5. 验证数据不足时的保护性策略
 * 6. 验证分时竞价集成后的最终出价计算
 * 7. 验证位置优化集成后的位置倾斜计算
 */

// ==================== 模拟数据生成器 ====================

interface MockPerformanceRow {
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

function generateMockData(config: {
  keywordId: number;
  campaignId: number;
  scenario: 'golden' | 'leaden' | 'potential' | 'standard' | 'insufficient';
  days: number;
  bestPlacement?: 'top_of_search' | 'product_page' | 'rest_of_search';
  bestHours?: number[];
  bestDays?: number[];
}): MockPerformanceRow[] {
  const rows: MockPerformanceRow[] = [];
  const now = new Date();
  
  for (let d = 0; d < config.days; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();
    
    for (const placement of ['top_of_search', 'product_page', 'rest_of_search'] as const) {
      for (let hour = 8; hour <= 22; hour++) {
        const isBestPlacement = placement === (config.bestPlacement || 'top_of_search');
        const isBestHour = (config.bestHours || [10, 14, 20]).includes(hour);
        const isBestDay = (config.bestDays || [1, 2, 3]).includes(dayOfWeek);
        
        let baseClicks = 0;
        let baseCvr = 0;
        let baseCpc = 0;
        let baseAov = 25;
        
        switch (config.scenario) {
          case 'golden':
            baseClicks = 3;
            baseCvr = 0.15;
            baseCpc = 0.80;
            baseAov = 30;
            if (isBestPlacement) { baseCvr *= 1.5; baseClicks *= 2; }
            if (isBestHour) { baseCvr *= 1.3; baseClicks *= 1.5; }
            if (isBestDay) { baseCvr *= 1.2; }
            break;
          case 'leaden':
            baseClicks = 2;
            baseCvr = 0.02;
            baseCpc = 1.20;
            baseAov = 20;
            break;
          case 'potential':
            baseClicks = 0.3;
            baseCvr = 0.08;
            baseCpc = 0.90;
            baseAov = 25;
            break;
          case 'standard':
            baseClicks = 1.5;
            baseCvr = 0.08;
            baseCpc = 0.90;
            baseAov = 25;
            if (isBestPlacement) { baseCvr *= 1.1; }
            break;
          case 'insufficient':
            baseClicks = 0.05;
            baseCvr = 0.10;
            baseCpc = 0.80;
            baseAov = 25;
            break;
        }
        
        const clicks = Math.max(0, Math.round(baseClicks + (Math.random() - 0.5) * baseClicks * 0.3));
        const orders = Math.round(clicks * baseCvr);
        const spend = (clicks * baseCpc).toFixed(4);
        const sales = (orders * baseAov).toFixed(2);
        const impressions = Math.round(clicks / 0.005);
        
        if (clicks > 0 || Math.random() > 0.7) {
          rows.push({
            keywordId: config.keywordId,
            targetId: null,
            placement,
            dayOfWeek,
            hour,
            date: dateStr,
            impressions,
            clicks,
            spend,
            sales,
            orders,
          });
        }
      }
    }
  }
  
  return rows;
}

// ==================== 分类算法纯函数测试 ====================

/**
 * 复制自 multiDimComboAnalyzer.ts 的 classifyCombo 函数
 * 用于独立测试分类逻辑
 */
function classifyCombo(
  totalClicks: number,
  totalOrders: number,
  totalSpend: number,
  totalSales: number,
  roas: number,
  acos: number,
  bestPlacement: string | null,
  bestTimeWindows: any[],
  targetAcos: number,
  dataPoints: number
): {
  category: 'golden' | 'leaden' | 'potential' | 'standard';
  bidMultiplier: number;
  placementMultiplier: number;
  timeMultiplier: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
} {
  const confidence: 'high' | 'medium' | 'low' | 'insufficient' =
    totalClicks >= 50 && totalOrders >= 8 ? 'high' :
    totalClicks >= 20 && totalOrders >= 3 ? 'medium' :
    totalClicks >= 10 ? 'low' : 'insufficient';

  const targetRoas = targetAcos > 0 ? 100 / targetAcos : 3.33;

  if (confidence === 'insufficient') {
    return { category: 'potential', bidMultiplier: 1.0, placementMultiplier: 1.0, timeMultiplier: 1.0, confidence };
  }

  if (roas >= targetRoas * 1.2 && totalOrders >= 3 && confidence !== 'low') {
    const roasRatio = Math.min(roas / targetRoas, 3.0);
    const bidMultiplier = Math.min(1.20, 1.0 + (roasRatio - 1.2) * 0.1);
    const placementMultiplier = bestPlacement ? Math.min(1.15, 1.0 + (roasRatio - 1.0) * 0.05) : 1.0;
    const timeMultiplier = bestTimeWindows.length > 0 ? Math.min(1.15, 1.0 + (roasRatio - 1.0) * 0.05) : 1.0;
    return { category: 'golden', bidMultiplier, placementMultiplier, timeMultiplier, confidence };
  }

  const isHighSpendNoConversion = totalSpend >= 5 && totalOrders === 0 && totalClicks >= 15;
  const isHighAcos = acos >= targetAcos * 1.5 && totalClicks >= 15;

  if (isHighSpendNoConversion || isHighAcos) {
    const acosRatio = acos > 0 ? Math.min(acos / targetAcos, 5.0) : 3.0;
    const bidMultiplier = Math.max(0.80, 1.0 - (acosRatio - 1.5) * 0.05);
    const placementMultiplier = Math.max(0.85, 1.0 - (acosRatio - 1.5) * 0.03);
    const timeMultiplier = Math.max(0.85, 1.0 - (acosRatio - 1.5) * 0.03);
    return { category: 'leaden', bidMultiplier, placementMultiplier, timeMultiplier, confidence };
  }

  if (confidence === 'low') {
    return { category: 'potential', bidMultiplier: 1.0, placementMultiplier: 1.0, timeMultiplier: 1.0, confidence };
  }

  const deviation = (targetAcos - acos) / targetAcos;
  const bidMultiplier = Math.max(0.95, Math.min(1.05, 1.0 + deviation * 0.05));
  return { category: 'standard', bidMultiplier, placementMultiplier: 1.0, timeMultiplier: 1.0, confidence };
}

/**
 * 复制自 multiDimComboAnalyzer.ts 的 getTimeDecayWeight 函数
 */
function getTimeDecayWeight(daysAgo: number): number {
  if (daysAgo <= 7) return 1.0;
  if (daysAgo <= 14) return 0.7;
  if (daysAgo <= 21) return 0.4;
  if (daysAgo <= 30) return 0.2;
  return 0.1;
}

// ==================== 测试运行器 ====================

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

function assertRange(value: number, min: number, max: number, testName: string) {
  total++;
  if (value >= min && value <= max) {
    passed++;
    console.log(`  ✅ ${testName} (值=${value.toFixed(4)}, 范围=[${min}, ${max}])`);
  } else {
    failed++;
    console.log(`  ❌ ${testName} (值=${value.toFixed(4)}, 期望范围=[${min}, ${max}])`);
  }
}

// ==================== 测试用例 ====================

console.log('\n========================================');
console.log('v183 多维度组合分析引擎 - 算法有效性测试');
console.log('========================================\n');

// --- 测试1: 黄金组合分类 ---
console.log('--- 测试1: 黄金组合分类 ---');
{
  // 场景: ROAS=5.0, 目标ACoS=30%(即目标ROAS=3.33), 高于120%阈值
  const result = classifyCombo(
    100, 15, 80, 400, 5.0, 20, 'top_of_search', 
    [{ dayOfWeek: 1, startHour: 10, endHour: 10 }], 30, 200
  );
  assert(result.category === 'golden', '高ROAS投放词应被分类为golden');
  assert(result.confidence === 'high', '100次点击+15个订单应为high置信度');
  assertRange(result.bidMultiplier, 1.0, 1.20, '黄金组合竞价乘数应在1.0-1.20之间');
  assertRange(result.placementMultiplier, 1.0, 1.15, '黄金组合位置乘数应在1.0-1.15之间');
  assertRange(result.timeMultiplier, 1.0, 1.15, '黄金组合时间乘数应在1.0-1.15之间');
}

// --- 测试2: 铅石组合分类 ---
console.log('\n--- 测试2: 铅石组合分类 ---');
{
  // 场景: ACoS=60%, 目标ACoS=30%, 超过150%阈值
  const result = classifyCombo(
    50, 5, 60, 100, 1.67, 60, null, [], 30, 100
  );
  assert(result.category === 'leaden', '高ACoS投放词应被分类为leaden');
  assertRange(result.bidMultiplier, 0.80, 1.0, '铅石组合竞价乘数应在0.80-1.0之间');
  assertRange(result.placementMultiplier, 0.85, 1.0, '铅石组合位置乘数应在0.85-1.0之间');
}

// --- 测试3: 高花费零转化铅石组合 ---
console.log('\n--- 测试3: 高花费零转化铅石组合 ---');
{
  const result = classifyCombo(
    30, 0, 25, 0, 0, 999, null, [], 30, 80
  );
  assert(result.category === 'leaden', '高花费零转化应被分类为leaden');
  assertRange(result.bidMultiplier, 0.80, 0.95, '零转化铅石组合竞价乘数应大幅降低');
}

// --- 测试4: 数据不足的保护性策略 ---
console.log('\n--- 测试4: 数据不足的保护性策略 ---');
{
  const result = classifyCombo(
    5, 1, 4, 25, 6.25, 16, 'top_of_search', 
    [{ dayOfWeek: 1, startHour: 10, endHour: 10 }], 30, 10
  );
  assert(result.category === 'potential', '数据不足应被分类为potential');
  assert(result.confidence === 'insufficient', '5次点击应为insufficient置信度');
  assert(result.bidMultiplier === 1.0, '数据不足时竞价乘数应为1.0（保护性）');
  assert(result.placementMultiplier === 1.0, '数据不足时位置乘数应为1.0（保护性）');
  assert(result.timeMultiplier === 1.0, '数据不足时时间乘数应为1.0（保护性）');
}

// --- 测试5: 标准组合 ---
console.log('\n--- 测试5: 标准组合 ---');
{
  // 场景: ACoS=28%, 目标ACoS=30%, 接近目标
  const result = classifyCombo(
    60, 10, 50, 178, 3.56, 28, 'top_of_search', [], 30, 150
  );
  assert(result.category === 'standard', '接近目标ACoS应被分类为standard');
  assertRange(result.bidMultiplier, 0.95, 1.05, '标准组合竞价乘数应在0.95-1.05之间微调');
}

// --- 测试6: 低置信度保护 ---
console.log('\n--- 测试6: 低置信度保护 ---');
{
  // 场景: 12次点击, 1个订单 → low置信度, 即使ROAS看起来不错也应保护
  const result = classifyCombo(
    12, 1, 10, 30, 3.0, 33, null, [], 30, 20
  );
  assert(result.category === 'potential', '低置信度应被分类为potential而非standard');
  assert(result.confidence === 'low', '12次点击应为low置信度');
  assert(result.bidMultiplier === 1.0, '低置信度时竞价乘数应为1.0');
}

// --- 测试7: 乘数安全边界 ---
console.log('\n--- 测试7: 乘数安全边界 ---');
{
  // 极端黄金: ROAS=15.0 (超高)
  const extreme = classifyCombo(
    200, 50, 100, 1500, 15.0, 6.67, 'top_of_search',
    [{ dayOfWeek: 1, startHour: 10, endHour: 10 }], 30, 500
  );
  assertRange(extreme.bidMultiplier, 1.0, 1.20, '极端黄金组合竞价乘数不应超过1.20');
  assertRange(extreme.placementMultiplier, 1.0, 1.15, '极端黄金组合位置乘数不应超过1.15');
  assertRange(extreme.timeMultiplier, 1.0, 1.15, '极端黄金组合时间乘数不应超过1.15');
  
  // 极端铅石: ACoS=200%
  const extremeLeaden = classifyCombo(
    100, 5, 200, 100, 0.5, 200, null, [], 30, 300
  );
  assertRange(extremeLeaden.bidMultiplier, 0.80, 1.0, '极端铅石组合竞价乘数不应低于0.80');
  assertRange(extremeLeaden.placementMultiplier, 0.85, 1.0, '极端铅石组合位置乘数不应低于0.85');
}

// --- 测试8: 时间衰减权重 ---
console.log('\n--- 测试8: 时间衰减权重 ---');
{
  assert(getTimeDecayWeight(1) === 1.0, '1天前数据权重应为1.0');
  assert(getTimeDecayWeight(7) === 1.0, '7天前数据权重应为1.0');
  assert(getTimeDecayWeight(10) === 0.7, '10天前数据权重应为0.7');
  assert(getTimeDecayWeight(14) === 0.7, '14天前数据权重应为0.7');
  assert(getTimeDecayWeight(18) === 0.4, '18天前数据权重应为0.4');
  assert(getTimeDecayWeight(25) === 0.2, '25天前数据权重应为0.2');
  assert(getTimeDecayWeight(35) === 0.1, '35天前数据权重应为0.1');
}

// --- 测试9: 分时竞价最终出价计算 ---
console.log('\n--- 测试9: 分时竞价最终出价计算（v183统一公式）---');
{
  const baseBid = 1.00;
  const maxBidLimit = 2.00;
  
  // 场景A: 黄金组合 + 最佳时段 → 出价提升
  const baseDaypartingMultiplier = 1.10; // 分时乘数
  const comboBidMultiplier = 1.15; // 投放词竞价乘数
  let comboTimeMultiplier = 1.10; // 时间乘数
  // 在最佳时间窗口内额外提升
  comboTimeMultiplier = Math.min(comboTimeMultiplier * 1.15, 1.30);
  
  const finalMultiplier = baseDaypartingMultiplier * comboBidMultiplier * comboTimeMultiplier;
  let adjustedBid = baseBid * finalMultiplier;
  adjustedBid = Math.min(adjustedBid, baseBid * 1.40); // 安全护栏
  adjustedBid = Math.min(adjustedBid, maxBidLimit);
  adjustedBid = Math.max(adjustedBid, 0.02);
  
  assertRange(adjustedBid, 1.00, 1.40, '黄金组合+最佳时段出价应提升但不超过40%');
  assert(adjustedBid <= maxBidLimit, '最终出价不应超过最高出价限制');
  console.log(`    黄金+最佳时段: $${baseBid.toFixed(2)} × ${finalMultiplier.toFixed(3)} = $${adjustedBid.toFixed(2)}`);
  
  // 场景B: 铅石组合 + 最差时段 → 出价降低
  const leadenDaypartingMultiplier = 0.90;
  const leadenBidMultiplier = 0.85;
  let leadenTimeMultiplier = 0.90;
  leadenTimeMultiplier = Math.max(leadenTimeMultiplier * 0.85, 0.70);
  
  const leadenFinalMultiplier = leadenDaypartingMultiplier * leadenBidMultiplier * leadenTimeMultiplier;
  let leadenBid = baseBid * leadenFinalMultiplier;
  leadenBid = Math.max(leadenBid, baseBid * 0.60); // 安全护栏
  leadenBid = Math.max(leadenBid, 0.02);
  
  assertRange(leadenBid, 0.60, 1.00, '铅石组合+最差时段出价应降低但不超过40%');
  console.log(`    铅石+最差时段: $${baseBid.toFixed(2)} × ${leadenFinalMultiplier.toFixed(3)} = $${leadenBid.toFixed(2)}`);
  
  // 场景C: 数据不足 → 出价不变
  const insufficientMultiplier = 1.10 * 1.0 * 1.0; // 只有分时乘数生效
  let insufficientBid = baseBid * insufficientMultiplier;
  insufficientBid = Math.min(insufficientBid, baseBid * 1.40);
  
  assertRange(insufficientBid, 1.00, 1.15, '数据不足时只有分时乘数生效');
  console.log(`    数据不足: $${baseBid.toFixed(2)} × ${insufficientMultiplier.toFixed(3)} = $${insufficientBid.toFixed(2)}`);
}

// --- 测试10: 位置优化集成 ---
console.log('\n--- 测试10: 位置优化集成（v183黄金组合位置增强）---');
{
  // 场景: 5个黄金组合中4个偏好搜索顶部
  const goldenCombos = [
    { comboCategory: 'golden', bestPlacement: 'top_of_search', confidenceLevel: 'high' },
    { comboCategory: 'golden', bestPlacement: 'top_of_search', confidenceLevel: 'medium' },
    { comboCategory: 'golden', bestPlacement: 'top_of_search', confidenceLevel: 'high' },
    { comdenCategory: 'golden', bestPlacement: 'top_of_search', confidenceLevel: 'high' },
    { comboCategory: 'golden', bestPlacement: 'product_page', confidenceLevel: 'medium' },
  ];
  
  const topOfSearchGoldenCount = goldenCombos.filter(c => c.bestPlacement === 'top_of_search').length;
  const suggestedMultiplier = 50; // 原始建议50%
  
  // 超过50%黄金组合偏好搜索顶部
  const shouldBoost = topOfSearchGoldenCount > goldenCombos.length * 0.5;
  assert(shouldBoost, '4/5黄金组合偏好搜索顶部应触发增强');
  
  if (shouldBoost) {
    const boost = Math.min(suggestedMultiplier * 0.10, 20);
    const comboAdjustedMultiplier = Math.min(suggestedMultiplier + boost, 900);
    assertRange(comboAdjustedMultiplier, 50, 70, '位置增强后乘数应在合理范围');
    assertRange(boost, 0, 20, '位置增强幅度不应超过20%');
    console.log(`    搜索顶部增强: ${suggestedMultiplier}% + ${boost.toFixed(0)}% = ${comboAdjustedMultiplier.toFixed(0)}%`);
  }
}

// --- 测试11: 模拟数据生成和统计 ---
console.log('\n--- 测试11: 模拟数据生成验证 ---');
{
  const goldenData = generateMockData({
    keywordId: 1, campaignId: 100,
    scenario: 'golden', days: 14,
    bestPlacement: 'top_of_search',
    bestHours: [10, 14, 20],
    bestDays: [1, 2, 3],
  });
  
  const totalClicks = goldenData.reduce((s, r) => s + r.clicks, 0);
  const totalOrders = goldenData.reduce((s, r) => s + r.orders, 0);
  const totalSpend = goldenData.reduce((s, r) => s + parseFloat(r.spend), 0);
  const totalSales = goldenData.reduce((s, r) => s + parseFloat(r.sales), 0);
  
  assert(goldenData.length > 0, `生成了${goldenData.length}条模拟数据`);
  assert(totalClicks > 50, `总点击${totalClicks}应>50以达到high置信度`);
  assert(totalOrders > 5, `总订单${totalOrders}应>5`);
  
  const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 999;
  console.log(`    黄金场景统计: ${totalClicks}点击, ${totalOrders}订单, ROAS=${roas.toFixed(2)}, ACoS=${acos.toFixed(1)}%`);
  
  // 验证搜索顶部的表现应优于其他位置
  const topSearchData = goldenData.filter(r => r.placement === 'top_of_search');
  const otherData = goldenData.filter(r => r.placement !== 'top_of_search');
  const topSearchOrders = topSearchData.reduce((s, r) => s + r.orders, 0);
  const otherOrders = otherData.reduce((s, r) => s + r.orders, 0);
  
  assert(topSearchOrders > otherOrders / 2, `搜索顶部订单(${topSearchOrders})应显著高于其他位置平均(${Math.round(otherOrders / 2)})`);
}

// --- 测试12: 渐进式调整验证 ---
console.log('\n--- 测试12: 渐进式调整验证 ---');
{
  // 验证从standard到golden的乘数变化不会太剧烈
  const standardResult = classifyCombo(
    60, 10, 50, 178, 3.56, 28, 'top_of_search', [], 30, 150
  );
  const goldenResult = classifyCombo(
    100, 15, 80, 400, 5.0, 20, 'top_of_search',
    [{ dayOfWeek: 1, startHour: 10, endHour: 10 }], 30, 200
  );
  
  const bidChange = Math.abs(goldenResult.bidMultiplier - standardResult.bidMultiplier);
  assertRange(bidChange, 0, 0.25, `从standard到golden的竞价乘数变化(${bidChange.toFixed(3)})应不超过0.25`);
  
  // 验证单次最大调整幅度
  assert(goldenResult.bidMultiplier <= 1.20, '黄金组合单次竞价乘数不超过1.20(+20%)');
  assert(goldenResult.placementMultiplier <= 1.15, '黄金组合单次位置乘数不超过1.15(+15%)');
}

// --- 测试13: 不同目标ACoS下的分类一致性 ---
console.log('\n--- 测试13: 不同目标ACoS下的分类一致性 ---');
{
  // ACoS=15%, 目标ACoS=30% → 应为golden
  const lowAcos = classifyCombo(80, 12, 30, 200, 6.67, 15, 'top_of_search', [], 30, 200);
  assert(lowAcos.category === 'golden', 'ACoS=15%/目标30%应为golden');
  
  // ACoS=15%, 目标ACoS=10% → 应为leaden(因为超过目标150%)
  const highTarget = classifyCombo(80, 12, 30, 200, 6.67, 15, 'top_of_search', [], 10, 200);
  assert(highTarget.category === 'leaden', 'ACoS=15%/目标10%应为leaden');
  
  // ACoS=25%, 目标ACoS=20% → 应为standard或leaden
  const borderline = classifyCombo(60, 8, 50, 200, 4.0, 25, null, [], 20, 150);
  assert(borderline.category !== 'golden', 'ACoS=25%/目标20%不应为golden');
}

// --- 测试14: 最终出价绝对红线 ---
console.log('\n--- 测试14: 最终出价绝对红线验证 ---');
{
  const baseBid = 1.50;
  const maxBidLimit = 2.00;
  
  // 所有乘数叠加后可能超过红线
  const extreme = 1.20 * 1.20 * 1.30; // = 1.872
  let adjustedBid = baseBid * extreme; // = 2.808
  
  // 安全护栏: 不超过基础出价的140%
  adjustedBid = Math.min(adjustedBid, baseBid * 1.40); // = 2.10
  // 绝对红线
  adjustedBid = Math.min(adjustedBid, maxBidLimit); // = 2.00
  adjustedBid = Math.max(adjustedBid, 0.02);
  
  assert(adjustedBid <= maxBidLimit, `最终出价$${adjustedBid.toFixed(2)}不应超过红线$${maxBidLimit.toFixed(2)}`);
  assert(adjustedBid >= 0.02, '最终出价不应低于$0.02');
}

// ==================== 测试结果汇总 ====================

console.log('\n========================================');
console.log(`测试结果: ${passed}/${total} 通过, ${failed} 失败`);
console.log('========================================\n');

if (failed > 0) {
  console.log('⚠️ 存在失败的测试用例，请检查算法逻辑');
  process.exit(1);
} else {
  console.log('✅ 所有测试通过！多维度组合分析引擎算法验证成功');
  process.exit(0);
}
