import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  MousePointer,
  Eye,
  Percent,
  Store,
  Globe,
  RefreshCw,
  Download,
  Upload,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { toast } from "sonner";

// 市场标志映射
const MARKETPLACE_FLAGS: Record<string, string> = {
  US: "🇺🇸",
  CA: "🇨🇦",
  MX: "🇲🇽",
  BR: "🇧🇷",
  UK: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
  IT: "🇮🇹",
  ES: "🇪🇸",
  NL: "🇳🇱",
  SE: "🇸🇪",
  PL: "🇵🇱",
  JP: "🇯🇵",
  AU: "🇦🇺",
  SG: "🇸🇬",
  AE: "🇦🇪",
  SA: "🇸🇦",
  IN: "🇮🇳",
};

const CHART_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

export default function AccountsSummary() {
  const [selectedMetric, setSelectedMetric] = useState<string>("sales");
  const [activeTab, setActiveTab] = useState("overview");

  // 获取汇总数据
  // @ts-ignore
  const { data: summary, isLoading, refetch } = trpc.crossAccount.getSummary.useQuery() as unknown;

  // 导出账号配置
  const exportMutation = trpc.crossAccount.exportAccounts.useMutation({
    onSuccess: (result) => {
      // 创建下载
      const blob = new Blob([result.data], { type: result.format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (error) => {
      toast.error(`导出失败: ${error.message}`);
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // 准备图表数据
  // @ts-expect-error - array method type inference
  const accountChartData = summary?.accountsData?.map(account => ({
    name: account.storeName || account.accountName,
    spend: account.spend,
    sales: account.sales,
    acos: account.acos,
    roas: account.roas,
    impressions: account.impressions,
    clicks: account.clicks,
    orders: account.orders,
    color: account.storeColor || '#3B82F6',
  })) || [];

  const marketplaceChartData = summary?.marketplaceDistribution 
    ? Object.entries(summary.marketplaceDistribution).map(([marketplace, data], index) => ({
        name: `${MARKETPLACE_FLAGS[marketplace] || '🌐'} ${marketplace}`,
        // @ts-expect-error - Dynamic data property access
        value: data.sales,
        // @ts-expect-error - Dynamic data property access
        count: data.count,
        // @ts-expect-error - Dynamic data property access
        spend: data.spend,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }))
    : [];

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">跨账号数据汇总</h1>
            <p className="text-muted-foreground">
              查看所有店铺的整体广告表现对比分析
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新数据
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate({ format: 'json' })}
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              导出JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate({ format: 'csv' })}
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              导出CSV
            </Button>
          </div>
        </div>

        {/* 汇总统计卡片 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总销售额</CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary?.totalSales || 0)}</div>
              <p className="text-xs text-muted-foreground">
                来自 {summary?.totalAccounts || 0} 个店铺
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总花费</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary?.totalSpend || 0)}</div>
              <p className="text-xs text-muted-foreground">
                平均ROAS: {(summary?.avgRoas || 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">平均ACoS</CardTitle>
              <Percent className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatPercent(summary?.avgAcos || 0)}</div>
              <p className="text-xs text-muted-foreground">
                总订单: {formatNumber(summary?.totalOrders || 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">账号状态</CardTitle>
              <Store className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary?.connectedAccounts || 0}/{summary?.totalAccounts || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                已连接账号
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 详细数据标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="comparison">账号对比</TabsTrigger>
            <TabsTrigger value="marketplace">市场分布</TabsTrigger>
            <TabsTrigger value="details">详细数据</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* 销售额对比图 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">各店铺销售额</CardTitle>
                  <CardDescription>按店铺统计的销售额分布</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={accountChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                        {/* @ts-ignore */}
                        <Tooltip
                          // @ts-ignore
                          formatter={((value: number) => formatCurrency(value)) as unknown}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                        />
                        <Bar dataKey="sales" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* 市场分布饼图 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">市场销售分布</CardTitle>
                  <CardDescription>按市场统计的销售额占比</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={marketplaceChartData}
                          cx="50%"
                          // @ts-ignore
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }: unknown) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          // @ts-ignore
                          dataKey="value"
                        >
                          {marketplaceChartData.map((entry: unknown, index: unknown) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          // @ts-ignore
                          formatter={((value: number) => formatCurrency(value)) as unknown}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 关键指标对比 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">关键指标对比</CardTitle>
                <CardDescription>各店铺核心广告指标一览</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Eye className="h-4 w-4" />
                      总曝光
                    </div>
                    <div className="text-xl font-bold">{formatNumber(summary?.totalImpressions || 0)}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MousePointer className="h-4 w-4" />
                      总点击
                    </div>
                    <div className="text-xl font-bold">{formatNumber(summary?.totalClicks || 0)}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Percent className="h-4 w-4" />
                      平均CTR
                    </div>
                    <div className="text-xl font-bold">{formatPercent(summary?.avgCtr || 0)}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ShoppingCart className="h-4 w-4" />
                      平均CVR
                    </div>
                    <div className="text-xl font-bold">{formatPercent(summary?.avgCvr || 0)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">账号指标对比</CardTitle>
                    <CardDescription>选择指标查看各店铺对比</CardDescription>
                  </div>
                  <Select value={selectedMetric} onValueChange={setSelectedMetric}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sales">销售额</SelectItem>
                      <SelectItem value="spend">花费</SelectItem>
                      <SelectItem value="acos">ACoS</SelectItem>
                      <SelectItem value="roas">ROAS</SelectItem>
                      <SelectItem value="impressions">曝光</SelectItem>
                      <SelectItem value="clicks">点击</SelectItem>
                      <SelectItem value="orders">订单</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={accountChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(v) => {
                          if (selectedMetric === 'sales' || selectedMetric === 'spend') {
                            return `$${(v / 1000).toFixed(0)}k`;
                          }
                          if (selectedMetric === 'acos') {
                            return `${v.toFixed(0)}%`;
                          }
                          if (selectedMetric === 'roas') {
                            return v.toFixed(1);
                          // @ts-ignore
                          }
                          return formatNumber(v);
                        }}
                      />
                      <Tooltip
                        // @ts-ignore
                        formatter={((value: number) => {
                          if (selectedMetric === 'sales' || selectedMetric === 'spend') {
                            return formatCurrency(value);
                          }
                          if (selectedMetric === 'acos') {
                            return formatPercent(value);
                          }
                          if (selectedMetric === 'roas') {
                            return value.toFixed(2);
                          }
                          return formatNumber(value);
                        }) as unknown}
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                      />
                      <Bar
                        dataKey={selectedMetric}
                        radius={[4, 4, 0, 0]}
                      >
                        {accountChartData.map((entry: unknown, index: unknown) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            {/* @ts-ignore */}
            </Card>
          </TabsContent>

          {/* @ts-ignore */}
          <TabsContent value="marketplace" className="space-y-4">
            {/* @ts-ignore */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* 市场统计卡片 */}
              {marketplaceChartData.map((market: unknown, index: unknown) => (
                <Card key={market.name}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      {/* @ts-ignore */}
                      {/* @ts-ignore */}
                      <CardTitle className="text-base">{market.name}</CardTitle>
                      {/* @ts-ignore */}
                      <Badge variant="outline">{market.count} 个账号</Badge>
                    {/* @ts-ignore */}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">销售额</div>
                        {/* @ts-ignore */}
                        <div className="text-lg font-bold">{formatCurrency(market.value)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">花费</div>
                        {/* @ts-ignore */}
                        <div className="text-lg font-bold">{formatCurrency(market.spend)}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">账号详细数据</CardTitle>
                <CardDescription>所有店铺的完整广告数据</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>店铺</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>市场</TableHead>
                        <TableHead className="text-right">销售额</TableHead>
                        <TableHead className="text-right">花费</TableHead>
                        <TableHead className="text-right">ACoS</TableHead>
                        <TableHead className="text-right">ROAS</TableHead>
                        {/* @ts-ignore */}
                        <TableHead className="text-right">订单</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    {/* @ts-ignore */}
                    <TableBody>
                      {summary?.accountsData?.map((account: unknown) => (
                        <TableRow key={account.id}>
                          <TableCell>
                            {/* @ts-ignore */}
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                                // @ts-ignore
                                style={{ backgroundColor: account.storeColor || '#3B82F6' }}
                              >
                                {/* @ts-ignore */}
                                {/* @ts-ignore */}
                                {(account.storeName || account.accountName).charAt(0).toUpperCase()}
                              </div>
                              {/* @ts-ignore */}
                              <span className="font-medium">
                                {/* @ts-ignore */}
                                {/* @ts-ignore */}
                                {account.storeName || account.accountName}
                              </span>
                            </div>
                          {/* @ts-ignore */}
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell>
                            {/* @ts-ignore */}
                            {MARKETPLACE_FLAGS[account.marketplace] || '🌐'} {account.marketplace}
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell className="text-right font-medium">
                            {/* @ts-ignore */}
                            {formatCurrency(account.sales)}
                          </TableCell>
                          <TableCell className="text-right">
                            {/* @ts-ignore */}
                            {formatCurrency(account.spend)}
                          </TableCell>
                          <TableCell className="text-right">
                            {/* @ts-ignore */}
                            {/* @ts-ignore */}
                            <span className={account.acos > 30 ? 'text-red-500' : 'text-green-500'}>
                              {/* @ts-ignore */}
                              {/* @ts-ignore */}
                              {formatPercent(account.acos)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {/* @ts-ignore */}
                            {/* @ts-ignore */}
                            <span className={account.roas < 2 ? 'text-red-500' : 'text-green-500'}>
                              {/* @ts-ignore */}
                              {account.roas.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {/* @ts-ignore */}
                            {formatNumber(account.orders)}
                          </TableCell>
                          <TableCell className="text-right">
                            {/* @ts-ignore */}
                            {formatPercent(account.ctr)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              // @ts-ignore
                              variant={account.connectionStatus === 'connected' ? 'default' : 'secondary'}
                              className={
                                // @ts-ignore
                                account.connectionStatus === 'connected'
                                  ? 'bg-green-500/20 text-green-500'
                                  // @ts-ignore
                                  : account.connectionStatus === 'error'
                                  ? 'bg-red-500/20 text-red-500'
                                  : ''
                              }
                            >
                              {(account as any).connectionStatus === 'connected' ? '已连接' :
                               // @ts-ignore
                               account.connectionStatus === 'error' ? '错误' : '待配置'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
