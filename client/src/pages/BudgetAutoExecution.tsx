import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Clock, Play, Settings, History, Plus, Trash2, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function BudgetAutoExecution() {
  const { user } = useAuth();
  // toast from sonner
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();

  // 获取自动执行配置列表
  const { data: configs, refetch: refetchConfigs } = trpc.budgetAutoExecution.listConfigs.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取执行历史
  const { data: history, refetch: refetchHistory } = trpc.budgetAutoExecution.getHistory.useQuery(
    { accountId: selectedAccountId!, limit: 50 },
    { enabled: !!selectedAccountId }
  );

  // 获取执行详情
  const { data: executionDetails } = trpc.budgetAutoExecution.getExecutionDetails.useQuery(
    { executionId: selectedExecutionId! },
    { enabled: !!selectedExecutionId }
  );

  // 创建配置
  const createConfigMutation = trpc.budgetAutoExecution.createConfig.useMutation({
    onSuccess: () => {
      toast.success('自动执行配置创建成功');
      setCreateDialogOpen(false);
      refetchConfigs();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // 更新配置
  const updateConfigMutation = trpc.budgetAutoExecution.updateConfig.useMutation({
    onSuccess: () => {
      toast.success('配置已更新');
      refetchConfigs();
    },
  });

  // 删除配置
  const deleteConfigMutation = trpc.budgetAutoExecution.deleteConfig.useMutation({
    onSuccess: () => {
      toast.success('配置已删除');
      refetchConfigs();
    },
  });

  // 手动触发执行
  const triggerExecutionMutation = trpc.budgetAutoExecution.triggerExecution.useMutation({
    onSuccess: () => {
      toast.success('执行已触发');
      refetchHistory();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // 审批执行
  const approveExecutionMutation = trpc.budgetAutoExecution.approveExecution.useMutation({
    onSuccess: () => {
      toast.success('审批完成');
      refetchHistory();
    },
  });

  // 创建配置表单状态
  const [newConfig, setNewConfig] = useState({
    configName: '',
    executionFrequency: 'daily' as 'daily' | 'weekly' | 'biweekly' | 'monthly',
    executionTime: '06:00',
    executionDayOfWeek: 1,
    executionDayOfMonth: 1,
    minDataDays: 7,
    maxAdjustmentPercent: 15,
    minBudget: 5,
    requireApproval: false,
    notifyOnExecution: true,
    notifyOnError: true,
  });

  const handleCreateConfig = () => {
    if (!selectedAccountId) return;
    createConfigMutation.mutate({
      accountId: selectedAccountId,
      ...newConfig,
      isEnabled: true,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
      running: { variant: 'default', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: '执行中' },
      completed: { variant: 'default', icon: <CheckCircle className="h-3 w-3" />, label: '已完成' },
      failed: { variant: 'destructive', icon: <XCircle className="h-3 w-3" />, label: '失败' },
      cancelled: { variant: 'secondary', icon: <XCircle className="h-3 w-3" />, label: '已取消' },
      pending_approval: { variant: 'outline', icon: <AlertCircle className="h-3 w-3" />, label: '待审批' },
    };
    const config = statusConfig[status] || { variant: 'secondary', icon: null, label: status };
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const frequencyLabels: Record<string, string> = {
    daily: '每天',
    weekly: '每周',
    biweekly: '每两周',
    monthly: '每月',
  };

  const dayOfWeekLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">预算自动执行</h1>
            <p className="text-muted-foreground">设置定时任务自动应用预算建议</p>
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={selectedAccountId?.toString() || ''}
              onValueChange={(value) => setSelectedAccountId(Number(value))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={!selectedAccountId}>
                  <Plus className="h-4 w-4 mr-2" />
                  创建配置
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>创建自动执行配置</DialogTitle>
                  <DialogDescription>配置预算自动分配的执行规则</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                  <div className="space-y-2">
                    <Label>配置名称</Label>
                    <Input
                      value={newConfig.configName}
                      onChange={(e) => setNewConfig({ ...newConfig, configName: e.target.value })}
                      placeholder="输入配置名称"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>执行频率</Label>
                    <Select
                      value={newConfig.executionFrequency}
                      onValueChange={(value: 'daily' | 'weekly' | 'biweekly' | 'monthly') => 
                        setNewConfig({ ...newConfig, executionFrequency: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">每天</SelectItem>
                        <SelectItem value="weekly">每周</SelectItem>
                        <SelectItem value="biweekly">每两周</SelectItem>
                        <SelectItem value="monthly">每月</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>执行时间</Label>
                    <Input
                      type="time"
                      value={newConfig.executionTime}
                      onChange={(e) => setNewConfig({ ...newConfig, executionTime: e.target.value })}
                    />
                  </div>
                  {(newConfig.executionFrequency === 'weekly' || newConfig.executionFrequency === 'biweekly') && (
                    <div className="space-y-2">
                      <Label>执行日（星期几）</Label>
                      <Select
                        value={newConfig.executionDayOfWeek.toString()}
                        onValueChange={(value) => setNewConfig({ ...newConfig, executionDayOfWeek: Number(value) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dayOfWeekLabels.map((label, index) => (
                            <SelectItem key={index} value={index.toString()}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {newConfig.executionFrequency === 'monthly' && (
                    <div className="space-y-2">
                      <Label>执行日（每月几号）</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={newConfig.executionDayOfMonth}
                        onChange={(e) => setNewConfig({ ...newConfig, executionDayOfMonth: Number(e.target.value) })}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>最少数据天数</Label>
                    <Input
                      type="number"
                      value={newConfig.minDataDays}
                      onChange={(e) => setNewConfig({ ...newConfig, minDataDays: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">广告活动至少需要多少天数据才会被调整</p>
                  </div>
                  <div className="space-y-2">
                    <Label>最大调整幅度 (%)</Label>
                    <Input
                      type="number"
                      value={newConfig.maxAdjustmentPercent}
                      onChange={(e) => setNewConfig({ ...newConfig, maxAdjustmentPercent: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>最小预算 ($)</Label>
                    <Input
                      type="number"
                      value={newConfig.minBudget}
                      onChange={(e) => setNewConfig({ ...newConfig, minBudget: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>需要人工审批</Label>
                    <Switch
                      checked={newConfig.requireApproval}
                      onCheckedChange={(checked) => setNewConfig({ ...newConfig, requireApproval: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>执行后通知</Label>
                    <Switch
                      checked={newConfig.notifyOnExecution}
                      onCheckedChange={(checked) => setNewConfig({ ...newConfig, notifyOnExecution: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>错误时通知</Label>
                    <Switch
                      checked={newConfig.notifyOnError}
                      onCheckedChange={(checked) => setNewConfig({ ...newConfig, notifyOnError: checked })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={handleCreateConfig} disabled={!newConfig.configName}>
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="configs">
          <TabsList>
            <TabsTrigger value="configs" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              执行配置
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              执行历史
            </TabsTrigger>
          </TabsList>

          <TabsContent value="configs" className="space-y-4">
            {configs?.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  暂无自动执行配置，点击"创建配置"开始设置
                </CardContent>
              </Card>
            )}
            {configs?.map((config) => (
              <Card key={config.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-lg">{config.configName}</CardTitle>
                        <CardDescription>
                          {frequencyLabels[config.executionFrequency || 'daily']} {config.executionTime} 执行
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={config.isEnabled === 1}
                        onCheckedChange={(checked) => 
                          updateConfigMutation.mutate({ configId: config.id, isEnabled: checked })
                        }
                      />
                      <Badge variant={config.isEnabled === 1 ? 'default' : 'secondary'}>
                        {config.isEnabled === 1 ? '已启用' : '已禁用'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">最大调整幅度</p>
                      <p className="font-medium">{config.maxAdjustmentPercent}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">最小预算</p>
                      <p className="font-medium">${config.minBudget}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">需要审批</p>
                      <p className="font-medium">{config.requireApproval === 1 ? '是' : '否'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">下次执行</p>
                      <p className="font-medium">
                        {config.nextExecutionAt ? new Date(config.nextExecutionAt).toLocaleString() : '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() => triggerExecutionMutation.mutate({ configId: config.id })}
                      disabled={triggerExecutionMutation.isPending}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      立即执行
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteConfigMutation.mutate({ configId: config.id })}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>执行历史</CardTitle>
                <CardDescription>查看预算自动分配的执行记录</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>执行时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>广告活动数</TableHead>
                      <TableHead>已调整</TableHead>
                      <TableHead>预算变化</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          暂无执行记录
                        </TableCell>
                      </TableRow>
                    )}
                    {history?.map((execution) => (
                      <TableRow key={execution.id}>
                        <TableCell>
                          {execution.executionStartAt ? new Date(execution.executionStartAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell>{getStatusBadge(execution.status || 'pending')}</TableCell>
                        <TableCell>{execution.totalCampaigns}</TableCell>
                        <TableCell>{execution.campaignsAdjusted}</TableCell>
                        <TableCell>
                          ${parseFloat(execution.totalBudgetBefore || '0').toFixed(2)} → 
                          ${parseFloat(execution.totalBudgetAfter || '0').toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedExecutionId(execution.id)}
                            >
                              详情
                            </Button>
                            {execution.status === 'pending_approval' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => approveExecutionMutation.mutate({ 
                                    executionId: execution.id, 
                                    approve: true 
                                  })}
                                >
                                  批准
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => approveExecutionMutation.mutate({ 
                                    executionId: execution.id, 
                                    approve: false 
                                  })}
                                >
                                  拒绝
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* 执行详情对话框 */}
            <Dialog open={!!selectedExecutionId} onOpenChange={() => setSelectedExecutionId(null)}>
              <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>执行详情</DialogTitle>
                  <DialogDescription>
                    查看本次执行的详细调整记录
                  </DialogDescription>
                </DialogHeader>
                {executionDetails && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-3 bg-accent rounded-lg">
                        <p className="text-sm text-muted-foreground">总计</p>
                        <p className="text-xl font-bold">{executionDetails.execution.totalCampaigns}</p>
                      </div>
                      <div className="p-3 bg-green-500/10 rounded-lg">
                        <p className="text-sm text-muted-foreground">已调整</p>
                        <p className="text-xl font-bold text-green-600">{executionDetails.execution.campaignsAdjusted}</p>
                      </div>
                      <div className="p-3 bg-yellow-500/10 rounded-lg">
                        <p className="text-sm text-muted-foreground">已跳过</p>
                        <p className="text-xl font-bold text-yellow-600">{executionDetails.execution.skippedCampaigns}</p>
                      </div>
                      <div className="p-3 bg-red-500/10 rounded-lg">
                        <p className="text-sm text-muted-foreground">错误</p>
                        <p className="text-xl font-bold text-red-600">{executionDetails.execution.errorCampaigns}</p>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>广告活动</TableHead>
                          <TableHead>调整前</TableHead>
                          <TableHead>调整后</TableHead>
                          <TableHead>变化</TableHead>
                          <TableHead>状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {executionDetails.details.map((detail) => (
                          <TableRow key={detail.id}>
                            <TableCell className="font-medium">{detail.campaignName}</TableCell>
                            <TableCell>${parseFloat(detail.budgetBefore || '0').toFixed(2)}</TableCell>
                            <TableCell>${parseFloat(detail.budgetAfter || '0').toFixed(2)}</TableCell>
                            <TableCell>
                              <span className={parseFloat(detail.adjustmentPercent || '0') > 0 ? 'text-green-600' : 'text-red-600'}>
                                {parseFloat(detail.adjustmentPercent || '0') > 0 ? '+' : ''}
                                {parseFloat(detail.adjustmentPercent || '0').toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                detail.status === 'applied' ? 'default' :
                                detail.status === 'error' ? 'destructive' : 'secondary'
                              }>
                                {detail.status === 'applied' ? '已应用' :
                                 detail.status === 'error' ? '错误' : '已跳过'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
