import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  History, 
  Search, 
  Filter, 
  Calendar,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Download,
  RefreshCw,
  BarChart3,
  DollarSign,
  Target,
  Zap,
  Clock,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

// 调整类型映射
const adjustmentTypeLabels: Record<string, { label: string; color: string }> = {
  manual: { label: '手动调整', color: 'bg-gray-500/10 text-gray-600' },
  auto_optimal: { label: '利润最优', color: 'bg-green-500/10 text-green-600' },
  auto_dayparting: { label: '分时策略', color: 'bg-blue-500/10 text-blue-600' },
  auto_placement: { label: '位置倾斜', color: 'bg-purple-500/10 text-purple-600' },
  batch_campaign: { label: '批量活动', color: 'bg-orange-500/10 text-orange-600' },
  batch_group: { label: '批量绩效组', color: 'bg-pink-500/10 text-pink-600' },
};

// 状态映射
const statusLabels: Record<string, { label: string; color: string }> = {
  applied: { label: '已应用', color: 'bg-green-500/10 text-green-600' },
  pending: { label: '待处理', color: 'bg-yellow-500/10 text-yellow-600' },
  failed: { label: '失败', color: 'bg-red-500/10 text-red-600' },
  rolled_back: { label: '已回滚', color: 'bg-gray-500/10 text-gray-600' },
};

export default function BidAdjustmentHistory() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取绩效组列表
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取历史记录
  const { data: historyData, isLoading, refetch } = trpc.placement.getBidAdjustmentHistory.useQuery(
    {
      accountId: accountId!,
      campaignId: selectedCampaignId || undefined,
      performanceGroupId: selectedGroupId || undefined,
      adjustmentType: selectedType !== 'all' ? selectedType as any : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      pageSize,
    },
    { enabled: !!accountId }
  );

  // 获取统计数据
  const { data: statsData } = trpc.placement.getBidAdjustmentStats.useQuery(
    { accountId: accountId!, days: 30 },
    { enabled: !!accountId }
  );

  // 导出CSV
  const handleExport = () => {
    if (!historyData?.records.length) {
      toast.error('没有可导出的数据');
      return;
    }

    const headers = ['时间', '广告活动', '绩效组', '关键词', '匹配类型', '调整前出价', '调整后出价', '变化%', '调整类型', '状态', '预估利润提升'];
    const rows = historyData.records.map(record => [
      record.appliedAt,
      record.campaignName || '-',
      record.performanceGroupName || '-',
      record.keywordText || '-',
      record.matchType || '-',
      `$${record.previousBid}`,
      `$${record.newBid}`,
      `${record.bidChangePercent}%`,
      adjustmentTypeLabels[record.adjustmentType || 'manual']?.label || record.adjustmentType,
      statusLabels[record.status || 'applied']?.label || record.status,
      record.expectedProfitIncrease ? `$${record.expectedProfitIncrease}` : '-',
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bid_adjustment_history_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    
    toast.success('导出成功');
  };

  // 重置筛选
  const handleReset = () => {
    setSelectedCampaignId(null);
    setSelectedGroupId(null);
    setSelectedType('all');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <History className="w-6 h-6 text-blue-500" />
              出价调整历史
            </h1>
            <p className="text-muted-foreground mt-1">
              查看和分析所有出价调整操作的历史记录
            </p>
          </div>
          <div className="flex items-center gap-2">
            {accounts && accounts.length > 1 && (
              <Select
                value={String(accountId)}
                onValueChange={(v) => setSelectedAccountId(Number(v))}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="选择账号" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.accountName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              导出CSV
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        {statsData && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">总调整次数</p>
                    <p className="text-2xl font-bold">{statsData.overall.totalAdjustments}</p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-blue-500/20" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">过去30天</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">预估利润提升</p>
                    <p className="text-2xl font-bold text-green-600">
                      ${Number(statsData.overall.totalProfitIncrease || 0).toFixed(2)}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-500/20" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">累计预估</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">平均出价变化</p>
                    <p className={`text-2xl font-bold ${Number(statsData.overall.avgBidChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {Number(statsData.overall.avgBidChange || 0) >= 0 ? '+' : ''}{Number(statsData.overall.avgBidChange || 0).toFixed(1)}%
                    </p>
                  </div>
                  <Target className="w-8 h-8 text-purple-500/20" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">平均变化幅度</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">提高出价</p>
                    <p className="text-2xl font-bold text-green-600">
                      {statsData.overall.increasedCount || 0}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-500/20" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">次数</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">降低出价</p>
                    <p className="text-2xl font-bold text-red-600">
                      {statsData.overall.decreasedCount || 0}
                    </p>
                  </div>
                  <TrendingDown className="w-8 h-8 text-red-500/20" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">次数</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 调整类型分布 */}
        {statsData?.typeStats && statsData.typeStats.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">调整类型分布</CardTitle>
              <CardDescription>过去30天各类型调整的数量统计</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {statsData.typeStats.map((stat) => (
                  <div key={stat.adjustmentType} className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
                    <Badge className={adjustmentTypeLabels[stat.adjustmentType || 'manual']?.color || 'bg-gray-500/10'}>
                      {adjustmentTypeLabels[stat.adjustmentType || 'manual']?.label || stat.adjustmentType}
                    </Badge>
                    <span className="font-semibold">{stat.count}次</span>
                    {Number(stat.totalProfitIncrease) > 0 && (
                      <span className="text-xs text-green-600">+${Number(stat.totalProfitIncrease).toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 筛选器 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="w-4 h-4" />
              筛选条件
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">广告活动</Label>
                <Select
                  value={selectedCampaignId ? String(selectedCampaignId) : 'all'}
                  onValueChange={(v) => setSelectedCampaignId(v === 'all' ? null : Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="全部活动" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部活动</SelectItem>
                    {campaigns?.map((campaign) => (
                      <SelectItem key={campaign.id} value={String(campaign.id)}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs">绩效组</Label>
                <Select
                  value={selectedGroupId ? String(selectedGroupId) : 'all'}
                  onValueChange={(v) => setSelectedGroupId(v === 'all' ? null : Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="全部绩效组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部绩效组</SelectItem>
                    {performanceGroups?.map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs">调整类型</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue placeholder="全部类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="manual">手动调整</SelectItem>
                    <SelectItem value="auto_optimal">利润最优</SelectItem>
                    <SelectItem value="auto_dayparting">分时策略</SelectItem>
                    <SelectItem value="auto_placement">位置倾斜</SelectItem>
                    <SelectItem value="batch_campaign">批量活动</SelectItem>
                    <SelectItem value="batch_group">批量绩效组</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs">开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs">结束日期</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              
              <div className="space-y-1 flex items-end">
                <Button variant="outline" size="sm" onClick={handleReset} className="w-full">
                  重置筛选
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 历史记录表格 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">历史记录</CardTitle>
                <CardDescription>
                  共 {historyData?.total || 0} 条记录
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">加载中...</span>
              </div>
            ) : historyData?.records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mb-4 opacity-20" />
                <p>暂无历史记录</p>
                <p className="text-xs mt-1">调整出价后将在此显示历史记录</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[160px]">时间</TableHead>
                        <TableHead>广告活动</TableHead>
                        <TableHead>关键词</TableHead>
                        <TableHead className="text-right">调整前</TableHead>
                        <TableHead className="text-right">调整后</TableHead>
                        <TableHead className="text-right">变化</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">预估利润</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyData?.records.map((record) => {
                        const bidChange = Number(record.bidChangePercent || 0);
                        return (
                          <TableRow key={record.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {record.appliedAt ? new Date(record.appliedAt).toLocaleString('zh-CN', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }) : '-'}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[150px] truncate" title={record.campaignName || '-'}>
                                {record.campaignName || '-'}
                              </div>
                              {record.performanceGroupName && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {record.performanceGroupName}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[150px] truncate" title={record.keywordText || '-'}>
                                {record.keywordText || '-'}
                              </div>
                              {record.matchType && (
                                <Badge variant="outline" className="text-xs mt-0.5">
                                  {record.matchType}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${Number(record.previousBid).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${Number(record.newBid).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className={`flex items-center justify-end gap-1 ${
                                bidChange > 0 ? 'text-green-600' : bidChange < 0 ? 'text-red-600' : 'text-muted-foreground'
                              }`}>
                                {bidChange > 0 ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : bidChange < 0 ? (
                                  <ArrowDown className="w-3 h-3" />
                                ) : null}
                                {bidChange > 0 ? '+' : ''}{bidChange.toFixed(1)}%
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={adjustmentTypeLabels[record.adjustmentType || 'manual']?.color || 'bg-gray-500/10'}>
                                {adjustmentTypeLabels[record.adjustmentType || 'manual']?.label || record.adjustmentType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={statusLabels[record.status || 'applied']?.color || 'bg-gray-500/10'}>
                                {statusLabels[record.status || 'applied']?.label || record.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {record.expectedProfitIncrease ? (
                                <span className="text-green-600">+${Number(record.expectedProfitIncrease).toFixed(2)}</span>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* 分页 */}
                {historyData && historyData.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      第 {page} / {historyData.totalPages} 页，共 {historyData.total} 条
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(historyData.totalPages, p + 1))}
                        disabled={page >= historyData.totalPages}
                      >
                        下一页
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
