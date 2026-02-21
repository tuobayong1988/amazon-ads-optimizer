/**
 * UnifiedHistoryTracker - 统一历史与追踪组件 v146
 * 数据源：optimization_events 统一事件表
 * 
 * 功能：
 * 1. 出价调整历史（含筛选、分页、API同步状态）
 * 2. 效果追踪（7/14/30天实际效果对比）
 * 3. 回滚操作（单个+批量）
 * 4. 全部操作日志（所有事件类别）
 * 5. 统计摘要（30天趋势）
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  RotateCcw,
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
  CloudOff,
  Cloud,
  Zap,
} from "lucide-react";

interface UnifiedHistoryTrackerProps {
  performanceGroupId: number;
  performanceGroupName: string;
  currencySymbol?: string;
}

// 事件类别标签
const EVENT_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  bid_adjustment: { label: "出价调整", color: "bg-blue-500/20 text-blue-400" },
  placement_adjustment: { label: "位置调整", color: "bg-orange-500/20 text-orange-400" },
  budget_adjustment: { label: "预算调整", color: "bg-green-500/20 text-green-400" },
  search_term_action: { label: "搜索词操作", color: "bg-purple-500/20 text-purple-400" },
  keyword_action: { label: "关键词操作", color: "bg-cyan-500/20 text-cyan-400" },
  campaign_action: { label: "广告活动", color: "bg-indigo-500/20 text-indigo-400" },
  target_management: { label: "目标管理", color: "bg-yellow-500/20 text-yellow-400" },
  settings_change: { label: "设置变更", color: "bg-gray-500/20 text-gray-400" },
};

// 操作类型标签（出价相关）
const ACTION_TYPE_LABELS: Record<string, string> = {
  bid_increase: "出价上调",
  bid_decrease: "出价下调",
  bid_set: "出价设置",
  bid_auto_adjust: "自动调整",
  dayparting_bid: "分时竞价",
  budget_increase: "预算上调",
  budget_decrease: "预算下调",
  budget_set: "预算设置",
  placement_adjust: "位置调整",
  search_term_harvest: "搜索词采集",
  negative_keyword_add: "添加否定词",
  keyword_create: "创建关键词",
  target_pause: "暂停目标",
  target_enable: "启用目标",
  campaign_pause: "暂停活动",
  campaign_enable: "启用活动",
  create_target: "创建目标",
  update_target: "更新目标",
  settings_update: "更新设置",
  strategy_change: "策略变更",
};

// 调整来源标签
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
  success: { label: "成功", icon: CheckCircle, color: "text-green-400" },
  pending: { label: "待执行", icon: Clock, color: "text-yellow-400" },
  failed: { label: "失败", icon: XCircle, color: "text-red-400" },
  rolled_back: { label: "已回滚", icon: RotateCcw, color: "text-gray-400" },
  skipped: { label: "已跳过", icon: AlertTriangle, color: "text-muted-foreground" },
};

// API同步状态标签
const API_SYNC_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  synced: { label: "已同步", icon: Cloud, color: "text-green-400" },
  pending: { label: "同步中", icon: Clock, color: "text-yellow-400" },
  failed: { label: "同步失败", icon: CloudOff, color: "text-red-400" },
  not_applicable: { label: "-", icon: null, color: "text-muted-foreground" },
};

export function UnifiedHistoryTracker({ performanceGroupId, performanceGroupName, currencySymbol = "$" }: UnifiedHistoryTrackerProps) {
  const [activeTab, setActiveTab] = useState("adjustments");
  
  // 出价调整历史筛选
  const [adjustmentType, setAdjustmentType] = useState<string>("all");
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: number; keyword: string } | null>(null);
  
  // 全部日志筛选
  const [logCategory, setLogCategory] = useState<string>("all");
  const [logPage, setLogPage] = useState(1);

  // ==================== API 调用（统一事件表） ====================
  
  // 出价调整历史 - 从统一事件表查询 bid_adjustment 类别
  const { data: adjustmentData, isLoading: adjustmentsLoading, refetch: refetchAdjustments } = 
    trpc.performanceGroup.getOptimizationEvents.useQuery({
      performanceGroupId,
      eventCategory: 'bid_adjustment',
      actionType: adjustmentType !== "all" ? adjustmentType : undefined,
      page: adjustmentPage,
      pageSize: 20,
    }, { enabled: !!performanceGroupId });

  // 统一事件统计
  const { data: eventStats } = trpc.performanceGroup.getOptimizationEventStats.useQuery({
    performanceGroupId,
    days: 30,
  }, { enabled: !!performanceGroupId });

  // 全部操作日志 - 从统一事件表查询所有类别
  const { data: allEventsData, isLoading: allEventsLoading, refetch: refetchAllEvents } = 
    trpc.performanceGroup.getOptimizationEvents.useQuery({
      performanceGroupId,
      eventCategory: logCategory !== "all" ? logCategory : undefined,
      page: logPage,
      pageSize: 20,
    }, { enabled: !!performanceGroupId });

  // 回滚mutation - 使用统一事件表的回滚API
  const rollbackMutation = trpc.performanceGroup.rollbackOptimizationEvent.useMutation({
    onSuccess: () => {
      toast.success("回滚成功，已通过Amazon API恢复原始出价");
      refetchAdjustments();
      refetchAllEvents();
      setRollbackDialogOpen(false);
      setRollbackTarget(null);
    },
    onError: (error: any) => {
      toast.error(`回滚失败: ${error.message}`);
    },
  });

  // ==================== 事件处理 ====================

  const handleRollback = (id: number, keyword: string) => {
    setRollbackTarget({ id, keyword });
    setRollbackDialogOpen(true);
  };

  const confirmRollback = () => {
    if (rollbackTarget) {
      rollbackMutation.mutate({ eventId: rollbackTarget.id });
    }
  };

  const handleBatchRollback = () => {
    if (selectedIds.length === 0) return;
    // 逐个回滚
    selectedIds.forEach(id => {
      rollbackMutation.mutate({ eventId: id });
    });
    setSelectedIds([]);
  };

  const toggleSelectAll = () => {
    if (!adjustmentData?.events) return;
    const rollbackableIds = adjustmentData.events
      .filter((r: any) => r.status === 'success')
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

  // ==================== 辅助函数 ====================

  const renderApiSyncBadge = (syncStatus: string | null) => {
    const info = API_SYNC_LABELS[syncStatus || 'not_applicable'] || API_SYNC_LABELS.not_applicable;
    if (!info.icon) return <span className="text-xs text-muted-foreground">-</span>;
    const Icon = info.icon;
    return (
      <span className={`flex items-center gap-1 text-xs ${info.color}`}>
        <Icon className="h-3 w-3" />
        {info.label}
      </span>
    );
  };

  const renderProfit = (val: any) => {
    if (val === null || val === undefined) return <span className="text-muted-foreground">-</span>;
    const num = parseFloat(val);
    return (
      <span className={num >= 0 ? 'text-green-400' : 'text-red-400'}>
        {num >= 0 ? '+' : ''}{currencySymbol}{num.toFixed(2)}
      </span>
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
              <span className="text-xs text-muted-foreground">30天操作总数</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {eventStats?.totalEvents ?? '-'}
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
              {eventStats ? `${eventStats.successRate}%` : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">出价调整</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {eventStats?.byCategory?.find((c: any) => c.category === 'bid_adjustment')?.count ?? 0}
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
              {eventStats?.byStatus?.find((s: any) => s.status === 'rolled_back')?.count ?? 0}
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
            全部操作日志
          </TabsTrigger>
        </TabsList>

        {/* ==================== 出价调整历史 Tab ==================== */}
        <TabsContent value="adjustments" className="mt-4">
          {/* 筛选栏 */}
          <div className="flex items-center gap-3 mb-4">
            <Select value={adjustmentType} onValueChange={(v) => { setAdjustmentType(v); setAdjustmentPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="操作类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="bid_increase">出价上调</SelectItem>
                <SelectItem value="bid_decrease">出价下调</SelectItem>
                <SelectItem value="bid_auto_adjust">自动调整</SelectItem>
                <SelectItem value="dayparting_bid">分时竞价</SelectItem>
              </SelectContent>
            </Select>
            
            {selectedIds.length > 0 && (
              <Button 
                variant="destructive"
                size="sm"
                onClick={handleBatchRollback}
                disabled={rollbackMutation.isPending}
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
          ) : !adjustmentData?.events?.length ? (
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
                          checked={selectedIds.length > 0 && selectedIds.length === adjustmentData.events.filter((r: any) => r.status === 'success').length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>关键词/目标</TableHead>
                      <TableHead>广告活动</TableHead>
                      <TableHead>操作</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead className="text-right">原出价</TableHead>
                      <TableHead className="text-right">新出价</TableHead>
                      <TableHead className="text-right">变化</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>API同步</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustmentData.events.map((record: any) => {
                      const statusInfo = STATUS_LABELS[record.status] || STATUS_LABELS.pending;
                      const StatusIcon = statusInfo.icon;
                      const changePercent = record.bidChangePercent ? parseFloat(record.bidChangePercent) : 0;
                      const prevBid = parseFloat(record.previousBid || '0');
                      const newBid = parseFloat(record.newBid || '0');
                      const adjType = ADJUSTMENT_TYPE_LABELS[record.adjustmentType] || { label: record.adjustmentType || '自动', color: "bg-gray-500/20 text-gray-400" };
                      
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            {record.status === 'success' && (
                              <Checkbox 
                                checked={selectedIds.includes(record.id)}
                                onCheckedChange={() => toggleSelect(record.id)}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {record.createdAt ? safeToLocaleString(record.createdAt, 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </TableCell>
                          <TableCell className="max-w-[160px] truncate font-medium text-sm">
                            {record.keywordText || record.targetName || '-'}
                            {record.matchType && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1">{record.matchType}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                            {record.campaignName || '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {ACTION_TYPE_LABELS[record.actionType] || record.actionType}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${adjType.color}`}>{adjType.label}</Badge>
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
                          <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                            {record.changeReason || '-'}
                          </TableCell>
                          <TableCell>
                            <span className={`flex items-center gap-1 text-xs ${statusInfo.color}`}>
                              <StatusIcon className="h-3 w-3" />
                              {statusInfo.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            {renderApiSyncBadge(record.apiSyncStatus)}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.status === 'success' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleRollback(record.id, record.keywordText || record.targetName || '未知')}
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
                    <Button variant="outline" size="sm" disabled={adjustmentPage <= 1} onClick={() => setAdjustmentPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">第 {adjustmentPage} 页</span>
                    <Button variant="outline" size="sm" disabled={adjustmentPage * 20 >= adjustmentData.total} onClick={() => setAdjustmentPage(p => p + 1)}>
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
            ) : !adjustmentData?.events?.length ? (
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
                      <TableHead>操作</TableHead>
                      <TableHead className="text-right">出价变化</TableHead>
                      <TableHead>API同步</TableHead>
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
                    {adjustmentData.events
                      .filter((r: any) => r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null)
                      .map((record: any) => {
                        const prevBid = parseFloat(record.previousBid || '0');
                        const newBid = parseFloat(record.newBid || '0');
                        const changeStr = newBid >= prevBid 
                          ? `+${currencySymbol}${(newBid - prevBid).toFixed(2)}` 
                          : `-${currencySymbol}${(prevBid - newBid).toFixed(2)}`;
                        
                        return (
                          <TableRow key={record.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {record.createdAt ? safeToLocaleDateString(record.createdAt, 'zh-CN') : '-'}
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate font-medium text-sm">
                              {record.keywordText || record.targetName || '-'}
                            </TableCell>
                            <TableCell className="text-xs">
                              {ACTION_TYPE_LABELS[record.actionType] || record.actionType}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className={newBid >= prevBid ? 'text-green-400' : 'text-red-400'}>{changeStr}</span>
                            </TableCell>
                            <TableCell>
                              {renderApiSyncBadge(record.apiSyncStatus)}
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
                    {adjustmentData.events.filter((r: any) => r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
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

        {/* ==================== 全部操作日志 Tab ==================== */}
        <TabsContent value="logs" className="mt-4">
          {/* 类别筛选 */}
          <div className="flex items-center gap-3 mb-4">
            <Select value={logCategory} onValueChange={(v) => { setLogCategory(v); setLogPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="事件类别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类别</SelectItem>
                <SelectItem value="bid_adjustment">出价调整</SelectItem>
                <SelectItem value="placement_adjustment">位置调整</SelectItem>
                <SelectItem value="budget_adjustment">预算调整</SelectItem>
                <SelectItem value="search_term_action">搜索词操作</SelectItem>
                <SelectItem value="keyword_action">关键词操作</SelectItem>
                <SelectItem value="target_management">目标管理</SelectItem>
                <SelectItem value="settings_change">设置变更</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => refetchAllEvents()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              刷新
            </Button>
          </div>

          {allEventsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !allEventsData?.events?.length ? (
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
                      <TableHead>操作</TableHead>
                      <TableHead>广告活动</TableHead>
                      <TableHead>关键词/目标</TableHead>
                      <TableHead>变更详情</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>API同步</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allEventsData.events.map((event: any) => {
                      const catInfo = EVENT_CATEGORY_LABELS[event.eventCategory] || { label: event.eventCategory, color: "bg-gray-500/20 text-gray-400" };
                      const statusInfo = STATUS_LABELS[event.status] || STATUS_LABELS.pending;
                      const StatusIcon = statusInfo.icon;
                      
                      // 构建变更详情显示
                      let changeDetail = '';
                      if (event.previousBid && event.newBid) {
                        changeDetail = `${currencySymbol}${parseFloat(event.previousBid).toFixed(2)} → ${currencySymbol}${parseFloat(event.newBid).toFixed(2)}`;
                      } else if (event.previousValue && event.newValue) {
                        changeDetail = `${event.previousValue} → ${event.newValue}`;
                      } else if (event.actionDetail) {
                        const detail = typeof event.actionDetail === 'string' ? event.actionDetail : JSON.stringify(event.actionDetail);
                        changeDetail = detail.slice(0, 80);
                      }
                      
                      return (
                        <TableRow key={event.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {event.createdAt ? safeToLocaleString(event.createdAt, 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${catInfo.color}`}>{catInfo.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {ACTION_TYPE_LABELS[event.actionType] || event.actionType?.replace(/_/g, ' ') || '-'}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                            {event.campaignName || '-'}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs">
                            {event.keywordText || event.targetName || '-'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {changeDetail ? (
                              <span className="text-xs">
                                {event.previousBid && event.newBid ? (
                                  <>
                                    <span className="text-muted-foreground">{currencySymbol}{parseFloat(event.previousBid).toFixed(2)}</span>
                                    <span className="mx-1">→</span>
                                    <span className="font-medium">{currencySymbol}{parseFloat(event.newBid).toFixed(2)}</span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground max-w-[200px] truncate block">{changeDetail}</span>
                                )}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                            {event.changeReason || '-'}
                          </TableCell>
                          <TableCell>
                            <span className={`flex items-center gap-1 text-xs ${statusInfo.color}`}>
                              <StatusIcon className="h-3 w-3" />
                              {statusInfo.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            {renderApiSyncBadge(event.apiSyncStatus)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {allEventsData.total > 20 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">共 {allEventsData.total} 条记录</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">第 {logPage} 页</span>
                    <Button variant="outline" size="sm" disabled={logPage * 20 >= allEventsData.total} onClick={() => setLogPage(p => p + 1)}>
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
