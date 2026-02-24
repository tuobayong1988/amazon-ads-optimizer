/**
 * OptimizationVisualizer - 优化决策可视化组件
 * 
 * 可视化展示优化决策的依据和预期效果
 * 包括: 出价-ACoS-利润曲线、预算-曝光-销量曲线等
 */

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceDot } from "recharts";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target } from "lucide-react";

interface OptimizationVisualizerProps {
  type: 'bid-optimization' | 'budget-optimization';
  currentValue: number;
  suggestedValue: number;
  data: {
    value: number;
    acos?: number;
    sales?: number;
    profit?: number;
    impressions?: number;
    clicks?: number;
  }[];
  metric: string; // 'ACoS' | 'Sales' | 'Profit' | 'Impressions'
}

export function OptimizationVisualizer({ type, currentValue, suggestedValue, data, metric }: OptimizationVisualizerProps) {
  const chartData = useMemo(() => {
    return data.map(d => ({
      ...d,
      isCurrent: d.value === currentValue,
      isSuggested: d.value === suggestedValue,
    }));
  }, [data, currentValue, suggestedValue]);

  const currentPoint = data.find(d => d.value === currentValue);
  const suggestedPoint = data.find(d => d.value === suggestedValue);

  const improvement = useMemo(() => {
    if (!currentPoint || !suggestedPoint) return null;

    const metricKey = metric.toLowerCase() as keyof typeof currentPoint;
    const currentMetric = currentPoint[metricKey] as number || 0;
    const suggestedMetric = suggestedPoint[metricKey] as number || 0;
    const change = suggestedMetric - currentMetric;
    const changePercent = currentMetric !== 0 ? (change / currentMetric) * 100 : 0;

    return {
      current: currentMetric,
      suggested: suggestedMetric,
      change,
      changePercent,
      isPositive: change > 0,
    };
  }, [currentPoint, suggestedPoint, metric]);

  const getMetricColor = (metric: string) => {
    switch (metric) {
      case 'ACoS':
        return '#ef4444'; // red
      case 'Sales':
        return '#10b981'; // green
      case 'Profit':
        return '#3b82f6'; // blue
      case 'Impressions':
        return '#f59e0b'; // amber
      default:
        return '#6b7280'; // gray
    }
  };

  const formatValue = (value: number, metric: string) => {
    switch (metric) {
      case 'ACoS':
        return `${value.toFixed(1)}%`;
      case 'Sales':
      case 'Profit':
        return `$${value.toFixed(0)}`;
      case 'Impressions':
      case 'Clicks':
        return value.toFixed(0);
      default:
        return value.toFixed(2);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            {type === 'bid-optimization' ? '出价优化分析' : '预算优化分析'}
          </span>
          {improvement && (
            <Badge variant={improvement.isPositive ? 'default' : 'destructive'}>
              {improvement.isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {improvement.changePercent > 0 ? '+' : ''}
              {improvement.changePercent.toFixed(1)}%
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          基于历史数据预测不同{type === 'bid-optimization' ? '出价' : '预算'}下的{metric}表现
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* 当前值 vs 建议值 */}
          {improvement && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">当前{metric}</p>
                <p className="text-2xl font-bold">{formatValue(improvement.current, metric)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">预期{metric}</p>
                <p className="text-2xl font-bold text-primary">{formatValue(improvement.suggested, metric)}</p>
              </div>
            </div>
          )}

          {/* 曲线图 */}
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={getMetricColor(metric)} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={getMetricColor(metric)} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="value" 
                label={{ value: type === 'bid-optimization' ? '出价 ($)' : '预算 ($)', position: 'insideBottom', offset: -5 }}
              />
              <YAxis 
                label={{ value: metric, angle: -90, position: 'insideLeft' }}
              />
              <Tooltip 
                formatter={((value: number) => formatValue(value, metric)) as any}
                labelFormatter={(label) => `${type === 'bid-optimization' ? '出价' : '预算'}: $${label}`}
              />
              <Legend />
              
              {/* 当前值参考线 */}
              <ReferenceLine 
                x={currentValue} 
                stroke="#6b7280" 
                strokeDasharray="3 3" 
                label={{ value: '当前', position: 'top' }}
              />
              
              {/* 建议值参考线 */}
              <ReferenceLine 
                x={suggestedValue} 
                stroke="#3b82f6" 
                strokeDasharray="3 3" 
                label={{ value: '建议', position: 'top' }}
              />
              
              {/* 数据区域 */}
              <Area 
                type="monotone" 
                dataKey={metric.toLowerCase()} 
                stroke={getMetricColor(metric)} 
                fillOpacity={1} 
                fill="url(#colorMetric)" 
                name={metric}
              />
              
              {/* 当前点标记 */}
              {currentPoint && (
                <ReferenceDot 
                  x={currentValue} 
                  y={currentPoint[metric.toLowerCase() as keyof typeof currentPoint] as number} 
                  r={6} 
                  fill="#6b7280" 
                  stroke="white" 
                  strokeWidth={2}
                />
              )}
              
              {/* 建议点标记 */}
              {suggestedPoint && (
                <ReferenceDot 
                  x={suggestedValue} 
                  y={suggestedPoint[metric.toLowerCase() as keyof typeof suggestedPoint] as number} 
                  r={6} 
                  fill="#3b82f6" 
                  stroke="white" 
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>

          {/* 说明文字 */}
          <div className="text-sm text-muted-foreground space-y-1">
            <p>• 灰色虚线表示当前{type === 'bid-optimization' ? '出价' : '预算'}</p>
            <p>• 蓝色虚线表示建议的{type === 'bid-optimization' ? '出价' : '预算'}</p>
            <p>• 曲线显示了不同{type === 'bid-optimization' ? '出价' : '预算'}下的预期{metric}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * @deprecated v187: 此函数生成模拟数据，不应在生产环境中使用
 * 未来应基于真实历史数据和弹性系数模型生成预测曲线
 * 当前无外部调用，保留作为参考
 */
export function generateOptimizationData(
  type: 'bid' | 'budget',
  currentValue: number,
  range: [number, number],
  points: number = 20
): {
  value: number;
  acos: number;
  sales: number;
  profit: number;
  impressions: number;
  clicks: number;
}[] {
  const [min, max] = range;
  const step = (max - min) / (points - 1);
  const data = [];

  for (let i = 0; i < points; i++) {
    const value = min + step * i;
    const ratio = value / currentValue;

    // 简化的模拟模型
    // 实际应该使用机器学习模型预测
    const impressions = Math.floor(10000 * Math.pow(ratio, 0.8));
    const clicks = Math.floor(impressions * 0.01 * (1 + Math.random() * 0.2));
    const orders = Math.floor(clicks * 0.1 * (1 - Math.abs(ratio - 1) * 0.2));
    const sales = orders * 50; // 假设客单价$50
    const spend = type === 'bid' ? clicks * value : value;
    const acos = sales > 0 ? (spend / sales) * 100 : 100;
    const profit = sales * 0.3 - spend; // 假设30%利润率

    data.push({
      value: parseFloat(value.toFixed(2)),
      acos: parseFloat(acos.toFixed(1)),
      sales: parseFloat(sales.toFixed(0)),
      profit: parseFloat(profit.toFixed(0)),
      impressions,
      clicks,
    });
  }

  return data;
}
