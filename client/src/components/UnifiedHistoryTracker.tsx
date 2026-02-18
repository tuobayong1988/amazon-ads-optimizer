/**
 * UnifiedHistoryTracker - 统一历史与追踪组件
 * v144: 合并竞价日志、出价调整历史、效果追踪报告三个模块
 * 
 * 功能：
 * 1. 出价调整历史（含筛选、分页）
 * 2. 效果追踪（7/14/30天实际效果对比）
 * 3. 回滚操作（单个+批量）
 * 4. 优化日志（操作记录）
 * 5. 统计摘要
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  History,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  FileText,
  Activity,
} from "lucide-react";

interface UnifiedHistoryTrackerProps {
  performanceGroupId: number;
  performanceGroupName: string;
  currencySymbol?: string;
}

// 调整类型标签
const ADJUSTMENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  manual: { label: "手动调整", color: "bg-blue-500/20 text-blue-400" },
  auto_optimal: { label: "自动优化", color: "bg-green-500/20 text-green-400" },
  auto_dayparting: { label: "分时竞价", color: "bg-purple-500/20 text-purple-400" },
  auto_placement: { label: "位置优化", color: "bg-orange-500/20 text-orange-400" },
  batch_campaign: { label: "批量调整", color: "bg-cyan-500/20 text-cyan-400" },
  batch_group: { label: "组批量", color: "bg-indigo-500/20 text-indigo-400" },
};

// 状态标签
const STATUS_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  applied: { label: "已执行", icon: CheckCircle, color: "text-green-400" },
  pending: { label: "待执行", icon: Clock, color: "text-yellow-400" },
  failed: { label: "失败", icon: XCircle, color: "text-red-400" },
  rolled_back: { label: "已回滚", icon: RotateCcw, color: "text-gray-400" },
};

// 日志类别标签
const LOG_CATEGORY_LABELS: Record<string, string> = {
  all: "全部",
  performance_target: "目标设置",
  bid_adjustment: "出价调整",
  placement_adjustment: "位置调整",
  optimization_settings: "优化设置",
};

export function UnifiedHistoryTracker({ performanceGroupId, performanceGroupName, currencySymbol = "$" }: UnifiedHistoryTrackerProps) {
  const [activeTab, setActiveTab] = useState("adjustments");
  
  // 出价调整历史筛选
  const [adjustmentType, setAdjustmentType] = useState<string>("all");
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: number; keyword: string } | null>(null);
  
  // 操作日志筛选
  const [logCategory, setLogCategory] = useState<string>("all");
  const [logPage, setLogPage] = useState(1);

  // ==================== API 调用 ====================
  
  // 出价调整历史
  const { data: adjustmentData, isLoading: adjustmentsLoading, refetch: refetchAdjustments } = 
    trpc.performanceGroup.getBidAdjustmentHistory.useQuery({
      performanceGroupId,
      adjustmentType: adjustmentType !== "all" ? adjustmentType as any : undefined,
      page: adjustmentPage,
      pageSize: 20,
    }, { enabled: !!performanceGroupId });

  // 出价调整统计
  const { data: adjustmentStats } = trpc.performanceGroup.getBidAdjustmentStats.useQuery({
    performanceGroupId,
    days: 30,
  }, { enabled: !!performanceGroupId });

  // 效果追踪统计
  const { data: trackingStats } = trpc.performanceGroup.getBidAdjustmentTrackingStats.useQuery({
    performanceGroupId,
    days: 30,
  }, { enabled: !!performanceGroupId });

  // 操作日志
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = 
    trpc.performanceGroup.getLogs.useQuery({
      performanceGroupId,
      category: logCategory as any,
      page: logPage,
      pageSize: 20,
    }, { enabled: !!performanceGroupId });

  // 回滚mutation
  const rollbackMutation = trpc.performanceGroup.rollbackBidAdjustment.useMutation({
    onSuccess: () => {
      toast.success("回滚成功");
      refetchAdjustments();
      setRollbackDialogOpen(false);
      setRollbackTarget(null);
    },
    onError: (error: any) => {
      toast.error(`回滚失败: ${error.message}`);
    },
  });

  // 批量回滚mutation
  const batchRollbackMutation = trpc.performanceGroup.batchRollbackBidAdjustments.useMutation({
    onSuccess: (data) => {
      toast.success(`批量回滚完成: ${data.succeeded}/${data.total} 成功`);
      refetchAdjustments();
      setSelectedIds([]);
    },
    onError: (error: any) => {
      toast.error(`批量回滚失败: ${error.message}`);
    },
  });

  // ==================== 事件处理 ====================

  const handleRollback = (id: number, keyword: string) => {
    setRollbackTarget({ id, keyword });
    setRollbackDialogOpen(true);
  };

  const confirmRollback = () => {
    if (rollbackTarget) {
      rollbackMutation.mutate({ adjustmentId: rollbackTarget.id });
    }
  };

  const handleBatchRollback = () => {
    if (selectedIds.length === 0) return;
    batchRollbackMutation.mutate({ adjustmentIds: selectedIds });
  };

  const toggleSelectAll = () => {
    if (!adjustmentData?.records) return;
    const rollbackableIds = adjustmentData.records
      .filter((r: any) => r.status === 'applied')
      .map((r: any) => r.id);
    if (selectedIds.length === rollbackableIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rollbackableIds);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // ==================== 渲染 ====================

  return (
    <div className="space-y-4">
      {/* 统计摘要卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">30天调整次数</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {adjustmentStats ? (Array.isArray(adjustmentStats) ? adjustmentStats.reduce((s: number, t: any) => s + (t.count || 0), 0) : 0) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">执行成功率</span>
            </div>
            <p className="text-xl font-bold mt-1 text-green-400">
              {adjustmentData?.records ? 
                `${((adjustmentData.records.filter((r: any) => r.status === 'applied').length / Math.max(adjustmentData.records.length, 1)) * 100).toFixed(0)}%` 
                : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">有追踪数据</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {trackingStats ? (typeof trackingStats === 'object' && 'totalTracked' in (trackingStats as any) ? (trackingStats as any).totalTracked : '-') : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-orange-400" />
              <span className="text-xs text-muted-foreground">已回滚</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {adjustmentData?.records ? 
                adjustmentData.records.filter((r: any) => r.status === 'rolled_back').length 
                : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 选项卡 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="adjustments" className="flex items-center gap-1">
            <History className="h-3.5 w-3.5" />
            出价调整历史
          </TabsTrigger>
          <TabsTrigger value="tracking" className="flex items-center gap-1">
            <BarChart3 className="h-3.5 w-3.5" />
            效果追踪
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            操作日志
          </TabsTrigger>
        </TabsList>

        {/* ==================== 出价调整历史 Tab ==================== */}
        <TabsContent value="adjustments" className="mt-4">
          {/* 筛选栏 */}
          <div className="flex items-center gap-3 mb-4">
            <Select value={adjustmentType} onValueChange={(v) => { setAdjustmentType(v); setAdjustmentPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="调整类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="auto_optimal">自动优化</SelectItem>
                <SelectItem value="auto_dayparting">分时竞价</SelectItem>
                <SelectItem value="auto_placement">位置优化</SelectItem>
                <SelectItem value="manual">手动调整</SelectItem>
                <SelectItem value="batch_campaign">批量调整</SelectItem>
              </SelectContent>
            </Select>
            
            {selectedIds.length > 0 && (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={handleBatchRollback}
                disabled={batchRollbackMutation.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                批量回滚 ({selectedIds.length})
              </Button>
            )}
            
            <div className="flex-1" />
            
            <Button variant="outline" size="sm" onClick={() => refetchAdjustments()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              刷新
            </Button>
          </div>

          {/* 表格 */}
          {adjustmentsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !adjustmentData?.records?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>暂无出价调整记录</p>
              <p className="text-sm mt-1">系统执行自动优化后，调整记录将显示在这里</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox 
                          checked={selectedIds.length > 0 && selectedIds.length === adjustmentData.records.filter((r: any) => r.status === 'applied').length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>关键词/目标</TableHead>
                      <TableHead>广告活动</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead className="text-right">原出价</TableHead>
                      <TableHead className="text-right">新出价</TableHead>
                      <TableHead className="text-right">变化</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>7天效果</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustmentData.records.map((record: any) => {
                      const typeInfo = ADJUSTMENT_TYPE_LABELS[record.adjustmentType] || { label: record.adjustmentType, color: "bg-gray-500/20 text-gray-400" };
                      const statusInfo = STATUS_LABELS[record.status] || STATUS_LABELS.pending;
                      const StatusIcon = statusInfo.icon;
                      const changePercent = record.bidChangePercent ? parseFloat(record.bidChangePercent) : 0;
                      const prevBid = parseFloat(record.previousBid || '0');
                      const newBid = parseFloat(record.newBid || '0');
                      
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            {record.status === 'applied' && (
                              <Checkbox 
                                checked={selectedIds.includes(record.id)}
                                onCheckedChange={() => toggleSelect(record.id)}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {record.appliedAt ? new Date(record.appliedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </TableCell>
                          <TableCell className="max-w-[160px] truncate font-medium text-sm">
                            {record.keywordText || '-'}
                            {record.matchType && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1">{record.matchType}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                            {record.campaignName || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${typeInfo.color}`}>{typeInfo.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {currencySymbol}{prevBid.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium">
                            {currencySymbol}{newBid.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`flex items-center justify-end gap-0.5 text-sm font-medium ${changePercent > 0 ? 'text-green-400' : changePercent < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                              {changePercent > 0 ? <ArrowUpRight className="h-3 w-3" /> : changePercent < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                              {changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`flex items-center gap-1 text-xs ${statusInfo.color}`}>
                              <StatusIcon className="h-3 w-3" />
                              {statusInfo.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            {record.actualProfit7D !== null && record.actualProfit7D !== undefined ? (
                              <span className={`text-xs font-medium ${parseFloat(record.actualProfit7D) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {parseFloat(record.actualProfit7D) >= 0 ? '+' : ''}{currencySymbol}{parseFloat(record.actualProfit7D).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">待追踪</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.status === 'applied' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleRollback(record.id, record.keywordText || '未知')}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                回滚
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {adjustmentData.total > 20 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    共 {adjustmentData.total} 条记录
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={adjustmentPage <= 1}
                      onClick={() => setAdjustmentPage(p => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">第 {adjustmentPage} 页</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={adjustmentPage * 20 >= adjustmentData.total}
                      onClick={() => setAdjustmentPage(p => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ==================== 效果追踪 Tab ==================== */}
        <TabsContent value="tracking" className="mt-4">
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              系统自动追踪每次出价调整后7天、14天、30天的实际效果，帮助您验证优化决策是否正确。
            </div>
            
            {adjustmentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !adjustmentData?.records?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>暂无追踪数据</p>
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>调整时间</TableHead>
                      <TableHead>关键词/目标</TableHead>
                      <TableHead>调整类型</TableHead>
                      <TableHead className="text-right">出价变化</TableHead>
                      <TableHead className="text-right">7天利润</TableHead>
                      <TableHead className="text-right">14天利润</TableHead>
                      <TableHead className="text-right">30天利润</TableHead>
                      <TableHead className="text-right">7天点击</TableHead>
                      <TableHead className="text-right">7天转化</TableHead>
                      <TableHead className="text-right">7天花费</TableHead>
                      <TableHead className="text-right">7天收入</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustmentData.records
                      .filter((r: any) => r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null)
                      .map((record: any) => {
                        const typeInfo = ADJUSTMENT_TYPE_LABELS[record.adjustmentType] || { label: record.adjustmentType, color: "bg-gray-500/20 text-gray-400" };
                        const prevBid = parseFloat(record.previousBid || '0');
                        const newBid = parseFloat(record.newBid || '0');
                        const changeStr = newBid > prevBid ? `+${currencySymbol}${(newBid - prevBid).toFixed(2)}` : `-${currencySymbol}${(prevBid - newBid).toFixed(2)}`;
                        
                        const renderProfit = (val: any) => {
                          if (val === null || val === undefined) return <span className="text-muted-foreground">-</span>;
                          const num = parseFloat(val);
                          return <span className={num >= 0 ? 'text-green-400' : 'text-red-400'}>{num >= 0 ? '+' : ''}{currencySymbol}{num.toFixed(2)}</span>;
                        };
                        
                        return (
                          <TableRow key={record.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {record.appliedAt ? new Date(record.appliedAt).toLocaleDateString('zh-CN') : '-'}
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate font-medium text-sm">
                              {record.keywordText || '-'}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${typeInfo.color}`}>{typeInfo.label}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className={newBid > prevBid ? 'text-green-400' : 'text-red-400'}>{changeStr}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{renderProfit(record.actualProfit7D)}</TableCell>
                            <TableCell className="text-right text-sm">{renderProfit(record.actualProfit14D)}</TableCell>
                            <TableCell className="text-right text-sm">{renderProfit(record.actualProfit30D)}</TableCell>
                            <TableCell className="text-right text-sm">{record.actualClicks7D ?? '-'}</TableCell>
                            <TableCell className="text-right text-sm">{record.actualConversions7D ?? '-'}</TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {record.actualSpend7D ? `${currencySymbol}${parseFloat(record.actualSpend7D).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {record.actualRevenue7D ? `${currencySymbol}${parseFloat(record.actualRevenue7D).toFixed(2)}` : '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {adjustmentData.records.filter((r: any) => r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          暂无追踪数据。出价调整后7天将开始生成追踪报告。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ==================== 操作日志 Tab ==================== */}
        <TabsContent value="logs" className="mt-4">
          {/* 日志类别筛选 */}
          <div className="flex items-center gap-3 mb-4">
            <Select value={logCategory} onValueChange={(v) => { setLogCategory(v); setLogPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="日志类别" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LOG_CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              刷新
            </Button>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !logsData?.logs?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>暂无操作日志</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>类别</TableHead>
                      <TableHead>操作类型</TableHead>
                      <TableHead>广告活动</TableHead>
                      <TableHead>变更详情</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData.logs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {LOG_CATEGORY_LABELS[log.logCategory] || log.logCategory}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.actionType?.replace(/_/g, ' ') || '-'}</TableCell>
                        <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                          {log.campaignName || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.previousValue && log.newValue ? (
                            <span>
                              <span className="text-muted-foreground">{log.previousValue}</span>
                              <span className="mx-1">→</span>
                              <span className="font-medium">{log.newValue}</span>
                            </span>
                          ) : log.actionDetail ? (
                            <span className="text-xs text-muted-foreground max-w-[200px] truncate block">
                              {typeof log.actionDetail === 'string' ? log.actionDetail.slice(0, 80) : JSON.stringify(log.actionDetail).slice(0, 80)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                          {log.changeReason || '-'}
                        </TableCell>
                        <TableCell>
                          {log.status === 'success' ? (
                            <Badge className="bg-green-500/20 text-green-400 text-[10px]">成功</Badge>
                          ) : log.status === 'failed' ? (
                            <Badge className="bg-red-500/20 text-red-400 text-[10px]">失败</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{log.status}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {logsData.total > 20 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">共 {logsData.total} 条记录</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">第 {logPage} 页</span>
                    <Button variant="outline" size="sm" disabled={logPage * 20 >= logsData.total} onClick={() => setLogPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* 回滚确认对话框 */}
      <Dialog open={rollbackDialogOpen} onOpenChange={setRollbackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              确认回滚
            </DialogTitle>
            <DialogDescription>
              确定要将 <strong>{rollbackTarget?.keyword}</strong> 的出价回滚到调整前的值吗？
              此操作将通过Amazon API恢复原始出价。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackDialogOpen(false)}>取消</Button>
            <Button 
              variant="destructive" 
              onClick={confirmRollback}
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              确认回滚
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
