import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  Play, 
  Pause, 
  RefreshCw, 
  Settings, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Zap,
  Database,
  Search,
  Filter,
  ArrowRightLeft,
  TrendingUp,
  History,
  Activity,
  Timer
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// 运营步骤配置
const OPERATION_STEPS = [
  { key: 'data_sync', name: '数据同步', icon: Database, description: '从Amazon API获取最新广告数据' },
  { key: 'ngram_analysis', name: 'N-Gram分析', icon: Search, description: '分析搜索词词根，识别无效流量' },
  { key: 'funnel_sync', name: '漏斗同步', icon: Filter, description: '自动同步否定词到各层漏斗' },
  { key: 'conflict_detection', name: '冲突检测', icon: AlertTriangle, description: '检测并解决流量冲突问题' },
  { key: 'migration_suggestion', name: '迁移建议', icon: ArrowRightLeft, description: '生成关键词迁移建议' },
  { key: 'bid_optimization', name: '出价优化', icon: TrendingUp, description: '基于市场曲线自动调整出价' },
];

// 格式化时间
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AutoOperation() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  
  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取自动运营配置
  const { data: config, refetch: refetchConfig } = trpc.autoOperation.getConfig.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );
  
  // 获取运营日志
  const { data: logs, refetch: refetchLogs } = trpc.autoOperation.getLogs.useQuery(
    { accountId: selectedAccountId!, limit: 20 },
    { enabled: !!selectedAccountId }
  );
  
  // 更新配置mutation
  const updateConfigMutation = trpc.autoOperation.upsertConfig.useMutation({
    onSuccess: () => {
      toast.success("配置已更新");
      refetchConfig();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  
  // 执行完整运营流程mutation
  const executeOperationMutation = trpc.autoOperation.executeFullOperation.useMutation({
    onSuccess: (result) => {
      setIsExecuting(false);
      toast.success(`运营完成: ${result.summary.successSteps}/${result.summary.totalSteps} 步骤成功`);
      refetchLogs();
      refetchConfig();
    },
    onError: (error) => {
      setIsExecuting(false);
      toast.error(`运营失败: ${error.message}`);
    },
  });
  
  // 处理配置更新
  const handleConfigUpdate = (updates: Record<string, any>) => {
    if (!selectedAccountId) return;
    updateConfigMutation.mutate({
      accountId: selectedAccountId,
      ...updates,
    });
  };
  
  // 处理立即执行
  const handleExecuteNow = () => {
    if (!selectedAccountId) {
      toast.error("请先选择账号");
      return;
    }
    setIsExecuting(true);
    executeOperationMutation.mutate({ accountId: selectedAccountId });
  };
  
  // 自动选择第一个账号
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6 text-yellow-500" />
              自动运营控制中心
            </h1>
            <p className="text-muted-foreground">
              每2小时自动执行完整优化流程：数据同步 → N-Gram分析 → 漏斗同步 → 冲突检测 → 迁移建议 → 出价优化
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(value) => setSelectedAccountId(Number(value))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.storeName || account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              onClick={handleExecuteNow} 
              disabled={!selectedAccountId || isExecuting}
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  执行中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  立即执行
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 状态概览 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">自动运营状态</p>
                  <p className="text-2xl font-bold">
                    {config?.enabled ? (
                      <span className="text-green-500">已启用</span>
                    ) : (
                      <span className="text-gray-500">已禁用</span>
                    )}
                  </p>
                </div>
                <Activity className={`h-8 w-8 ${config?.enabled ? 'text-green-500' : 'text-gray-400'}`} />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">执行间隔</p>
                  <p className="text-2xl font-bold">{config?.intervalHours || 2} 小时</p>
                </div>
                <Timer className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">上次执行</p>
                  <p className="text-lg font-medium">{formatDateTime(config?.lastRunAt || null)}</p>
                </div>
                <History className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">下次执行</p>
                  <p className="text-lg font-medium">{formatDateTime(config?.nextRunAt || null)}</p>
                </div>
                <Clock className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="config" className="space-y-4">
          <TabsList>
            <TabsTrigger value="config">运营配置</TabsTrigger>
            <TabsTrigger value="logs">执行日志</TabsTrigger>
            <TabsTrigger value="steps">运营步骤</TabsTrigger>
          </TabsList>

          {/* 运营配置 */}
          <TabsContent value="config" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  自动运营配置
                </CardTitle>
                <CardDescription>
                  配置每2小时自动执行的优化步骤
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 总开关 */}
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label className="text-base font-medium">启用自动运营</Label>
                    <p className="text-sm text-muted-foreground">
                      开启后系统将每{config?.intervalHours || 2}小时自动执行选中的优化步骤
                    </p>
                  </div>
                  <Switch
                    checked={config?.enabled ?? false}
                    onCheckedChange={(checked) => handleConfigUpdate({ enabled: checked })}
                  />
                </div>

                <Separator />

                {/* 执行间隔 */}
                <div className="space-y-2">
                  <Label>执行间隔</Label>
                  <Select
                    value={config?.intervalHours?.toString() || "2"}
                    onValueChange={(value) => handleConfigUpdate({ intervalHours: Number(value) })}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">每1小时</SelectItem>
                      <SelectItem value="2">每2小时（推荐）</SelectItem>
                      <SelectItem value="4">每4小时</SelectItem>
                      <SelectItem value="6">每6小时</SelectItem>
                      <SelectItem value="12">每12小时</SelectItem>
                      <SelectItem value="24">每24小时</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* 步骤开关 */}
                <div className="space-y-4">
                  <Label className="text-base font-medium">启用的优化步骤</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {OPERATION_STEPS.map((step) => {
                      // 构建配置键名
                      const keyParts = step.key.split('_');
                      const configKeyName = 'enable' + keyParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
                      
                      // 根据步骤获取对应的配置值
                      let isEnabled = true;
                      if (config) {
                        if (step.key === 'data_sync') isEnabled = config.enableDataSync ?? true;
                        else if (step.key === 'ngram_analysis') isEnabled = config.enableNgramAnalysis ?? true;
                        else if (step.key === 'funnel_sync') isEnabled = config.enableFunnelSync ?? true;
                        else if (step.key === 'conflict_detection') isEnabled = config.enableConflictDetection ?? true;
                        else if (step.key === 'migration_suggestion') isEnabled = config.enableMigrationSuggestion ?? true;
                        else if (step.key === 'bid_optimization') isEnabled = config.enableBidOptimization ?? true;
                      }
                      
                      return (
                        <div 
                          key={step.key}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <step.icon className="h-5 w-5 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{step.name}</p>
                              <p className="text-xs text-muted-foreground">{step.description}</p>
                            </div>
                          </div>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => {
                              handleConfigUpdate({ [configKeyName]: checked });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 执行日志 */}
          <TabsContent value="logs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  执行日志
                </CardTitle>
                <CardDescription>
                  查看自动运营的执行历史记录
                </CardDescription>
              </CardHeader>
              <CardContent>
                {logs && logs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>执行时间</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>耗时</TableHead>
                        <TableHead>详情</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>{formatDateTime(log.startedAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.operationType}</Badge>
                          </TableCell>
                          <TableCell>
                            {log.status === 'completed' && (
                              <Badge className="bg-green-500">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                完成
                              </Badge>
                            )}
                            {log.status === 'failed' && (
                              <Badge variant="destructive">
                                <XCircle className="h-3 w-3 mr-1" />
                                失败
                              </Badge>
                            )}
                            {log.status === 'running' && (
                              <Badge className="bg-blue-500">
                                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                运行中
                              </Badge>
                            )}
                            {log.status === 'pending' && (
                              <Badge variant="secondary">
                                <Clock className="h-3 w-3 mr-1" />
                                等待中
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {log.duration ? formatDuration(log.duration) : '-'}
                          </TableCell>
                          <TableCell>
                            {log.errorMessage ? (
                              <span className="text-red-500 text-sm">{log.errorMessage}</span>
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                {log.details?.summary ? 
                                  `成功: ${log.details.summary.successSteps}, 失败: ${log.details.summary.failedSteps}` : 
                                  '-'
                                }
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无执行日志
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 运营步骤说明 */}
          <TabsContent value="steps" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  自动运营流程
                </CardTitle>
                <CardDescription>
                  每2小时自动执行的完整优化流程说明
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {OPERATION_STEPS.map((step, index) => (
                    <div key={step.key} className="flex items-start gap-4 p-4 border rounded-lg">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <step.icon className="h-4 w-4 text-primary" />
                          <h4 className="font-medium">{step.name}</h4>
                        </div>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {step.key === 'data_sync' && '从Amazon Advertising API获取最新的广告活动、关键词、搜索词报告等数据'}
                          {step.key === 'ngram_analysis' && '对搜索词进行N-Gram分词分析，识别高频无效词根，生成否定关键词建议'}
                          {step.key === 'funnel_sync' && '根据漏斗层级配置，自动将否定词同步到上层广告活动，防止流量泄漏'}
                          {step.key === 'conflict_detection' && '检测同一搜索词在多个广告活动中的竞争情况，计算浪费花费并生成解决方案'}
                          {step.key === 'migration_suggestion' && '分析关键词表现，生成从自动广告到手动广告、从广泛匹配到精确匹配的迁移建议'}
                          {step.key === 'bid_optimization' && '基于市场曲线模型和历史数据，自动计算并应用最优出价调整'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Alert className="mt-6">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>安全边界保护</AlertTitle>
                  <AlertDescription>
                    所有自动调整都受到安全边界保护：单次出价调整不超过20%，单日调整次数有限制，
                    异常情况自动触发回滚机制，确保广告投放安全稳定。
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
