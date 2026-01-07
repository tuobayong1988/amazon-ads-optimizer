import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { 
  Shield, 
  AlertTriangle, 
  Bell, 
  History, 
  Settings, 
  Plus,
  Play,
  Pause,
  RefreshCw,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  TrendingUp,
  Activity,
  Filter
} from 'lucide-react';
import { toast } from 'sonner';

export default function ApiSecurityCenter() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState('overview');
  
  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取操作日志
  const { data: operationLogs, refetch: refetchLogs } = trpc.apiSecurity.getOperationLogs.useQuery({
    accountId: selectedAccountId,
    limit: 50,
  });
  
  // 获取花费限额配置
  const { data: spendLimitConfig, refetch: refetchSpendConfig } = trpc.apiSecurity.getSpendLimitConfig.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );
  
  // 获取花费告警历史
  const { data: spendAlerts } = trpc.apiSecurity.getSpendAlertHistory.useQuery({
    accountId: selectedAccountId,
    limit: 20,
  });
  
  // 获取异常检测规则
  const { data: anomalyRules, refetch: refetchRules } = trpc.apiSecurity.getAnomalyRules.useQuery({
    accountId: selectedAccountId,
  });
  
  // 获取自动暂停记录
  const { data: autoPauseRecords, refetch: refetchPauseRecords } = trpc.apiSecurity.getAutoPauseRecords.useQuery({
    accountId: selectedAccountId,
    includeResumed: true,
  });
  
  // Mutations
  const upsertSpendLimit = trpc.apiSecurity.upsertSpendLimitConfig.useMutation({
    onSuccess: () => {
      toast.success('花费限额配置已保存');
      refetchSpendConfig();
    },
    onError: (error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });
  
  const createRule = trpc.apiSecurity.createAnomalyRule.useMutation({
    onSuccess: () => {
      toast.success('异常检测规则已创建');
      refetchRules();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });
  
  const initDefaultRules = trpc.apiSecurity.initializeDefaultRules.useMutation({
    onSuccess: () => {
      toast.success('默认规则已初始化');
      refetchRules();
    },
    onError: (error) => {
      toast.error(`初始化失败: ${error.message}`);
    },
  });
  
  const resumeEntities = trpc.apiSecurity.resumePausedEntities.useMutation({
    onSuccess: () => {
      toast.success('已恢复暂停的实体');
      refetchPauseRecords();
    },
    onError: (error) => {
      toast.error(`恢复失败: ${error.message}`);
    },
  });

  // 统计数据
  const stats = {
    totalOperations: operationLogs?.total || 0,
    highRiskOperations: operationLogs?.logs.filter(l => l.riskLevel === 'high' || l.riskLevel === 'critical').length || 0,
    activeAlerts: spendAlerts?.filter(a => !a.acknowledged).length || 0,
    pausedEntities: autoPauseRecords?.filter(r => !r.isResumed).length || 0,
  };

  const getRiskBadgeVariant = (level: string) => {
    switch (level) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'success': return 'default';
      case 'failed': return 'destructive';
      case 'pending': return 'secondary';
      case 'rolled_back': return 'outline';
      default: return 'outline';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              API安全中心
            </h1>
            <p className="text-muted-foreground mt-1">
              监控API操作、设置花费限额、配置异常检测规则
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <Select
              value={selectedAccountId?.toString() || ''}
              onValueChange={(v) => setSelectedAccountId(v ? parseInt(v) : undefined)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部账号</SelectItem>
                {accounts?.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id.toString()}>
                    {acc.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button variant="outline" onClick={() => {
              refetchLogs();
              refetchSpendConfig();
              refetchRules();
              refetchPauseRecords();
            }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">今日操作</p>
                  <p className="text-2xl font-bold">{stats.totalOperations}</p>
                </div>
                <Activity className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">高风险操作</p>
                  <p className="text-2xl font-bold text-red-500">{stats.highRiskOperations}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">待处理告警</p>
                  <p className="text-2xl font-bold text-yellow-500">{stats.activeAlerts}</p>
                </div>
                <Bell className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">暂停中</p>
                  <p className="text-2xl font-bold text-orange-500">{stats.pausedEntities}</p>
                </div>
                <Pause className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 主要内容区域 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">
              <History className="h-4 w-4 mr-2" />
              操作日志
            </TabsTrigger>
            <TabsTrigger value="spend-limit">
              <DollarSign className="h-4 w-4 mr-2" />
              花费限额
            </TabsTrigger>
            <TabsTrigger value="anomaly">
              <AlertTriangle className="h-4 w-4 mr-2" />
              异常检测
            </TabsTrigger>
            <TabsTrigger value="auto-pause">
              <Pause className="h-4 w-4 mr-2" />
              自动暂停
            </TabsTrigger>
          </TabsList>

          {/* 操作日志 */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>API操作日志</CardTitle>
                <CardDescription>
                  详细记录所有API调用，包括出价调整、预算变更、状态变更等操作
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {operationLogs?.logs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无操作记录
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {operationLogs?.logs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                              <span className="font-medium">{log.actionDescription}</span>
                              <span className="text-sm text-muted-foreground">
                                {log.targetType} {log.targetName && `- ${log.targetName}`}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <Badge variant={getRiskBadgeVariant(log.riskLevel)}>
                              {log.riskLevel}
                            </Badge>
                            <Badge variant={getStatusBadgeVariant(log.status)}>
                              {log.status}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {new Date(log.executedAt).toLocaleString('zh-CN')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 花费限额 */}
          <TabsContent value="spend-limit" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>花费限额配置</CardTitle>
                  <CardDescription>
                    设置每日花费限额和告警阈值
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!selectedAccountId ? (
                    <div className="text-center py-8 text-muted-foreground">
                      请先选择一个账号
                    </div>
                  ) : (
                    <SpendLimitForm 
                      accountId={selectedAccountId}
                      config={spendLimitConfig}
                      onSave={(data) => upsertSpendLimit.mutate(data)}
                      isLoading={upsertSpendLimit.isPending}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>花费告警历史</CardTitle>
                  <CardDescription>
                    最近的花费告警记录
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {spendAlerts?.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无告警记录
                      </div>
                    ) : (
                      spendAlerts?.map((alert) => (
                        <div key={alert.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <Bell className={`h-4 w-4 ${
                              alert.alertLevel === 'critical' ? 'text-red-500' :
                              alert.alertLevel === 'warning' ? 'text-yellow-500' : 'text-blue-500'
                            }`} />
                            <div>
                              <p className="font-medium">{alert.alertType}</p>
                              <p className="text-sm text-muted-foreground">
                                ${parseFloat(alert.currentSpend).toFixed(2)} / ${parseFloat(alert.dailyLimit).toFixed(2)} ({parseFloat(alert.spendPercent).toFixed(1)}%)
                              </p>
                            </div>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {new Date(alert.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 异常检测 */}
          <TabsContent value="anomaly" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>异常检测规则</CardTitle>
                  <CardDescription>
                    配置自动检测异常操作的规则
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => initDefaultRules.mutate()}
                    disabled={initDefaultRules.isPending}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    初始化默认规则
                  </Button>
                  <CreateRuleDialog 
                    accountId={selectedAccountId}
                    onCreate={(data) => createRule.mutate(data)}
                    isLoading={createRule.isPending}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {anomalyRules?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无异常检测规则，点击上方按钮初始化默认规则
                    </div>
                  ) : (
                    anomalyRules?.map((rule) => (
                      <div key={rule.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-full ${rule.isEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                            <Shield className={`h-4 w-4 ${rule.isEnabled ? 'text-green-600' : 'text-gray-400'}`} />
                          </div>
                          <div>
                            <p className="font-medium">{rule.ruleName}</p>
                            <p className="text-sm text-muted-foreground">
                              {rule.ruleType} - {rule.conditionType}: {rule.conditionValue}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant={rule.actionOnTrigger === 'alert_only' ? 'outline' : 'destructive'}>
                            {rule.actionOnTrigger}
                          </Badge>
                          <Badge variant={rule.isEnabled ? 'default' : 'secondary'}>
                            {rule.isEnabled ? '启用' : '禁用'}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 自动暂停 */}
          <TabsContent value="auto-pause" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>自动暂停记录</CardTitle>
                <CardDescription>
                  因安全规则触发而自动暂停的广告实体
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {autoPauseRecords?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无自动暂停记录
                    </div>
                  ) : (
                    autoPauseRecords?.map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-full ${record.isResumed ? 'bg-green-100' : 'bg-red-100'}`}>
                            {record.isResumed ? (
                              <Play className="h-4 w-4 text-green-600" />
                            ) : (
                              <Pause className="h-4 w-4 text-red-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">
                              {record.pauseReason === 'spend_limit_reached' && '花费限额达到'}
                              {record.pauseReason === 'anomaly_detected' && '检测到异常操作'}
                              {record.pauseReason === 'acos_threshold' && 'ACoS超过阈值'}
                              {record.pauseReason === 'manual_trigger' && '手动触发'}
                              {record.pauseReason === 'scheduled' && '定时暂停'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {record.pauseScope} - 影响 {record.pausedEntityCount} 个实体
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">
                            {new Date(record.createdAt).toLocaleString('zh-CN')}
                          </span>
                          {!record.isResumed && (
                            <ResumeDialog 
                              recordId={record.id}
                              onResume={(reason) => resumeEntities.mutate({ recordId: record.id, resumeReason: reason })}
                              isLoading={resumeEntities.isPending}
                            />
                          )}
                          {record.isResumed && (
                            <Badge variant="outline">已恢复</Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// 花费限额配置表单组件
function SpendLimitForm({ 
  accountId, 
  config, 
  onSave, 
  isLoading 
}: { 
  accountId: number;
  config: any;
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [dailyLimit, setDailyLimit] = useState(config?.dailySpendLimit || '1000');
  const [warning1, setWarning1] = useState(config?.warningThreshold1 || '50');
  const [warning2, setWarning2] = useState(config?.warningThreshold2 || '80');
  const [critical, setCritical] = useState(config?.criticalThreshold || '95');
  const [autoStop, setAutoStop] = useState(config?.autoStopEnabled === 1);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>每日花费限额 ($)</Label>
        <Input 
          type="number"
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
          placeholder="1000"
        />
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>50%告警阈值</Label>
          <Input 
            type="number"
            value={warning1}
            onChange={(e) => setWarning1(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>80%告警阈值</Label>
          <Input 
            type="number"
            value={warning2}
            onChange={(e) => setWarning2(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>95%严重告警</Label>
          <Input 
            type="number"
            value={critical}
            onChange={(e) => setCritical(e.target.value)}
          />
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <div>
          <Label>达到限额自动暂停</Label>
          <p className="text-sm text-muted-foreground">
            当花费达到100%限额时自动暂停所有广告
          </p>
        </div>
        <Switch 
          checked={autoStop}
          onCheckedChange={setAutoStop}
        />
      </div>
      
      <Button 
        className="w-full"
        onClick={() => onSave({
          accountId,
          dailySpendLimit: parseFloat(dailyLimit),
          warningThreshold1: parseFloat(warning1),
          warningThreshold2: parseFloat(warning2),
          criticalThreshold: parseFloat(critical),
          autoStopEnabled: autoStop,
        })}
        disabled={isLoading}
      >
        {isLoading ? '保存中...' : '保存配置'}
      </Button>
    </div>
  );
}

// 创建规则对话框
function CreateRuleDialog({ 
  accountId, 
  onCreate, 
  isLoading 
}: { 
  accountId?: number;
  onCreate: (data: any) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleType, setRuleType] = useState('bid_spike');
  const [conditionType, setConditionType] = useState('threshold');
  const [conditionValue, setConditionValue] = useState('100');
  const [actionOnTrigger, setActionOnTrigger] = useState('alert_only');

  const handleCreate = () => {
    onCreate({
      accountId,
      ruleName,
      ruleType,
      conditionType,
      conditionValue: parseFloat(conditionValue),
      actionOnTrigger,
    });
    setOpen(false);
    setRuleName('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          创建规则
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建异常检测规则</DialogTitle>
          <DialogDescription>
            配置新的异常检测规则
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>规则名称</Label>
            <Input 
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="例如：出价飙升检测"
            />
          </div>
          
          <div className="space-y-2">
            <Label>规则类型</Label>
            <Select value={ruleType} onValueChange={setRuleType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bid_spike">出价飙升</SelectItem>
                <SelectItem value="bid_drop">出价骤降</SelectItem>
                <SelectItem value="batch_size">批量操作数量</SelectItem>
                <SelectItem value="budget_change">预算变更</SelectItem>
                <SelectItem value="acos_spike">ACoS飙升</SelectItem>
                <SelectItem value="spend_velocity">花费速度</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>条件类型</Label>
            <Select value={conditionType} onValueChange={setConditionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="threshold">阈值</SelectItem>
                <SelectItem value="percentage_change">百分比变化</SelectItem>
                <SelectItem value="absolute_change">绝对值变化</SelectItem>
                <SelectItem value="rate_limit">频率限制</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>条件值</Label>
            <Input 
              type="number"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label>触发动作</Label>
            <Select value={actionOnTrigger} onValueChange={setActionOnTrigger}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alert_only">仅告警</SelectItem>
                <SelectItem value="pause_and_alert">暂停并告警</SelectItem>
                <SelectItem value="rollback_and_alert">回滚并告警</SelectItem>
                <SelectItem value="block_operation">阻止操作</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleCreate} disabled={isLoading || !ruleName}>
            {isLoading ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 恢复对话框
function ResumeDialog({ 
  recordId, 
  onResume, 
  isLoading 
}: { 
  recordId: number;
  onResume: (reason: string) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const handleResume = () => {
    onResume(reason);
    setOpen(false);
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Play className="h-4 w-4 mr-1" />
          恢复
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>恢复暂停的实体</DialogTitle>
          <DialogDescription>
            请说明恢复原因
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>恢复原因</Label>
            <Textarea 
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：已确认为正常操作，手动恢复"
              rows={3}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleResume} disabled={isLoading || !reason}>
            {isLoading ? '恢复中...' : '确认恢复'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
