import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  RefreshCw, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Database,
  FileText,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Calendar,
  BarChart3,
  Activity,
  Loader2
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

type LogLevel = 'all' | 'info' | 'warning' | 'error' | 'success';
type LogType = 'all' | 'campaign' | 'adGroup' | 'keyword' | 'productTarget' | 'performance' | 'negativeKeyword';

export default function SyncLogs() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [typeFilter, setTypeFilter] = useState<LogType>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const pageSize = 50;

  // 获取用户的所有账户
  const { data: accounts } = trpc.adAccount.list.useQuery(
    undefined,
    { enabled: !!user?.id }
  );

  // 获取同步历史记录
  const { data: syncHistoryData, isLoading: logsLoading, refetch: refetchLogs } = trpc.amazonApi.getSyncHistory.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );
  
  // 转换同步历史为日志格式
  const logsData = useMemo(() => {
    if (!syncHistoryData?.jobs) return { logs: [], total: 0 };
    
    const logs = syncHistoryData.jobs.map((job: any) => ({
      id: job.id,
      level: job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'info',
      logType: 'sync',
      message: `同步任务 #${job.id} - ${job.status === 'completed' ? '完成' : job.status === 'failed' ? '失败' : job.status === 'running' ? '进行中' : '等待中'}`,
      details: {
        campaigns: job.campaignsSynced,
        adGroups: job.adGroupsSynced,
        keywords: job.keywordsSynced,
        error: job.errorMessage,
      },
      createdAt: job.startedAt || job.createdAt,
    }));
    
    return { logs, total: syncHistoryData.total };
  }, [syncHistoryData]);

  // 计算日志统计
  const logStats = useMemo(() => {
    if (!syncHistoryData?.jobs) return null;
    
    const successCount = syncHistoryData.jobs.filter((job: any) => job.status === 'completed').length;
    const errorCount = syncHistoryData.jobs.filter((job: any) => job.status === 'failed').length;
    const warningCount = 0;
    
    return { successCount, errorCount, warningCount };
  }, [syncHistoryData]);

  // 过滤日志
  const filteredLogs = useMemo(() => {
    if (!logsData?.logs) return [];
    
    return logsData.logs.filter((log: any) => {
      // 搜索过滤
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const message = (log.message || '').toLowerCase();
        const details = JSON.stringify(log.details || {}).toLowerCase();
        if (!message.includes(query) && !details.includes(query)) {
          return false;
        }
      }
      
      // 级别过滤
      if (levelFilter !== 'all' && log.level !== levelFilter) {
        return false;
      }
      
      // 类型过滤
      if (typeFilter !== 'all' && log.logType !== typeFilter) {
        return false;
      }
      
      // 日期过滤
      if (startDate) {
        const logDate = new Date(log.createdAt);
        if (logDate < startDate) return false;
      }
      if (endDate) {
        const logDate = new Date(log.createdAt);
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        if (logDate > endOfDay) return false;
      }
      
      return true;
    });
  }, [logsData?.logs, searchQuery, levelFilter, typeFilter, startDate, endDate]);

  // 获取日志级别的样式
  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'success':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />成功</Badge>;
      case 'error':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />错误</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30"><AlertTriangle className="w-3 h-3 mr-1" />警告</Badge>;
      case 'info':
      default:
        return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30"><Clock className="w-3 h-3 mr-1" />信息</Badge>;
    }
  };

  // 获取日志类型的标签
  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      campaign: '广告活动',
      adGroup: '广告组',
      keyword: '关键词',
      productTarget: '商品定位',
      performance: '绩效数据',
      negativeKeyword: '否定词',
    };
    return typeMap[type] || type;
  };

  // 导出日志
  const handleExportLogs = () => {
    if (!filteredLogs.length) return;
    
    const csvContent = [
      ['时间', '级别', '类型', '消息', '详情'].join(','),
      ...filteredLogs.map((log: any) => [
        format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        log.level,
        getTypeLabel(log.logType || ''),
        `"${(log.message || '').replace(/"/g, '""')}"`,
        `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`,
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sync-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="w-6 h-6" />
              同步日志
            </h1>
            <p className="text-muted-foreground mt-1">
              查看数据同步的详细日志记录，排查同步问题
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportLogs} disabled={!filteredLogs.length}>
              <Download className="w-4 h-4 mr-2" />
              导出日志
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>

        {/* 账户选择和统计 */}
        <div className="grid lg:grid-cols-4 gap-4">
          {/* 账户选择 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">选择账户</CardTitle>
            </CardHeader>
            <CardContent>
              <Select 
                value={selectedAccountId?.toString() || ''} 
                onValueChange={(value) => {
                  setSelectedAccountId(parseInt(value));
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择账户" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id.toString()}>
                      {account.accountName} ({account.marketplace})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* 统计卡片 */}
          {logStats && (
            <>
              <Card className="bg-gradient-to-br from-green-500/10 to-transparent border-green-500/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/20">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{logStats.successCount || 0}</p>
                      <p className="text-xs text-muted-foreground">成功</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-yellow-500/20">
                      <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{logStats.warningCount || 0}</p>
                      <p className="text-xs text-muted-foreground">警告</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-red-500/20">
                      <XCircle className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{logStats.errorCount || 0}</p>
                      <p className="text-xs text-muted-foreground">错误</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* 筛选器 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4" />
              筛选条件
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {/* 搜索 */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索日志内容..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* 级别筛选 */}
              <Select value={levelFilter} onValueChange={(value: LogLevel) => setLevelFilter(value)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="日志级别" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部级别</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="info">信息</SelectItem>
                  <SelectItem value="warning">警告</SelectItem>
                  <SelectItem value="error">错误</SelectItem>
                </SelectContent>
              </Select>

              {/* 类型筛选 */}
              <Select value={typeFilter} onValueChange={(value: LogType) => setTypeFilter(value)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="日志类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="campaign">广告活动</SelectItem>
                  <SelectItem value="adGroup">广告组</SelectItem>
                  <SelectItem value="keyword">关键词</SelectItem>
                  <SelectItem value="productTarget">商品定位</SelectItem>
                  <SelectItem value="performance">绩效数据</SelectItem>
                  <SelectItem value="negativeKeyword">否定词</SelectItem>
                </SelectContent>
              </Select>

              {/* 开始日期 */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px]">
                    <Calendar className="w-4 h-4 mr-2" />
                    {startDate ? format(startDate, 'MM/dd') : '开始日期'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* 结束日期 */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px]">
                    <Calendar className="w-4 h-4 mr-2" />
                    {endDate ? format(endDate, 'MM/dd') : '结束日期'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* 清除筛选 */}
              {(searchQuery || levelFilter !== 'all' || typeFilter !== 'all' || startDate || endDate) && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setLevelFilter('all');
                    setTypeFilter('all');
                    setStartDate(undefined);
                    setEndDate(undefined);
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 日志列表 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5" />
                日志记录
              </CardTitle>
              <CardDescription>
                共 {logsData?.total || 0} 条记录，当前显示 {filteredLogs.length} 条
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!selectedAccountId ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">请先选择账户</p>
                <p className="text-sm mt-1">选择一个账户以查看其同步日志</p>
              </div>
            ) : logsLoading ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
                <p className="text-muted-foreground">加载中...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">暂无日志记录</p>
                <p className="text-sm mt-1">该账户还没有同步日志，请先执行数据同步</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLogs.map((log: any) => (
                  <div 
                    key={log.id} 
                    className="p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getLevelBadge(log.level)}
                          {log.logType && (
                            <Badge variant="outline" className="text-xs">
                              {getTypeLabel(log.logType)}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                          </span>
                        </div>
                        <p className="text-sm">{log.message}</p>
                        {log.details && Object.keys(log.details).length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              查看详情
                            </summary>
                            <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 分页 */}
            {logsData && logsData.total > pageSize && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  第 {page} 页，共 {Math.ceil(logsData.total / pageSize)} 页
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= Math.ceil(logsData.total / pageSize)}
                  >
                    下一页
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
