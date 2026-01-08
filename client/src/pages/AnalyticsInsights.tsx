/**
 * AnalyticsInsights - 分析洞察中心
 * 合并原有的特殊场景分析、纠错复盘、季节性建议功能
 */

import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { 
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Calendar,
  Target,
  DollarSign,
  Zap,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  PieChart,
  Lightbulb,
  History,
  Sun,
  Snowflake,
  Gift,
  Percent
} from "lucide-react";
import { format, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "sonner";

export default function AnalyticsInsights() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取特殊场景分析
  const specialScenarioQuery = trpc.specialScenario.runFullAnalysis.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取归因调整数据
  const attributionQuery = trpc.specialScenario.getAttributionAdjustedData.useQuery(
    { accountId: accountId!, days: 7 },
    { enabled: !!accountId }
  );

  // 获取竞价效率分析
  const biddingEfficiencyQuery = trpc.specialScenario.analyzeBidEfficiency.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取纠错复盘分析
  const correctionsQuery = trpc.adAutomation.analyzeBidCorrections.useQuery(
    { accountId: accountId!, attributionWindowDays: 14 },
    { enabled: !!accountId }
  );

  // 获取季节性建议
  const seasonalQuery = { data: { adjustments: [] }, refetch: () => Promise.resolve() };

  // 刷新所有数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        specialScenarioQuery.refetch(),
        attributionQuery.refetch(),
        biddingEfficiencyQuery.refetch(),
        correctionsQuery.refetch(),
        seasonalQuery.refetch(),
      ]);
      toast.success("数据刷新成功");
    } catch (err) {
      toast.error("刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  };

  // 计算洞察摘要
  const insightsSummary = useMemo(() => {
    const critical: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // 预算耗尽风险
    if (specialScenarioQuery.data?.budgetDepletion) {
      const highRisk = specialScenarioQuery.data.budgetDepletion.filter(
        (b: any) => b.riskLevel === 'high' || b.riskLevel === 'critical'
      );
      if (highRisk.length > 0) {
        critical.push(`${highRisk.length}个广告活动预算即将耗尽`);
      }
    }

    // 过度竞价
    if (biddingEfficiencyQuery.data?.topOverbidding) {
      const count = biddingEfficiencyQuery.data.overbiddingCount;
      if (count > 0) {
        warnings.push(`${count}个关键词存在过度竞价，可节省$${biddingEfficiencyQuery.data.totalPotentialSavings?.toFixed(0) || 0}`);
      }
    }

    // 纠错建议
    if (correctionsQuery.data?.totalCorrections) {
      suggestions.push(`${correctionsQuery.data.totalCorrections}个出价需要纠错调整`);
    }

    // 季节性调整
    if (seasonalQuery.data?.adjustments) {
      const upcoming = seasonalQuery.data.adjustments.filter((a: any) => a.status === 'upcoming');
      if (upcoming.length > 0) {
        suggestions.push(`${upcoming.length}个季节性调整计划待执行`);
      }
    }

    return { critical, warnings, suggestions };
  }, [specialScenarioQuery.data, biddingEfficiencyQuery.data, correctionsQuery.data, seasonalQuery.data]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-400 bg-red-500/20';
      case 'high': return 'text-orange-400 bg-orange-500/20';
      case 'warning': return 'text-yellow-400 bg-yellow-500/20';
      default: return 'text-blue-400 bg-blue-500/20';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-7 w-7 text-purple-400" />
              分析洞察
            </h1>
            <p className="text-muted-foreground mt-1">
              特殊场景分析、纠错复盘、季节性建议的统一视图
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={accountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 洞察摘要卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-red-500/20">
                  <XCircle className="h-6 w-6 text-red-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">严重问题</p>
                  <p className="text-2xl font-bold text-red-400">{insightsSummary.critical.length}</p>
                </div>
              </div>
              {insightsSummary.critical.length > 0 && (
                <div className="mt-3 space-y-1">
                  {insightsSummary.critical.map((item, idx) => (
                    <p key={idx} className="text-sm text-red-300">{item}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-yellow-500/30 bg-yellow-500/10">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-yellow-500/20">
                  <AlertTriangle className="h-6 w-6 text-yellow-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">警告提示</p>
                  <p className="text-2xl font-bold text-yellow-400">{insightsSummary.warnings.length}</p>
                </div>
              </div>
              {insightsSummary.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {insightsSummary.warnings.map((item, idx) => (
                    <p key={idx} className="text-sm text-yellow-300">{item}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-blue-500/30 bg-blue-500/10">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-blue-500/20">
                  <Lightbulb className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">优化建议</p>
                  <p className="text-2xl font-bold text-blue-400">{insightsSummary.suggestions.length}</p>
                </div>
              </div>
              {insightsSummary.suggestions.length > 0 && (
                <div className="mt-3 space-y-1">
                  {insightsSummary.suggestions.map((item, idx) => (
                    <p key={idx} className="text-sm text-blue-300">{item}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 主要标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              综合概览
            </TabsTrigger>
            <TabsTrigger value="attribution" className="gap-2">
              <Clock className="h-4 w-4" />
              归因分析
            </TabsTrigger>
            <TabsTrigger value="bidding" className="gap-2">
              <DollarSign className="h-4 w-4" />
              竞价效率
            </TabsTrigger>
            <TabsTrigger value="corrections" className="gap-2">
              <History className="h-4 w-4" />
              纠错复盘
            </TabsTrigger>
            <TabsTrigger value="seasonal" className="gap-2">
              <Calendar className="h-4 w-4" />
              季节性
            </TabsTrigger>
          </TabsList>

          {/* 综合概览Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 预算风险 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-400" />
                    预算耗尽风险
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {specialScenarioQuery.data?.budgetDepletion?.slice(0, 5).map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                        <div>
                          <p className="font-medium">{item.campaignName}</p>
                          <p className="text-sm text-muted-foreground">
                            预计 {item.hoursUntilDepletion?.toFixed(0) || '?'} 小时后耗尽
                          </p>
                        </div>
                        <Badge variant={item.riskLevel === 'critical' ? 'destructive' : item.riskLevel === 'high' ? 'secondary' : 'outline'}>
                          {item.riskLevel === 'critical' ? '严重' : item.riskLevel === 'high' ? '高风险' : '低风险'}
                        </Badge>
                      </div>
                    )) || (
                      <p className="text-center text-muted-foreground py-4">暂无预算风险数据</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 竞价效率 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Percent className="h-5 w-5 text-green-400" />
                    竞价效率分析
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="text-center p-4 rounded-lg bg-muted/30">
                      <p className="text-3xl font-bold text-green-400">
                        ${biddingEfficiencyQuery.data?.totalPotentialSavings?.toFixed(0) || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">潜在节省</p>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-muted/30">
                      <p className="text-3xl font-bold text-orange-400">
                        {biddingEfficiencyQuery.data?.topOverbidding?.length || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">过度竞价词</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {biddingEfficiencyQuery.data?.topOverbidding?.slice(0, 3).map((kw: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <span className="truncate max-w-[200px]">{kw.keyword}</span>
                        <span className="text-orange-400">-{kw.suggestedReduction?.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 归因分析Tab */}
          <TabsContent value="attribution" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>归因窗口数据调整</CardTitle>
                <CardDescription>
                  近7天数据根据归因延迟进行调整，显示更准确的预期表现
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {attributionQuery.data?.map((day: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-lg border bg-card/50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{format(new Date(day.date), 'MM-dd EEEE', { locale: zhCN })}</span>
                        </div>
                        <Badge variant={day.adjusted.confidence === 'high' ? 'default' : day.adjusted.confidence === 'medium' ? 'secondary' : 'outline'}>
                          {day.adjusted.confidence === 'high' ? '高置信度' : day.adjusted.confidence === 'medium' ? '中置信度' : '低置信度'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">原始销售额</p>
                          <p className="font-medium">${day.original.sales.toFixed(0)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">调整后销售额</p>
                          <p className="font-medium text-green-400">${day.adjusted.sales.toFixed(0)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">调整系数</p>
                          <p className="font-medium">{day.adjusted.adjustmentFactor.toFixed(2)}x</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">预期增量</p>
                          <p className="font-medium text-blue-400">+${(day.adjusted.sales - day.original.sales).toFixed(0)}</p>
                        </div>
                      </div>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">暂无归因数据</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 竞价效率Tab */}
          <TabsContent value="bidding" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>过度竞价关键词</CardTitle>
                <CardDescription>
                  这些关键词的出价相对于实际CPC过高，建议降低出价
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {biddingEfficiencyQuery.data?.topOverbidding?.map((kw: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-lg border bg-card/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{kw.keyword}</span>
                        <Badge variant="secondary">{kw.matchType}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">当前出价</p>
                          <p className="font-medium">${kw.currentBid?.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">建议出价</p>
                          <p className="font-medium text-green-400">${kw.suggestedBid?.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">实际CPC</p>
                          <p className="font-medium">${kw.avgCpc?.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">潜在节省</p>
                          <p className="font-medium text-orange-400">${kw.potentialSavings?.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">暂无过度竞价数据</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 纠错复盘Tab */}
          <TabsContent value="corrections" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>出价纠错建议</CardTitle>
                <CardDescription>
                  基于归因窗口后的实际转化数据，识别需要调整的出价
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="text-center p-4 rounded-lg bg-muted/30">
                    <p className="text-3xl font-bold">{correctionsQuery.data?.totalCorrections || 0}</p>
                    <p className="text-sm text-muted-foreground">待纠错项</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-green-500/10">
                    <p className="text-3xl font-bold text-green-400">{correctionsQuery.data?.summary?.prematureIncrease || 0}</p>
                    <p className="text-sm text-muted-foreground">建议提价</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-red-500/10">
                    <p className="text-3xl font-bold text-red-400">{correctionsQuery.data?.summary?.prematureDecrease || 0}</p>
                    <p className="text-sm text-muted-foreground">建议降价</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {correctionsQuery.data?.corrections?.slice(0, 10).map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium">{item.keyword}</p>
                        <p className="text-sm text-muted-foreground">{item.reason}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">${item.currentBid?.toFixed(2)}</span>
                        <ArrowUpRight className={`h-4 w-4 ${item.direction === 'increase' ? 'text-green-400' : 'text-red-400'}`} />
                        <span className={`text-sm font-medium ${item.direction === 'increase' ? 'text-green-400' : 'text-red-400'}`}>
                          ${item.suggestedBid?.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">暂无纠错建议</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 季节性Tab */}
          <TabsContent value="seasonal" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>季节性调整计划</CardTitle>
                <CardDescription>
                  基于历史数据和大促日历的智能调整建议
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {seasonalQuery.data?.adjustments?.map((item: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-lg border bg-card/50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {item.type === 'holiday' ? (
                            <Gift className="h-5 w-5 text-red-400" />
                          ) : item.type === 'summer' ? (
                            <Sun className="h-5 w-5 text-yellow-400" />
                          ) : (
                            <Snowflake className="h-5 w-5 text-blue-400" />
                          )}
                          <span className="font-medium">{item.name}</span>
                        </div>
                        <Badge variant={item.status === 'active' ? 'default' : item.status === 'upcoming' ? 'secondary' : 'outline'}>
                          {item.status === 'active' ? '进行中' : item.status === 'upcoming' ? '即将开始' : '已结束'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">开始日期</p>
                          <p className="font-medium">{format(new Date(item.startDate), 'yyyy-MM-dd')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">结束日期</p>
                          <p className="font-medium">{format(new Date(item.endDate), 'yyyy-MM-dd')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">建议调整</p>
                          <p className={`font-medium ${item.adjustment > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {item.adjustment > 0 ? '+' : ''}{item.adjustment}%
                          </p>
                        </div>
                      </div>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">暂无季节性调整计划</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
