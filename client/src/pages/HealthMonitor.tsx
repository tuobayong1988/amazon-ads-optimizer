import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
  ArrowDownRight
} from "lucide-react";
import { toast } from "sonner";

export default function HealthMonitor() {
  const [selectedAccountId, setSelectedAccountId] = useState<number>(1);
  const [activeTab, setActiveTab] = useState("overview");

  // 获取广告账号列表
  const accountsQuery = trpc.adAccount.list.useQuery();
  
  // 获取健康度分析
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
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[200px] bg-gray-800 border-gray-700">
                <SelectValue placeholder="选择广告账号" />
              </SelectTrigger>
              <SelectContent>
                {accountsQuery.data?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
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

        {/* 概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-900/30 to-gray-900 border-green-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">平均健康分数</p>
                  <p className={`text-3xl font-bold ${getScoreColor(healthQuery.data?.avgHealthScore || 0)}`}>
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
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">严重问题</p>
                  <p className="text-3xl font-bold text-red-400">
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
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">警告问题</p>
                  <p className="text-3xl font-bold text-yellow-400">
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
                {healthQuery.isLoading ? (
                  <div className="text-center py-8 text-gray-400">加载中...</div>
                ) : healthQuery.data?.campaigns?.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">暂无广告活动数据</div>
                ) : (
                  <div className="space-y-4">
                    {healthQuery.data?.campaigns?.map((campaign: any) => (
                      <div
                        key={campaign.campaignId}
                        className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Badge className={getStatusColor(campaign.status)}>
                              {campaign.status === 'healthy' ? '健康' : 
                               campaign.status === 'warning' ? '警告' : '严重'}
                            </Badge>
                            <span className="font-medium text-white">
                              {campaign.campaignName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {campaign.campaignType.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-2xl font-bold ${getScoreColor(campaign.overallScore)}`}>
                              {campaign.overallScore}
                            </span>
                            <span className="text-gray-400 text-sm">/ 100</span>
                          </div>
                        </div>
                        
                        <div className="mb-3">
                          <Progress 
                            value={campaign.overallScore} 
                            className="h-2"
                          />
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">效率分</span>
                            <div className="flex items-center gap-1">
                              <span className={getScoreColor(campaign.scores?.efficiency || 0)}>
                                {campaign.scores?.efficiency || 0}
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400">流量分</span>
                            <div className="flex items-center gap-1">
                              <span className={getScoreColor(campaign.scores?.traffic || 0)}>
                                {campaign.scores?.traffic || 0}
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400">转化分</span>
                            <div className="flex items-center gap-1">
                              <span className={getScoreColor(campaign.scores?.conversion || 0)}>
                                {campaign.scores?.conversion || 0}
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400">成本分</span>
                            <div className="flex items-center gap-1">
                              <span className={getScoreColor(campaign.scores?.cost || 0)}>
                                {campaign.scores?.cost || 0}
                              </span>
                            </div>
                          </div>
                        </div>

                        {campaign.alerts?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-700">
                            <div className="flex flex-wrap gap-2">
                              {campaign.alerts.slice(0, 3).map((alert: any, idx: number) => (
                                <Badge 
                                  key={idx}
                                  variant="outline"
                                  className={
                                    alert.severity === 'critical' ? 'border-red-500/50 text-red-400' :
                                    alert.severity === 'warning' ? 'border-yellow-500/50 text-yellow-400' :
                                    'border-blue-500/50 text-blue-400'
                                  }
                                >
                                  {getSeverityIcon(alert.severity)}
                                  <span className="ml-1">{alert.message}</span>
                                </Badge>
                              ))}
                              {campaign.alerts.length > 3 && (
                                <Badge variant="outline" className="text-gray-400">
                                  +{campaign.alerts.length - 3} 更多
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 预警列表 */}
          <TabsContent value="alerts" className="space-y-4">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white">预警列表</CardTitle>
                <CardDescription>
                  所有需要关注的异常指标和问题
                </CardDescription>
              </CardHeader>
              <CardContent>
                {alertsQuery.isLoading ? (
                  <div className="text-center py-8 text-gray-400">加载中...</div>
                ) : alertsQuery.data?.alerts?.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                    <p className="text-gray-400">太棒了！目前没有需要关注的预警</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alertsQuery.data?.alerts?.map((alert: any, idx: number) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border ${
                          alert.severity === 'critical' ? 'bg-red-900/20 border-red-500/30' :
                          alert.severity === 'warning' ? 'bg-yellow-900/20 border-yellow-500/30' :
                          'bg-blue-900/20 border-blue-500/30'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {getSeverityIcon(alert.severity)}
                          <div className="flex-1">
                            <p className="text-white font-medium">{alert.message}</p>
                            <p className="text-gray-400 text-sm mt-1">
                              {alert.metric}: {alert.currentValue?.toFixed(2)} 
                              {alert.threshold && ` (阈值: ${alert.threshold})`}
                            </p>
                          </div>
                          <Badge className={
                            alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                            alert.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }>
                            {alert.severity === 'critical' ? '严重' :
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
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-sm text-gray-400">分析记录</p>
                    <p className="text-2xl font-bold text-white">
                      {correctionsQuery.data?.totalAnalyzed || 0}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-sm text-gray-400">过早降价</p>
                    <p className="text-2xl font-bold text-orange-400">
                      {correctionsQuery.data?.summary?.prematureDecrease || 0}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-sm text-gray-400">过早加价</p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {correctionsQuery.data?.summary?.prematureIncrease || 0}
                    </p>
                  </div>
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
                    {correctionsQuery.data?.corrections?.map((correction: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={
                              correction.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                              correction.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }>
                              {correction.priority === 'urgent' ? '紧急' :
                               correction.priority === 'high' ? '高' : '中'}
                            </Badge>
                            <span className="font-medium text-white">
                              {correction.targetName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {correction.errorType === 'premature_decrease' ? '过早降价' :
                               correction.errorType === 'premature_increase' ? '过早加价' :
                               correction.errorType === 'over_adjustment' ? '调整过度' : '归因延迟'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">置信度:</span>
                            <span className="text-white">{(correction.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        
                        <p className="text-gray-300 text-sm mb-3">{correction.reason}</p>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <span className="text-gray-400">原出价: </span>
                              <span className="text-white">${correction.oldBid?.toFixed(2)}</span>
                            </div>
                            <ArrowDownRight className="h-4 w-4 text-red-400" />
                            <div>
                              <span className="text-gray-400">当前: </span>
                              <span className="text-white">${correction.currentBid?.toFixed(2)}</span>
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-green-400" />
                            <div>
                              <span className="text-gray-400">建议: </span>
                              <span className="text-green-400 font-medium">${correction.suggestedBid?.toFixed(2)}</span>
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
