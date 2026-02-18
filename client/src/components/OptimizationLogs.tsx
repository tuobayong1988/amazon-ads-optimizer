/**
 * OptimizationLogs - 优化日志组件 v134
 * 展示优化目标的完整操作日志，包含：
 * - 具体关键词/商品定向名称（摘要行直接显示）
 * - 出价变化（旧价 → 新价）
 * - 调整原因
 * - Amazon API同步状态（是否已传递到亚马逊执行）
 * - 完整执行链路：本地决策 → API调用 → Amazon确认
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  History,
  Target,
  DollarSign,
  Layers,
  Settings,
  User,
  Calendar,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Cloud,
  CloudOff,
  Loader2,
  ExternalLink,
  Tag,
  Package,
} from "lucide-react";

// 日志分类配置
const LOG_CATEGORIES = {
  all: { label: '全部日志', icon: History, color: 'text-gray-400' },
  performance_target: { label: '绩效组和目标', icon: Target, color: 'text-blue-400' },
  bid_adjustment: { label: '出价调整', icon: DollarSign, color: 'text-orange-400' },
  placement_adjustment: { label: '层面调整', icon: Layers, color: 'text-purple-400' },
  optimization_settings: { label: '优化设置', icon: Settings, color: 'text-green-400' },
};

// 操作类型标签
const ACTION_TYPE_LABELS: Record<string, { label: string; color: string; icon?: string }> = {
  create_target: { label: '创建目标', color: 'bg-green-500/20 text-green-400' },
  update_target: { label: '更新目标', color: 'bg-blue-500/20 text-blue-400' },
  delete_target: { label: '删除目标', color: 'bg-red-500/20 text-red-400' },
  pause_target: { label: '暂停目标', color: 'bg-yellow-500/20 text-yellow-400' },
  resume_target: { label: '恢复目标', color: 'bg-green-500/20 text-green-400' },
  add_campaign: { label: '添加广告活动', color: 'bg-blue-500/20 text-blue-400' },
  remove_campaign: { label: '移除广告活动', color: 'bg-orange-500/20 text-orange-400' },
  bid_increase: { label: '提高出价', color: 'bg-green-500/20 text-green-400', icon: '↑' },
  bid_decrease: { label: '降低出价', color: 'bg-red-500/20 text-red-400', icon: '↓' },
  bid_set: { label: '设置出价', color: 'bg-blue-500/20 text-blue-400' },
  bid_auto_adjust: { label: '自动调整出价', color: 'bg-purple-500/20 text-purple-400' },
  placement_adjust: { label: '调整广告位', color: 'bg-purple-500/20 text-purple-400' },
  placement_enable: { label: '启用广告位', color: 'bg-green-500/20 text-green-400' },
  placement_disable: { label: '禁用广告位', color: 'bg-red-500/20 text-red-400' },
  settings_update: { label: '更新设置', color: 'bg-blue-500/20 text-blue-400' },
  strategy_change: { label: '更换策略', color: 'bg-orange-500/20 text-orange-400' },
  schedule_update: { label: '更新计划', color: 'bg-cyan-500/20 text-cyan-400' },
  search_term_harvest: { label: '搜索词收割', color: 'bg-teal-500/20 text-teal-400' },
  negative_keyword_add: { label: '添加否定词', color: 'bg-red-500/20 text-red-400' },
  negative_keyword_remove: { label: '移除否定词', color: 'bg-green-500/20 text-green-400' },
  keyword_create: { label: '创建关键词', color: 'bg-blue-500/20 text-blue-400' },
  target_pause: { label: '暂停投放词', color: 'bg-yellow-500/20 text-yellow-400', icon: '⏸' },
  target_enable: { label: '启用投放词', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  campaign_pause: { label: '暂停广告活动', color: 'bg-red-500/20 text-red-400', icon: '⏸' },
  campaign_enable: { label: '启用广告活动', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  adgroup_pause: { label: '暂停广告组', color: 'bg-orange-500/20 text-orange-400', icon: '⏸' },
  adgroup_enable: { label: '启用广告组', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  dayparting_bid: { label: '分时竞价', color: 'bg-cyan-500/20 text-cyan-400', icon: '⏰' },
  budget_adjustment: { label: '预算调整', color: 'bg-emerald-500/20 text-emerald-400', icon: '💰' },
};

// API同步状态配置
const API_SYNC_STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string; bgColor: string }> = {
  synced: { label: '已同步到Amazon', icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  failed: { label: 'Amazon同步失败', icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  pending: { label: '待同步', icon: Clock, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  partial: { label: '部分同步', icon: AlertCircle, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  not_applicable: { label: '无需同步', icon: Cloud, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
};

// 状态标签
const STATUS_LABELS: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  success: { label: '成功', icon: CheckCircle, color: 'text-green-400' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-400' },
  pending: { label: '待执行', icon: Clock, color: 'text-yellow-400' },
  rolled_back: { label: '已回滚', icon: AlertCircle, color: 'text-orange-400' },
};

interface OptimizationLogsProps {
  performanceGroupId: number;
  performanceGroupName?: string;
}

export function OptimizationLogs({ performanceGroupId, performanceGroupName }: OptimizationLogsProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 获取日志列表
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = trpc.performanceGroup.getLogs.useQuery({
    performanceGroupId,
    category: activeCategory as any,
    page,
    pageSize,
  }, {
    enabled: !!performanceGroupId,
  });

  // 过滤日志
  const filteredLogs = useMemo(() => {
    if (!logsData?.logs) return [];
    if (!searchQuery) return logsData.logs;
    
    const query = searchQuery.toLowerCase();
    return logsData.logs.filter((log: any) => 
      log.performanceGroupName?.toLowerCase().includes(query) ||
      log.campaignName?.toLowerCase().includes(query) ||
      log.userName?.toLowerCase().includes(query) ||
      log.actionDetail?.toLowerCase().includes(query) ||
      log.changeReason?.toLowerCase().includes(query) ||
      log.previousValue?.toLowerCase().includes(query) ||
      log.newValue?.toLowerCase().includes(query)
    );
  }, [logsData?.logs, searchQuery]);

  // 格式化日期时间
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // 解析操作详情
  const parseActionDetail = (detail: string | null) => {
    if (!detail) return null;
    try {
      return JSON.parse(detail);
    } catch {
      return { text: detail };
    }
  };

  // 从actionDetail中提取关键词/目标名称
  const getTargetName = (log: any): { name: string; isProductTarget: boolean } | null => {
    const detail = parseActionDetail(log.actionDetail);
    if (!detail) return null;
    
    // 出价调整日志
    if (detail.keywordText) {
      return { name: detail.keywordText, isProductTarget: !!detail.isProductTarget };
    }
    
    // 搜索词分析日志
    if (detail.searchTerm) {
      return { name: detail.searchTerm, isProductTarget: false };
    }
    
    // 位置调整日志
    if (detail.placement) {
      const placementNames: Record<string, string> = {
        'top_of_search': '搜索顶部',
        'product_page': '商品页面',
        'rest_of_search': '搜索其他',
      };
      return { name: placementNames[detail.placement] || detail.placement, isProductTarget: false };
    }
    
    // 关键词状态变更
    if (detail.keywordName || detail.targetName) {
      return { name: detail.keywordName || detail.targetName, isProductTarget: !!detail.isProductTarget };
    }
    
    // v135: 广告活动状态变更 - 显示广告活动名称
    if (detail.entityType === 'campaign' && detail.campaignName) {
      return { name: `广告活动: ${detail.campaignName}`, isProductTarget: false };
    }
    
    // v135: 广告组状态变更 - 显示广告组名称
    if (detail.entityType === 'adGroup' && detail.adGroupName) {
      return { name: `广告组: ${detail.adGroupName}`, isProductTarget: false };
    }
    
    return null;
  };

  // 渲染API同步状态徽章
  const renderApiSyncBadge = (log: any) => {
    const syncStatus = log.apiSyncStatus || (log.logCategory === 'bid_adjustment' || log.logCategory === 'placement_adjustment' ? 'pending' : 'not_applicable');
    const config = API_SYNC_STATUS_CONFIG[syncStatus] || API_SYNC_STATUS_CONFIG.pending;
    const SyncIcon = config.icon;
    
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.bgColor} ${config.color}`}>
        <SyncIcon className="w-3 h-3" />
        <span>{config.label}</span>
      </div>
    );
  };

  // 渲染执行链路
  const renderExecutionPipeline = (log: any) => {
    const syncStatus = log.apiSyncStatus || 'pending';
    const isApiAction = log.logCategory === 'bid_adjustment' || log.logCategory === 'placement_adjustment' || log.logCategory === 'optimization_settings';
    
    if (!isApiAction) return null;
    
    const steps = [
      { label: '优化决策', status: 'done', icon: Target },
      { label: '本地更新', status: log.status === 'success' || log.status === 'failed' ? 'done' : 'pending', icon: Settings },
      { label: 'Amazon API', status: syncStatus === 'synced' ? 'done' : syncStatus === 'failed' ? 'failed' : 'pending', icon: Cloud },
      { label: 'Amazon执行', status: syncStatus === 'synced' ? 'done' : syncStatus === 'failed' ? 'failed' : 'pending', icon: ExternalLink },
    ];
    
    return (
      <div className="flex items-center gap-1 mt-2">
        {steps.map((step, idx) => {
          const StepIcon = step.icon;
          const isLast = idx === steps.length - 1;
          let stepColor = 'text-gray-500';
          let dotColor = 'bg-gray-500';
          
          if (step.status === 'done') {
            stepColor = 'text-green-400';
            dotColor = 'bg-green-400';
          } else if (step.status === 'failed') {
            stepColor = 'text-red-400';
            dotColor = 'bg-red-400';
          } else if (step.status === 'pending') {
            stepColor = 'text-yellow-400';
            dotColor = 'bg-yellow-400';
          }
          
          return (
            <div key={idx} className="flex items-center gap-1">
              <div className={`flex items-center gap-1 ${stepColor}`}>
                <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="text-xs whitespace-nowrap">{step.label}</span>
              </div>
              {!isLast && (
                <ArrowRight className="w-3 h-3 text-gray-600" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染出价变化标签
  const renderBidChange = (log: any, compact: boolean = false) => {
    if (!log.previousValue && !log.newValue) return null;
    
    const actionDetail = parseActionDetail(log.actionDetail);
    const changePercent = actionDetail?.changePercent;
    
    return (
      <div className={`flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}`}>
        {log.previousValue && (
          <span className="text-red-400 line-through font-mono">{log.previousValue}</span>
        )}
        {log.previousValue && log.newValue && (
          <ArrowRight className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-muted-foreground`} />
        )}
        {log.newValue && (
          <span className="text-green-400 font-medium font-mono">{log.newValue}</span>
        )}
        {changePercent && (
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} px-1 py-0.5 rounded ${
            parseFloat(changePercent) > 0 
              ? 'bg-green-500/10 text-green-400' 
              : 'bg-red-500/10 text-red-400'
          }`}>
            {parseFloat(changePercent) > 0 ? '+' : ''}{changePercent}%
          </span>
        )}
      </div>
    );
  };

  // 渲染关键词/目标名称标签
  const renderTargetTag = (log: any, compact: boolean = false) => {
    const target = getTargetName(log);
    if (!target) return null;
    
    const TargetIcon = target.isProductTarget ? Package : Tag;
    
    return (
      <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 ${compact ? 'text-[11px]' : 'text-xs'} text-blue-300 max-w-[200px]`}>
        <TargetIcon className="w-3 h-3 shrink-0" />
        <span className="truncate font-mono">{target.name}</span>
      </div>
    );
  };

  // 渲染单条日志
  const renderLogItem = (log: any) => {
    const isExpanded = expandedLogId === log.id;
    const categoryConfig = LOG_CATEGORIES[log.logCategory as keyof typeof LOG_CATEGORIES] || LOG_CATEGORIES.all;
    const actionConfig = ACTION_TYPE_LABELS[log.actionType] || { label: log.actionType || '系统操作', color: 'bg-gray-500/20 text-gray-400' };
    const statusConfig = STATUS_LABELS[log.status] || STATUS_LABELS.success;
    const CategoryIcon = categoryConfig.icon;
    const StatusIcon = statusConfig.icon;
    const actionDetail = parseActionDetail(log.actionDetail);

    return (
      <div key={log.id} className="border rounded-lg mb-2 overflow-hidden">
        {/* 日志头部 */}
        <div 
          className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
        >
          {/* 移动端布局 */}
          <div className="md:hidden space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <Badge className={`${actionConfig.color} text-xs`}>
                {actionConfig.icon && <span className="mr-1">{actionConfig.icon}</span>}
                {actionConfig.label}
              </Badge>
              <StatusIcon className={`w-4 h-4 ${statusConfig.color} shrink-0`} />
              {renderApiSyncBadge(log)}
            </div>
            
            {/* 关键词名称 - 移动端 */}
            {renderTargetTag(log, true) && (
              <div className="pl-6">
                {renderTargetTag(log, true)}
              </div>
            )}
            
            {/* 出价变更 - 移动端 */}
            {(log.previousValue || log.newValue) && (
              <div className="pl-6">
                {renderBidChange(log, true)}
              </div>
            )}
            
            {/* 调整原因 - 移动端 */}
            {log.changeReason && (
              <div className="text-[11px] text-muted-foreground pl-6 line-clamp-1">
                {log.changeReason}
              </div>
            )}
            
            <div className="flex items-center gap-1 text-xs text-muted-foreground pl-6">
              <Calendar className="w-3 h-3" />
              <span>{formatDateTime(log.createdAt)}</span>
            </div>
            {log.campaignName && (
              <div className="text-[11px] text-muted-foreground pl-6 truncate">
                {log.campaignName}
              </div>
            )}
          </div>
          
          {/* PC端布局 */}
          <div className="hidden md:block">
            {/* 第一行：操作类型、关键词、出价变化、同步状态 */}
            <div className="flex items-center gap-2.5">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <CategoryIcon className={`w-4 h-4 ${categoryConfig.color} shrink-0`} />
              
              {/* 时间 */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-[140px] shrink-0">
                <Calendar className="w-3 h-3" />
                {formatDateTime(log.createdAt)}
              </div>
              
              {/* 操作类型 */}
              <Badge className={`${actionConfig.color} text-xs shrink-0`}>
                {actionConfig.icon && <span className="mr-1">{actionConfig.icon}</span>}
                {actionConfig.label}
              </Badge>
              
              {/* 关键词/目标名称 - 直接在摘要行显示 */}
              {renderTargetTag(log)}
              
              {/* 出价变更摘要 */}
              {renderBidChange(log)}
              
              {/* Amazon同步状态 */}
              {renderApiSyncBadge(log)}
              
              {/* 执行状态 */}
              <StatusIcon className={`w-4 h-4 ${statusConfig.color} shrink-0`} />
              
              {/* Campaign名称 */}
              {log.campaignName && (
                <div className="flex-1 truncate text-xs text-muted-foreground min-w-0">
                  {log.campaignName}
                </div>
              )}
            </div>
            
            {/* 第二行：调整原因（仅在未展开时显示） */}
            {!isExpanded && log.changeReason && (
              <div className="text-xs text-muted-foreground mt-1.5 ml-[30px] line-clamp-1">
                <span className="text-muted-foreground/60">原因: </span>
                {log.changeReason}
              </div>
            )}
            
            {/* 执行链路（仅在摘要行显示） */}
            {!isExpanded && renderExecutionPipeline(log)}
          </div>
        </div>
        
        {/* 展开的详情 */}
        {isExpanded && (
          <div className="border-t bg-muted/30 p-4 space-y-4">
            {/* 执行链路 */}
            <div>
              <p className="text-sm font-medium mb-2">执行链路</p>
              <div className="bg-background rounded-lg p-3">
                {renderExecutionPipeline(log)}
              </div>
            </div>
            
            <Separator />
            
            {/* 基本信息 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">执行时间</p>
                <p className="font-medium">{formatDateTime(log.executedAt || log.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">操作用户</p>
                <p className="font-medium">{log.userName || '系统自动'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">优化目标</p>
                <p className="font-medium">{log.performanceGroupName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">策略模板</p>
                <p className="font-medium">{log.strategyTemplateName || '默认策略'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">广告活动</p>
                <p className="font-medium">{log.campaignName || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">执行状态</p>
                <div className="flex items-center gap-1">
                  <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                  <span className={`font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
                </div>
              </div>
            </div>
            
            <Separator />
            
            {/* Amazon API同步详情 */}
            <div>
              <p className="text-sm font-medium mb-2">Amazon API 同步状态</p>
              <div className="bg-background rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {renderApiSyncBadge(log)}
                  {log.apiSyncedAt && (
                    <span className="text-xs text-muted-foreground">
                      同步时间: {formatDateTime(log.apiSyncedAt)}
                    </span>
                  )}
                </div>
                
                {/* API同步详情 */}
                {log.apiSyncDetail && (() => {
                  try {
                    const syncDetail = JSON.parse(log.apiSyncDetail);
                    return (
                      <div className="text-sm space-y-1">
                        <div className="flex gap-4">
                          <span className="text-green-400">成功: {syncDetail.totalSuccess || 0}</span>
                          <span className="text-red-400">失败: {syncDetail.totalFailed || 0}</span>
                        </div>
                        {syncDetail.errors && syncDetail.errors.length > 0 && (
                          <div className="text-red-400 text-xs mt-1">
                            {syncDetail.errors.map((err: string, i: number) => (
                              <p key={i}>{err}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  } catch {
                    return <p className="text-xs text-muted-foreground">{log.apiSyncDetail}</p>;
                  }
                })()}
                
                {!log.apiSyncStatus && (
                  <p className="text-xs text-muted-foreground">
                    此日志记录于API同步状态追踪功能上线前，无法确认是否已同步到Amazon
                  </p>
                )}
              </div>
            </div>
            
            <Separator />
            
            {/* 操作详情 */}
            <div>
              <p className="text-sm font-medium mb-2">操作详情</p>
              <div className="bg-background rounded-lg p-3 space-y-3">
                {/* 目标关键词/ASIN */}
                {actionDetail && actionDetail.keywordText && (
                  <div className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {actionDetail.isProductTarget ? '商品定向:' : '关键词:'}
                    </span>
                    <span className="font-mono font-medium text-blue-300">{actionDetail.keywordText}</span>
                  </div>
                )}
                
                {/* 出价变更 */}
                {(log.previousValue || log.newValue) && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0">出价变更:</span>
                    {renderBidChange(log)}
                  </div>
                )}
                
                {/* 变更原因 */}
                {log.changeReason && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">调整原因: </span>
                    <span className="text-foreground">{log.changeReason}</span>
                  </div>
                )}
                
                {/* 算法信息 */}
                {actionDetail && actionDetail.algorithmUsed && (
                  <div className="text-sm flex gap-4 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">算法: </span>
                      <Badge variant="outline" className="text-xs">{actionDetail.algorithmUsed}</Badge>
                    </span>
                    {actionDetail.confidenceScore !== undefined && (
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground">置信度: </span>
                        <span className={actionDetail.confidenceScore > 0.7 ? 'text-green-400' : actionDetail.confidenceScore > 0.4 ? 'text-yellow-400' : 'text-red-400'}>
                          {(actionDetail.confidenceScore * 100).toFixed(0)}%
                        </span>
                      </span>
                    )}
                  </div>
                )}
                
                {/* 搜索词信息（用于搜索词收割/否定词日志） */}
                {actionDetail && actionDetail.searchTerm && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">搜索词: </span>
                    <span className="font-mono text-blue-300">{actionDetail.searchTerm}</span>
                  </div>
                )}
                
                {/* 匹配类型 */}
                {actionDetail && actionDetail.matchType && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">匹配类型: </span>
                    <Badge variant="outline" className="text-xs">{actionDetail.matchType}</Badge>
                  </div>
                )}
                
                {/* 分时竞价信息 */}
                {actionDetail && actionDetail.bidMultiplier !== undefined && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">时段: </span>
                        <span className="font-medium">{actionDetail.hour}:00</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">星期: </span>
                        <span className="font-medium">{['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'][actionDetail.dayOfWeek] || actionDetail.dayOfWeek}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">乘数: </span>
                        <span className="font-medium">{actionDetail.bidMultiplier}x</span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 预算调整信息 */}
                {actionDetail && actionDetail.currentBudget !== undefined && actionDetail.suggestedBudget !== undefined && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">当前预算: </span>
                        <span className="font-mono text-red-400 line-through">${actionDetail.currentBudget.toFixed(2)}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">新预算: </span>
                        <span className="font-mono text-green-400 font-medium">${actionDetail.suggestedBudget.toFixed(2)}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">变化: </span>
                        <span className={`font-mono ${actionDetail.changeAmount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {actionDetail.changeAmount > 0 ? '+' : ''}${actionDetail.changeAmount?.toFixed(2)} ({actionDetail.changePercent}%)
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 位置调整信息 */}
                {actionDetail && actionDetail.placement && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">广告位: </span>
                        <span className="font-medium">
                          {{'top_of_search': '\u641c\u7d22\u9876\u90e8', 'product_page': '\u5546\u54c1\u9875\u9762', 'rest_of_search': '\u641c\u7d22\u5176\u4ed6'}[actionDetail.placement] || actionDetail.placement}
                        </span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">当前乘数: </span>
                        <span className="font-mono text-red-400 line-through">{actionDetail.currentMultiplier}%</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">新乘数: </span>
                        <span className="font-mono text-green-400 font-medium">{actionDetail.suggestedMultiplier}%</span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 关键词/广告活动/广告组状态变更信息 */}
                {actionDetail && (actionDetail.action === 'pause' || actionDetail.action === 'enable') && (
                  <div className="text-sm space-y-2">
                    {/* 实体类型和名称 */}
                    <div>
                      <span className="text-muted-foreground">
                        {actionDetail.entityType === 'campaign' ? '广告活动: ' : 
                         actionDetail.entityType === 'adGroup' ? '广告组: ' : '投放词: '}
                      </span>
                      <span className="font-mono font-medium text-blue-300">
                        {actionDetail.entityType === 'campaign' ? actionDetail.campaignName :
                         actionDetail.entityType === 'adGroup' ? actionDetail.adGroupName :
                         actionDetail.keywordText || '-'}
                      </span>
                    </div>
                    
                    {/* 广告组所属广告活动 */}
                    {actionDetail.entityType === 'adGroup' && actionDetail.campaignName && (
                      <div>
                        <span className="text-muted-foreground">所属广告活动: </span>
                        <span className="font-medium">{actionDetail.campaignName}</span>
                      </div>
                    )}
                    
                    {/* 状态变更 */}
                    <div>
                      <span className="text-muted-foreground">状态变更: </span>
                      <span className="text-red-400">{actionDetail.currentStatus}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1 text-muted-foreground" />
                      <span className="text-green-400 font-medium">{actionDetail.newStatus || actionDetail.action}</span>
                    </div>
                    
                    {/* 绩效数据（广告活动/广告组状态变更时显示） */}
                    {(actionDetail.entityType === 'campaign' || actionDetail.entityType === 'adGroup') && (
                      <div className="flex gap-4 flex-wrap text-xs">
                        {actionDetail.spend !== undefined && (
                          <span>
                            <span className="text-muted-foreground">花费: </span>
                            <span className="font-mono">${Number(actionDetail.spend).toFixed(2)}</span>
                          </span>
                        )}
                        {actionDetail.sales !== undefined && (
                          <span>
                            <span className="text-muted-foreground">销售: </span>
                            <span className="font-mono">${Number(actionDetail.sales).toFixed(2)}</span>
                          </span>
                        )}
                        {actionDetail.clicks !== undefined && (
                          <span>
                            <span className="text-muted-foreground">点击: </span>
                            <span className="font-mono">{actionDetail.clicks}</span>
                          </span>
                        )}
                        {actionDetail.conversions !== undefined && (
                          <span>
                            <span className="text-muted-foreground">转化: </span>
                            <span className="font-mono">{actionDetail.conversions}</span>
                          </span>
                        )}
                        {actionDetail.acos !== undefined && actionDetail.acos > 0 && (
                          <span>
                            <span className="text-muted-foreground">ACoS: </span>
                            <span className="font-mono">{Number(actionDetail.acos).toFixed(1)}%</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* 错误信息 */}
                {log.errorMessage && (
                  <div className="text-sm text-red-400 bg-red-500/10 rounded p-2 mt-2">
                    <span className="font-medium">错误: </span>
                    <span>{log.errorMessage}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              优化日志
            </CardTitle>
            <CardDescription>
              {performanceGroupName || '优化目标'}的完整操作记录与Amazon同步状态
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* 分类标签页 */}
        <Tabs value={activeCategory} onValueChange={(v) => { setActiveCategory(v); setPage(1); }}>
          <TabsList className="grid grid-cols-5 w-full">
            {Object.entries(LOG_CATEGORIES).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger key={key} value={key} className="text-xs">
                  <Icon className={`w-4 h-4 mr-1 ${config.color}`} />
                  <span className="hidden sm:inline">{config.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        
        {/* 搜索框 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索日志（关键词、广告活动、出价、原因等）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        {/* 日志列表 */}
        <ScrollArea className="h-[600px]">
          {logsLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredLogs.length > 0 ? (
            <div className="space-y-2">
              {filteredLogs.map(renderLogItem)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p>暂无日志记录</p>
            </div>
          )}
        </ScrollArea>
        
        {/* 分页 */}
        {logsData && logsData.total > pageSize && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              共 {logsData.total} 条记录，第 {page} / {Math.ceil(logsData.total / pageSize)} 页
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(logsData.total / pageSize)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OptimizationLogs;
