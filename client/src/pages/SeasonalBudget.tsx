/**
 * Seasonal Budget Page - 季节性预算调整建议页面
 * 基于历史数据和大促活动提供预算调整建议
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Calendar, CalendarDays, Check, ChevronRight, Clock, Gift, LineChart, RefreshCw, Sparkles, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";

type RecommendationStatus = "pending" | "applied" | "skipped" | "expired";

export default function SeasonalBudget() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("recommendations");
  const [marketplace, setMarketplace] = useState("US");

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取季节性建议
  const { data: recommendationsData, isLoading: recommendationsLoading, refetch: refetchRecommendations } = trpc.seasonalBudget.getRecommendations.useQuery({
    accountId: accountId || undefined,
  });

  // 获取即将到来的促销活动
  const { data: upcomingEvents, isLoading: eventsLoading } = trpc.seasonalBudget.getUpcomingEvents.useQuery({
    marketplace,
  });

  // 获取历史趋势
  const { data: historicalTrends, isLoading: trendsLoading } = trpc.seasonalBudget.getHistoricalTrends.useQuery({
    accountId: accountId || undefined,
  });

  // 生成建议
  const generateMutation = trpc.seasonalBudget.generateRecommendations.useMutation({
    onSuccess: (result) => {
      toast.success(`生成了 ${result.count} 条建议`);
      refetchRecommendations();
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
  });

  // 应用建议
  const applyMutation = trpc.seasonalBudget.applyRecommendation.useMutation({
    onSuccess: () => {
      toast.success("建议已应用");
      refetchRecommendations();
    },
    onError: (error) => {
      toast.error(`应用失败: ${error.message}`);
    },
  });

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500">待处理</Badge>;
      case "applied":
        return <Badge className="bg-green-500">已应用</Badge>;
      case "skipped":
        return <Badge variant="secondary">已跳过</Badge>;
      case "expired":
        return <Badge variant="outline">已过期</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getRecommendationTypeIcon = (type: string | null) => {
    switch (type) {
      case "event_increase":
        return <Gift className="h-5 w-5 text-red-500" />;
      case "event_warmup":
        return <Clock className="h-5 w-5 text-orange-500" />;
      case "seasonal_increase":
        return <TrendingUp className="h-5 w-5 text-green-500" />;
      case "seasonal_decrease":
        return <TrendingUp className="h-5 w-5 text-blue-500 rotate-180" />;
      case "trend_based":
        return <LineChart className="h-5 w-5 text-purple-500" />;
      default:
        return <Sparkles className="h-5 w-5" />;
    }
  };

  const getRecommendationTypeName = (type: string | null) => {
    const names: Record<string, string> = {
      event_increase: "大促期间增加",
      event_warmup: "大促预热",
      seasonal_increase: "季节性增加",
      seasonal_decrease: "季节性减少",
      trend_based: "趋势驱动",
    };
    return names[type || ""] || type || "未知";
  };

  const formatCurrency = (value: string | number | null) => {
    return `$${Number(value || 0).toFixed(2)}`;
  };

  const formatPercent = (value: string | number | null) => {
    const num = Number(value || 0);
    return `${num >= 0 ? "+" : ""}${num.toFixed(1)}%`;
  };

  const getDaysUntil = (date: Date | string | null) => {
    if (!date) return 0;
    const target = new Date(date);
    const now = new Date();
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getEventStatusBadge = (event: any) => {
    const daysUntil = getDaysUntil(event.startDate);
    if (daysUntil < 0) {
      return <Badge className="bg-green-500">进行中</Badge>;
    } else if (daysUntil <= 7) {
      return <Badge className="bg-orange-500">即将开始</Badge>;
    } else if (daysUntil <= 30) {
      return <Badge className="bg-blue-500">预热期</Badge>;
    } else {
      return <Badge variant="outline">即将到来</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">季节性预算建议</h1>
          <p className="text-muted-foreground">基于历史数据和大促活动，智能调整预算策略</p>
        </div>
        <div className="flex gap-2">
          <Select value={marketplace} onValueChange={setMarketplace}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="US">美国</SelectItem>
              <SelectItem value="UK">英国</SelectItem>
              <SelectItem value="DE">德国</SelectItem>
              <SelectItem value="JP">日本</SelectItem>
              <SelectItem value="CN">中国</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => generateMutation.mutate({ accountId: accountId || undefined })}
            disabled={generateMutation.isPending}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            生成建议
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="recommendations">
            <Sparkles className="h-4 w-4 mr-2" />
            预算建议
          </TabsTrigger>
          <TabsTrigger value="events">
            <CalendarDays className="h-4 w-4 mr-2" />
            促销日历
          </TabsTrigger>
          <TabsTrigger value="trends">
            <LineChart className="h-4 w-4 mr-2" />
            季节性趋势
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-4">
          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-yellow-100 dark:bg-yellow-900">
                    <Clock className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">待处理</p>
                    <p className="text-2xl font-bold">
                      {recommendationsData?.recommendations.filter(r => r.status === "pending").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">已应用</p>
                    <p className="text-2xl font-bold">
                      {recommendationsData?.recommendations.filter(r => r.status === "applied").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-red-100 dark:bg-red-900">
                    <Gift className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">大促相关</p>
                    <p className="text-2xl font-bold">
                      {recommendationsData?.recommendations.filter(r => 
                        r.recommendationType === "event_increase" || r.recommendationType === "event_warmup"
                      ).length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900">
                    <TrendingUp className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">平均预算倍数</p>
                    <p className="text-2xl font-bold">
                      {(() => {
                        const pending = recommendationsData?.recommendations.filter(r => r.status === "pending") || [];
                        if (pending.length === 0) return "N/A";
                        const avg = pending.reduce((sum, r) => sum + Number(r.budgetMultiplier || 1), 0) / pending.length;
                        return `${avg.toFixed(2)}x`;
                      })()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 建议列表 */}
          <Card>
            <CardHeader>
              <CardTitle>预算调整建议</CardTitle>
              <CardDescription>共 {recommendationsData?.total || 0} 条建议</CardDescription>
            </CardHeader>
            <CardContent>
              {recommendationsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : recommendationsData?.recommendations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无预算建议</p>
                  <p className="text-sm mt-2">点击"生成建议"按钮获取智能预算调整建议</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recommendationsData?.recommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {getRecommendationTypeIcon(rec.recommendationType)}
                          <div>
                            <p className="font-medium">{getRecommendationTypeName(rec.recommendationType)}</p>
                            <p className="text-sm text-muted-foreground">
                              置信度: {Number(rec.confidenceScore || 0).toFixed(0)}%
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(rec.status)}
                          {rec.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => applyMutation.mutate({ recommendationId: rec.id })}
                                disabled={applyMutation.isPending}
                              >
                                <Check className="h-4 w-4 mr-1" />
                                应用
                              </Button>
                              <Button size="sm" variant="ghost">
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4 mb-3">
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">当前预算</p>
                          <p className="font-medium">{formatCurrency(rec.currentBudget)}</p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">建议预算</p>
                          <p className="font-medium text-green-500">{formatCurrency(rec.recommendedBudget)}</p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">预算倍数</p>
                          <p className="font-medium">{Number(rec.budgetMultiplier || 1).toFixed(2)}x</p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">预期销售增长</p>
                          <p className="font-medium text-green-500">{formatPercent(rec.expectedSalesIncrease)}</p>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground">{rec.reasoning}</p>

                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>
                            生效: {rec.effectiveStartDate ? new Date(rec.effectiveStartDate).toLocaleDateString() : "N/A"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>
                            结束: {rec.effectiveEndDate ? new Date(rec.effectiveEndDate).toLocaleDateString() : "N/A"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>促销活动日历</CardTitle>
              <CardDescription>即将到来的大促活动和建议预算调整</CardDescription>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : !upcomingEvents || upcomingEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CalendarDays className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无即将到来的促销活动</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingEvents.map((event: any, index: number) => (
                    <div
                      key={index}
                      className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-red-100 dark:bg-red-900">
                            <Gift className="h-5 w-5 text-red-500" />
                          </div>
                          <div>
                            <p className="font-medium">{event.eventName}</p>
                            <p className="text-sm text-muted-foreground">{event.eventType}</p>
                          </div>
                        </div>
                        {getEventStatusBadge(event)}
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">开始日期</p>
                          <p className="font-medium">
                            {event.startDate ? new Date(event.startDate).toLocaleDateString() : "N/A"}
                          </p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">结束日期</p>
                          <p className="font-medium">
                            {event.endDate ? new Date(event.endDate).toLocaleDateString() : "N/A"}
                          </p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">建议预算倍数</p>
                          <p className="font-medium text-green-500">
                            {Number(event.recommendedBudgetMultiplier || 1).toFixed(1)}x
                          </p>
                        </div>
                      </div>

                      {event.warmupStartDate && (
                        <div className="text-sm text-muted-foreground">
                          预热期: {new Date(event.warmupStartDate).toLocaleDateString()} - {new Date(event.warmupEndDate || event.startDate).toLocaleDateString()}
                          （建议预算倍数: {Number(event.warmupBudgetMultiplier || 1).toFixed(1)}x）
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>季节性趋势分析</CardTitle>
              <CardDescription>基于历史数据的月度表现趋势</CardDescription>
            </CardHeader>
            <CardContent>
              {trendsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : !historicalTrends || historicalTrends.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <LineChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无历史趋势数据</p>
                  <p className="text-sm mt-2">需要至少3个月的历史数据才能生成趋势分析</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {historicalTrends.map((trend: any, index: number) => (
                    <div
                      key={index}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{trend.year}年{trend.month}月</span>
                          {Number(trend.seasonalIndex || 1) > 1.1 && (
                            <Badge className="bg-green-500">旺季</Badge>
                          )}
                          {Number(trend.seasonalIndex || 1) < 0.9 && (
                            <Badge className="bg-blue-500">淡季</Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          季节性指数: {Number(trend.seasonalIndex || 1).toFixed(2)}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">日均花费</p>
                          <p className="font-medium">{formatCurrency(trend.avgDailySpend)}</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">日均销售</p>
                          <p className="font-medium">{formatCurrency(trend.avgDailySales)}</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">ROAS</p>
                          <p className="font-medium">{Number(trend.avgRoas || 0).toFixed(2)}</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">ACoS</p>
                          <p className="font-medium">{Number(trend.avgAcos || 0).toFixed(1)}%</p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span>季节性强度</span>
                          <span>{((Number(trend.seasonalIndex || 1) - 1) * 100).toFixed(0)}%</span>
                        </div>
                        <Progress value={Math.min(Math.abs((Number(trend.seasonalIndex || 1) - 1) * 100), 100)} />
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
  );
}
