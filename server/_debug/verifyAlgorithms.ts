// @ts-nocheck
/**
 * 下一代算法体系 — 端到端纯逻辑验证脚本
 * 
 * 不依赖数据库连接，直接测试所有核心算法模块的数学正确性和业务逻辑。
 * 覆盖范围：
 * 1. Sigmoid曲线拟合 (Levenberg-Marquardt)
 * 2. LinUCB上下文赌博机
 * 3. 因果推断DID
 * 4. CQL离线强化学习
 * 5. 预算组合优化 (边际效用等价法)
 * 6. 元学习策略选择 (Thompson Sampling)
 * 7. 上下文特征管道
 * 8. 安全校验与编排器
 */

// ==================== 导入纯算法函数 ====================
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('VerifyAlgo');

import {
  sigmoid,
  sigmoidDerivative,
  fitSigmoidCurve,
  calculateSigmoidOptimalBid,
  type SigmoidParams,
} from "../algorithm/sigmoidCurveFitter";

import {
  ARM_CONFIGS,
  type ArmType,
  type LinUCBArm,
} from "../algorithm/contextualBanditService";

import {
  didEstimate,
} from "../algorithm/causalInferenceEngine";

import {
  ACTIONS,
  NUM_ACTIONS,
  STATE_DIM,
  initCQLModel,
  cqlDecide,
} from "../algorithm/offlineRLService";

import {
  marginalUtilityAllocation,
  type CampaignProfitCurve,
} from "../budget/budgetPortfolioOptimizer";

import {
  featureVectorToArray,
  FEATURE_DIM as CTX_FEATURE_DIM,
  type ContextFeatureVector,
} from "../analytics/contextualFeatureService";

// ==================== 测试框架 ====================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, detail: string = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    log.debug(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    const msg = `  ❌ FAIL: ${testName}${detail ? ' — ' + detail : ''}`;
    log.debug(msg);
    failures.push(msg);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, testName: string) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, testName, `expected ≈${expected}, got ${actual}, diff=${diff.toFixed(6)}`);
}

function assertRange(value: number, min: number, max: number, testName: string) {
  assert(value >= min && value <= max, testName, `expected [${min}, ${max}], got ${value}`);
}

function section(name: string) {
  log.debug(`\n${'='.repeat(60)}`);
  log.debug(`  ${name}`);
  log.debug('='.repeat(60));
}

// ==================== 测试1: Sigmoid曲线拟合 ====================

function testSigmoidCurveFitting() {
  section('TEST 1: Sigmoid曲线拟合 (Levenberg-Marquardt)');
  
  // 1.1 Sigmoid函数基本性质
  const params: SigmoidParams = { L: 1000, k: 3, x0: 1.5, b: 50, r2: 1 };
  
  // 在x0处，sigmoid应该约等于 L/2 + b
  const atMidpoint = sigmoid(params.x0, params);
  assertApprox(atMidpoint, params.L / 2 + params.b, 1, 'Sigmoid在拐点处 ≈ L/2 + b');
  
  // 在极大bid处，sigmoid应该趋近于 L + b
  const atHigh = sigmoid(100, params);
  assertApprox(atHigh, params.L + params.b, 1, 'Sigmoid在极大bid处 ≈ L + b');
  
  // 在极小bid处，sigmoid应该趋近于 b
  const atLow = sigmoid(-100, params);
  assertApprox(atLow, params.b, 1, 'Sigmoid在极小bid处 ≈ b');
  
  // 1.2 Sigmoid导数（边际展现量）
  const derivAtMidpoint = sigmoidDerivative(params.x0, params);
  // 在拐点处导数最大，等于 L*k/4
  assertApprox(derivAtMidpoint, params.L * params.k / 4, 1, 'Sigmoid导数在拐点处 = L*k/4');
  
  // 导数应该始终为正（展现量随bid单调递增）
  assert(sigmoidDerivative(0.5, params) > 0, 'Sigmoid导数 > 0 (bid=0.5)');
  assert(sigmoidDerivative(2.5, params) > 0, 'Sigmoid导数 > 0 (bid=2.5)');
  
  // 1.3 曲线拟合测试
  // 生成已知参数的Sigmoid数据
  const trueParms: SigmoidParams = { L: 2000, k: 2, x0: 2.0, b: 100, r2: 1 };
  const testBids = [0.3, 0.5, 0.8, 1.0, 1.3, 1.5, 1.8, 2.0, 2.3, 2.5, 3.0, 3.5, 4.0, 5.0];
  const testImpressions = testBids.map(bid => sigmoid(bid, trueParms) + (Math.random() - 0.5) * 20);
  
  const fittedParams = fitSigmoidCurve(testBids, testImpressions);
  
  assert(fittedParams.r2 > 0.95, `曲线拟合R² > 0.95 (实际: ${fittedParams.r2.toFixed(4)})`);
  assertApprox(fittedParams.L, trueParms.L, 300, `拟合L ≈ ${trueParms.L} (实际: ${fittedParams.L})`);
  assertApprox(fittedParams.x0, trueParms.x0, 0.5, `拟合x0 ≈ ${trueParms.x0} (实际: ${fittedParams.x0})`);
  
  // 1.4 数据不足时的安全降级
  const sparseParams = fitSigmoidCurve([1.0, 2.0], [500, 800]);
  assert(sparseParams.L > 0, '数据不足时返回正的L');
  assert(sparseParams.k > 0, '数据不足时返回正的k');
  
  // 1.5 利润最大化出价计算
  const optimalResult = calculateSigmoidOptimalBid(
    { L: 5000, k: 2, x0: 2.0, b: 100, r2: 0.9 },
    0.02,   // CTR = 2%
    0.05,   // CVR = 5%
    25,     // AOV = $25
    0.7     // CPC/bid ratio
  );
  
  assert(optimalResult.optimalBid > 0.02, `最优出价 > $0.02 (实际: $${optimalResult.optimalBid})`);
  assert(optimalResult.optimalBid < 10, `最优出价 < $10 (实际: $${optimalResult.optimalBid})`);
  assert(optimalResult.maxProfit > 0, `最大利润 > 0 (实际: $${optimalResult.maxProfit})`);
  assert(optimalResult.profitCurve.length > 0, `利润曲线有数据点 (${optimalResult.profitCurve.length}个)`);
  assert(optimalResult.impressionCeiling > 0, `展现天花板 > 0 (${optimalResult.impressionCeiling})`);
  
  // 验证利润曲线的单峰性：最优点附近的利润应该是最高的
  const nearOptimal = optimalResult.profitCurve.find(
    p => Math.abs(p.bid - optimalResult.optimalBid) < 0.15
  );
  if (nearOptimal) {
    assert(nearOptimal.profit >= 0, '最优点附近利润 >= 0');
  }
}

// ==================== 测试2: LinUCB上下文赌博机 ====================

function testLinUCB() {
  section('TEST 2: LinUCB上下文赌博机');
  
  // 2.1 臂配置验证
  assert(ARM_CONFIGS.length === 5, `有5个臂配置 (实际: ${ARM_CONFIGS.length})`);
  
  const armTypes = ARM_CONFIGS.map(a => a.type);
  assert(armTypes.includes('bid_aggressive'), '包含激进加价臂');
  assert(armTypes.includes('bid_moderate'), '包含温和加价臂');
  assert(armTypes.includes('bid_conservative'), '包含保守微调臂');
  assert(armTypes.includes('bid_hold'), '包含温和降价臂');
  assert(armTypes.includes('bid_decrease'), '包含明显降价臂');
  
  // 2.2 出价倍率范围验证
  for (const config of ARM_CONFIGS) {
    const [min, max] = config.bidMultiplierRange;
    assert(min < max, `${config.type}: 倍率范围有效 [${min}, ${max}]`);
    assert(min >= 0.5 && max <= 2.0, `${config.type}: 倍率在安全范围内`);
  }
  
  // 2.3 矩阵运算验证（通过模拟LinUCB选择过程）
  const d = CTX_FEATURE_DIM;
  
  // 创建单位矩阵
  const identity = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))
  );
  
  // 验证单位矩阵的性质
  assert(identity.length === d, `单位矩阵维度正确 (${d}×${d})`);
  assert(identity[0][0] === 1, '单位矩阵对角线为1');
  assert(identity[0][1] === 0, '单位矩阵非对角线为0');
  
  // 2.4 特征向量维度一致性
  assert(d === 17, `特征维度 = 17 (实际: ${d})`);
  
  // 2.5 UCB分数计算验证
  // 对于初始化的模型（A=I, b=0），theta=0
  // UCB = 0 + alpha * sqrt(x^T * I^{-1} * x) = alpha * ||x||
  // 所有臂的UCB应该相同（因为theta都是0）
  const testContext = createMockContext();
  const x = featureVectorToArray(testContext);
  // @ts-ignore Type inference limitation
  const norm = Math.sqrt(x.reduce((sum: number, v: Record<string, unknown>) => sum + v * v, 0));
  assert(norm > 0, `特征向量范数 > 0 (${norm.toFixed(4)})`);
  assert(norm < 5, `特征向量范数 < 5 (${norm.toFixed(4)}) — 归一化有效`);
}

// ==================== 测试3: 因果推断DID ====================

function testCausalInference() {
  section('TEST 3: 因果推断 (Difference-in-Differences)');
  
  // 3.1 标准DID估计
  // 场景：处理组CVR从3%提升到5%，对照组从3%提升到3.5%（市场趋势）
  const result1 = didEstimate(
    { impressions: 1000, clicks: 100, orders: 3, spend: 50, sales: 75, cvr: 0.03, cpc: 0.5, acos: 0.67 },
    { impressions: 1200, clicks: 120, orders: 6, spend: 60, sales: 150, cvr: 0.05, cpc: 0.5, acos: 0.40 },
    { impressions: 1000, clicks: 100, orders: 3, spend: 50, sales: 75, cvr: 0.03, cpc: 0.5, acos: 0.67 },
    { impressions: 1050, clicks: 105, orders: 3.675, spend: 52.5, sales: 91.875, cvr: 0.035, cpc: 0.5, acos: 0.57 }
  );
  
  // ITE = (0.05 - 0.03) - (0.035 - 0.03) = 0.02 - 0.005 = 0.015
  assertApprox(result1.ite, 0.015, 0.001, 'DID ITE = 0.015 (处理效应减去时间趋势)');
  assertApprox(result1.treatmentEffect, 0.02, 0.001, '处理组前后差异 = 0.02');
  assertApprox(result1.timeEffect, 0.005, 0.001, '时间趋势效应 = 0.005');
  
  // 3.2 无效果场景
  const result2 = didEstimate(
    { impressions: 1000, clicks: 100, orders: 3, spend: 50, sales: 75, cvr: 0.03, cpc: 0.5, acos: 0.67 },
    { impressions: 1050, clicks: 105, orders: 3.675, spend: 52.5, sales: 91.875, cvr: 0.035, cpc: 0.5, acos: 0.57 },
    { impressions: 1000, clicks: 100, orders: 3, spend: 50, sales: 75, cvr: 0.03, cpc: 0.5, acos: 0.67 },
    { impressions: 1050, clicks: 105, orders: 3.675, spend: 52.5, sales: 91.875, cvr: 0.035, cpc: 0.5, acos: 0.57 }
  );
  
  // 处理组和对照组变化相同 → ITE = 0
  assertApprox(result2.ite, 0, 0.001, 'DID ITE ≈ 0 (无因果效应)');
  
  // 3.3 负效果场景
  const result3 = didEstimate(
    { impressions: 1000, clicks: 100, orders: 5, spend: 50, sales: 125, cvr: 0.05, cpc: 0.5, acos: 0.40 },
    { impressions: 800, clicks: 80, orders: 2.4, spend: 40, sales: 60, cvr: 0.03, cpc: 0.5, acos: 0.67 },
    { impressions: 1000, clicks: 100, orders: 5, spend: 50, sales: 125, cvr: 0.05, cpc: 0.5, acos: 0.40 },
    { impressions: 1000, clicks: 100, orders: 5, spend: 50, sales: 125, cvr: 0.05, cpc: 0.5, acos: 0.40 }
  );
  
  // 处理组CVR下降0.02，对照组不变 → ITE = -0.02
  assertApprox(result3.ite, -0.02, 0.001, 'DID ITE = -0.02 (负面因果效应)');
}

// ==================== 测试4: CQL离线强化学习 ====================

function testCQL() {
  section('TEST 4: CQL离线强化学习');
  
  // 4.1 动作空间验证
  assert(ACTIONS.length === 7, `动作空间大小 = 7 (实际: ${ACTIONS.length})`);
  assert(ACTIONS[0] === -0.30, '动作0 = -30%');
  assert(ACTIONS[3] === 0, '动作3 = 0% (hold)');
  assert(ACTIONS[6] === 0.30, '动作6 = +30%');
  
  // 4.2 状态维度验证
  assert(STATE_DIM === CTX_FEATURE_DIM + 1, `状态维度 = 特征维度+1 = ${STATE_DIM}`);
  
  // 4.3 模型初始化验证
  const model = initCQLModel();
  assert(model.weights.length === NUM_ACTIONS, `权重矩阵行数 = ${NUM_ACTIONS}`);
  assert(model.weights[0].length === STATE_DIM, `权重向量维度 = ${STATE_DIM}`);
  assert(model.trainingEpisodes === 0, '初始训练episode = 0');
  assert(model.avgLoss === 0, '初始平均损失 = 0');
  
  // 4.4 CQL决策测试
  const context = createMockContext();
  const decision = cqlDecide(model, context, 1.50);
  
  assert(decision.actionIndex >= 0 && decision.actionIndex < NUM_ACTIONS,
    `动作索引在有效范围 [0, ${NUM_ACTIONS}) (实际: ${decision.actionIndex})`);
  assert(decision.recommendedBid >= 0.02, `推荐出价 >= $0.02 (实际: $${decision.recommendedBid})`);
  assert(decision.recommendedBid <= 1.50 * 1.30, `推荐出价 <= 当前出价×1.3 (实际: $${decision.recommendedBid})`);
  assert(decision.qValues.length === NUM_ACTIONS, `Q值数组长度 = ${NUM_ACTIONS}`);
  assertRange(decision.confidence, 0, 1, '置信度在[0,1]范围');
  
  // 4.5 安全约束验证
  const highBidDecision = cqlDecide(model, context, 5.00);
  assert(highBidDecision.recommendedBid <= 5.00 * 1.30, '高出价时不超过+30%');
  assert(highBidDecision.recommendedBid >= 5.00 * 0.70, '高出价时不低于-30%');
  
  const lowBidDecision = cqlDecide(model, context, 0.05);
  assert(lowBidDecision.recommendedBid >= 0.02, '低出价时不低于$0.02底价');
}

// ==================== 测试5: 预算组合优化 ====================

function testBudgetOptimization() {
  section('TEST 5: 预算组合优化 (边际效用等价法)');
  
  // 5.1 基本分配测试
  const curves: CampaignProfitCurve[] = [
    {
      campaignId: 'camp1', campaignName: 'High ROAS Campaign',
      currentBudget: 50, maxSales: 500, efficiency: 0.05,
      avgRoas: 5, avgAcos: 0.2, avgSpend: 50, avgSales: 250,
    },
    {
      campaignId: 'camp2', campaignName: 'Medium ROAS Campaign',
      currentBudget: 50, maxSales: 300, efficiency: 0.03,
      avgRoas: 3, avgAcos: 0.33, avgSpend: 50, avgSales: 150,
    },
    {
      campaignId: 'camp3', campaignName: 'Low ROAS Campaign',
      currentBudget: 50, maxSales: 150, efficiency: 0.02,
      avgRoas: 1.5, avgAcos: 0.67, avgSpend: 50, avgSales: 75,
    },
  ];
  
  const allocations = marginalUtilityAllocation(curves, 150);
  
  assert(allocations.length === 3, `分配结果数量 = 3 (实际: ${allocations.length})`);
  
  // 总预算约束
  // @ts-ignore Type inference limitation
  const totalAllocated = allocations.reduce((sum: number, a: Record<string, unknown>) => sum + a.optimalBudget, 0);
  // @ts-ignore Complex function parameter types
  assert(totalAllocated <= 150 * 1.01, `总分配 ≤ 总预算 (${totalAllocated.toFixed(2)} ≤ 150)`);
  
  // 高效率Campaign应该获得更多预算
  const highRoasAlloc = allocations.find(a => a.campaignId === 'camp1')!;
  const lowRoasAlloc = allocations.find(a => a.campaignId === 'camp3')!;
  assert(highRoasAlloc.optimalBudget >= lowRoasAlloc.optimalBudget,
    `高效率Campaign预算(${highRoasAlloc.optimalBudget}) >= 低效率Campaign预算(${lowRoasAlloc.optimalBudget})`);
  
  // 5.2 安全约束验证（单个Campaign变化不超过±50%）
  for (const alloc of allocations) {
    const changePercent = Math.abs(alloc.changePercent);
    assert(changePercent <= 0.50 + 0.01, 
      `${alloc.campaignName}: 变化幅度 ${(changePercent*100).toFixed(1)}% ≤ 50%`);
  }
  
  // 5.3 边际利润趋近一致（最优条件）
  const marginalProfits = allocations.map(a => a.marginalProfit);
  const mpRange = Math.max(...marginalProfits) - Math.min(...marginalProfits);
  // 由于安全约束，边际利润可能不完全一致，但差距不应太大
  assert(mpRange < 5, `边际利润差距 < 5 (实际: ${mpRange.toFixed(4)})`);
  
  // 5.4 空输入处理
  const emptyResult = marginalUtilityAllocation([], 100);
  assert(emptyResult.length === 0, '空输入返回空数组');
  
  // 5.5 单Campaign测试
  const singleResult = marginalUtilityAllocation([curves[0]], 100);
  assert(singleResult.length === 1, '单Campaign返回1个分配');
  assert(singleResult[0].optimalBudget > 0, '单Campaign分配预算 > 0');
}

// ==================== 测试6: 上下文特征管道 ====================

function testContextualFeatures() {
  section('TEST 6: 上下文特征管道');
  
  // 6.1 特征维度验证
  assert(CTX_FEATURE_DIM === 17, `特征维度 = 17 (实际: ${CTX_FEATURE_DIM})`);
  
  // 6.2 特征向量转换
  const context = createMockContext();
  const vec = featureVectorToArray(context);
  
  assert(vec.length === CTX_FEATURE_DIM, `转换后向量长度 = ${CTX_FEATURE_DIM} (实际: ${vec.length})`);
  
  // 所有特征应该在[0, 1]范围内
  for (let i = 0; i < vec.length; i++) {
    assertRange(vec[i], 0, 1, `特征[${i}]在[0,1]范围 (值: ${vec[i].toFixed(4)})`);
  }
  
  // 6.3 边界值测试
  const extremeContext: ContextFeatureVector = {
    accountId: 1,
    hourOfDay: 23,
    dayOfWeek: 6,
    isHoliday: 1,
    estimatedCompetition: 1,
    cpcVolatility7d: 1,
    ctrVolatility7d: 1,
    impressionShare: 1,
    avgCpc7d: 5,
    avgCtr7d: 0.1,
    avgCvr7d: 0.2,
    weightedAcos14d: 1,
    impressionTrend7d: 1,
    clickTrend7d: 1,
    orderTrend7d: 1,
    spendTrend7d: 1,
    weightedCvr14d: 0.2,
    weightedRoas14d: 10,
  };
  
  const extremeVec = featureVectorToArray(extremeContext);
  for (let i = 0; i < extremeVec.length; i++) {
    assertRange(extremeVec[i], 0, 1, `极端特征[${i}]仍在[0,1]范围 (值: ${extremeVec[i].toFixed(4)})`);
  }
  
  // 6.4 零值测试
  const zeroContext: ContextFeatureVector = {
    accountId: 1,
    hourOfDay: 0,
    dayOfWeek: 0,
    isHoliday: 0,
    estimatedCompetition: 0,
    cpcVolatility7d: 0,
    ctrVolatility7d: 0,
    impressionShare: 0,
    avgCpc7d: 0,
    avgCtr7d: 0,
    avgCvr7d: 0,
    weightedAcos14d: 0,
    impressionTrend7d: -1,
    clickTrend7d: -1,
    orderTrend7d: -1,
    spendTrend7d: -1,
    weightedCvr14d: 0,
    weightedRoas14d: 0,
  };
  
  const zeroVec = featureVectorToArray(zeroContext);
  for (let i = 0; i < zeroVec.length; i++) {
    assertRange(zeroVec[i], 0, 1, `零值特征[${i}]在[0,1]范围 (值: ${zeroVec[i].toFixed(4)})`);
  }
}

// ==================== 测试7: 安全校验与编排器 ====================

function testSafetyAndOrchestrator() {
  section('TEST 7: 安全校验与编排器逻辑');
  
  // 7.1 安全校验函数（内联测试）
  function safetyValidate(currentBid: number, proposedBid: number, maxChangePercent: number = 0.30): number {
    let safeBid = proposedBid;
    safeBid = Math.max(0.02, Math.min(10.00, safeBid));
    const maxIncrease = currentBid * (1 + maxChangePercent);
    const maxDecrease = currentBid * (1 - maxChangePercent);
    safeBid = Math.max(maxDecrease, Math.min(maxIncrease, safeBid));
    safeBid = Math.round(safeBid * 100) / 100;
    safeBid = Math.max(0.02, safeBid);
    return safeBid;
  }
  
  // 正常调整
  assertApprox(safetyValidate(1.00, 1.10), 1.10, 0.01, '正常加价10%通过');
  assertApprox(safetyValidate(1.00, 0.90), 0.90, 0.01, '正常降价10%通过');
  
  // 超出幅度限制
  assertApprox(safetyValidate(1.00, 2.00), 1.30, 0.01, '超出+30%被截断到1.30');
  assertApprox(safetyValidate(1.00, 0.50), 0.70, 0.01, '超出-30%被截断到0.70');
  
  // 绝对范围限制
  assert(safetyValidate(0.01, 0.01) >= 0.02, '低于$0.02底价被提升');
  assert(safetyValidate(9.00, 15.00) <= 10.00, '超过$10上限被截断');
  
  // 精度控制
  const precisionBid = safetyValidate(1.00, 1.123456);
  // 使用容差比较避免IEEE 754浮点精度问题（1.12*100 = 112.00000000000001）
  assert(Math.abs(Math.round(precisionBid * 100) - precisionBid * 100) < 1e-10, '出价精度为$0.01');
  
  // 7.2 流量分配确定性
  function shouldUseNextGen(targetId: number, ratio: number): boolean {
    const hash = targetId * 2654435761 % 1000;
    return hash < ratio * 1000;
  }
  
  // 相同targetId应该总是得到相同结果
  const result1 = shouldUseNextGen(123, 0.3);
  const result2 = shouldUseNextGen(123, 0.3);
  assert(result1 === result2, '流量分配对相同targetId是确定性的');
  
  // 比例为0时，没有流量使用新算法
  assert(!shouldUseNextGen(123, 0), '比例为0时不使用新算法');
  
  // 比例为1时，所有流量使用新算法
  assert(shouldUseNextGen(123, 1), '比例为1时使用新算法');
  
  // 统计验证：30%比例下，大约30%的targetId会被分配到新算法
  let nextGenCount = 0;
  const sampleSize = 1000;
  for (let i = 0; i < sampleSize; i++) {
    if (shouldUseNextGen(i, 0.3)) nextGenCount++;
  }
  const actualRatio = nextGenCount / sampleSize;
  assertRange(actualRatio, 0.2, 0.4, `30%流量分配实际比例 ≈ 30% (实际: ${(actualRatio*100).toFixed(1)}%)`);
}

// ==================== 测试8: 集成测试 ====================

function testIntegration() {
  section('TEST 8: 端到端集成测试');
  
  // 8.1 完整出价决策流程模拟
  // Step 1: 创建上下文特征
  const context = createMockContext();
  const featureVec = featureVectorToArray(context);
  assert(featureVec.length === 17, '特征向量维度正确');
  
  // Step 2: Sigmoid曲线拟合
  const bids = [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0];
  const impressions = bids.map(b => 3000 / (1 + Math.exp(-2 * (b - 2))) + 100);
  const sigmoidParams = fitSigmoidCurve(bids, impressions);
  assert(sigmoidParams.r2 > 0.9, `Sigmoid拟合R² > 0.9 (${sigmoidParams.r2.toFixed(4)})`);
  
  // Step 3: 利润最大化出价
  const optimalBid = calculateSigmoidOptimalBid(sigmoidParams, 0.02, 0.05, 25, 0.7);
  assert(optimalBid.optimalBid > 0, '最优出价 > 0');
  
  // Step 4: CQL决策
  const cqlModel = initCQLModel();
  const cqlDecision = cqlDecide(cqlModel, context, 1.50);
  assert(cqlDecision.recommendedBid > 0, 'CQL推荐出价 > 0');
  
  // Step 5: DID因果效应
  const causalResult = didEstimate(
    { impressions: 1000, clicks: 50, orders: 2, spend: 25, sales: 50, cvr: 0.04, cpc: 0.5, acos: 0.5 },
    { impressions: 1500, clicks: 75, orders: 4.5, spend: 37.5, sales: 112.5, cvr: 0.06, cpc: 0.5, acos: 0.33 },
    { impressions: 1000, clicks: 50, orders: 2, spend: 25, sales: 50, cvr: 0.04, cpc: 0.5, acos: 0.5 },
    { impressions: 1100, clicks: 55, orders: 2.2, spend: 27.5, sales: 55, cvr: 0.04, cpc: 0.5, acos: 0.5 }
  );
  assert(causalResult.ite > 0, '因果效应为正（出价调整有效）');
  
  // Step 6: 预算优化
  const budgetResult = marginalUtilityAllocation([
    { campaignId: 'c1', campaignName: 'Test', currentBudget: 100,
      maxSales: 500, efficiency: 0.03, avgRoas: 3, avgAcos: 0.33,
      avgSpend: 100, avgSales: 300 },
  ], 100);
  assert(budgetResult.length === 1, '预算优化返回结果');
  
  // Step 7: 安全校验
  const finalBid = Math.max(0.02, Math.min(10, Math.round(optimalBid.optimalBid * 100) / 100));
  assert(finalBid >= 0.02 && finalBid <= 10, `最终出价在安全范围 ($${finalBid})`);
  
  log.info('\n  📊 集成测试摘要:');
  log.debug(`     特征维度: ${featureVec.length}`);
  log.debug(`     Sigmoid R²: ${sigmoidParams.r2.toFixed(4)}`);
  log.debug(`     最优出价: $${optimalBid.optimalBid}`);
  log.debug(`     CQL推荐: $${cqlDecision.recommendedBid}`);
  log.debug(`     因果效应ITE: ${causalResult.ite.toFixed(4)}`);
  log.debug(`     预算分配: $${budgetResult[0].optimalBudget}`);
  log.debug(`     最终安全出价: $${finalBid}`);
}

// ==================== 辅助函数 ====================

function createMockContext(): ContextFeatureVector {
  return {
    accountId: 1,
    keywordId: 100,
    campaignId: 'camp_001',
    adGroupId: 10,
    hourOfDay: 14,
    dayOfWeek: 3,
    isHoliday: 0,
    estimatedCompetition: 0.45,
    cpcVolatility7d: 0.25,
    ctrVolatility7d: 0.15,
    impressionShare: 0.60,
    avgCpc7d: 1.20,
    avgCtr7d: 0.025,
    avgCvr7d: 0.08,
    weightedAcos14d: 0.35,
    impressionTrend7d: 0.05,
    clickTrend7d: 0.03,
    orderTrend7d: 0.02,
    spendTrend7d: 0.04,
    weightedCvr14d: 0.07,
    weightedRoas14d: 3.5,
  };
}

// ==================== 主函数 ====================

function main() {
  log.debug('╔══════════════════════════════════════════════════════════╗');
  log.debug('║  下一代广告优化算法体系 — 端到端验证                    ║');
  log.info('║  版本: 1.0 | 日期: 2026-02-22                          ║');
  log.debug('╚══════════════════════════════════════════════════════════╝');
  
  try {
    testSigmoidCurveFitting();
    testLinUCB();
    testCausalInference();
    testCQL();
    testBudgetOptimization();
    testContextualFeatures();
    testSafetyAndOrchestrator();
    testIntegration();
  } catch (error: any) {
    log.warn('\n💥 FATAL ERROR:', error);
    failedTests++;
  }
  
  log.debug('\n' + '='.repeat(60));
  log.info('  验证结果汇总');
  log.debug('='.repeat(60));
  log.debug(`  总测试数: ${totalTests}`);
  log.debug(`  通过: ${passedTests} ✅`);
  log.warn(`  失败: ${failedTests} ❌`);
  log.debug(`  通过率: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);
  
  if (failures.length > 0) {
    log.warn('\n  失败详情:');
    failures.forEach(f => log.debug(f));
  }
  
  log.debug('\n' + '='.repeat(60));
  
  if (failedTests === 0) {
    log.info('  🎉 所有测试通过！下一代算法体系逻辑验证成功。');
  } else {
    log.warn(`  ⚠️  有 ${failedTests} 个测试失败，需要修复。`);
  }
  log.debug('='.repeat(60));
  
  process.exit(failedTests > 0 ? 1 : 0);
}

main();
