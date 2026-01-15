import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Activity, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { client } from '@/lib/trpc';

interface OptimizationAction {
  id: number;
  campaignId: number;
  campaignName: string;
  actionType: 'bid_adjustment' | 'budget_adjustment' | 'keyword_pause' | 'keyword_enable' | 'negative_keyword_add';
  actionDescription: string;
  previousValue?: string;
  newValue?: string;
  expectedImpact: 'increase' | 'decrease' | 'neutral';
  expectedImpactPercent: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: {
    actualImpactPercent: number;
    metricsChanged: Record<string, number>;
  };
}

interface OptimizationMetrics {
  totalActionsToday: number;
  completedActions: number;
  failedActions: number;
  pendingActions: number;
  totalROIImprovement: number;
  totalCostSavings: number;
  averageActionDuration: number;
  successRate: number;
}

interface OptimizationTrend {
  date: string;
  actions: number;
  roiImprovement: number;
  costSavings: number;
}

export default function AutoOptimizationDashboard() {
  // 获取优化指标
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['optimization-metrics'],
    queryFn: async () => {
      const response = await client.optimization.getMetrics.query();
      return response as OptimizationMetrics;
    },
    refetchInterval: 30000, // 每30秒刷新一次
  });

  // 获取最近的优化动作
  const { data: recentActions, isLoading: actionsLoading } = useQuery({
    queryKey: ['recent-optimization-actions'],
    queryFn: async () => {
      const response = await client.optimization.getRecentActions.query({ limit: 10 });
      return response as OptimizationAction[];
    },
    refetchInterval: 30000,
  });

  // 获取优化趋势
  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['optimization-trends'],
    queryFn: async () => {
      const response = await client.optimization.getTrends.query({ days: 7 });
      return response as OptimizationTrend[];
    },
  });

  const getActionTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      bid_adjustment: '出价调整',
      budget_adjustment: '预算调整',
      keyword_pause: '暂停关键词',
      keyword_enable: '启用关键词',
      negative_keyword_add: '添加否定词',
    };
    return labels[type] || type;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">已完成</Badge>;
      case 'executing':
        return <Badge className="bg-blue-100 text-blue-800">执行中</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">待执行</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">失败</Badge>;
      default:
        return <Badge>未知</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'executing':
        return <Activity className="w-5 h-5 text-blue-600 animate-pulse" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const isLoading = metricsLoading || actionsLoading || trendsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">加载优化仪表板中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">广告活动自动优化仪表板</h1>
        <p className="text-gray-600 mt-2">实时监控系统自动执行的优化动作和效果</p>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">今日优化动作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.totalActionsToday || 0}</div>
            <p className="text-xs text-gray-600 mt-1">
              成功: {metrics?.completedActions || 0} | 失败: {metrics?.failedActions || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">ROI提升</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <div className="text-2xl font-bold text-green-600">
                {metrics?.totalROIImprovement.toFixed(1) || 0}%
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1">相比优化前</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">成本节省</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-blue-600" />
              <div className="text-2xl font-bold text-blue-600">
                ¥{(metrics?.totalCostSavings || 0).toLocaleString('zh-CN')}
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1">总计节省</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">成功率</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.successRate.toFixed(1) || 0}%
            </div>
            <p className="text-xs text-gray-600 mt-1">平均执行成功率</p>
          </CardContent>
        </Card>
      </div>

      {/* 优化趋势图表 */}
      {trends && trends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>优化趋势（近7天）</CardTitle>
            <CardDescription>显示每日优化动作数量和效果</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="actions"
                  stroke="#3b82f6"
                  name="优化动作数"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="roiImprovement"
                  stroke="#10b981"
                  name="ROI提升(%)"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 最近的优化动作 */}
      <Card>
        <CardHeader>
          <CardTitle>最近的优化动作</CardTitle>
          <CardDescription>显示系统最近执行的优化动作和结果</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActions && recentActions.length > 0 ? (
              recentActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 transition"
                >
                  <div className="flex items-start gap-4 flex-1">
                    {getStatusIcon(action.status)}
                    <div className="flex-1">
                      <div className="font-semibold">{action.campaignName}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {getActionTypeLabel(action.actionType)}: {action.actionDescription}
                      </div>
                      {action.previousValue && action.newValue && (
                        <div className="text-sm text-gray-500 mt-1">
                          {action.previousValue} → {action.newValue}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(action.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {action.expectedImpactPercent > 0 ? '+' : ''}
                        {action.expectedImpactPercent}%
                      </div>
                      <div className="text-xs text-gray-600">预期效果</div>
                      {action.result && (
                        <div className="text-xs text-gray-600 mt-1">
                          实际: {action.result.actualImpactPercent > 0 ? '+' : ''}
                          {action.result.actualImpactPercent}%
                        </div>
                      )}
                    </div>
                    {getStatusBadge(action.status)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-600">
                <p>暂无优化动作记录</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 优化建议 */}
      <Card>
        <CardHeader>
          <CardTitle>系统建议</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics && metrics.pendingActions > 0 && (
              <Alert>
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  有{metrics.pendingActions}个待执行的优化动作，系统将在下一个执行周期自动处理
                </AlertDescription>
              </Alert>
            )}
            {metrics && metrics.failedActions > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  有{metrics.failedActions}个优化动作执行失败，请检查相关账号的API授权状态
                </AlertDescription>
              </Alert>
            )}
            {metrics && metrics.successRate < 80 && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  成功率低于80%，建议检查系统配置和API连接状态
                </AlertDescription>
              </Alert>
            )}
            {metrics && metrics.successRate >= 80 && metrics.failedActions === 0 && (
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  系统运行正常，优化效果显著，继续保持当前配置
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
