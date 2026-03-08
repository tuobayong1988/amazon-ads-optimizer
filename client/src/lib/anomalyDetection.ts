/**
 * 异常检测工具函数
 * 使用统计方法检测数据中的异常点
 */

export interface DataPoint {
  date: string;
  value: number;
}

export interface Anomaly {
  date: string;
  value: number;
  expected: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high';
  type: 'spike' | 'drop' | 'outlier';
}

/**
 * 计算Z-Score(标准分数)
 * Z-score = (x - mean) / std
 */
export function calculateZScores(data: DataPoint[]): Array<{ date: string; value: number; zScore: number }> {
  if (data.length < 2) return [];

  const values = data.map(d => d.value);
  const mean = values.reduce((sum: any, v: any) => sum + v, 0) / values.length;
  const variance = values.reduce((sum: any, v: any) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);

  if (std === 0) {
    return data.map(d => ({ date: d.date, value: d.value, zScore: 0 }));
  }

  return data.map(d => ({
    date: d.date,
    value: d.value,
    zScore: (d.value - mean) / std
  }));
}

/**
 * 使用Z-Score方法检测异常
 * 阈值: |z| > 2 (中度异常), |z| > 3 (严重异常)
 */
export function detectAnomaliesZScore(
  data: DataPoint[],
  threshold: number = 2.5
): Anomaly[] {
  const zScores = calculateZScores(data);
  const mean = data.reduce((sum: any, d: any) => sum + d.value, 0) / data.length;

  return zScores
    .filter(d => Math.abs(d.zScore) > threshold)
    .map(d => ({
      date: d.date,
      value: d.value,
      expected: mean,
      deviation: Math.abs(d.value - mean),
      severity: Math.abs(d.zScore) > 3 ? 'high' : Math.abs(d.zScore) > 2 ? 'medium' : 'low',
      type: d.value > mean ? 'spike' : 'drop'
    }));
}

/**
 * 使用IQR(四分位距)方法检测异常
 * 异常定义: 值 < Q1 - 1.5*IQR 或 值 > Q3 + 1.5*IQR
 */
export function detectAnomaliesIQR(data: DataPoint[]): Anomaly[] {
  if (data.length < 4) return [];

  const values = data.map(d => d.value).sort((a: any, b: any) => a - b);
  const q1Index = Math.floor(values.length * 0.25);
  const q3Index = Math.floor(values.length * 0.75);
  const q1 = values[q1Index];
  const q3 = values[q3Index];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const median = values[Math.floor(values.length / 2)];

  return data
    .filter(d => d.value < lowerBound || d.value > upperBound)
    .map(d => ({
      date: d.date,
      value: d.value,
      expected: median,
      deviation: Math.abs(d.value - median),
      severity: 
        d.value < q1 - 3 * iqr || d.value > q3 + 3 * iqr ? 'high' :
        d.value < q1 - 2 * iqr || d.value > q3 + 2 * iqr ? 'medium' : 'low',
      type: d.value > upperBound ? 'spike' : 'drop'
    }));
}

/**
 * 使用移动平均检测异常
 * 检测偏离移动平均线的数据点
 */
export function detectAnomaliesMovingAverage(
  data: DataPoint[],
  windowSize: number = 7,
  threshold: number = 2
): Anomaly[] {
  if (data.length < windowSize) return [];

  const anomalies: Anomaly[] = [];

  for (let i = windowSize; i < data.length; i++) {
    // 计算移动平均
    const window = data.slice(i - windowSize, i);
    const ma = window.reduce((sum: any, d: any) => sum + d.value, 0) / windowSize;
    
    // 计算移动标准差
    const variance = window.reduce((sum: any, d: any) => sum + Math.pow(d.value - ma, 2), 0) / windowSize;
    const std = Math.sqrt(variance);

    const current = data[i];
    const deviation = Math.abs(current.value - ma);

    // 检测是否超过阈值
    if (std > 0 && deviation > threshold * std) {
      anomalies.push({
        date: current.date,
        value: current.value,
        expected: ma,
        deviation,
        severity: 
          deviation > 3 * std ? 'high' :
          deviation > 2 * std ? 'medium' : 'low',
        type: current.value > ma ? 'spike' : 'drop'
      });
    }
  }

  return anomalies;
}

/**
 * 检测突变点
 * 检测相邻数据点之间的剧烈变化
 */
export function detectSuddenChanges(
  data: DataPoint[],
  threshold: number = 0.5 // 50%变化
): Anomaly[] {
  if (data.length < 2) return [];

  const anomalies: Anomaly[] = [];

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const current = data[i];
    
    if (prev.value === 0) continue;

    const changeRate = Math.abs((current.value - prev.value) / prev.value);

    if (changeRate > threshold) {
      anomalies.push({
        date: current.date,
        value: current.value,
        expected: prev.value,
        deviation: Math.abs(current.value - prev.value),
        severity: 
          changeRate > 1 ? 'high' :
          changeRate > 0.7 ? 'medium' : 'low',
        type: current.value > prev.value ? 'spike' : 'drop'
      });
    }
  }

  return anomalies;
}

/**
 * 组合异常检测
 * 综合多种方法的结果
 */
export function detectAnomaliesCombined(data: DataPoint[]): Anomaly[] {
  if (data.length < 4) return [];

  // 使用多种方法检测
  const zScoreAnomalies = detectAnomaliesZScore(data, 2.5);
  const iqrAnomalies = detectAnomaliesIQR(data);
  const maAnomalies = detectAnomaliesMovingAverage(data, Math.min(7, Math.floor(data.length / 3)), 2);
  const suddenChanges = detectSuddenChanges(data, 0.5);

  // 合并结果(去重)
  const anomalyMap = new Map<string, Anomaly>();

  const addAnomaly = (anomaly: Anomaly) => {
    const existing = anomalyMap.get(anomaly.date);
    if (!existing) {
      anomalyMap.set(anomaly.date, anomaly);
    } else {
      // 如果同一日期有多个检测结果,保留严重程度最高的
      const severityOrder = { low: 1, medium: 2, high: 3 };
      if (severityOrder[anomaly.severity] > severityOrder[existing.severity]) {
        anomalyMap.set(anomaly.date, anomaly);
      }
    }
  };

  zScoreAnomalies.forEach(addAnomaly);
  iqrAnomalies.forEach(addAnomaly);
  maAnomalies.forEach(addAnomaly);
  suddenChanges.forEach(addAnomaly);

  return Array.from(anomalyMap.values()).sort((a: any, b: any) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
    const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
    return timeA - timeB;
  });
}

/**
 * 生成异常报告
 */
export function generateAnomalyReport(anomalies: Anomaly[]): {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentAnomalies: Anomaly[];
} {
  const byType: Record<string, number> = { spike: 0, drop: 0, outlier: 0 };
  const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 };

  anomalies.forEach(a => {
    byType[a.type] = (byType[a.type] || 0) + 1;
    bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
  });

  // 获取最近的5个异常
  const recentAnomalies = anomalies.slice(-5);

  return {
    total: anomalies.length,
    byType,
    bySeverity,
    recentAnomalies
  };
}

/**
 * 计算异常分数
 * 用于量化数据质量
 */
export function calculateAnomalyScore(data: DataPoint[]): {
  score: number; // 0-100, 100表示无异常
  anomalyRate: number; // 异常点占比
  quality: 'excellent' | 'good' | 'fair' | 'poor';
} {
  if (data.length === 0) {
    return { score: 0, anomalyRate: 0, quality: 'poor' };
  }

  const anomalies = detectAnomaliesCombined(data);
  const anomalyRate = anomalies.length / data.length;
  
  // 计算分数(考虑异常数量和严重程度)
  const severityWeights = { low: 1, medium: 2, high: 3 };
  // @ts-ignore
  const weightedAnomalies = anomalies.reduce((sum: any, a: any) => sum + severityWeights[a.severity], 0);
  const maxPossibleScore = data.length * 3;
  const score = Math.max(0, Math.min(100, 100 - (weightedAnomalies / maxPossibleScore) * 100));

  let quality: 'excellent' | 'good' | 'fair' | 'poor';
  if (score >= 90) quality = 'excellent';
  else if (score >= 75) quality = 'good';
  else if (score >= 50) quality = 'fair';
  else quality = 'poor';

  return {
    score: Math.round(score),
    anomalyRate: Math.round(anomalyRate * 100) / 100,
    quality
  };
}
