import { useState, useEffect, useMemo, useCallback} from "react";
import DashboardLayout from "@/components/DashboardLayout";
// v399: removed old AccountSwitcher import
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Bell,
  BarChart3,
  Target,
  Zap,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Cpu,
  HardDrive,
  Database,
  Server
} from "lucide-react";
import { toast } from "sonner";

import { useGlobalAccountId } from "@/hooks/useGlobalAccountId";
export default function HealthMonitor() {
  // v399: 使用全局店铺选择器
  const { accountId: _globalAccountId, accounts, isLoading: _accountsLoading } = useGlobalAccountId();
  const selectedAccountId = _globalAccountId || 1;
  const [activeTab, setActiveTab] = useState("overview");

  // 获取广告账号列表
  const accountsQuery = { data: accounts };

  // v399: 全局选择器自动处理账户切换
  
  // 获取健康度分析
  const resourcesQuery = trpc.monitoring.getSystemResources.useQuery(undefined, {
    refetchInterval: 30000, // 30秒自动刷新
  }) as unknown;

  const healthQuery = trpc.adAutomation.analyzeCampaignHealth.useQuery({
    accountId: selectedAccountId,
  });

  // 获取预警列表
  const alertsQuery = trpc.adAutomation.getHealthAlerts.useQuery({
    accountId: selectedAccountId,
    severity: 'all',
  });

  // 获取纠错复盘分析
  const correctionsQuery = trpc.adAutomation.analyzeBidCorrections.useQuery({
    accountId: selectedAccountId,
    attributionWindowDays: 14,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'warning': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <XCircle className="h-4 w-4 text-red-400" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'info': return <Bell className="h-4 w-4 text-blue-400" />;
      default: return <CheckCircle className="h-4 w-4 text-green-400" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="h-7 w-7 text-green-400" />
              健康度监控
            </h1>
            <p className="text-gray-400 mt-1">
              实时监控广告活动健康状态，自动检测异常并生成预警
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={selectedAccountId.toString()}
              onValueChange={() => {}} // v399: 由全局选择器控制
            >
              <SelectTrigger className="w-[200px] bg-gray-800 border-gray-700">
                <SelectValue placeholder="选择广告账号" />
              </SelectTrigger>
              <SelectContent>
                {accountsQuery.data?.map((account: unknown) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {/* @ts-ignore */}
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                healthQuery.refetch();
                alertsQuery.refetch();
                correctionsQuery.refetch();
                toast.success("数据已刷新");
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>

        {/* 概览卡片 - v390: 添加loading骨架屏 */}
        {healthQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-gray-900 border-gray-800">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20 bg-gray-700" />
                      <Skeleton className="h-8 w-16 bg-gray-700" />
                    </div>
                    <Skeleton className="h-12 w-12 rounded-full bg-gray-700" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-900/30 to-gray-900 border-green-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                {/* @ts-ignore */}
                <div>
                  {/* @ts-ignore */}
                  <p className="text-sm text-gray-400">平均健康分数</p>
                  {/* @ts-ignore */}
                  <p className={`text-3xl font-bold ${getScoreColor(healthQuery.data?.avgHealthScore || 0)}`}>
                    {/* @ts-ignore */}
                    {healthQuery.data?.avgHealthScore || 0}
                  </p>
                </div>
                <div className="p-3 bg-green-500/20 rounded-full">
                  <Target className="h-6 w-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-900/30 to-gray-900 border-red-500/20">
            <CardContent className="pt-6">
              {/* @ts-ignore */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">严重问题</p>
                  <p className="text-3xl font-bold text-red-400">
                    {/* @ts-ignore */}
                    {healthQuery.data?.criticalCount || 0}
                  </p>
                </div>
                <div className="p-3 bg-red-500/20 rounded-full">
                  <XCircle className="h-6 w-6 text-red-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-900/30 to-gray-900 border-yellow-500/20">
            {/* @ts-ignore */}
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">警告问题</p>
                  <p className="text-3xl font-bold text-yellow-400">
                    {/* @ts-ignore */}
                    {healthQuery.data?.warningCount || 0}
                  </p>
                </div>
                <div className="p-3 bg-yellow-500/20 rounded-full">
                  <AlertTriangle className="h-6 w-6 text-yellow-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-900/30 to-gray-900 border-blue-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">待纠错项</p>
                  <p className="text-3xl font-bold text-blue-400">
                    {correctionsQuery.data?.totalCorrections || 0}
                  </p>
                </div>
                <div className="p-3 bg-blue-500/20 rounded-full">
                  <Zap className="h-6 w-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-gray-800/50 border border-gray-700">
            <TabsTrigger value="overview" className="data-[state=active]:bg-gray-700">
              <BarChart3 className="h-4 w-4 mr-2" />
              健康概览
            </TabsTrigger>
            <TabsTrigger value="alerts" className="data-[state=active]:bg-gray-700">
              <Bell className="h-4 w-4 mr-2" />
              预警列表
              {(alertsQuery.data?.criticalCount || 0) > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {alertsQuery.data?.criticalCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="corrections" className="data-[state=active]:bg-gray-700">
              <Clock className="h-4 w-4 mr-2" />
              纠错复盘
            </TabsTrigger>
            <TabsTrigger value="resources" className="data-[state=active]:bg-gray-700">
              <Server className="h-4 w-4 mr-2" />
              系统资源
            </TabsTrigger>
          </TabsList>

          {/* 健康概览 */}
          <TabsContent value="overview" className="space-y-4">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white">广告活动健康状态</CardTitle>
                <CardDescription>
                  基于多维度指标综合评估每个广告活动的健康程度
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* @ts-ignore */}
                {healthQuery.isLoading ? (
                  <div className="text-center py-8 text-gray-400">加载中...</div>
                ) : healthQuery.data?.campaigns?.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">暂无广告活动数据</div>
                ) : (
                  <div className="space-y-4">
                    {/* @ts-ignore */}
                    {healthQuery.data?.campaigns?.map((campaign: unknown) => (
                      <div
                        // @ts-ignore
                        key={campaign.campaignId}
                        className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
                      >
                        <div className="flex items-center justify-between mb-3">
                          {/* @ts-ignore */}
                          <div className="flex items-center gap-3">
                            {/* @ts-ignore */}
                            <Badge className={getStatusColor(campaign.status)}>
                              {(campaign as any).status === 'healthy' ? '健康' : 
                               // @ts-ignore
                               campaign.status === 'warning' ? '警告' : '严重'}
                            </Badge>
                            <span className="font-medium text-white">
                              {/* @ts-ignore */}
                              {campaign.campaignName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {/* @ts-ignore */}
                              {/* @ts-ignore */}
                              {(campaign.campaignType || 'N/A').toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* @ts-ignore */}
                            <span className={`text-2xl font-bold ${getScoreColor(campaign.overallScore)}`}>
                              {/* @ts-ignore */}
                              {campaign.overallScore}
                            </span>
                            {/* @ts-ignore */}
                            <span className="text-gray-400 text-sm">/ 100</span>
                          </div>
                        </div>
                        
                        <div className="mb-3">
                          <Progress 
                            // @ts-ignore
                            value={campaign.overallScore} 
                            className="h-2"
                          />
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">效率分</span>
                            {/* @ts-ignore */}
                            <div className="flex items-center gap-1">
                              {/* @ts-ignore */}
                              {/* @ts-ignore */}
                              <span className={getScoreColor(campaign.scoreBreakdown?.efficiency || 0)}>
                                {/* @ts-ignore */}
                                {campaign.scoreBreakdown?.efficiency || 0}
                              </span>
                            </div>
                          </div>
                          {/* @ts-ignore */}
                          <div>
                            {/* @ts-ignore */}
                            <span className="text-gray-400">流量分</span>
                            <div className="flex items-center gap-1">
                              {/* @ts-ignore */}
                              <span className={getScoreColor(campaign.scoreBreakdown?.traffic || 0)}>
                                {/* @ts-ignore */}
                                {campaign.scoreBreakdown?.traffic || 0}
                              </span>
                            </div>
                          </div>
                          {/* @ts-ignore */}
                          <div>
                            <span className="text-gray-400">转化分</span>
                            <div className="flex items-center gap-1">
                              {/* @ts-ignore */}
                              <span className={getScoreColor(campaign.scoreBreakdown?.conversion || 0)}>
                                {/* @ts-ignore */}
                                {/* @ts-ignore */}
                                {campaign.scoreBreakdown?.conversion || 0}
                              </span>
                            </div>
                          </div>
                          {/* @ts-ignore */}
                          <div>
                            {/* @ts-ignore */}
                            <span className="text-gray-400">成本分</span>
                            <div className="flex items-center gap-1">
                              {/* @ts-ignore */}
                              <span className={getScoreColor(campaign.scoreBreakdown?.cost || 0)}>
                                {/* @ts-ignore */}
                                {campaign.scoreBreakdown?.cost || 0}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* @ts-ignore */}
                        {campaign.alerts?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-700">
                            <div className="flex flex-wrap gap-2">
                              {(campaign as any).alerts.slice(0, 3).map((alert: unknown, idx: number) => (
                                <Badge 
                                  key={idx}
                                  variant="outline"
                                  className={
                                    // @ts-ignore
                                    alert.severity === 'critical' ? 'border-red-500/50 text-red-400' :
                                    // @ts-ignore
                                    alert.severity === 'warning' ? 'border-yellow-500/50 text-yellow-400' :
                                    'border-blue-500/50 text-blue-400'
                                  }
                                >
                                  {/* @ts-ignore */}
                                  {getSeverityIcon(alert.severity)}
                                  <span className="ml-1">{(alert as any).message}</span>
                                </Badge>
                              ))}
                              {(campaign as any).alerts.length > 3 && (
                                <Badge variant="outline" className="text-gray-400">
                                  +{(campaign as any).alerts.length - 3} 更多
                                </Badge>
                              )}
                            </div>
                          {/* @ts-ignore */}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          {/* @ts-ignore */}
          </TabsContent>

          {/* @ts-ignore */}
          {/* 预警列表 */}
          {/* @ts-ignore */}
          <TabsContent value="alerts" className="space-y-4">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white">预警列表</CardTitle>
                {/* @ts-ignore */}
                <CardDescription>
                  所有需要关注的异常指标和问题
                </CardDescription>
              </CardHeader>
              {/* @ts-ignore */}
              <CardContent>
                {/* @ts-ignore */}
                {alertsQuery.isLoading ? (
                  <div className="text-center py-8 text-gray-400">加载中...</div>
                ) : alertsQuery.data?.alerts?.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                    <p className="text-gray-400">太棒了！目前没有需要关注的预警</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alertsQuery.data?.alerts?.map((alert: unknown, idx: number) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border ${
                          // @ts-ignore
                          alert.severity === 'critical' ? 'bg-red-900/20 border-red-500/30' :
                          // @ts-ignore
                          alert.severity === 'warning' ? 'bg-yellow-900/20 border-yellow-500/30' :
                          'bg-blue-900/20 border-blue-500/30'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* @ts-ignore */}
                          {getSeverityIcon(alert.severity)}
                          <div className="flex-1">
                            {/* @ts-ignore */}
                            <p className="text-white font-medium">{alert.message}</p>
                            <p className="text-gray-400 text-sm mt-1">
                              {(alert as any).metric}: {(alert as any).currentValue?.toFixed(2)} 
                              {(alert as any).threshold && ` (阈值: ${(alert as any).threshold})`}
                            </p>
                          </div>
                          <Badge className={
                            // @ts-ignore
                            alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                            // @ts-ignore
                            alert.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }>
                            {(alert as any).severity === 'critical' ? '严重' :
                             // @ts-ignore
                             alert.severity === 'warning' ? '警告' : '提示'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 纠错复盘 */}
          <TabsContent value="corrections" className="space-y-4">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white">半月纠错复盘</CardTitle>
                <CardDescription>
                  检测因归因延迟导致的错误出价调整，生成纠错建议
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* 纠错统计 */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {/* @ts-ignore */}
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    {/* @ts-ignore */}
                    <p className="text-sm text-gray-400">分析记录</p>
                    <p className="text-2xl font-bold text-white">
                      {correctionsQuery.data?.totalAnalyzed || 0}
                    </p>
                  {/* @ts-ignore */}
                  </div>
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-sm text-gray-400">过早降价</p>
                    {/* @ts-ignore */}
                    <p className="text-2xl font-bold text-orange-400">
                      {correctionsQuery.data?.summary?.prematureDecrease || 0}
                    </p>
                  {/* @ts-ignore */}
                  </div>
                  {/* @ts-ignore */}
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    {/* @ts-ignore */}
                    <p className="text-sm text-gray-400">过早加价</p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {correctionsQuery.data?.summary?.prematureIncrease || 0}
                    </p>
                  </div>
                  {/* @ts-ignore */}
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-sm text-gray-400">归因延迟</p>
                    <p className="text-2xl font-bold text-blue-400">
                      {correctionsQuery.data?.summary?.attributionDelay || 0}
                    </p>
                  </div>
                </div>

                {correctionsQuery.isLoading ? (
                  <div className="text-center py-8 text-gray-400">加载中...</div>
                ) : correctionsQuery.data?.corrections?.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                    <p className="text-gray-400">太棒了！目前没有需要纠错的出价调整</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {correctionsQuery.data?.corrections?.map((correction: unknown, idx: number) => (
                      <div
                        key={idx}
                        className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={
                              // @ts-ignore
                              correction.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                              // @ts-ignore
                              correction.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }>
                              {(correction as any).priority === 'urgent' ? '紧急' :
                               // @ts-ignore
                               correction.priority === 'high' ? '高' : '中'}
                            </Badge>
                            <span className="font-medium text-white">
                              {/* @ts-ignore */}
                              {/* @ts-ignore */}
                              {correction.targetName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {(correction as any).errorType === 'premature_decrease' ? '过早降价' :
                               // @ts-ignore
                               correction.errorType === 'premature_increase' ? '过早加价' :
                               // @ts-ignore
                               correction.errorType === 'over_adjustment' ? '调整过度' : '归因延迟'}
                            </Badge>
                          </div>
                          {/* @ts-ignore */}
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">置信度:</span>
                            {/* @ts-ignore */}
                            <span className="text-white">{(correction.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        
                        {/* @ts-ignore */}
                        {/* @ts-ignore */}
                        <p className="text-gray-300 text-sm mb-3">{correction.reason}</p>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <span className="text-gray-400">原出价: </span>
                              {/* @ts-ignore */}
                              <span className="text-white">${correction.oldBid?.toFixed(2)}</span>
                            </div>
                            <ArrowDownRight className="h-4 w-4 text-red-400" />
                            <div>
                              <span className="text-gray-400">当前: </span>
                              {/* @ts-ignore */}
                              <span className="text-white">${correction.currentBid?.toFixed(2)}</span>
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-green-400" />
                            <div>
                              {/* @ts-ignore */}
                              <span className="text-gray-400">建议: </span>
                              {/* @ts-ignore */}
                              <span className="text-green-400 font-medium">${correction.suggestedBid?.toFixed(2)}</span>
                            {/* @ts-ignore */}
                            </div>
                          </div>
                          <Button size="sm" variant="outline">
                            应用纠错
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 系统资源监控 */}
          <TabsContent value="resources" className="space-y-4">
            {/* @ts-ignore */}
            {resourcesQuery.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1,2,3,4].map(i => (
                  <Card key={i} className="bg-gray-900/50 border-gray-800">
                    <CardHeader><Skeleton className="h-5 w-32 bg-gray-700" /></CardHeader>
                    {/* @ts-ignore */}
                    <CardContent><Skeleton className="h-24 w-full bg-gray-700" /></CardContent>
                  </Card>
                ))}
              </div>
            ) : resourcesQuery.data?.resources ? (
              <div className="space-y-4">
                {/* @ts-ignore */}
                {/* 告警 */}
                {/* @ts-ignore */}
                {(resourcesQuery.data.resources.alerts?.length > 0) && (
                  <Card className="bg-red-900/20 border-red-800">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-5 w-5 text-red-400" />
                        <span className="text-red-400 font-semibold">系统告警</span>
                      </div>
                      {(resourcesQuery as any).data.resources.alerts.map((alert: string, i: number) => (
                        <p key={i} className="text-red-300 text-sm">{alert}</p>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* @ts-ignore */}
                  {/* CPU */}
                  <Card className="bg-gray-900/50 border-gray-800">
                    <CardHeader className="pb-2">
                      {/* @ts-ignore */}
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-blue-400" />
                        CPU 使用率
                      </CardTitle>
                    {/* @ts-ignore */}
                    </CardHeader>
                    {/* @ts-ignore */}
                    <CardContent>
                      {/* @ts-ignore */}
                      <div className="text-3xl font-bold text-white mb-2">
                        {/* @ts-ignore */}
                        {/* @ts-ignore */}
                        {resourcesQuery.data.resources.cpu.avgUsagePercent}%
                      </div>
                      <Progress 
                        // @ts-ignore
                        value={resourcesQuery.data.resources.cpu.avgUsagePercent} 
                        className="h-2 mb-2" 
                      />
                      <p className="text-xs text-gray-400">
                        {/* @ts-ignore */}
                        {resourcesQuery.data.resources.cpu.cores} 核心 | {resourcesQuery.data.resources.cpu.model}
                      </p>
                      <p className="text-xs text-gray-400">
                        负载: {(resourcesQuery as any).data.resources.system.loadAvg1m} (1m) / {(resourcesQuery as any).data.resources.system.loadAvg5m} (5m) / {(resourcesQuery as any).data.resources.system.loadAvg15m} (15m)
                      </p>
                    </CardContent>
                  </Card>

                  {/* 系统内存 */}
                  <Card className="bg-gray-900/50 border-gray-800">
                    {/* @ts-ignore */}
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {/* @ts-ignore */}
                        <HardDrive className="h-4 w-4 text-green-400" />
                        系统内存
                      </CardTitle>
                    </CardHeader>
                    {/* @ts-ignore */}
                    <CardContent>
                      {/* @ts-ignore */}
                      <div className="text-3xl font-bold text-white mb-2">
                        {/* @ts-ignore */}
                        {/* @ts-ignore */}
                        {resourcesQuery.data.resources.memory.system.usagePercent}%
                      </div>
                      {/* @ts-ignore */}
                      <Progress 
                        // @ts-ignore
                        value={resourcesQuery.data.resources.memory.system.usagePercent} 
                        className="h-2 mb-2" 
                      // @ts-ignore
                      />
                      <p className="text-xs text-gray-400">
                        已用: {(resourcesQuery as any).data.resources.memory.system.usedMB}MB / 总计: {(resourcesQuery as any).data.resources.memory.system.totalMB}MB
                      </p>
                      <p className="text-xs text-gray-400">
                        可用: {(resourcesQuery as any).data.resources.memory.system.freeMB}MB
                      </p>
                    </CardContent>
                  </Card>

                  {/* Node.js 进程内存 */}
                  <Card className="bg-gray-900/50 border-gray-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {/* @ts-ignore */}
                        <Zap className="h-4 w-4 text-yellow-400" />
                        Node.js 进程内存
                      </CardTitle>
                    </CardHeader>
                    {/* @ts-ignore */}
                    <CardContent>
                      <div className="text-3xl font-bold text-white mb-2">
                        {/* @ts-ignore */}
                        {resourcesQuery.data.resources.memory.process.heapUsagePercent}%
                      </div>
                      <Progress 
                        // @ts-ignore
                        value={resourcesQuery.data.resources.memory.process.heapUsagePercent} 
                        className="h-2 mb-2" 
                      />
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        {/* @ts-ignore */}
                        <span>RSS: {resourcesQuery.data.resources.memory.process.rssMB}MB</span>
                        {/* @ts-ignore */}
                        <span>堆已用: {resourcesQuery.data.resources.memory.process.heapUsedMB}MB</span>
                        {/* @ts-ignore */}
                        <span>堆总计: {resourcesQuery.data.resources.memory.process.heapTotalMB}MB</span>
                        {/* @ts-ignore */}
                        <span>外部: {resourcesQuery.data.resources.memory.process.externalMB}MB</span>
                      </div>
                      {/* @ts-ignore */}
                      {resourcesQuery.data.resources.memory.nodeMaxOldSpaceMB && (
                        <p className="text-xs text-gray-500 mt-1">
                          V8堆上限: {(resourcesQuery as any).data.resources.memory.nodeMaxOldSpaceMB}MB
                          // @ts-ignore
                          （已用 {(resourcesQuery as any).data.resources.memory.process.heapUsedMB}MB / {(resourcesQuery as any).data.resources.memory.nodeMaxOldSpaceMB}MB）
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 数据库连接池 */}
                  <Card className="bg-gray-900/50 border-gray-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Database className="h-4 w-4 text-purple-400" />
                        数据库连接池
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 mb-2">
                        {/* @ts-ignore */}
                        <span className={`inline-block w-2 h-2 rounded-full ${resourcesQuery.data.resources.database.poolExists ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="text-sm text-white">
                          {(resourcesQuery as any).data.resources.database.poolExists ? '连接池正常' : '连接池异常'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        {/* @ts-ignore */}
                        <span>配置上限: {resourcesQuery.data.resources.database.poolConfigured}</span>
                        {/* @ts-ignore */}
                        <span>已创建: {resourcesQuery.data.resources.database.poolCreated}</span>
                        {/* @ts-ignore */}
                        <span>健康检查失败: {resourcesQuery.data.resources.database.healthChecksFailed}</span>
                        {/* @ts-ignore */}
                        <span>连接池重建: {resourcesQuery.data.resources.database.poolRebuilds}</span>
                        {/* @ts-ignore */}
                        <span>借出连接: {resourcesQuery.data.resources.database.directConnBorrowed}</span>
                        {/* @ts-ignore */}
                        <span>归还连接: {resourcesQuery.data.resources.database.directConnReturned}</span>
                      </div>
                      {/* @ts-ignore */}
                      {resourcesQuery.data.resources.database.leakedConnections > 0 && (
                        <p className="text-xs text-red-400 mt-1">
                          疑似泄漏: {(resourcesQuery as any).data.resources.database.leakedConnections} 个连接
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* 系统信息 */}
                <Card className="bg-gray-900/50 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">系统信息</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-400">
                      <div>
                        <span className="text-gray-500">平台</span>
                        {/* @ts-ignore */}
                        <p className="text-white">{resourcesQuery.data.resources.system.platform} / {resourcesQuery.data.resources.system.arch}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Node.js</span>
                        {/* @ts-ignore */}
                        <p className="text-white">{resourcesQuery.data.resources.system.nodeVersion}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">运行时间</span>
                        {/* @ts-ignore */}
                        <p className="text-white">{resourcesQuery.data.resources.system.uptimeHours} 小时</p>
                      </div>
                      <div>
                        <span className="text-gray-500">数据更新</span>
                        {/* @ts-ignore */}
                        <p className="text-white">{new Date(resourcesQuery.data.resources.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card className="bg-gray-900/50 border-gray-800">
                <CardContent className="pt-6 text-center text-gray-400">
                  暂无系统资源数据
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
