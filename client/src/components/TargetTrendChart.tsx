import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  MousePointer,
  DollarSign,
  ShoppingCart,
  Target,
  BarChart3,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

interface TargetTrendChartProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: number;
  targetType: "keyword" | "productTarget";
  targetName: string;
  matchType?: string;
}

export function TargetTrendChart({
  open,
  onOpenChange,
  targetId,
  targetType,
  targetName,
  matchType,
}: TargetTrendChartProps) {
  const [days, setDays] = useState(30);
  const [activeMetric, setActiveMetric] = useState<"performance" | "efficiency">("performance");

  // 根据类型调用不同的API
  const keywordTrend = trpc.keyword.getHistoryTrend.useQuery(
    { id: targetId, days },
    { enabled: open && targetType === "keyword" }
  );

  const productTargetTrend = trpc.productTarget.getHistoryTrend.useQuery(
    { id: targetId, days },
    { enabled: open && targetType === "productTarget" }
  );

  const { data, isLoading } = targetType === "keyword" ? keywordTrend : productTargetTrend;

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "down":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case "up":
        return "text-green-500";
      case "down":
        return "text-red-500";
      default:
        return "text-gray-500";
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;
  const formatNumber = (value: number) => value.toLocaleString();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            历史趋势分析
          </DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            <span className="font-medium">{targetName}</span>
            {matchType && (
              <Badge variant="outline" className="text-xs">
                {matchType === "broad" ? "广泛" : matchType === "phrase" ? "词组" : "精准"}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* 时间范围选择 */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-muted-foreground">时间范围：</span>
          {[7, 14, 30, 60].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}天
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-80" />
          </div>
        ) : data ? (
          <>
            {/* 汇总指标卡片 */}
            <div className="grid grid-cols-5 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">总展示</div>
                    {getTrendIcon(data.summary.trend.impressions)}
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {formatNumber(data.summary.totalImpressions)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">总点击</div>
                    {getTrendIcon(data.summary.trend.clicks)}
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {formatNumber(data.summary.totalClicks)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    CTR: {formatPercent(data.summary.avgCtr)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">总花费</div>
                    {getTrendIcon(data.summary.trend.spend)}
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {formatCurrency(data.summary.totalSpend)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    CPC: {formatCurrency(data.summary.avgCpc)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">总销售额</div>
                    {getTrendIcon(data.summary.trend.sales)}
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {formatCurrency(data.summary.totalSales)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    订单: {data.summary.totalOrders}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">ACoS</div>
                    {getTrendIcon(data.summary.trend.acos === "up" ? "down" : data.summary.trend.acos === "down" ? "up" : "stable")}
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {formatPercent(data.summary.avgAcos)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ROAS: {data.summary.avgRoas.toFixed(2)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 图表切换 */}
            <Tabs value={activeMetric} onValueChange={(v) => setActiveMetric(v as any)}>
              <TabsList className="mb-4">
                <TabsTrigger value="performance" className="gap-2">
                  <MousePointer className="h-4 w-4" />
                  流量表现
                </TabsTrigger>
                <TabsTrigger value="efficiency" className="gap-2">
                  <Target className="h-4 w-4" />
                  效率指标
                </TabsTrigger>
              </TabsList>

              <TabsContent value="performance">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">点击与花费趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={data.trendData}>
                        <defs>
                          <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          className="text-xs"
                        />
                        <YAxis yAxisId="left" className="text-xs" />
                        <YAxis yAxisId="right" orientation="right" className="text-xs" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === "点击") return [formatNumber(value), name];
                            if (name === "花费") return [formatCurrency(value), name];
                            return [value, name];
                          }}
                          labelFormatter={(label) => `日期: ${label}`}
                        />
                        <Legend />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="clicks"
                          name="点击"
                          stroke="#3b82f6"
                          fill="url(#colorClicks)"
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="spend"
                          name="花费"
                          stroke="#f59e0b"
                          fill="url(#colorSpend)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">销售额与订单趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={data.trendData}>
                        <defs>
                          <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          className="text-xs"
                        />
                        <YAxis yAxisId="left" className="text-xs" />
                        <YAxis yAxisId="right" orientation="right" className="text-xs" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === "销售额") return [formatCurrency(value), name];
                            if (name === "订单") return [formatNumber(value), name];
                            return [value, name];
                          }}
                          labelFormatter={(label) => `日期: ${label}`}
                        />
                        <Legend />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="sales"
                          name="销售额"
                          stroke="#10b981"
                          fill="url(#colorSales)"
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="orders"
                          name="订单"
                          stroke="#8b5cf6"
                          fill="url(#colorOrders)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="efficiency">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">ACoS与ROAS趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={data.trendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          className="text-xs"
                        />
                        <YAxis yAxisId="left" className="text-xs" />
                        <YAxis yAxisId="right" orientation="right" className="text-xs" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === "ACoS") return [formatPercent(value), name];
                            if (name === "ROAS") return [value.toFixed(2), name];
                            return [value, name];
                          }}
                          labelFormatter={(label) => `日期: ${label}`}
                        />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="acos"
                          name="ACoS"
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="roas"
                          name="ROAS"
                          stroke="#22c55e"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">CTR与CVR趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={data.trendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          className="text-xs"
                        />
                        <YAxis className="text-xs" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => [formatPercent(value), name]}
                          labelFormatter={(label) => `日期: ${label}`}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="ctr"
                          name="CTR"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="cvr"
                          name="CVR"
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">CPC趋势</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={data.trendData}>
                        <defs>
                          <linearGradient id="colorCpc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          className="text-xs"
                        />
                        <YAxis className="text-xs" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number) => [formatCurrency(value), "CPC"]}
                          labelFormatter={(label) => `日期: ${label}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="cpc"
                          name="CPC"
                          stroke="#f59e0b"
                          fill="url(#colorCpc)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            暂无数据
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
