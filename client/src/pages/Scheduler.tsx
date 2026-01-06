import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { 
  Clock, 
  Play, 
  Pause, 
  Trash2, 
  Plus, 
  Settings2, 
  History, 
  CheckCircle, 
  XCircle, 
  Loader2,
  RefreshCw,
  Zap,
  Search,
  GitBranch,
  AlertTriangle,
  TrendingUp,
  Activity,
  Database
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const taskTypeConfig = {
  ngram_analysis: {
    name: 'N-Gram词根分析',
    description: '分析无效搜索词的共同词根特征，生成批量否定词建议',
    icon: Search,
    color: 'text-blue-500',
  },
  funnel_migration: {
    name: '漏斗迁移分析',
    description: '监控广泛匹配中表现优秀的词，建议迁移到短语或精准匹配',
    icon: GitBranch,
    color: 'text-green-500',
  },
  traffic_conflict: {
    name: '流量冲突检测',
    description: '检测跨广告活动的重叠搜索词，建议最优流量分配方案',
    icon: AlertTriangle,
    color: 'text-yellow-500',
  },
  smart_bidding: {
    name: '智能竞价调整',
    description: '基于绩效数据自动计算最优出价调整',
    icon: TrendingUp,
    color: 'text-purple-500',
  },
  health_check: {
    name: '健康度检查',
    description: '监控广告活动健康状态，检测异常指标',
    icon: Activity,
    color: 'text-red-500',
  },
  data_sync: {
    name: '数据同步',
    description: '从Amazon API同步最新广告数据',
    icon: Database,
    color: 'text-cyan-500',
  },
};

type TaskType = keyof typeof taskTypeConfig;

export default function Scheduler() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [newTask, setNewTask] = useState({
    taskType: 'ngram_analysis' as TaskType,
    name: '',
    description: '',
    schedule: 'daily' as 'hourly' | 'daily' | 'weekly' | 'monthly',
    runTime: '06:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    enabled: true,
    autoApply: false,
    requireApproval: true,
  });

  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.scheduler.getTasks.useQuery();
  const { data: defaultConfigs } = trpc.scheduler.getDefaultConfigs.useQuery();
  const { data: executionHistory, isLoading: historyLoading } = trpc.scheduler.getExecutionHistory.useQuery(
    { taskId: selectedTask || 0, limit: 10 },
    { enabled: !!selectedTask }
  );

  const createTaskMutation = trpc.scheduler.createTask.useMutation({
    onSuccess: () => {
      utils.scheduler.getTasks.invalidate();
      setIsCreateDialogOpen(false);
      toast.success('定时任务已创建');
    },
    onError: () => {
      toast.error('创建任务失败');
    },
  });

  const updateTaskMutation = trpc.scheduler.updateTask.useMutation({
    onSuccess: () => {
      utils.scheduler.getTasks.invalidate();
      toast.success('任务已更新');
    },
    onError: () => {
      toast.error('更新任务失败');
    },
  });

  const deleteTaskMutation = trpc.scheduler.deleteTask.useMutation({
    onSuccess: () => {
      utils.scheduler.getTasks.invalidate();
      toast.success('任务已删除');
    },
    onError: () => {
      toast.error('删除任务失败');
    },
  });

  const runTaskMutation = trpc.scheduler.runTask.useMutation({
    onSuccess: (result) => {
      utils.scheduler.getTasks.invalidate();
      if (selectedTask) {
        utils.scheduler.getExecutionHistory.invalidate({ taskId: selectedTask });
      }
      if (result.status === 'success') {
        toast.success(`任务执行成功，处理了 ${result.itemsProcessed} 项，生成 ${result.suggestionsGenerated} 条建议`);
      } else {
        toast.error(`任务执行失败: ${result.errorMessage}`);
      }
    },
    onError: () => {
      toast.error('执行任务失败');
    },
  });

  const handleCreateTask = () => {
    createTaskMutation.mutate({
      ...newTask,
      dayOfWeek: newTask.schedule === 'weekly' ? newTask.dayOfWeek : undefined,
      dayOfMonth: newTask.schedule === 'monthly' ? newTask.dayOfMonth : undefined,
    });
  };

  const handleToggleEnabled = (taskId: number, enabled: boolean) => {
    updateTaskMutation.mutate({ id: taskId, enabled });
  };

  const handleRunTask = (taskId: number, autoApply: boolean = false) => {
    runTaskMutation.mutate({ id: taskId, autoApply });
  };

  const getScheduleText = (task: { schedule: string | null; runTime: string | null; dayOfWeek: number | null; dayOfMonth: number | null }) => {
    const time = task.runTime || '06:00';
    switch (task.schedule) {
      case 'hourly':
        return '每小时';
      case 'daily':
        return `每天 ${time}`;
      case 'weekly':
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `每${days[task.dayOfWeek || 0]} ${time}`;
      case 'monthly':
        return `每月${task.dayOfMonth}日 ${time}`;
      default:
        return '未设置';
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">成功</Badge>;
      case 'failed':
        return <Badge variant="destructive">失败</Badge>;
      case 'running':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">运行中</Badge>;
      case 'skipped':
        return <Badge variant="secondary">跳过</Badge>;
      default:
        return <Badge variant="outline">未运行</Badge>;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">定时任务</h1>
            <p className="text-muted-foreground">配置自动化优化任务的执行计划</p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                创建任务
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>创建定时任务</DialogTitle>
                <DialogDescription>配置新的自动化优化任务</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>任务类型</Label>
                  <Select
                    value={newTask.taskType}
                    onValueChange={(value) => {
                      const config = defaultConfigs?.[value as TaskType];
                      setNewTask({
                        ...newTask,
                        taskType: value as TaskType,
                        name: config?.name || taskTypeConfig[value as TaskType].name,
                        description: config?.description || taskTypeConfig[value as TaskType].description,
                        schedule: config?.schedule || 'daily',
                        runTime: config?.runTime || '06:00',
                        autoApply: config?.autoApply || false,
                        requireApproval: config?.requireApproval ?? true,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(taskTypeConfig).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <Icon className={`h-4 w-4 ${config.color}`} />
                              <span>{config.name}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>任务名称</Label>
                  <Input
                    value={newTask.name}
                    onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                    placeholder="输入任务名称"
                  />
                </div>

                <div className="space-y-2">
                  <Label>任务描述</Label>
                  <Textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="输入任务描述"
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>执行频率</Label>
                    <Select
                      value={newTask.schedule}
                      onValueChange={(value) => setNewTask({ ...newTask, schedule: value as typeof newTask.schedule })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">每小时</SelectItem>
                        <SelectItem value="daily">每天</SelectItem>
                        <SelectItem value="weekly">每周</SelectItem>
                        <SelectItem value="monthly">每月</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>执行时间</Label>
                    <Input
                      type="time"
                      value={newTask.runTime}
                      onChange={(e) => setNewTask({ ...newTask, runTime: e.target.value })}
                    />
                  </div>
                </div>

                {newTask.schedule === 'weekly' && (
                  <div className="space-y-2">
                    <Label>执行日期</Label>
                    <Select
                      value={newTask.dayOfWeek.toString()}
                      onValueChange={(value) => setNewTask({ ...newTask, dayOfWeek: parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((day, i) => (
                          <SelectItem key={i} value={i.toString()}>{day}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {newTask.schedule === 'monthly' && (
                  <div className="space-y-2">
                    <Label>执行日期</Label>
                    <Select
                      value={newTask.dayOfMonth.toString()}
                      onValueChange={(value) => setNewTask({ ...newTask, dayOfMonth: parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 31 }, (_, i) => (
                          <SelectItem key={i + 1} value={(i + 1).toString()}>每月{i + 1}日</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>自动应用建议</Label>
                      <p className="text-xs text-muted-foreground">自动执行生成的优化建议</p>
                    </div>
                    <Switch
                      checked={newTask.autoApply}
                      onCheckedChange={(checked) => setNewTask({ ...newTask, autoApply: checked })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>需要审批</Label>
                      <p className="text-xs text-muted-foreground">应用建议前需要人工确认</p>
                    </div>
                    <Switch
                      checked={newTask.requireApproval}
                      onCheckedChange={(checked) => setNewTask({ ...newTask, requireApproval: checked })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending}>
                  {createTaskMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="tasks" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tasks">任务列表</TabsTrigger>
            <TabsTrigger value="history">执行历史</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-4">
            {tasks && tasks.length > 0 ? (
              <div className="grid gap-4">
                {tasks.map((task) => {
                  const config = taskTypeConfig[task.taskType as TaskType];
                  const Icon = config?.icon || Clock;
                  return (
                    <Card key={task.id}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-4">
                            <div className={`p-2 rounded-lg bg-muted ${config?.color || ''}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold">{task.name}</h3>
                                {task.enabled ? (
                                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20">启用</Badge>
                                ) : (
                                  <Badge variant="secondary">禁用</Badge>
                                )}
                                {getStatusBadge(task.lastRunStatus)}
                              </div>
                              <p className="text-sm text-muted-foreground">{task.description || config?.description}</p>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {getScheduleText(task)}
                                </span>
                                {task.lastRunAt && (
                                  <span>
                                    上次执行: {new Date(task.lastRunAt).toLocaleString('zh-CN')}
                                  </span>
                                )}
                                {task.autoApply && (
                                  <Badge variant="outline" className="text-xs">自动应用</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRunTask(task.id)}
                              disabled={runTaskMutation.isPending}
                            >
                              {runTaskMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleEnabled(task.id, !task.enabled)}
                            >
                              {task.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedTask(task.id)}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteTaskMutation.mutate({ id: task.id })}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">暂无定时任务</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    创建定时任务以自动执行广告优化分析
                  </p>
                  <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    创建第一个任务
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Quick Create Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(taskTypeConfig).map(([key, config]) => {
                const Icon = config.icon;
                const hasTask = tasks?.some(t => t.taskType === key);
                return (
                  <Card key={key} className={hasTask ? 'opacity-50' : ''}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        {config.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">{config.description}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={hasTask}
                        onClick={() => {
                          const defaultConfig = defaultConfigs?.[key as TaskType];
                          setNewTask({
                            taskType: key as TaskType,
                            name: defaultConfig?.name || config.name,
                            description: defaultConfig?.description || config.description,
                            schedule: defaultConfig?.schedule || 'daily',
                            runTime: defaultConfig?.runTime || '06:00',
                            dayOfWeek: 1,
                            dayOfMonth: 1,
                            enabled: true,
                            autoApply: defaultConfig?.autoApply || false,
                            requireApproval: defaultConfig?.requireApproval ?? true,
                          });
                          setIsCreateDialogOpen(true);
                        }}
                      >
                        {hasTask ? '已创建' : '快速创建'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>执行历史</CardTitle>
                    <CardDescription>查看定时任务的执行记录</CardDescription>
                  </div>
                  {tasks && tasks.length > 0 && (
                    <Select
                      value={selectedTask?.toString() || ''}
                      onValueChange={(value) => setSelectedTask(parseInt(value))}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="选择任务" />
                      </SelectTrigger>
                      <SelectContent>
                        {tasks.map((task) => (
                          <SelectItem key={task.id} value={task.id.toString()}>
                            {task.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {selectedTask ? (
                  historyLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : executionHistory && executionHistory.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>执行时间</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>耗时</TableHead>
                          <TableHead>处理项目</TableHead>
                          <TableHead>生成建议</TableHead>
                          <TableHead>已应用</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {executionHistory.map((execution) => (
                          <TableRow key={execution.id}>
                            <TableCell>
                              {new Date(execution.startedAt).toLocaleString('zh-CN')}
                            </TableCell>
                            <TableCell>
                              {execution.status === 'success' ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : execution.status === 'failed' ? (
                                <XCircle className="h-4 w-4 text-red-500" />
                              ) : (
                                <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                              )}
                            </TableCell>
                            <TableCell>{execution.duration}秒</TableCell>
                            <TableCell>{execution.itemsProcessed}</TableCell>
                            <TableCell>{execution.suggestionsGenerated}</TableCell>
                            <TableCell>{execution.suggestionsApplied}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>该任务暂无执行记录</p>
                    </div>
                  )
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>请选择一个任务查看执行历史</p>
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
