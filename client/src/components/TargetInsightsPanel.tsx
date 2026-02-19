/**
 * TargetInsightsPanel - 优化目标分析洞察面板
 * v151: 融合原有的 AdvancedAnalyticsDashboard 和 AnalyticsInsights 的核心功能
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, ComposedChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, Activity,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle,
  Brain, RefreshCw, Minus, Info, Award,
} from "lucide-react";

interface TargetInsightsPanelProps {
  groupId: number;
  accountId: number;
}

const ratingColors: Record<string, string> = {
  excellent: "text-green-600 bg-green-50",
  good: "text-blue-600 bg-blue-50",
  neutral: "text-gray-600 bg-gray-50",
  poor: "text-orange-600 bg-orange-50",
  harmful: "text-red-600 bg-red-50",
};

const ratingLabels: Record<string, string> = {
  excellent: "优秀", good: "良好", neutral: "中性", poor: "较差", harmful: "有害",
};

export function TargetInsightsPanel({ groupId, accountId }: TargetInsightsPanelProps) {
  const [insightTab, setInsightTab] = useState("attribution");
  const [timeRange, setTimeRange] = useState("30");

  // 归因分析 - 返回 { results: AttributionResult[], total, page, pageSize }
  const { data: attribution, isLoading: attributionLoading } = trpc.advancedAnalytics.getAttribution.useQuery(
    { performanceGroupId: groupId, days: parseInt(timeRange), limit: 20, offset: 0 },
    { enabled: true }
  );

  // 趋势分析 - 返回 TrendAnalysis[] (每个metric一个对象)
  const { data: trends, isLoading: trendsLoading } = trpc.advancedAnalytics.getTrendAnalysis.useQuery(
    { accountId, performanceGroupId: groupId, days: parseInt(timeRange) },
    { enabled: insightTab === "trends" }
  );

  // 异常检测 - 返回 AnomalyDetection[]
  const { data: anomalies, isLoading: anomaliesLoading } = trpc.advancedAnalytics.getAnomalies.useQuery(
    { accountId, performanceGroupId: groupId, days: parseInt(timeRange) },
    { enabled: insightTab === "anomalies" }
  );

  // 策略ROI - 返回 StrategyROI[]
  const { data: strategyROI, isLoading: roiLoading } = trpc.advancedAnalytics.getStrategyROI.useQuery(
    { performanceGroupId: groupId, days: parseInt(timeRange), groupBy: "actionType" },
    { enabled: insightTab === "roi" }
  );

  // 汇总统计
  const attributionStats = useMemo(() => {
    if (!attribution?.results) return null;
    const results = attribution.results;
    const total = results.length;
    const excellent = results.filter((r: any) => r.effectRating === 'excellent').length;
    const good = results.filter((r: any) => r.effectRating === 'good').length;
    const poor = results.filter((r: any) => r.effectRating === 'poor' || r.effectRating === 'harmful').length;
    const avgScore = total > 0 ? results.reduce((sum: number, r: any) => sum + (r.effectScore || 0), 0) / total : 0;
    return { total, excellent, good, poor, avgScore };
  }, [attribution]);

  return (
    <div className="space-y-4">
      {/* 时间范围选择 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5" />
          分析洞察
        </h3>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">近7天</SelectItem>
            <SelectItem value="14">近14天</SelectItem>
            <SelectItem value="30">近30天</SelectItem>
            <SelectItem value="60">近60天</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 汇总卡片 */}
      {attributionStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Activity className="w-4 h-4" />
                优化操作数
              </div>
              <p className="text-2xl font-bold">{attributionStats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                有效优化
              </div>
              <p className="text-2xl font-bold text-green-600">{attributionStats.excellent + attributionStats.good}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                待改进
              </div>
              <p className="text-2xl font-bold text-orange-600">{attributionStats.poor}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Award className="w-4 h-4 text-blue-500" />
                平均效果分
              </div>
              <p className="text-2xl font-bold">{attributionStats.avgScore.toFixed(0)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 分析子Tab */}
      <Tabs value={insightTab} onValueChange={setInsightTab}>
        <TabsList>
          <TabsTrigger value="attribution">归因分析</TabsTrigger>
          <TabsTrigger value="trends">趋势分析</TabsTrigger>
          <TabsTrigger value="anomalies">异常检测</TabsTrigger>
          <TabsTrigger value="roi">策略ROI</TabsTrigger>
        </TabsList>

        {/* 归因分析 */}
        <TabsContent value="attribution" className="space-y-4">
          {attributionLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              加载归因分析数据...
            </div>
          ) : attribution?.results?.length ? (
            <div className="space-y-3">
              {attribution.results.map((item: any, idx: number) => (
                <Card key={idx} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {item.eventCategory || item.actionType}
                          </Badge>
                          <Badge className={`text-xs ${ratingColors[item.effectRating] || ''}`}>
                            {ratingLabels[item.effectRating] || item.effectRating}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                        <p className="text-sm font-medium">
                          {item.keywordText || item.campaignName || '未知目标'}
                        </p>
                        {item.previousBid && item.newBid && (
                          <p className="text-xs text-muted-foreground mt-1">
                            出价: ${item.previousBid} → ${item.newBid}
                            {item.bidChangePercent && (
                              <span className={parseFloat(item.bidChangePercent) > 0 ? 'text-red-500' : 'text-green-500'}>
                                {' '}({parseFloat(item.bidChangePercent) > 0 ? '+' : ''}{parseFloat(item.bidChangePercent).toFixed(1)}%)
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <div className="flex items-center gap-1">
                          {item.deltaRoas > 0 ? (
                            <ArrowUpRight className="w-4 h-4 text-green-500" />
                          ) : item.deltaRoas < 0 ? (
                            <ArrowDownRight className="w-4 h-4 text-red-500" />
                          ) : (
                            <Minus className="w-4 h-4 text-gray-400" />
                          )}
                          <span className={`text-sm font-medium ${item.deltaRoas > 0 ? 'text-green-600' : item.deltaRoas < 0 ? 'text-red-600' : ''}`}>
                            ROAS {item.deltaRoas > 0 ? '+' : ''}{item.deltaRoas?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          效果分: {item.effectScore?.toFixed(0) || '0'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Info className="w-8 h-8 mb-2" />
              <p>暂无归因分析数据</p>
              <p className="text-xs">系统需要积累优化操作数据后才能生成归因分析</p>
            </div>
          )}
        </TabsContent>

        {/* 趋势分析 - trends是TrendAnalysis[]，每个元素有metric, dataPoints, movingAverage */}
        <TabsContent value="trends" className="space-y-4">
          {trendsLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              加载趋势分析数据...
            </div>
          ) : trends && trends.length > 0 ? (
            <>
              {/* 趋势概要卡片 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {trends.slice(0, 4).map((trend: any, idx: number) => (
                  <Card key={idx}>
                    <CardContent className="pt-3 pb-2 px-4">
                      <p className="text-xs text-muted-foreground">{trend.metricLabel}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {trend.direction === 'up' ? (
                          <TrendingUp className="w-4 h-4 text-green-500" />
                        ) : trend.direction === 'down' ? (
                          <TrendingDown className="w-4 h-4 text-red-500" />
                        ) : (
                          <Minus className="w-4 h-4 text-gray-400" />
                        )}
                        <span className={`text-sm font-medium ${
                          trend.direction === 'up' ? 'text-green-600' : 
                          trend.direction === 'down' ? 'text-red-600' : ''
                        }`}>
                          {trend.changePercent > 0 ? '+' : ''}{trend.changePercent?.toFixed(1)}%
                        </span>
                        <Badge variant="outline" className="text-xs ml-1">
                          {trend.trendStrength === 'strong' ? '强' : trend.trendStrength === 'moderate' ? '中' : '弱'}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* 趋势图表 */}
              {trends.slice(0, 2).map((trend: any, idx: number) => (
                <Card key={idx}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{trend.metricLabel}趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={trend.dataPoints}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="value" fill="#8884d8" name={trend.metricLabel} opacity={0.6} />
                        {trend.movingAverage?.length > 0 && (
                          <Line
                            data={trend.movingAverage}
                            type="monotone"
                            dataKey="value"
                            stroke="#ff7300"
                            name="移动平均"
                            strokeWidth={2}
                            dot={false}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Info className="w-8 h-8 mb-2" />
              <p>暂无趋势数据</p>
            </div>
          )}
        </TabsContent>

        {/* 异常检测 - anomalies是AnomalyDetection[] */}
        <TabsContent value="anomalies" className="space-y-4">
          {anomaliesLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              加载异常检测数据...
            </div>
          ) : anomalies && anomalies.length > 0 ? (
            <div className="space-y-3">
              {anomalies.map((anomaly: any, idx: number) => (
                <Card key={idx} className={`border-l-4 ${
                  anomaly.severity === 'critical' ? 'border-l-red-500' :
                  anomaly.severity === 'warning' ? 'border-l-orange-500' :
                  'border-l-yellow-500'
                }`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle className={`w-4 h-4 ${
                            anomaly.severity === 'critical' ? 'text-red-500' :
                            anomaly.severity === 'warning' ? 'text-orange-500' :
                            'text-yellow-500'
                          }`} />
                          <span className="text-sm font-medium">{anomaly.metricLabel}</span>
                          <Badge variant="outline" className="text-xs">
                            {anomaly.severity === 'critical' ? '严重' : anomaly.severity === 'warning' ? '警告' : '信息'}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {anomaly.direction === 'spike' ? '飙升' : '骤降'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          实际值: {anomaly.actualValue?.toFixed(2)} / 预期值: {anomaly.expectedValue?.toFixed(2)}
                        </p>
                        {anomaly.possibleCauses?.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            可能原因：{anomaly.possibleCauses[0].description}
                            {anomaly.possibleCauses[0].confidence > 0 && ` (置信度: ${anomaly.possibleCauses[0].confidence}%)`}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{anomaly.date}</p>
                        <p className="text-sm font-medium">
                          偏离 {anomaly.deviationPercent?.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <CheckCircle className="w-8 h-8 mb-2 text-green-500" />
              <p>未检测到异常</p>
              <p className="text-xs">所有指标在正常范围内</p>
            </div>
          )}
        </TabsContent>

        {/* 策略ROI对比 - strategyROI是StrategyROI[] */}
        <TabsContent value="roi" className="space-y-4">
          {roiLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              加载策略ROI数据...
            </div>
          ) : strategyROI && strategyROI.length > 0 ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">各策略类型ROI对比</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={strategyROI}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="strategyName" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="successRate" fill="#82ca9d" name="成功率%" />
                      <Bar dataKey="avgBidChange" fill="#8884d8" name="平均出价变化%" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {strategyROI.map((strategy: any, idx: number) => (
                  <Card key={idx}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{strategy.strategyName}</p>
                          <p className="text-xs text-muted-foreground">
                            执行 {strategy.totalEvents} 次 · 
                            成功 {strategy.successEvents} 次 · 
                            失败 {strategy.failedEvents} 次
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            成功率: {strategy.successRate?.toFixed(0)}%
                          </p>
                          {strategy.roi7D !== null && (
                            <p className="text-xs text-muted-foreground">
                              7日ROI: {strategy.roi7D?.toFixed(1)}%
                            </p>
                          )}
                        </div>
                      </div>
                      <Progress 
                        value={strategy.successRate || 0} 
                        className="mt-2 h-2" 
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Info className="w-8 h-8 mb-2" />
              <p>暂无策略ROI数据</p>
              <p className="text-xs">系统需要积累优化操作数据后才能生成ROI分析</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
