import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  AreaChart,
  Cell,
  ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Info } from 'lucide-react';

// 类型定义
interface MetricAnalysis {
  metricName: string;
  controlValue: number;
  treatmentValue: number;
  absoluteDifference: number;
  relativeDifference: number;
  pValue: number;
  confidenceInterval: { lower: number; upper: number };
  isSignificant: boolean;
  winner: 'control' | 'treatment' | 'none';
}

interface DailyMetric {
  date: string;
  controlValue: number;
  treatmentValue: number;
}

interface ABTestAnalysisResult {
  metrics: MetricAnalysis[];
  overallWinner: 'control' | 'treatment' | 'none';
  recommendation: string;
  dailyMetrics?: DailyMetric[];
}

interface ABTestChartsProps {
  analysisResults: ABTestAnalysisResult;
  testName?: string;
}

// 颜色配置
const COLORS = {
  control: '#6366f1', // 紫色 - 对照组
  treatment: '#10b981', // 绿色 - 实验组
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#6b7280',
  grid: '#374151',
  text: '#9ca3af',
};

// 格式化数字
const formatNumber = (value: number, metric: string): string => {
  if (metric === 'acos' || metric === 'ctr' || metric === 'conversionRate') {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (metric === 'roas') {
    return value.toFixed(2);
  }
  if (metric === 'spend' || metric === 'revenue' || metric === 'cpc') {
    return `$${value.toFixed(2)}`;
  }
  return value.toFixed(2);
};

// 获取指标中文名称
const getMetricLabel = (metric: string): string => {
  const labels: Record<string, string> = {
    roas: 'ROAS',
    acos: 'ACoS',
    ctr: '点击率',
    conversionRate: '转化率',
    spend: '花费',
    revenue: '销售额',
    clicks: '点击数',
    impressions: '曝光数',
    conversions: '转化数',
    cpc: 'CPC',
  };
  return labels[metric] || metric.toUpperCase();
};

// 指标对比柱状图组件
function MetricComparisonChart({ metrics }: { metrics: MetricAnalysis[] }) {
  const chartData = metrics.map((m) => ({
    name: getMetricLabel(m.metricName),
    metric: m.metricName,
    对照组: m.controlValue,
    实验组: m.treatmentValue,
    变化: m.relativeDifference,
    isSignificant: m.isSignificant,
    winner: m.winner,
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.control }} />
              <span>对照组: {formatNumber(data.对照组, data.metric)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.treatment }} />
              <span>实验组: {formatNumber(data.实验组, data.metric)}</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-border mt-1">
              <span className={data.变化 > 0 ? 'text-green-500' : data.变化 < 0 ? 'text-red-500' : ''}>
                变化: {data.变化 > 0 ? '+' : ''}{data.变化.toFixed(2)}%
              </span>
              {data.isSignificant && (
                <Badge variant="outline" className="text-xs">显著</Badge>
              )}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.3} />
        <XAxis dataKey="name" tick={{ fill: COLORS.text, fontSize: 12 }} />
        <YAxis tick={{ fill: COLORS.text, fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend 
          wrapperStyle={{ paddingTop: 10 }}
          formatter={(value) => <span style={{ color: COLORS.text }}>{value}</span>}
        />
        <Bar dataKey="对照组" fill={COLORS.control} radius={[4, 4, 0, 0]} />
        <Bar dataKey="实验组" fill={COLORS.treatment} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 效果提升百分比图表
function ImprovementChart({ metrics }: { metrics: MetricAnalysis[] }) {
  const chartData = metrics.map((m) => ({
    name: getMetricLabel(m.metricName),
    metric: m.metricName,
    提升: m.relativeDifference,
    isSignificant: m.isSignificant,
    winner: m.winner,
  }));

  const CustomBar = (props: any) => {
    const { x, y, width, height, payload } = props;
    const isPositive = payload.提升 >= 0;
    const color = payload.isSignificant 
      ? (isPositive ? COLORS.positive : COLORS.negative)
      : COLORS.neutral;
    
    return (
      <g>
        <rect
          x={x}
          y={isPositive ? y : y}
          width={width}
          height={Math.abs(height)}
          fill={color}
          rx={4}
          ry={4}
          opacity={payload.isSignificant ? 1 : 0.6}
        />
        {payload.isSignificant && (
          <circle
            cx={x + width / 2}
            cy={isPositive ? y - 8 : y + Math.abs(height) + 8}
            r={4}
            fill={color}
          />
        )}
      </g>
    );
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          <div className="flex items-center gap-2">
            {data.提升 > 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : data.提升 < 0 ? (
              <TrendingDown className="h-4 w-4 text-red-500" />
            ) : (
              <Minus className="h-4 w-4 text-gray-500" />
            )}
            <span className={data.提升 > 0 ? 'text-green-500' : data.提升 < 0 ? 'text-red-500' : ''}>
              {data.提升 > 0 ? '+' : ''}{data.提升.toFixed(2)}%
            </span>
            {data.isSignificant && (
              <Badge variant="outline" className="text-xs">统计显著</Badge>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.3} />
        <XAxis dataKey="name" tick={{ fill: COLORS.text, fontSize: 12 }} />
        <YAxis 
          tick={{ fill: COLORS.text, fontSize: 12 }} 
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke={COLORS.text} strokeDasharray="3 3" />
        <Bar dataKey="提升" shape={<CustomBar />} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 置信区间可视化
function ConfidenceIntervalChart({ metrics }: { metrics: MetricAnalysis[] }) {
  const chartData = metrics.map((m) => ({
    name: getMetricLabel(m.metricName),
    metric: m.metricName,
    差异: m.relativeDifference,
    下限: m.confidenceInterval.lower,
    上限: m.confidenceInterval.upper,
    isSignificant: m.isSignificant,
    pValue: m.pValue,
  }));

  return (
    <div className="space-y-4">
      {chartData.map((item, index) => {
        const range = item.上限 - item.下限;
        const center = (item.上限 + item.下限) / 2;
        const minVal = Math.min(item.下限, -20);
        const maxVal = Math.max(item.上限, 20);
        const totalRange = maxVal - minVal;
        
        // 计算位置百分比
        const lowerPos = ((item.下限 - minVal) / totalRange) * 100;
        const upperPos = ((item.上限 - minVal) / totalRange) * 100;
        const centerPos = ((item.差异 - minVal) / totalRange) * 100;
        const zeroPos = ((0 - minVal) / totalRange) * 100;
        
        const isPositive = item.下限 > 0;
        const isNegative = item.上限 < 0;
        const color = item.isSignificant 
          ? (isPositive ? COLORS.positive : isNegative ? COLORS.negative : COLORS.neutral)
          : COLORS.neutral;

        return (
          <div key={item.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{item.name}</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : ''}`}>
                  {item.差异 > 0 ? '+' : ''}{item.差异.toFixed(2)}%
                </span>
                {item.isSignificant ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-gray-500" />
                )}
              </div>
            </div>
            <div className="relative h-8 bg-accent rounded-lg overflow-hidden">
              {/* 零线 */}
              <div 
                className="absolute top-0 bottom-0 w-px bg-white/50"
                style={{ left: `${zeroPos}%` }}
              />
              {/* 置信区间 */}
              <div 
                className="absolute top-2 bottom-2 rounded"
                style={{ 
                  left: `${lowerPos}%`, 
                  width: `${upperPos - lowerPos}%`,
                  backgroundColor: color,
                  opacity: 0.3
                }}
              />
              {/* 中心点 */}
              <div 
                className="absolute top-1 bottom-1 w-1 rounded"
                style={{ 
                  left: `${centerPos}%`,
                  backgroundColor: color
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>95%置信区间: [{item.下限.toFixed(2)}%, {item.上限.toFixed(2)}%]</span>
              <span>p值: {item.pValue.toFixed(4)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 趋势对比折线图
function TrendComparisonChart({ 
  dailyMetrics, 
  selectedMetric 
}: { 
  dailyMetrics: DailyMetric[]; 
  selectedMetric: string;
}) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          <div className="space-y-1 text-sm">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded" 
                  style={{ backgroundColor: entry.color }} 
                />
                <span>{entry.name}: {formatNumber(entry.value, selectedMetric)}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={dailyMetrics} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.3} />
        <XAxis 
          dataKey="date" 
          tick={{ fill: COLORS.text, fontSize: 12 }}
          tickFormatter={(value) => {
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          }}
        />
        <YAxis tick={{ fill: COLORS.text, fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend 
          wrapperStyle={{ paddingTop: 10 }}
          formatter={(value) => <span style={{ color: COLORS.text }}>{value}</span>}
        />
        <Line 
          type="monotone" 
          dataKey="controlValue" 
          name="对照组"
          stroke={COLORS.control} 
          strokeWidth={2}
          dot={{ fill: COLORS.control, strokeWidth: 2 }}
          activeDot={{ r: 6 }}
        />
        <Line 
          type="monotone" 
          dataKey="treatmentValue" 
          name="实验组"
          stroke={COLORS.treatment} 
          strokeWidth={2}
          dot={{ fill: COLORS.treatment, strokeWidth: 2 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 累计效果面积图
function CumulativeEffectChart({ dailyMetrics }: { dailyMetrics: DailyMetric[] }) {
  // 计算累计差异
  const cumulativeData = dailyMetrics.map((item, index) => {
    const prevItems = dailyMetrics.slice(0, index + 1);
    const cumulativeControl = prevItems.reduce((sum, i) => sum + i.controlValue, 0);
    const cumulativeTreatment = prevItems.reduce((sum, i) => sum + i.treatmentValue, 0);
    const difference = cumulativeTreatment - cumulativeControl;
    
    return {
      date: item.date,
      累计差异: difference,
      对照组累计: cumulativeControl,
      实验组累计: cumulativeTreatment,
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          <div className="space-y-1 text-sm">
            <div>对照组累计: {data.对照组累计.toFixed(2)}</div>
            <div>实验组累计: {data.实验组累计.toFixed(2)}</div>
            <div className={`font-medium ${data.累计差异 > 0 ? 'text-green-500' : 'text-red-500'}`}>
              累计差异: {data.累计差异 > 0 ? '+' : ''}{data.累计差异.toFixed(2)}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={cumulativeData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.3} />
        <XAxis 
          dataKey="date" 
          tick={{ fill: COLORS.text, fontSize: 12 }}
          tickFormatter={(value) => {
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          }}
        />
        <YAxis tick={{ fill: COLORS.text, fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend 
          wrapperStyle={{ paddingTop: 10 }}
          formatter={(value) => <span style={{ color: COLORS.text }}>{value}</span>}
        />
        <ReferenceLine y={0} stroke={COLORS.text} strokeDasharray="3 3" />
        <Area 
          type="monotone" 
          dataKey="累计差异" 
          stroke={COLORS.treatment}
          fill={COLORS.treatment}
          fillOpacity={0.3}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// 统计摘要卡片
function StatisticsSummary({ metrics }: { metrics: MetricAnalysis[] }) {
  const significantCount = metrics.filter(m => m.isSignificant).length;
  const positiveCount = metrics.filter(m => m.relativeDifference > 0).length;
  const avgImprovement = metrics.reduce((sum, m) => sum + m.relativeDifference, 0) / metrics.length;
  const minPValue = Math.min(...metrics.map(m => m.pValue));

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="p-4 rounded-lg bg-accent">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">显著指标</span>
        </div>
        <p className="text-2xl font-bold">{significantCount}/{metrics.length}</p>
      </div>
      <div className="p-4 rounded-lg bg-accent">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">正向指标</span>
        </div>
        <p className="text-2xl font-bold">{positiveCount}/{metrics.length}</p>
      </div>
      <div className="p-4 rounded-lg bg-accent">
        <div className="flex items-center gap-2 mb-1">
          <Info className="h-4 w-4 text-blue-500" />
          <span className="text-sm text-muted-foreground">平均提升</span>
        </div>
        <p className={`text-2xl font-bold ${avgImprovement > 0 ? 'text-green-500' : avgImprovement < 0 ? 'text-red-500' : ''}`}>
          {avgImprovement > 0 ? '+' : ''}{avgImprovement.toFixed(2)}%
        </p>
      </div>
      <div className="p-4 rounded-lg bg-accent">
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-muted-foreground">最小p值</span>
        </div>
        <p className="text-2xl font-bold">{minPValue.toFixed(4)}</p>
      </div>
    </div>
  );
}

// 主组件
export default function ABTestCharts({ analysisResults, testName }: ABTestChartsProps) {
  const [selectedMetric, setSelectedMetric] = useState<string>('roas');
  
  // 生成模拟的每日数据（如果没有提供）
  const dailyMetrics = useMemo(() => {
    if (analysisResults.dailyMetrics && analysisResults.dailyMetrics.length > 0) {
      return analysisResults.dailyMetrics;
    }
    
    // 生成14天的模拟数据
    const days = 14;
    const data: DailyMetric[] = [];
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - days);
    
    for (let i = 0; i < days; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      
      // 基于实际分析结果生成模拟趋势
      const metric = analysisResults.metrics.find(m => m.metricName === selectedMetric);
      const baseControl = metric?.controlValue || 1;
      const baseTreatment = metric?.treatmentValue || 1;
      
      // 添加一些随机波动
      const controlVariation = (Math.random() - 0.5) * 0.2;
      const treatmentVariation = (Math.random() - 0.5) * 0.2;
      
      data.push({
        date: date.toISOString().split('T')[0],
        controlValue: baseControl * (1 + controlVariation),
        treatmentValue: baseTreatment * (1 + treatmentVariation),
      });
    }
    
    return data;
  }, [analysisResults, selectedMetric]);

  return (
    <div className="space-y-6">
      {/* 统计摘要 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">测试统计摘要</CardTitle>
          <CardDescription>
            {testName ? `${testName} - ` : ''}A/B测试关键统计指标概览
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatisticsSummary metrics={analysisResults.metrics} />
        </CardContent>
      </Card>

      {/* 图表标签页 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">效果对比图表</CardTitle>
          <CardDescription>多维度可视化展示测试结果</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="comparison" className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="comparison">指标对比</TabsTrigger>
              <TabsTrigger value="improvement">效果提升</TabsTrigger>
              <TabsTrigger value="confidence">置信区间</TabsTrigger>
              <TabsTrigger value="trend">趋势分析</TabsTrigger>
            </TabsList>

            <TabsContent value="comparison">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  对照组与实验组各指标数值对比，直观展示两组差异
                </p>
                <MetricComparisonChart metrics={analysisResults.metrics} />
              </div>
            </TabsContent>

            <TabsContent value="improvement">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  实验组相对于对照组的效果提升百分比，绿色表示正向提升，红色表示下降
                </p>
                <ImprovementChart metrics={analysisResults.metrics} />
              </div>
            </TabsContent>

            <TabsContent value="confidence">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  95%置信区间可视化，当区间不包含0时表示结果具有统计显著性
                </p>
                <ConfidenceIntervalChart metrics={analysisResults.metrics} />
              </div>
            </TabsContent>

            <TabsContent value="trend">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    测试期间每日指标变化趋势对比
                  </p>
                  <Select value={selectedMetric} onValueChange={setSelectedMetric}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {analysisResults.metrics.map((m) => (
                        <SelectItem key={m.metricName} value={m.metricName}>
                          {getMetricLabel(m.metricName)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <TrendComparisonChart dailyMetrics={dailyMetrics} selectedMetric={selectedMetric} />
                
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-4">累计效果差异</p>
                  <CumulativeEffectChart dailyMetrics={dailyMetrics} />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 详细指标表格 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">详细指标数据</CardTitle>
          <CardDescription>各指标的完整统计数据</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4">指标</th>
                  <th className="text-right py-3 px-4">对照组</th>
                  <th className="text-right py-3 px-4">实验组</th>
                  <th className="text-right py-3 px-4">变化</th>
                  <th className="text-right py-3 px-4">置信区间</th>
                  <th className="text-right py-3 px-4">p值</th>
                  <th className="text-center py-3 px-4">显著性</th>
                </tr>
              </thead>
              <tbody>
                {analysisResults.metrics.map((metric) => (
                  <tr key={metric.metricName} className="border-b hover:bg-accent/50">
                    <td className="py-3 px-4 font-medium">{getMetricLabel(metric.metricName)}</td>
                    <td className="text-right py-3 px-4">{formatNumber(metric.controlValue, metric.metricName)}</td>
                    <td className="text-right py-3 px-4">{formatNumber(metric.treatmentValue, metric.metricName)}</td>
                    <td className={`text-right py-3 px-4 ${metric.relativeDifference > 0 ? 'text-green-500' : metric.relativeDifference < 0 ? 'text-red-500' : ''}`}>
                      {metric.relativeDifference > 0 ? '+' : ''}{metric.relativeDifference.toFixed(2)}%
                    </td>
                    <td className="text-right py-3 px-4 text-muted-foreground">
                      [{metric.confidenceInterval.lower.toFixed(2)}%, {metric.confidenceInterval.upper.toFixed(2)}%]
                    </td>
                    <td className="text-right py-3 px-4">{metric.pValue.toFixed(4)}</td>
                    <td className="text-center py-3 px-4">
                      {metric.isSignificant ? (
                        <Badge variant="default" className="bg-green-500">显著</Badge>
                      ) : (
                        <Badge variant="secondary">不显著</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
