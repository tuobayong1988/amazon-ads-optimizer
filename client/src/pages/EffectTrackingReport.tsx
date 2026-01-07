import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  BarChart3, 
  Calendar, 
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  FileText,
  PieChart
} from 'lucide-react';

export default function EffectTrackingReport() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');

  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery({ accountId: 1 });
  
  // 获取绩效组列表
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery({ accountId: 1 });

  // 获取效果追踪统计摘要
  const { data: trackingStats, isLoading: statsLoading, refetch: refetchStats } = 
    trpc.placement.getTrackingStatsSummary.useQuery();

  // 获取效果追踪报告
  const { data: report, isLoading: reportLoading, refetch: refetchReport } = 
    trpc.placement.generateTrackingReport.useQuery({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      campaignId: selectedCampaign !== 'all' ? parseInt(selectedCampaign) : undefined,
      performanceGroupId: selectedGroup !== 'all' ? parseInt(selectedGroup) : undefined,
    });

  // 运行效果追踪任务
  const runTrackingMutation = trpc.placement.runAllTrackingTasks.useMutation({
    onSuccess: (data) => {
      toast.success('效果追踪任务完成', {
        description: `7天: ${data.day7.length}条, 14天: ${data.day14.length}条, 30天: ${data.day30.length}条`,
      });
      refetchStats();
      refetchReport();
    },
    onError: (error) => {
      toast.error('效果追踪任务失败', { description: error.message });
    },
  });

  // 导出报告
  const handleExportReport = () => {
    if (!report) return;

    const csvContent = [
      ['关键词', '广告活动', '调整类型', '原出价', '新出价', '预估利润变化', '7天实际利润', '14天实际利润', '30天实际利润', '调整时间'].join(','),
      ...report.records.map(r => [
        r.keywordText,
        r.campaignName,
        r.adjustmentType,
        r.previousBid,
        r.newBid,
        r.estimatedProfitChange,
        r.actualProfit7d || '',
        r.actualProfit14d || '',
        r.actualProfit30d || '',
        r.adjustedAt ? new Date(r.adjustedAt).toLocaleString() : '',
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `效果追踪报告_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('报告已导出');
  };

  // 获取准确率颜色
  const getAccuracyColor = (accuracy: number | null) => {
    if (accuracy === null) return 'text-muted-foreground';
    if (accuracy >= 80) return 'text-green-500';
    if (accuracy >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  // 获取准确率Badge
  const getAccuracyBadge = (accuracy: number | null) => {
    if (accuracy === null) return <Badge variant="outline">未追踪</Badge>;
    if (accuracy >= 80) return <Badge className="bg-green-500">优秀</Badge>;
    if (accuracy >= 60) return <Badge className="bg-yellow-500">良好</Badge>;
    return <Badge variant="destructive">需改进</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">效果追踪报告</h1>
            <p className="text-muted-foreground">
              评估出价调整的预估vs实际效果，衡量算法准确性
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => runTrackingMutation.mutate()}
              disabled={runTrackingMutation.isPending}
            >
              {runTrackingMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              运行追踪任务
            </Button>
            <Button onClick={handleExportReport} disabled={!report}>
              <Download className="h-4 w-4 mr-2" />
              导出报告
            </Button>
          </div>
        </div>

        {/* 统计摘要卡片 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总追踪记录</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? '...' : trackingStats?.totalTracked || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                已完成效果追踪的出价调整
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">预估总利润</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500">
                ${statsLoading ? '...' : (trackingStats?.totalEstimatedProfit || 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                算法预估的利润提升
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">实际总利润</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(trackingStats?.totalActualProfit || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ${statsLoading ? '...' : (trackingStats?.totalActualProfit || 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                30天实际利润变化
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">整体准确率</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${getAccuracyColor(trackingStats?.overallAccuracy || null)}`}>
                {statsLoading ? '...' : `${(trackingStats?.overallAccuracy || 0).toFixed(1)}%`}
              </div>
              <Progress 
                value={trackingStats?.overallAccuracy || 0} 
                className="mt-2"
              />
            </CardContent>
          </Card>
        </div>

        {/* 各周期准确率 */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                7天准确率
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${getAccuracyColor(trackingStats?.avgAccuracy7d || null)}`}>
                {trackingStats?.avgAccuracy7d ? `${trackingStats.avgAccuracy7d.toFixed(1)}%` : '暂无数据'}
              </div>
              <Progress value={trackingStats?.avgAccuracy7d || 0} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                14天准确率
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${getAccuracyColor(trackingStats?.avgAccuracy14d || null)}`}>
                {trackingStats?.avgAccuracy14d ? `${trackingStats.avgAccuracy14d.toFixed(1)}%` : '暂无数据'}
              </div>
              <Progress value={trackingStats?.avgAccuracy14d || 0} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                30天准确率
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${getAccuracyColor(trackingStats?.avgAccuracy30d || null)}`}>
                {trackingStats?.avgAccuracy30d ? `${trackingStats.avgAccuracy30d.toFixed(1)}%` : '暂无数据'}
              </div>
              <Progress value={trackingStats?.avgAccuracy30d || 0} className="mt-2" />
            </CardContent>
          </Card>
        </div>

        {/* 筛选器 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">报告筛选</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>结束日期</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>广告活动</Label>
                <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                  <SelectTrigger>
                    <SelectValue placeholder="全部广告活动" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部广告活动</SelectItem>
                    {campaigns?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>绩效组</Label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder="全部绩效组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部绩效组</SelectItem>
                    {performanceGroups?.map((g: any) => (
                      <SelectItem key={g.id} value={g.id.toString()}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 报告内容 */}
        <Tabs defaultValue="summary" className="space-y-4">
          <TabsList>
            <TabsTrigger value="summary">摘要</TabsTrigger>
            <TabsTrigger value="byType">按调整类型</TabsTrigger>
            <TabsTrigger value="byCampaign">按广告活动</TabsTrigger>
            <TabsTrigger value="details">详细记录</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <Card>
              <CardHeader>
                <CardTitle>报告摘要</CardTitle>
                <CardDescription>
                  出价调整效果的整体统计
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : report ? (
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">总调整记录</span>
                        <span className="font-medium">{report.summary?.totalRecords || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">已追踪记录</span>
                        <span className="font-medium">{report.summary?.trackedRecords || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">追踪覆盖率</span>
                        <span className="font-medium">{report.summary?.trackingRate || 0}%</span>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">预估总利润</span>
                        <span className="font-medium text-blue-500">
                          ${(report.summary?.totalEstimatedProfit || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">7天实际利润</span>
                        <span className={`font-medium ${(report.summary?.totalActualProfit7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          ${(report.summary?.totalActualProfit7d || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">30天实际利润</span>
                        <span className={`font-medium ${(report.summary?.totalActualProfit30d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          ${(report.summary?.totalActualProfit30d || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无数据
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="byType">
            <Card>
              <CardHeader>
                <CardTitle>按调整类型分析</CardTitle>
                <CardDescription>
                  不同调整类型的效果对比
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : report?.byAdjustmentType && Array.isArray(report.byAdjustmentType) && report.byAdjustmentType.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>调整类型</TableHead>
                        <TableHead className="text-right">调整次数</TableHead>
                        <TableHead className="text-right">预估利润</TableHead>
                        <TableHead className="text-right">实际利润</TableHead>
                        <TableHead className="text-right">准确率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(report.byAdjustmentType as any[]).map((item: any) => (
                        <TableRow key={item.type}>
                          <TableCell>
                            <Badge variant="outline">{item.type}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{item.count}</TableCell>
                          <TableCell className="text-right text-blue-500">
                            ${item.estimated.toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right ${item.actual >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            ${item.actual.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {getAccuracyBadge(item.accuracy)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无数据
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="byCampaign">
            <Card>
              <CardHeader>
                <CardTitle>按广告活动分析</CardTitle>
                <CardDescription>
                  各广告活动的调整效果对比
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : report?.byCampaign && Array.isArray(report.byCampaign) && report.byCampaign.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>广告活动</TableHead>
                        <TableHead className="text-right">调整次数</TableHead>
                        <TableHead className="text-right">预估利润</TableHead>
                        <TableHead className="text-right">实际利润</TableHead>
                        <TableHead className="text-right">准确率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(report.byCampaign as any[]).map((item: any) => (
                        <TableRow key={item.campaignId}>
                          <TableCell className="font-medium">{item.name || `活动 ${item.campaignId}`}</TableCell>
                          <TableCell className="text-right">{item.count}</TableCell>
                          <TableCell className="text-right text-blue-500">
                            ${item.estimated.toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right ${item.actual >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            ${item.actual.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {getAccuracyBadge(item.accuracy)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无数据
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <CardTitle>详细记录</CardTitle>
                <CardDescription>
                  最近100条出价调整记录及其效果追踪
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : report?.records && report.records.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>关键词</TableHead>
                          <TableHead>广告活动</TableHead>
                          <TableHead>调整类型</TableHead>
                          <TableHead className="text-right">原出价</TableHead>
                          <TableHead className="text-right">新出价</TableHead>
                          <TableHead className="text-right">预估利润</TableHead>
                          <TableHead className="text-right">7天实际</TableHead>
                          <TableHead className="text-right">14天实际</TableHead>
                          <TableHead className="text-right">30天实际</TableHead>
                          <TableHead>调整时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.records.map((record: any) => (
                          <TableRow key={record.id}>
                            <TableCell className="font-medium max-w-[150px] truncate">
                              {record.keywordText}
                            </TableCell>
                            <TableCell className="max-w-[120px] truncate">
                              {record.campaignName}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {record.adjustmentType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              ${parseFloat(record.previousBid || '0').toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              ${parseFloat(record.newBid || '0').toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-blue-500">
                              ${parseFloat(record.estimatedProfitChange || '0').toFixed(2)}
                            </TableCell>
                            <TableCell className={`text-right ${record.actualProfit7d ? (parseFloat(record.actualProfit7d) >= 0 ? 'text-green-500' : 'text-red-500') : 'text-muted-foreground'}`}>
                              {record.actualProfit7d ? `$${parseFloat(record.actualProfit7d).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className={`text-right ${record.actualProfit14d ? (parseFloat(record.actualProfit14d) >= 0 ? 'text-green-500' : 'text-red-500') : 'text-muted-foreground'}`}>
                              {record.actualProfit14d ? `$${parseFloat(record.actualProfit14d).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className={`text-right ${record.actualProfit30d ? (parseFloat(record.actualProfit30d) >= 0 ? 'text-green-500' : 'text-red-500') : 'text-muted-foreground'}`}>
                              {record.actualProfit30d ? `$${parseFloat(record.actualProfit30d).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {new Date(record.adjustedAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无数据
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
