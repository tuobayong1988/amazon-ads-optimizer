/**
 * v183.1 多维度组合分析引擎测试
 * 
 * 测试覆盖:
 * 1. 组合分类算法 (golden/leaden/potential/standard)
 * 2. 时间衰减权重计算
 * 3. 位置分布比例计算
 * 4. 竞价/位置/时间乘数计算
 * 5. Campaign级别预算乘数
 * 6. v183.1: 数据合成逻辑
 * 7. v183.1: 自我迭代平滑过渡
 * 8. v183.1: 安全护栏验证
 */

// ==================== 模拟函数 ====================

function getTimeDecayWeight(daysAgo: number): number {
  if (daysAgo <= 7) return 1.0;
  if (daysAgo <= 14) return 0.7;
  if (daysAgo <= 21) return 0.4;
  if (daysAgo <= 30) return 0.2;
  return 0.1;
}

function classifyCombo(
  totalClicks: number, totalOrders: number, totalSpend: number, totalSales: number,
  roas: number, acos: number, bestPlacement: string | null, bestTimeWindows: any[],
  targetAcos: number, dataPoints: number
): { category: string; bidMultiplier: number; placementMultiplier: number; timeMultiplier: number; confidence: string } {
  const confidence = totalClicks >= 50 && totalOrders >= 8 ? 'high' :
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

function calculatePlacementRatios(placementData: any[]): Record<string, number> {
  if (placementData.length === 0) {
    return { top_of_search: 0.35, product_page: 0.30, rest_of_search: 0.35 };
  }
  const spendByPlacement: Record<string, number> = { top_of_search: 0, product_page: 0, rest_of_search: 0 };
  for (const row of placementData) {
    const p = row.placement as string;
    const spend = parseFloat(row.spend || '0');
    if (spendByPlacement[p] !== undefined) spendByPlacement[p] += spend;
  }
  const totalSpend = Object.values(spendByPlacement).reduce((a, b) => a + b, 0);
  if (totalSpend <= 0) {
    const clicksByPlacement: Record<string, number> = { top_of_search: 0, product_page: 0, rest_of_search: 0 };
    for (const row of placementData) {
      const p = row.placement as string;
      if (clicksByPlacement[p] !== undefined) clicksByPlacement[p] += (row.clicks || 0);
    }
    const totalClicks = Object.values(clicksByPlacement).reduce((a, b) => a + b, 0);
    if (totalClicks <= 0) return { top_of_search: 0.35, product_page: 0.30, rest_of_search: 0.35 };
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

function calculateCampaignBudgetMultiplier(golden: any[], leaden: any[], potential: any[], standard: any[]): number {
  const allCombos = [...golden, ...leaden, ...potential, ...standard];
  if (allCombos.length === 0) return 1.0;
  const totalSpend = allCombos.reduce((s: number, c: any) => s + (c.totalSpend || 0), 0);
  if (totalSpend <= 0) return 1.0;
  const goldenSpend = golden.reduce((s: number, c: any) => s + (c.totalSpend || 0), 0);
  const leadenSpend = leaden.reduce((s: number, c: any) => s + (c.totalSpend || 0), 0);
  const goldenRatio = goldenSpend / totalSpend;
  const leadenRatio = leadenSpend / totalSpend;
  if (goldenRatio > 0.4 && leadenRatio < 0.2) return Math.min(1.15, 1.0 + (goldenRatio - 0.4) * 0.3);
  if (leadenRatio > 0.4) return Math.max(0.90, 1.0 - (leadenRatio - 0.4) * 0.2);
  return 1.0;
}

function smoothMultiplier(newValue: number, oldValue: number, smoothFactor: number = 0.6): number {
  if (oldValue === 1.0 && newValue === 1.0) return 1.0;
  if (Math.abs(oldValue - 1.0) < 0.001) return newValue;
  return oldValue * (1 - smoothFactor) + newValue * smoothFactor;
}

// ==================== 测试框架 ====================

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) { passed++; console.log(`  \u2705 ${message}`); }
  else { failed++; console.log(`  \u274c ${message}`); }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${message} (actual: ${actual.toFixed(4)}, expected: ${expected.toFixed(4)})`);
}

function section(name: string) { console.log(`\n\ud83d\udccb ${name}`); }

// ==================== 测试用例 ====================

console.log('\ud83e\uddea v183.1 \u591a\u7ef4\u5ea6\u7ec4\u5408\u5206\u6790\u5f15\u64ce\u6d4b\u8bd5\n');

// === 1. 时间衰减权重 ===
section('1. \u65f6\u95f4\u8870\u51cf\u6743\u91cd');
assertApprox(getTimeDecayWeight(1), 1.0, 0.001, '1\u5929\u524d\u6743\u91cd=1.0');
assertApprox(getTimeDecayWeight(7), 1.0, 0.001, '7\u5929\u524d\u6743\u91cd=1.0');
assertApprox(getTimeDecayWeight(8), 0.7, 0.001, '8\u5929\u524d\u6743\u91cd=0.7');
assertApprox(getTimeDecayWeight(14), 0.7, 0.001, '14\u5929\u524d\u6743\u91cd=0.7');
assertApprox(getTimeDecayWeight(15), 0.4, 0.001, '15\u5929\u524d\u6743\u91cd=0.4');
assertApprox(getTimeDecayWeight(21), 0.4, 0.001, '21\u5929\u524d\u6743\u91cd=0.4');
assertApprox(getTimeDecayWeight(22), 0.2, 0.001, '22\u5929\u524d\u6743\u91cd=0.2');
assertApprox(getTimeDecayWeight(30), 0.2, 0.001, '30\u5929\u524d\u6743\u91cd=0.2');
assertApprox(getTimeDecayWeight(31), 0.1, 0.001, '31\u5929\u524d\u6743\u91cd=0.1');

// === 2. 组合分类 - 黄金组合 ===
section('2. \u7ec4\u5408\u5206\u7c7b - \u9ec4\u91d1\u7ec4\u5408');
{
  const r = classifyCombo(60, 10, 100, 500, 5.0, 20, 'top_of_search', [{ dayOfWeek: 1 }], 30, 100);
  assert(r.category === 'golden', '\u9ad8ROAS\u9ad8\u8f6c\u5316 \u2192 \u9ec4\u91d1');
  assert(r.confidence === 'high', '\u7f6e\u4fe1\u5ea6=high');
  assert(r.bidMultiplier > 1.0, '\u7ade\u4ef7\u4e58\u6570>1.0');
  assert(r.bidMultiplier <= 1.20, '\u7ade\u4ef7\u4e58\u6570<=1.20');
  assert(r.placementMultiplier > 1.0, '\u4f4d\u7f6e\u4e58\u6570>1.0');
  assert(r.timeMultiplier > 1.0, '\u65f6\u95f4\u4e58\u6570>1.0');
}

// === 3. 组合分类 - 铅石组合 ===
section('3. \u7ec4\u5408\u5206\u7c7b - \u94c5\u77f3\u7ec4\u5408');
{
  const r1 = classifyCombo(20, 0, 15, 0, 0, 999, null, [], 30, 50);
  assert(r1.category === 'leaden', '\u9ad8\u82b1\u8d39\u65e0\u8f6c\u5316 \u2192 \u94c5\u77f3');
  assert(r1.bidMultiplier < 1.0, '\u7ade\u4ef7\u4e58\u6570<1.0');
  assert(r1.bidMultiplier >= 0.80, '\u7ade\u4ef7\u4e58\u6570>=0.80');

  const r2 = classifyCombo(30, 5, 100, 50, 0.5, 200, null, [], 30, 80);
  assert(r2.category === 'leaden', '\u9ad8ACoS \u2192 \u94c5\u77f3');
  assert(r2.bidMultiplier < 1.0, '\u7ade\u4ef7\u4e58\u6570<1.0');
}

// === 4. 组合分类 - 潜力组合 ===
section('4. \u7ec4\u5408\u5206\u7c7b - \u6f5c\u529b\u7ec4\u5408');
{
  const r1 = classifyCombo(5, 1, 3, 10, 3.33, 30, null, [], 30, 10);
  assert(r1.category === 'potential', '\u6570\u636e\u4e0d\u8db3 \u2192 \u6f5c\u529b');
  assertApprox(r1.bidMultiplier, 1.0, 0.001, '\u4fdd\u62a4\u6027\u7b56\u7565: \u7ade\u4ef7\u4e58\u6570=1.0');
  assertApprox(r1.placementMultiplier, 1.0, 0.001, '\u4fdd\u62a4\u6027\u7b56\u7565: \u4f4d\u7f6e\u4e58\u6570=1.0');

  const r2 = classifyCombo(12, 1, 8, 20, 2.5, 40, null, [], 30, 30);
  assert(r2.category === 'potential', '\u4f4e\u7f6e\u4fe1\u5ea6 \u2192 \u6f5c\u529b');
}

// === 5. 组合分类 - 标准组合 ===
section('5. \u7ec4\u5408\u5206\u7c7b - \u6807\u51c6\u7ec4\u5408');
{
  const r = classifyCombo(30, 5, 50, 150, 3.0, 33, null, [], 30, 60);
  assert(r.category === 'standard', '\u8868\u73b0\u4e00\u822c \u2192 \u6807\u51c6');
  assert(r.bidMultiplier >= 0.95 && r.bidMultiplier <= 1.05, '\u6807\u51c6\u7ec4\u5408\u5fae\u8c03\u8303\u56f4\u00b15%');
}

// === 6. 位置分布比例计算 ===
section('6. \u4f4d\u7f6e\u5206\u5e03\u6bd4\u4f8b\u8ba1\u7b97');
{
  const r1 = calculatePlacementRatios([]);
  assertApprox(r1.top_of_search, 0.35, 0.001, '\u65e0\u6570\u636e\u9ed8\u8ba4TOS=35%');
  assertApprox(r1.product_page, 0.30, 0.001, '\u65e0\u6570\u636e\u9ed8\u8ba4PP=30%');
  assertApprox(r1.rest_of_search, 0.35, 0.001, '\u65e0\u6570\u636e\u9ed8\u8ba4ROS=35%');

  const r2 = calculatePlacementRatios([
    { placement: 'top_of_search', spend: '50', clicks: 100 },
    { placement: 'product_page', spend: '30', clicks: 60 },
    { placement: 'rest_of_search', spend: '20', clicks: 40 },
  ]);
  assertApprox(r2.top_of_search, 0.50, 0.001, '\u6309\u82b1\u8d39TOS=50%');
  assertApprox(r2.product_page, 0.30, 0.001, '\u6309\u82b1\u8d39PP=30%');
  assertApprox(r2.rest_of_search, 0.20, 0.001, '\u6309\u82b1\u8d39ROS=20%');

  const r3 = calculatePlacementRatios([
    { placement: 'top_of_search', spend: '0', clicks: 60 },
    { placement: 'product_page', spend: '0', clicks: 30 },
    { placement: 'rest_of_search', spend: '0', clicks: 10 },
  ]);
  assertApprox(r3.top_of_search, 0.60, 0.001, '\u6309\u70b9\u51fbTOS=60%');
  assertApprox(r3.product_page, 0.30, 0.001, '\u6309\u70b9\u51fbPP=30%');
  assertApprox(r3.rest_of_search, 0.10, 0.001, '\u6309\u70b9\u51fbROS=10%');
}

// === 7. Campaign预算乘数 ===
section('7. Campaign\u9884\u7b97\u4e58\u6570');
{
  const m1 = calculateCampaignBudgetMultiplier([{ totalSpend: 60 }], [{ totalSpend: 10 }], [{ totalSpend: 10 }], [{ totalSpend: 20 }]);
  assert(m1 > 1.0, '\u9ec4\u91d1\u5360\u6bd460% \u2192 \u9884\u7b97\u589e\u52a0');
  assert(m1 <= 1.15, '\u9884\u7b97\u589e\u52a0\u4e0d\u8d85\u8fc715%');

  const m2 = calculateCampaignBudgetMultiplier([{ totalSpend: 10 }], [{ totalSpend: 60 }], [{ totalSpend: 10 }], [{ totalSpend: 20 }]);
  assert(m2 < 1.0, '\u94c5\u77f3\u5360\u6bd460% \u2192 \u9884\u7b97\u964d\u4f4e');
  assert(m2 >= 0.90, '\u9884\u7b97\u964d\u4f4e\u4e0d\u8d85\u8fc710%');

  const m3 = calculateCampaignBudgetMultiplier([{ totalSpend: 25 }], [{ totalSpend: 25 }], [{ totalSpend: 25 }], [{ totalSpend: 25 }]);
  assertApprox(m3, 1.0, 0.001, '\u5747\u8861\u5206\u5e03 \u2192 \u9884\u7b97\u4e0d\u53d8');

  const m4 = calculateCampaignBudgetMultiplier([], [], [], []);
  assertApprox(m4, 1.0, 0.001, '\u7a7a\u6570\u636e \u2192 \u9884\u7b97\u4e0d\u53d8');
}

// === 8. v183.1: 平滑过渡乘数 ===
section('8. v183.1: \u5e73\u6ed1\u8fc7\u6e21\u4e58\u6570');
{
  assertApprox(smoothMultiplier(1.0, 1.0), 1.0, 0.001, '\u65b0\u65e7\u90fd\u662f1.0 \u2192 \u4fdd\u63011.0');
  assertApprox(smoothMultiplier(1.15, 1.0), 1.15, 0.001, '\u9996\u6b21\u5206\u6790 \u2192 \u76f4\u63a5\u4f7f\u7528\u65b0\u503c1.15');
  assertApprox(smoothMultiplier(0.85, 1.0), 0.85, 0.001, '\u9996\u6b21\u5206\u6790 \u2192 \u76f4\u63a5\u4f7f\u7528\u65b0\u503c0.85');

  const s1 = smoothMultiplier(1.20, 1.10, 0.6);
  assertApprox(s1, 1.16, 0.001, '\u65e71.10\u65b01.20 \u2192 \u5e73\u6ed1\u52301.16');

  const s2 = smoothMultiplier(0.80, 0.90, 0.6);
  assertApprox(s2, 0.84, 0.001, '\u65e70.90\u65b00.80 \u2192 \u5e73\u6ed1\u52300.84');

  const s3 = smoothMultiplier(0.90, 1.10, 0.6);
  assertApprox(s3, 0.98, 0.001, '\u65e71.10\u65b00.90 \u2192 \u5e73\u6ed1\u52300.98\uff08\u7f13\u6162\u53cd\u8f6c\uff09');
}

// === 9. v183.1: 安全护栏验证 ===
section('9. v183.1: \u5b89\u5168\u62a4\u680f\u9a8c\u8bc1');
{
  const r1 = classifyCombo(100, 20, 50, 1000, 20.0, 5, 'top_of_search', [{ dayOfWeek: 1 }], 30, 200);
  assert(r1.bidMultiplier <= 1.20, '\u6781\u9ad8ROAS\u7ade\u4ef7\u4e58\u6570\u4e0d\u8d85\u8fc71.20');
  assert(r1.placementMultiplier <= 1.15, '\u6781\u9ad8ROAS\u4f4d\u7f6e\u4e58\u6570\u4e0d\u8d85\u8fc71.15');
  assert(r1.timeMultiplier <= 1.15, '\u6781\u9ad8ROAS\u65f6\u95f4\u4e58\u6570\u4e0d\u8d85\u8fc71.15');

  const r2 = classifyCombo(50, 0, 100, 0, 0, 999, null, [], 30, 100);
  assert(r2.bidMultiplier >= 0.80, '\u6781\u5dee\u8868\u73b0\u7ade\u4ef7\u4e58\u6570\u4e0d\u4f4e\u4e8e0.80');
  assert(r2.placementMultiplier >= 0.85, '\u6781\u5dee\u8868\u73b0\u4f4d\u7f6e\u4e58\u6570\u4e0d\u4f4e\u4e8e0.85');
  assert(r2.timeMultiplier >= 0.85, '\u6781\u5dee\u8868\u73b0\u65f6\u95f4\u4e58\u6570\u4e0d\u4f4e\u4e8e0.85');

  const smoothedBid = smoothMultiplier(1.20, 1.20, 0.6);
  const clampedBid = Math.max(0.80, Math.min(1.20, smoothedBid));
  assert(clampedBid <= 1.20, '\u5e73\u6ed1\u540e\u7ade\u4ef7\u4e58\u6570\u4e0d\u8d85\u8fc71.20');
  assert(clampedBid >= 0.80, '\u5e73\u6ed1\u540e\u7ade\u4ef7\u4e58\u6570\u4e0d\u4f4e\u4e8e0.80');
}

// === 10. v183.1: 数据合成逻辑验证 ===
section('10. v183.1: \u6570\u636e\u5408\u6210\u903b\u8f91\u9a8c\u8bc1');
{
  const hourlyData = [
    { keywordId: 1, hour: 10, dayOfWeek: 1, impressions: 100, clicks: 10, spend: '5.00', sales: '20.00', orders: 2 },
    { keywordId: 1, hour: 14, dayOfWeek: 1, impressions: 80, clicks: 8, spend: '4.00', sales: '15.00', orders: 1 },
    { keywordId: 2, hour: 10, dayOfWeek: 1, impressions: 50, clicks: 5, spend: '3.00', sales: '0.00', orders: 0 },
  ];
  const placementRatios = { top_of_search: 0.50, product_page: 0.30, rest_of_search: 0.20 };

  const synthesized: any[] = [];
  for (const row of hourlyData) {
    for (const [placement, ratio] of Object.entries(placementRatios)) {
      synthesized.push({
        keywordId: row.keywordId, placement, dayOfWeek: row.dayOfWeek, hour: row.hour,
        impressions: Math.round(row.impressions * ratio),
        clicks: Math.round(row.clicks * ratio),
        spend: (parseFloat(row.spend) * ratio).toFixed(2),
        sales: (parseFloat(row.sales) * ratio).toFixed(2),
        orders: Math.round(row.orders * ratio),
      });
    }
  }

  assert(synthesized.length === 9, `3\u6761hourly \u00d7 3\u4e2a\u4f4d\u7f6e = 9\u6761\u5408\u6210\u6570\u636e (\u5b9e\u9645: ${synthesized.length})`);
  const tosRow = synthesized.find((r: any) => r.keywordId === 1 && r.hour === 10 && r.placement === 'top_of_search');
  assert(tosRow !== undefined, 'TOS\u5408\u6210\u6570\u636e\u5b58\u5728');
  assert(tosRow.impressions === 50, `TOS impressions = 100 * 0.5 = 50 (\u5b9e\u9645: ${tosRow.impressions})`);
  assert(tosRow.clicks === 5, `TOS clicks = 10 * 0.5 = 5 (\u5b9e\u9645: ${tosRow.clicks})`);
  assertApprox(parseFloat(tosRow.spend), 2.50, 0.01, 'TOS spend = 5.00 * 0.5 = 2.50');
  assertApprox(parseFloat(tosRow.sales), 10.00, 0.01, 'TOS sales = 20.00 * 0.5 = 10.00');
  assert(tosRow.orders === 1, `TOS orders = 2 * 0.5 = 1 (\u5b9e\u9645: ${tosRow.orders})`);
}

// === 11. v183.1: 自我迭代分类追踪 ===
section('11. v183.1: \u81ea\u6211\u8fed\u4ee3\u5206\u7c7b\u8ffd\u8e2a');
{
  const prevCategory = 'standard';
  const newResult = classifyCombo(60, 10, 100, 500, 5.0, 20, 'top_of_search', [{ dayOfWeek: 1 }], 30, 100);
  assert(newResult.category !== prevCategory, '\u5206\u7c7b\u4ecestard\u53d8\u4e3agolden \u2192 categoryChanged=true');
  assert(newResult.category === 'golden', '\u65b0\u5206\u7c7b=golden');

  const prevCategory2 = 'golden';
  const newResult2 = classifyCombo(30, 0, 20, 0, 0, 999, null, [], 30, 60);
  assert(newResult2.category !== prevCategory2, '\u5206\u7c7b\u4ecegolden\u53d8\u4e3aleaden \u2192 categoryChanged=true');

  const prevCategory3 = 'standard';
  const newResult3 = classifyCombo(30, 5, 50, 150, 3.0, 33, null, [], 30, 60);
  assert(newResult3.category === prevCategory3, '\u5206\u7c7b\u4fdd\u6301standard \u2192 categoryChanged=false');
}

// === 12. v183.1: 预算乘数叠加安全护栏 ===
section('12. v183.1: \u9884\u7b97\u4e58\u6570\u53e0\u52a0\u5b89\u5168\u62a4\u680f');
{
  let f1 = 1.10 * 1.15;
  f1 = Math.max(0.80, Math.min(1.30, f1));
  assertApprox(f1, 1.265, 0.001, '1.10 \u00d7 1.15 = 1.265 (\u5728\u62a4\u680f\u5185)');

  let f2 = 1.15 * 1.15;
  f2 = Math.max(0.80, Math.min(1.30, f2));
  assertApprox(f2, 1.30, 0.01, '1.15 \u00d7 1.15 = 1.3225 \u2192 \u622a\u65ad\u52301.30');

  let f3 = 0.90 * 0.90;
  f3 = Math.max(0.80, Math.min(1.30, f3));
  assertApprox(f3, 0.81, 0.001, '0.90 \u00d7 0.90 = 0.81 (\u5728\u62a4\u680f\u5185)');

  let f4 = 0.85 * 0.90;
  f4 = Math.max(0.80, Math.min(1.30, f4));
  assertApprox(f4, 0.80, 0.01, '0.85 \u00d7 0.90 = 0.765 \u2192 \u622a\u65ad\u52300.80');
}

// === 13. 边界条件测试 ===
section('13. \u8fb9\u754c\u6761\u4ef6\u6d4b\u8bd5');
{
  const targetAcos = 30;
  const targetRoas = 100 / targetAcos;
  const borderRoas = targetRoas * 1.2;
  const r1 = classifyCombo(25, 4, 50, 200, borderRoas, 25, 'top_of_search', [{ dayOfWeek: 1 }], targetAcos, 50);
  assert(r1.category === 'golden', `ROAS\u6070\u597d=${borderRoas.toFixed(2)} \u2192 \u9ec4\u91d1`);

  const borderAcos = targetAcos * 1.5;
  const r2 = classifyCombo(20, 2, 45, 100, 2.22, borderAcos, null, [], targetAcos, 40);
  assert(r2.category === 'leaden', `ACoS\u6070\u597d=${borderAcos} \u2192 \u94c5\u77f3`);

  const r3 = classifyCombo(0, 0, 0, 0, 0, 0, null, [], 30, 0);
  assert(r3.category === 'potential', '0\u6570\u636e \u2192 \u6f5c\u529b');
  assertApprox(r3.bidMultiplier, 1.0, 0.001, '0\u6570\u636e \u2192 \u4fdd\u62a4\u6027\u7b56\u7565');
}

// === 14. v183.1: 连续迭代平滑收敛测试 ===
section('14. v183.1: \u8fde\u7eed\u8fed\u4ee3\u5e73\u6ed1\u6536\u655b\u6d4b\u8bd5');
{
  let currentValue = 1.0;
  const targetValue = 1.15;
  const iterations: number[] = [currentValue];
  for (let i = 0; i < 5; i++) {
    currentValue = smoothMultiplier(targetValue, currentValue, 0.6);
    currentValue = Math.max(0.80, Math.min(1.20, currentValue));
    iterations.push(currentValue);
  }
  assert(iterations[1] === 1.15, `\u7b2c1\u8f6e: \u9996\u6b21\u5206\u6790\u76f4\u63a5\u4f7f\u7528\u65b0\u503c (${iterations[1].toFixed(4)})`);
  assert(Math.abs(iterations[5] - 1.15) < 0.01, `\u7b2c5\u8f6e: \u6536\u655b\u5230${iterations[5].toFixed(4)} \u2248 1.15`);

  let value = 1.15;
  value = smoothMultiplier(0.90, value, 0.6);
  assert(value < 1.15, `\u7a81\u53d8\u540e\u5e73\u6ed1: ${value.toFixed(4)} < 1.15`);
  assert(value > 0.90, `\u7a81\u53d8\u540e\u5e73\u6ed1: ${value.toFixed(4)} > 0.90`);
  assertApprox(value, 1.0, 0.01, '\u7a81\u53d8\u540e\u5e73\u6ed1\u5230\u7ea61.0');
}

// === 15. 分时竞价最终出价计算 ===
section('15. \u5206\u65f6\u7ade\u4ef7\u6700\u7ec8\u51fa\u4ef7\u8ba1\u7b97');
{
  const baseBid = 1.00;
  const maxBidLimit = 2.00;

  // 黄金+最佳时段
  const finalMult = 1.10 * 1.15 * Math.min(1.10 * 1.15, 1.30);
  let adjustedBid = baseBid * finalMult;
  adjustedBid = Math.min(adjustedBid, baseBid * 1.40);
  adjustedBid = Math.min(adjustedBid, maxBidLimit);
  adjustedBid = Math.max(adjustedBid, 0.02);
  assert(adjustedBid >= 1.00 && adjustedBid <= 1.40, `\u9ec4\u91d1+\u6700\u4f73\u65f6\u6bb5\u51fa\u4ef7\u5728\u5408\u7406\u8303\u56f4 ($${adjustedBid.toFixed(2)})`);

  // 铅石+最差时段
  const leadenMult = 0.90 * 0.85 * Math.max(0.90 * 0.85, 0.70);
  let leadenBid = baseBid * leadenMult;
  leadenBid = Math.max(leadenBid, baseBid * 0.60);
  leadenBid = Math.max(leadenBid, 0.02);
  assert(leadenBid >= 0.60 && leadenBid <= 1.00, `\u94c5\u77f3+\u6700\u5dee\u65f6\u6bb5\u51fa\u4ef7\u5728\u5408\u7406\u8303\u56f4 ($${leadenBid.toFixed(2)})`);
}

// ==================== 测试结果 ====================

console.log(`\n${'='.repeat(60)}`);
console.log(`\ud83d\udcca \u6d4b\u8bd5\u7ed3\u679c: ${passed}/${total} \u901a\u8fc7, ${failed} \u5931\u8d25`);
console.log(`${'='.repeat(60)}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n\ud83c\udf89 \u6240\u6709\u6d4b\u8bd5\u901a\u8fc7\uff01v183.1 \u591a\u7ef4\u5ea6\u7ec4\u5408\u5206\u6790\u5f15\u64ce\u7b97\u6cd5\u9a8c\u8bc1\u6210\u529f');
}
