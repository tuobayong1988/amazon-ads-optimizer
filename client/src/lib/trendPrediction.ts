/**
 * 趋势预测工具函数
 * 使用线性回归和移动平均进行简单的趋势预测
 */

export interface DataPoint {
  date: string;
  value: number;
}

export interface PredictionResult {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

/**
 * 线性回归预测
 * 使用最小二乘法拟合直线
 */
export function linearRegression(data: DataPoint[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = data.length;
  if (n < 2) {
    return { slope: 0, intercept: 0, r2: 0 };
  }

  // 将日期转换为数值(天数)
  const firstDate = new Date(data[0].date);
  const points = data.map(d => ({
    x: Math.floor((new Date(d.date).getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)),
    y: d.value
  }));

  // 计算均值
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  // 计算斜率和截距
  const numerator = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  const denominator = points.reduce((sum, p) => sum + Math.pow(p.x - meanX, 2), 0);
  
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  // 计算R²(决定系数)
  const predictions = points.map(p => slope * p.x + intercept);
  const ssRes = points.reduce((sum, p, i) => sum + Math.pow(p.y - predictions[i], 2), 0);
  const ssTot = points.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2 };
}

/**
 * 预测未来N天的值
 */
export function predictFutureDays(
  data: DataPoint[],
  days: number
): PredictionResult[] {
  if (data.length < 2) {
    return [];
  }

  const { slope, intercept, r2 } = linearRegression(data);
  
  // 计算标准误差用于置信区间
  const firstDate = new Date(data[0].date);
  const points = data.map(d => ({
    x: Math.floor((new Date(d.date).getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)),
    y: d.value
  }));
  
  const predictions = points.map(p => slope * p.x + intercept);
  const residuals = points.map((p, i) => p.y - predictions[i]);
  const standardError = Math.sqrt(
    residuals.reduce((sum, r) => sum + r * r, 0) / (data.length - 2)
  );

  // 生成预测结果
  const lastDate = new Date(data[data.length - 1].date);
  const lastX = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const results: PredictionResult[] = [];
  
  for (let i = 1; i <= days; i++) {
    const futureDate = new Date(lastDate);
    futureDate.setDate(futureDate.getDate() + i);
    
    const x = lastX + i;
    const predicted = slope * x + intercept;
    
    // 95%置信区间 (约1.96个标准误差)
    const margin = 1.96 * standardError * Math.sqrt(1 + 1/data.length + Math.pow(x - points.reduce((sum, p) => sum + p.x, 0) / data.length, 2) / points.reduce((sum, p) => sum + Math.pow(p.x, 2), 0));
    
    results.push({
      date: futureDate.toISOString().split('T')[0],
      predicted: Math.max(0, predicted), // 确保预测值非负
      confidence: {
        lower: Math.max(0, predicted - margin),
        upper: predicted + margin
      }
    });
  }

  return results;
}

/**
 * 移动平均预测
 * 使用指数移动平均(EMA)进行预测
 */
export function exponentialMovingAverage(
  data: DataPoint[],
  alpha: number = 0.3
): number[] {
  if (data.length === 0) return [];
  
  const ema: number[] = [data[0].value];
  
  for (let i = 1; i < data.length; i++) {
    ema.push(alpha * data[i].value + (1 - alpha) * ema[i - 1]);
  }
  
  return ema;
}

/**
 * 预测趋势方向
 */
export function predictTrend(data: DataPoint[]): {
  direction: 'up' | 'down' | 'stable';
  strength: number; // 0-1,表示趋势强度
  confidence: number; // 0-1,基于R²
} {
  if (data.length < 3) {
    return { direction: 'stable', strength: 0, confidence: 0 };
  }

  const { slope, r2 } = linearRegression(data);
  
  // 计算平均值用于归一化斜率
  const avgValue = data.reduce((sum, d) => sum + d.value, 0) / data.length;
  const normalizedSlope = avgValue === 0 ? 0 : slope / avgValue;
  
  // 判断趋势方向
  let direction: 'up' | 'down' | 'stable';
  if (Math.abs(normalizedSlope) < 0.01) {
    direction = 'stable';
  } else if (normalizedSlope > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }
  
  // 趋势强度(归一化的斜率绝对值)
  const strength = Math.min(1, Math.abs(normalizedSlope) * 10);
  
  return {
    direction,
    strength,
    confidence: Math.max(0, r2) // R²作为置信度
  };
}

/**
 * 季节性分解
 * 简单的周期性检测
 */
export function detectSeasonality(data: DataPoint[], period: number = 7): {
  hasSeasonality: boolean;
  strength: number;
} {
  if (data.length < period * 2) {
    return { hasSeasonality: false, strength: 0 };
  }

  // 计算自相关系数
  const values = data.map(d => d.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < values.length - period; i++) {
    numerator += (values[i] - mean) * (values[i + period] - mean);
  }
  
  for (let i = 0; i < values.length; i++) {
    denominator += Math.pow(values[i] - mean, 2);
  }
  
  const autocorrelation = denominator === 0 ? 0 : numerator / denominator;
  
  return {
    hasSeasonality: autocorrelation > 0.3,
    strength: Math.max(0, Math.min(1, autocorrelation))
  };
}

/**
 * 组合预测
 * 结合线性回归和移动平均的预测结果
 */
export function combinedPrediction(
  data: DataPoint[],
  days: number
): PredictionResult[] {
  if (data.length < 2) {
    return [];
  }

  // 线性回归预测
  const linearPred = predictFutureDays(data, days);
  
  // EMA预测
  const ema = exponentialMovingAverage(data);
  const lastEMA = ema[ema.length - 1];
  const { slope } = linearRegression(data);
  
  // 组合预测(70%线性回归 + 30%EMA)
  return linearPred.map((pred, i) => {
    const emaPred = lastEMA + slope * (i + 1);
    const combined = pred.predicted * 0.7 + emaPred * 0.3;
    
    return {
      date: pred.date,
      predicted: Math.max(0, combined),
      confidence: {
        lower: Math.max(0, pred.confidence.lower * 0.7 + (emaPred - pred.predicted * 0.3) * 0.3),
        upper: pred.confidence.upper * 0.7 + (emaPred + pred.predicted * 0.3) * 0.3
      }
    };
  });
}
