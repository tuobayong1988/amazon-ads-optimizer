/**
 * Budget Tracking Page - 预算分配效果追踪页面
 * 追踪预算调整后的效果变化
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Calendar, ChevronRight, Clock, LineChart, RefreshCw, Target, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

type TrackingStatus = "tracking" | "completed" | "cancelled";

export default function BudgetTracking() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<TrackingStatus | "all">("all");

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取追踪列表
  const { data: trackingsData, isLoading, refetch } = trpc.budgetTracking.getTrackings.useQuery({
    accountId: selectedAccountId || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 20,
    offset: 0,
  });

  // 生成报告
  const generateReportMutation = trpc.budgetTracking.generateReport.useMutation({
    onSuccess: () => {
      toast.success("报告生成成功");
      refetch();
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "tracking":
        return <Badge className="bg-blue-500">追踪中</Badge>;
      case "completed":
        return <Badge className="bg-green-500">已完成</Badge>;
      case "cancelled":
        return <Badge variant="secondary">已取消</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatPercent = (value: number | string | null) => {
    const num = Number(value || 0);
    const prefix = num >= 0 ? "+" : "";
    return `${prefix}${num.toFixed(1)}%`;
  };

  const getChangeIcon = (value: number | string | null) => {
    const num = Number(value || 0);
    if (num > 0) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (num < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return null;
  };

  const calculateProgress = (startDate: Date | null, endDate: Date | null) => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const now = Date.now();
    if (now >= end) return 100;
    if (now <= start) return 0;
    return Math.round(((now - start) / (end - start)) * 100);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">预算效果追踪</h1>
          <p className="text-muted-foreground">追踪预算调整后的效果变化，评估优化策略</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* 筛选器 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-4">
            <div className="w-48">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TrackingStatus | "all")}>
                <SelectTrigger>
                  <SelectValue placeholder="状态筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="tracking">追踪中</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                <Target className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">追踪中</p>
                <p className="text-2xl font-bold">
                  {trackingsData?.trackings.filter(t => t.status === "tracking").length || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                <BarChart3 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">已完成</p>
                <p className="text-2xl font-bold">
                  {trackingsData?.trackings.filter(t => t.status === "completed").length || 0}
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
                <p className="text-sm text-muted-foreground">平均ROAS提升</p>
                <p className="text-2xl font-bold">
                  {(() => {
                    const completed = trackingsData?.trackings.filter(t => t.status === "completed") || [];
                    if (completed.length === 0) return "N/A";
                    const avg = completed.reduce((sum, t) => sum + Number(t.roasChange || 0), 0) / completed.length;
                    return formatPercent(avg);
                  })()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-orange-100 dark:bg-orange-900">
                <LineChart className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">平均ACoS变化</p>
                <p className="text-2xl font-bold">
                  {(() => {
                    const completed = trackingsData?.trackings.filter(t => t.status === "completed") || [];
                    if (completed.length === 0) return "N/A";
                    const avg = completed.reduce((sum, t) => sum + Number(t.acosChange || 0), 0) / completed.length;
                    return formatPercent(avg);
                  })()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 追踪列表 */}
      <Card>
        <CardHeader>
          <CardTitle>效果追踪记录</CardTitle>
          <CardDescription>共 {trackingsData?.total || 0} 条追踪记录</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : trackingsData?.trackings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>暂无追踪记录</p>
              <p className="text-sm mt-2">在预算分配页面应用建议后，系统会自动创建效果追踪</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trackingsData?.trackings.map((tracking) => (
                <div
                  key={tracking.id}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {getStatusBadge(tracking.status || "tracking")}
                      <span className="font-medium">追踪 #{tracking.id}</span>
                      <span className="text-sm text-muted-foreground">
                        周期: {tracking.trackingPeriod || "14_days"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {tracking.status === "tracking" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => generateReportMutation.mutate({ trackingId: tracking.id })}
                          disabled={generateReportMutation.isPending}
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          更新数据
                        </Button>
                      )}
                      <Button size="sm" variant="ghost">
                        查看详情
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>

                  {/* 进度条 */}
                  {tracking.status === "tracking" && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">追踪进度</span>
                        <span>{calculateProgress(tracking.startDate, tracking.endDate)}%</span>
                      </div>
                      <Progress value={calculateProgress(tracking.startDate, tracking.endDate)} />
                    </div>
                  )}

                  {/* 效果指标 */}
                  <div className="grid grid-cols-5 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">预算变化</p>
                      <div className="flex items-center justify-center gap-1">
                        {getChangeIcon(tracking.spendChange)}
                        <span className="font-medium">{formatPercent(tracking.spendChange)}</span>
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">销售额变化</p>
                      <div className="flex items-center justify-center gap-1">
                        {getChangeIcon(tracking.salesChange)}
                        <span className="font-medium">{formatPercent(tracking.salesChange)}</span>
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">ROAS变化</p>
                      <div className="flex items-center justify-center gap-1">
                        {getChangeIcon(tracking.roasChange)}
                        <span className="font-medium">{formatPercent(tracking.roasChange)}</span>
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">ACoS变化</p>
                      <div className="flex items-center justify-center gap-1">
                        {getChangeIcon(tracking.acosChange)}
                        <span className="font-medium">{formatPercent(tracking.acosChange)}</span>
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">效果评估</p>
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-medium">{tracking.effectRating || "N/A"}</span>
                      </div>
                    </div>
                  </div>

                  {/* 时间信息 */}
                  <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>
                        开始: {tracking.startDate ? new Date(tracking.startDate).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>
                        结束: {tracking.endDate ? new Date(tracking.endDate).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
