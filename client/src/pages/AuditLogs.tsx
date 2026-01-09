import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Search,
  Download,
  Filter,
  Eye,
  Clock,
  User,
  Activity,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  XCircle,
  Calendar,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export default function AuditLogs() {
  
  const [activeTab, setActiveTab] = useState("logs");
  const [search, setSearch] = useState("");
  const [selectedActionType, setSelectedActionType] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [viewAll, setViewAll] = useState(true); // 管理员默认查看所有用户日志

  // 管理员权限检查 - 默认允许查看所有日志（实际权限由后端控制）
  const isAdmin = true; // 后端会根据用户角色判断是否有权限查看所有日志

  // 获取操作类型和描述
  const { data: actionTypes } = trpc.audit.getActionTypes.useQuery();

  // 获取审计日志列表
  const { data: logsData, isLoading, refetch } = trpc.audit.list.useQuery({
    actionTypes: selectedActionType !== "all" ? [selectedActionType] : undefined,
    status: selectedStatus !== "all" ? selectedStatus : undefined,
    search: search || undefined,
    page,
    pageSize,
    viewAll: isAdmin ? viewAll : false, // 管理员可以查看所有用户日志
  });

  // 获取用户操作统计
  const { data: userStats } = trpc.audit.userStats.useQuery({ days: 30 });

  // 导出审计日志
  const exportMutation = trpc.audit.export.useMutation({
    onSuccess: (data) => {
      // 创建下载链接
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit_logs_${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功", {
        description: "审计日志已导出为CSV文件",
      });
    },
    onError: (error) => {
      toast.error("导出失败", {
        description: error.message,
      });
    },
  });

  // 操作类型分组
  const actionCategories = useMemo(() => {
    if (!actionTypes?.categories) return [];
    return Object.entries(actionTypes.categories).map(([key, actions]) => ({
      key,
      label: getCategoryLabel(key),
      actions: [...actions] as string[],
    }));
  }, [actionTypes]);

  // 获取分类标签
  function getCategoryLabel(key: string): string {
    const labels: Record<string, string> = {
      account: "账号管理",
      campaign: "广告活动",
      bid: "出价调整",
      negative: "否定词管理",
      performance_group: "绩效组",
      automation: "自动化",
      scheduler: "定时任务",
      team: "团队管理",
      data: "数据操作",
      settings: "系统设置",
    };
    return labels[key] || key;
  }

  // 获取操作类型描述
  function getActionDescription(actionType: string): string {
    return actionTypes?.actionDescriptions?.[actionType] || actionType;
  }

  // 获取状态徽章
  function getStatusBadge(status: string) {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle className="w-3 h-3 mr-1" />成功</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />失败</Badge>;
      case "partial":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20"><AlertCircle className="w-3 h-3 mr-1" />部分成功</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  // 格式化时间
  function formatTime(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // 查看详情
  function viewDetail(log: any) {
    setSelectedLog(log);
    setDetailDialogOpen(true);
  }

  // 处理导出
  function handleExport() {
    exportMutation.mutate({
      actionTypes: selectedActionType !== "all" ? [selectedActionType] : undefined,
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">操作审计日志</h1>
            <p className="text-muted-foreground">记录所有团队成员的操作行为，便于追溯和合规管理</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
            <Button onClick={handleExport} disabled={exportMutation.isPending}>
              <Download className="w-4 h-4 mr-2" />
              导出CSV
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">近30天操作总数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                <span className="text-2xl font-bold">{userStats?.totalActions || 0}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">出价调整次数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-2xl font-bold">
                  {(userStats?.actionsByType?.bid_adjust_single || 0) + (userStats?.actionsByType?.bid_adjust_batch || 0)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">否定词操作次数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-orange-500" />
                <span className="text-2xl font-bold">
                  {(userStats?.actionsByType?.negative_add_single || 0) + (userStats?.actionsByType?.negative_add_batch || 0)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">团队操作次数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-purple-500" />
                <span className="text-2xl font-bold">
                  {(userStats?.actionsByType?.team_member_invite || 0) + (userStats?.actionsByType?.team_permission_update || 0)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="logs">操作日志</TabsTrigger>
            <TabsTrigger value="stats">操作统计</TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="space-y-4">
            {/* 筛选器 */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="搜索操作描述、目标名称..."
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <Select
                    value={selectedActionType}
                    onValueChange={(value) => {
                      setSelectedActionType(value);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="操作类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部类型</SelectItem>
                      {actionCategories.map((category) => (
                        <div key={category.key}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{category.label}</div>
                          {category.actions.map((action) => (
                            <SelectItem key={action} value={action}>
                              {getActionDescription(action)}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedStatus}
                    onValueChange={(value) => {
                      setSelectedStatus(value);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="success">成功</SelectItem>
                      <SelectItem value="failed">失败</SelectItem>
                      <SelectItem value="partial">部分成功</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* 管理员查看所有用户日志开关 */}
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="viewAll"
                        checked={viewAll}
                        onChange={(e) => {
                          setViewAll(e.target.checked);
                          setPage(1);
                        }}
                        className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                      />
                      <label htmlFor="viewAll" className="text-sm text-muted-foreground">
                        查看所有用户日志
                      </label>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 日志列表 */}
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : logsData?.logs && logsData.logs.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">时间</TableHead>
                          <TableHead className="w-[120px]">操作用户</TableHead>
                          <TableHead className="w-[150px]">操作类型</TableHead>
                          <TableHead>操作描述</TableHead>
                          <TableHead className="w-[120px]">关联账号</TableHead>
                          <TableHead className="w-[80px]">状态</TableHead>
                          <TableHead className="w-[80px]">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logsData.logs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTime(log.createdAt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                  <User className="w-3 h-3 text-primary" />
                                </div>
                                <span className="text-sm">{log.userName || "未知用户"}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{getActionDescription(log.actionType || "")}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[300px] truncate" title={log.description || ""}>
                                {log.description}
                                {log.targetName && (
                                  <span className="text-muted-foreground ml-1">({log.targetName})</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {log.accountName ? (
                                <span className="text-sm">{log.accountName}</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>{getStatusBadge(log.status || "success")}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => viewDetail(log)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* 分页 */}
                    <div className="flex items-center justify-between px-4 py-3 border-t">
                      <div className="text-sm text-muted-foreground">
                        共 {logsData.total} 条记录
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm">
                          第 {page} 页 / 共 {Math.ceil(logsData.total / pageSize)} 页
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => p + 1)}
                          disabled={page >= Math.ceil(logsData.total / pageSize)}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Activity className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">暂无审计日志</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats" className="space-y-4">
            {/* 操作趋势 */}
            <Card>
              <CardHeader>
                <CardTitle>近30天操作趋势</CardTitle>
                <CardDescription>按天统计的操作数量变化</CardDescription>
              </CardHeader>
              <CardContent>
                {userStats?.actionsByDay && userStats.actionsByDay.length > 0 ? (
                  <div className="h-[200px] flex items-end gap-1">
                    {userStats.actionsByDay.map((day, index) => {
                      const maxCount = Math.max(...userStats.actionsByDay.map((d) => d.count));
                      const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                      return (
                        <div
                          key={index}
                          className="flex-1 bg-primary/20 hover:bg-primary/40 transition-colors rounded-t"
                          style={{ height: `${Math.max(height, 2)}%` }}
                          title={`${day.date}: ${day.count} 次操作`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    暂无数据
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 按类型统计 */}
            <Card>
              <CardHeader>
                <CardTitle>按操作类型统计</CardTitle>
                <CardDescription>近30天各类型操作的数量分布</CardDescription>
              </CardHeader>
              <CardContent>
                {userStats?.actionsByType && Object.keys(userStats.actionsByType).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(userStats.actionsByType)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([actionType, count]) => {
                        const total = Object.values(userStats.actionsByType).reduce((a, b) => a + b, 0);
                        const percentage = total > 0 ? (count / total) * 100 : 0;
                        return (
                          <div key={actionType} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span>{getActionDescription(actionType)}</span>
                              <span className="text-muted-foreground">{count} 次 ({percentage.toFixed(1)}%)</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">暂无数据</div>
                )}
              </CardContent>
            </Card>

            {/* 最近操作 */}
            <Card>
              <CardHeader>
                <CardTitle>最近操作</CardTitle>
                <CardDescription>您最近执行的10条操作记录</CardDescription>
              </CardHeader>
              <CardContent>
                {userStats?.recentActions && userStats.recentActions.length > 0 ? (
                  <div className="space-y-3">
                    {userStats.recentActions.map((log) => (
                      <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Activity className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{getActionDescription(log.actionType || "")}</div>
                          <div className="text-xs text-muted-foreground truncate">{log.description}</div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(log.createdAt)}
                        </div>
                        {getStatusBadge(log.status || "success")}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">暂无数据</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 详情对话框 */}
        <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>操作详情</DialogTitle>
              <DialogDescription>查看操作的完整信息</DialogDescription>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">操作时间</label>
                    <p className="mt-1">{formatTime(selectedLog.createdAt)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">操作用户</label>
                    <p className="mt-1">{selectedLog.userName || "未知用户"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">操作类型</label>
                    <p className="mt-1">{getActionDescription(selectedLog.actionType)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">状态</label>
                    <p className="mt-1">{getStatusBadge(selectedLog.status)}</p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-muted-foreground">操作描述</label>
                    <p className="mt-1">{selectedLog.description}</p>
                  </div>
                  {selectedLog.targetName && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">目标对象</label>
                      <p className="mt-1">{selectedLog.targetName}</p>
                    </div>
                  )}
                  {selectedLog.accountName && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">关联账号</label>
                      <p className="mt-1">{selectedLog.accountName}</p>
                    </div>
                  )}
                  {selectedLog.ipAddress && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">IP地址</label>
                      <p className="mt-1">{selectedLog.ipAddress}</p>
                    </div>
                  )}
                  {selectedLog.errorMessage && (
                    <div className="col-span-2">
                      <label className="text-sm font-medium text-muted-foreground">错误信息</label>
                      <p className="mt-1 text-red-500">{selectedLog.errorMessage}</p>
                    </div>
                  )}
                </div>
                {(selectedLog.previousValue || selectedLog.newValue) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">数据变更</label>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedLog.previousValue && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <div className="text-xs font-medium text-red-500 mb-2">变更前</div>
                          <pre className="text-xs overflow-auto max-h-[200px]">
                            {JSON.stringify(selectedLog.previousValue, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedLog.newValue && (
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                          <div className="text-xs font-medium text-green-500 mb-2">变更后</div>
                          <pre className="text-xs overflow-auto max-h-[200px]">
                            {JSON.stringify(selectedLog.newValue, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
