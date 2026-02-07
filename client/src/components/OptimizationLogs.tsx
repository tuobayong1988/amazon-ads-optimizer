/**
 * OptimizationLogs - 优化日志组件
 * 展示优化目标的完整操作日志，包含：
 * - 绩效组和目标：日期/时间、操作用户、优化目标名称、优化目标策略、帐户、Campaign名称、行动与细节
 * - 出价调整日志
 * - 层面调整日志
 * - 优化设置日志
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Filter,
  TrendingUp,
  TrendingDown,
  Activity,
  Loader2
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
const ACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  create_target: { label: '创建目标', color: 'bg-green-500/20 text-green-400' },
  update_target: { label: '更新目标', color: 'bg-blue-500/20 text-blue-400' },
  delete_target: { label: '删除目标', color: 'bg-red-500/20 text-red-400' },
  pause_target: { label: '暂停目标', color: 'bg-yellow-500/20 text-yellow-400' },
  resume_target: { label: '恢复目标', color: 'bg-green-500/20 text-green-400' },
  add_campaign: { label: '添加广告活动', color: 'bg-blue-500/20 text-blue-400' },
  remove_campaign: { label: '移除广告活动', color: 'bg-orange-500/20 text-orange-400' },
  bid_increase: { label: '提高出价', color: 'bg-green-500/20 text-green-400' },
  bid_decrease: { label: '降低出价', color: 'bg-red-500/20 text-red-400' },
  bid_set: { label: '设置出价', color: 'bg-blue-500/20 text-blue-400' },
  bid_auto_adjust: { label: '自动调整出价', color: 'bg-purple-500/20 text-purple-400' },
  placement_adjust: { label: '调整广告位', color: 'bg-purple-500/20 text-purple-400' },
  placement_enable: { label: '启用广告位', color: 'bg-green-500/20 text-green-400' },
  placement_disable: { label: '禁用广告位', color: 'bg-red-500/20 text-red-400' },
  settings_update: { label: '更新设置', color: 'bg-blue-500/20 text-blue-400' },
  strategy_change: { label: '更换策略', color: 'bg-orange-500/20 text-orange-400' },
  schedule_update: { label: '更新计划', color: 'bg-cyan-500/20 text-cyan-400' },
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

  // 日志统计暂时禁用
  const statsData: { totalLogs: number; byCategory: Array<{ category: string; count: number }> } | null = null;

  // 过滤日志
  const filteredLogs = useMemo(() => {
    if (!logsData?.logs) return [];
    if (!searchQuery) return logsData.logs;
    
    const query = searchQuery.toLowerCase();
    return logsData.logs.filter(log => 
      log.performanceGroupName?.toLowerCase().includes(query) ||
      log.campaignName?.toLowerCase().includes(query) ||
      log.userName?.toLowerCase().includes(query) ||
      log.strategyTemplateName?.toLowerCase().includes(query) ||
      log.actionDetail?.toLowerCase().includes(query)
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

  // 渲染单条日志
  const renderLogItem = (log: any) => {
    const isExpanded = expandedLogId === log.id;
    const categoryConfig = LOG_CATEGORIES[log.logCategory as keyof typeof LOG_CATEGORIES] || LOG_CATEGORIES.all;
    const actionConfig = ACTION_TYPE_LABELS[log.actionType] || { label: log.actionType, color: 'bg-gray-500/20 text-gray-400' };
    const statusConfig = STATUS_LABELS[log.status] || STATUS_LABELS.success;
    const CategoryIcon = categoryConfig.icon;
    const StatusIcon = statusConfig.icon;
    const actionDetail = parseActionDetail(log.actionDetail);

    return (
      <div key={log.id} className="border rounded-lg mb-2 overflow-hidden">
        {/* 日志头部 */}
        <div 
          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
        >
          {/* 展开/收起图标 */}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* 分类图标 */}
          <CategoryIcon className={`w-5 h-5 ${categoryConfig.color}`} />
          
          {/* 时间 */}
          <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-[140px]">
            <Calendar className="w-3 h-3" />
            {formatDateTime(log.createdAt)}
          </div>
          
          {/* 操作类型 */}
          <Badge className={`${actionConfig.color} text-xs`}>
            {actionConfig.label}
          </Badge>
          
          {/* 状态 */}
          <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
          
          {/* 操作用户 */}
          <div className="flex items-center gap-1 text-sm">
            <User className="w-3 h-3 text-muted-foreground" />
            <span>{log.userName || '系统'}</span>
          </div>
          
          {/* Campaign名称（如果有） */}
          {log.campaignName && (
            <div className="flex-1 truncate text-sm text-muted-foreground">
              {log.campaignName}
            </div>
          )}
        </div>
        
        {/* 展开的详情 */}
        {isExpanded && (
          <div className="border-t bg-muted/30 p-4 space-y-3">
            {/* 基本信息表格 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">日期/时间</p>
                <p className="font-medium">{formatDateTime(log.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">操作用户</p>
                <p className="font-medium">{log.userName || '系统自动'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">优化目标名称</p>
                <p className="font-medium">{log.performanceGroupName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">优化目标策略</p>
                <p className="font-medium">{log.strategyTemplateName || '默认策略'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">帐户</p>
                <p className="font-medium">{log.accountName || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Campaign名称</p>
                <p className="font-medium">{log.campaignName || '-'}</p>
              </div>
            </div>
            
            <Separator />
            
            {/* 行动与细节 */}
            <div>
              <p className="text-muted-foreground text-sm mb-2">行动与细节</p>
              <div className="bg-background rounded-lg p-3 space-y-2">
                {/* 变更值 */}
                {(log.previousValue || log.newValue) && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">变更:</span>
                    {log.previousValue && (
                      <span className="text-red-400 line-through">{log.previousValue}</span>
                    )}
                    {log.previousValue && log.newValue && (
                      <span className="text-muted-foreground">→</span>
                    )}
                    {log.newValue && (
                      <span className="text-green-400">{log.newValue}</span>
                    )}
                  </div>
                )}
                
                {/* 变更原因 */}
                {log.changeReason && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">原因: </span>
                    <span>{log.changeReason}</span>
                  </div>
                )}
                
                {/* 详细信息 */}
                {actionDetail && (
                  <div className="text-sm">
                    {actionDetail.text ? (
                      <p>{actionDetail.text}</p>
                    ) : (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(actionDetail, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
                
                {/* 错误信息 */}
                {log.errorMessage && (
                  <div className="text-sm text-red-400">
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
              {performanceGroupName || '优化目标'}的完整操作记录
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* 统计卡片 */}
        {statsData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{statsData.totalLogs}</p>
              <p className="text-xs text-muted-foreground">30天总日志</p>
            </div>
            {statsData.byCategory.slice(0, 3).map((cat) => {
              const config = LOG_CATEGORIES[cat.category as keyof typeof LOG_CATEGORIES];
              const Icon = config?.icon || History;
              return (
                <div key={cat.category} className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Icon className={`w-4 h-4 ${config?.color || 'text-gray-400'}`} />
                  </div>
                  <p className="text-xl font-bold">{cat.count}</p>
                  <p className="text-xs text-muted-foreground">{config?.label || cat.category}</p>
                </div>
              );
            })}
          </div>
        )}
        
        {/* 分类标签页 */}
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="grid grid-cols-5 w-full">
            {Object.entries(LOG_CATEGORIES).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger key={key} value={key} className="text-xs">
                  <Icon className={`w-4 h-4 mr-1 ${config.color}`} />
                  {config.label}
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
              placeholder="搜索日志..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        {/* 日志列表 */}
        <ScrollArea className="h-[500px]">
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
