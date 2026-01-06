import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Trash2,
  Edit,
  Plus,
  RefreshCw,
  Loader2,
  RotateCcw,
  Shield,
  Bell,
  Target,
  TrendingDown,
  Eye
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

// 优先级颜色映射
const priorityColors: Record<string, string> = {
  low: 'bg-gray-500/10 text-gray-600',
  medium: 'bg-yellow-500/10 text-yellow-600',
  high: 'bg-red-500/10 text-red-600',
};

// 状态颜色映射
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-600',
  approved: 'bg-blue-500/10 text-blue-600',
  rejected: 'bg-gray-500/10 text-gray-600',
  executed: 'bg-green-500/10 text-green-600',
};

export default function AutoRollbackSettings() {
  const [activeTab, setActiveTab] = useState('rules');
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState('');

  // 获取回滚规则
  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } = trpc.autoRollback.getRules.useQuery();

  // 获取回滚建议
  const { data: suggestions, isLoading: suggestionsLoading, refetch: refetchSuggestions } = trpc.autoRollback.getSuggestions.useQuery({});

  // 获取统计数据
  const { data: stats } = trpc.autoRollback.getStats.useQuery();

  // 运行评估
  const runEvaluationMutation = trpc.autoRollback.runEvaluation.useMutation({
    onSuccess: (result) => {
      toast.success(`评估完成：发现 ${result.suggestions.length} 条新建议`);
      refetchSuggestions();
    },
    onError: (error) => {
      toast.error(`评估失败: ${error.message}`);
    },
  });

  // 创建规则
  const createRuleMutation = trpc.autoRollback.createRule.useMutation({
    onSuccess: () => {
      toast.success('规则创建成功');
      setRuleDialogOpen(false);
      setEditingRule(null);
      refetchRules();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  // 更新规则
  const updateRuleMutation = trpc.autoRollback.updateRule.useMutation({
    onSuccess: () => {
      toast.success('规则更新成功');
      setRuleDialogOpen(false);
      setEditingRule(null);
      refetchRules();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 删除规则
  const deleteRuleMutation = trpc.autoRollback.deleteRule.useMutation({
    onSuccess: () => {
      toast.success('规则删除成功');
      refetchRules();
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  // 审核建议
  const reviewSuggestionMutation = trpc.autoRollback.reviewSuggestion.useMutation({
    onSuccess: () => {
      toast.success('审核完成');
      setReviewDialogOpen(false);
      setSelectedSuggestion(null);
      setReviewNote('');
      refetchSuggestions();
    },
    onError: (error) => {
      toast.error(`审核失败: ${error.message}`);
    },
  });

  // 执行建议
  const executeSuggestionMutation = trpc.autoRollback.executeSuggestion.useMutation({
    onSuccess: () => {
      toast.success('回滚执行成功');
      refetchSuggestions();
    },
    onError: (error) => {
      toast.error(`执行失败: ${error.message}`);
    },
  });

  // 新建/编辑规则表单
  const [ruleForm, setRuleForm] = useState({
    name: '',
    description: '',
    enabled: true,
    conditions: {
      profitThresholdPercent: 50,
      minTrackingDays: 7 as 7 | 14 | 30,
      minSampleCount: 1,
      includeNegativeAdjustments: false,
    },
    actions: {
      autoRollback: false,
      sendNotification: true,
      notificationPriority: 'medium' as 'low' | 'medium' | 'high',
    },
  });

  const openEditDialog = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      conditions: { ...rule.conditions },
      actions: { ...rule.actions },
    });
    setRuleDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingRule(null);
    setRuleForm({
      name: '',
      description: '',
      enabled: true,
      conditions: {
        profitThresholdPercent: 50,
        minTrackingDays: 7,
        minSampleCount: 1,
        includeNegativeAdjustments: false,
      },
      actions: {
        autoRollback: false,
        sendNotification: true,
        notificationPriority: 'medium',
      },
    });
    setRuleDialogOpen(true);
  };

  const handleSaveRule = () => {
    if (editingRule) {
      updateRuleMutation.mutate({
        ruleId: editingRule.id,
        ...ruleForm,
      });
    } else {
      createRuleMutation.mutate(ruleForm);
    }
  };

  const handleReview = (action: 'approve' | 'reject') => {
    if (!selectedSuggestion) return;
    reviewSuggestionMutation.mutate({
      suggestionId: selectedSuggestion.id,
      action,
      reviewNote: reviewNote || undefined,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-orange-500" />
              自动回滚规则
            </h1>
            <p className="text-muted-foreground mt-1">
              设置阈值自动检测效果不佳的出价调整，生成回滚建议
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => runEvaluationMutation.mutate({})}
              disabled={runEvaluationMutation.isPending}
            >
              {runEvaluationMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              运行评估
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">待处理建议</p>
                    <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                  </div>
                  <Clock className="w-8 h-8 text-yellow-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">已批准</p>
                    <p className="text-2xl font-bold text-blue-600">{stats.approved}</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-blue-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">已执行</p>
                    <p className="text-2xl font-bold text-green-600">{stats.executed}</p>
                  </div>
                  <RotateCcw className="w-8 h-8 text-green-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">高优先级</p>
                    <p className="text-2xl font-bold text-red-600">{stats.byPriority.high}</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-red-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">总建议数</p>
                    <p className="text-2xl font-bold">{stats.total}</p>
                  </div>
                  <Target className="w-8 h-8 text-purple-500/20" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="rules" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              规则配置
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              回滚建议
              {stats && stats.pending > 0 && (
                <Badge variant="destructive" className="ml-1">{stats.pending}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* 规则配置 */}
          <TabsContent value="rules" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">回滚规则</CardTitle>
                  <CardDescription>配置自动检测效果不佳调整的规则</CardDescription>
                </div>
                <Button size="sm" onClick={openCreateDialog}>
                  <Plus className="w-4 h-4 mr-2" />
                  新建规则
                </Button>
              </CardHeader>
              <CardContent>
                {rulesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : rules?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无规则，点击"新建规则"创建
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rules?.map((rule: any) => (
                      <div
                        key={rule.id}
                        className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{rule.name}</h3>
                              <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                                {rule.enabled ? '启用' : '禁用'}
                              </Badge>
                              <Badge className={priorityColors[rule.actions.notificationPriority]}>
                                {rule.actions.notificationPriority === 'high' ? '高优先级' : 
                                 rule.actions.notificationPriority === 'medium' ? '中优先级' : '低优先级'}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
                            <div className="flex flex-wrap gap-4 mt-3 text-sm">
                              <div className="flex items-center gap-1">
                                <TrendingDown className="w-4 h-4 text-muted-foreground" />
                                <span>阈值: {rule.conditions.profitThresholdPercent}%</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                <span>追踪: {rule.conditions.minTrackingDays}天</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Bell className="w-4 h-4 text-muted-foreground" />
                                <span>{rule.actions.sendNotification ? '发送通知' : '不通知'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(rule)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteRuleMutation.mutate({ ruleId: rule.id })}
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 回滚建议 */}
          <TabsContent value="suggestions" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">回滚建议</CardTitle>
                  <CardDescription>根据规则自动生成的回滚建议</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchSuggestions()}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新
                </Button>
              </CardHeader>
              <CardContent>
                {suggestionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : suggestions?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无回滚建议
                  </div>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead>关键词</TableHead>
                          <TableHead>广告活动</TableHead>
                          <TableHead className="text-right">出价变化</TableHead>
                          <TableHead className="text-right">预估利润</TableHead>
                          <TableHead className="text-right">实际利润</TableHead>
                          <TableHead className="text-right">差异</TableHead>
                          <TableHead>优先级</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-center">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {suggestions?.map((suggestion: any) => (
                          <TableRow key={suggestion.id}>
                            <TableCell className="font-medium max-w-[150px] truncate">
                              {suggestion.keywordText || '-'}
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate">
                              {suggestion.campaignName || '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${suggestion.previousBid?.toFixed(2)} → ${suggestion.newBid?.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${suggestion.estimatedProfit?.toFixed(2)}
                            </TableCell>
                            <TableCell className={`text-right font-mono ${suggestion.actualProfit < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              ${suggestion.actualProfit?.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={suggestion.profitDifferencePercent < 50 ? 'text-red-600' : ''}>
                                {suggestion.profitDifferencePercent?.toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge className={priorityColors[suggestion.priority]}>
                                {suggestion.priority === 'high' ? '高' : suggestion.priority === 'medium' ? '中' : '低'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[suggestion.status]}>
                                {suggestion.status === 'pending' ? '待处理' :
                                 suggestion.status === 'approved' ? '已批准' :
                                 suggestion.status === 'rejected' ? '已拒绝' : '已执行'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                {suggestion.status === 'pending' && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setSelectedSuggestion(suggestion);
                                        setReviewDialogOpen(true);
                                      }}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  </>
                                )}
                                {suggestion.status === 'approved' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => executeSuggestionMutation.mutate({ suggestionId: suggestion.id })}
                                    disabled={executeSuggestionMutation.isPending}
                                  >
                                    <RotateCcw className="w-4 h-4 text-green-600" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* 规则编辑对话框 */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? '编辑规则' : '新建规则'}</DialogTitle>
            <DialogDescription>
              配置自动检测效果不佳调整的规则
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>规则名称</Label>
              <Input
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                placeholder="输入规则名称"
              />
            </div>
            <div className="space-y-2">
              <Label>规则描述</Label>
              <Textarea
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                placeholder="输入规则描述"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>启用规则</Label>
              <Switch
                checked={ruleForm.enabled}
                onCheckedChange={(checked) => setRuleForm({ ...ruleForm, enabled: checked })}
              />
            </div>
            
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">触发条件</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>利润阈值 (%)</Label>
                  <Input
                    type="number"
                    value={ruleForm.conditions.profitThresholdPercent}
                    onChange={(e) => setRuleForm({
                      ...ruleForm,
                      conditions: { ...ruleForm.conditions, profitThresholdPercent: Number(e.target.value) }
                    })}
                  />
                  <p className="text-xs text-muted-foreground">实际利润低于预估的此百分比时触发</p>
                </div>
                <div className="space-y-2">
                  <Label>最小追踪天数</Label>
                  <Select
                    value={String(ruleForm.conditions.minTrackingDays)}
                    onValueChange={(value) => setRuleForm({
                      ...ruleForm,
                      conditions: { ...ruleForm.conditions, minTrackingDays: Number(value) as 7 | 14 | 30 }
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7天</SelectItem>
                      <SelectItem value="14">14天</SelectItem>
                      <SelectItem value="30">30天</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <Label>包含降价调整</Label>
                <Switch
                  checked={ruleForm.conditions.includeNegativeAdjustments}
                  onCheckedChange={(checked) => setRuleForm({
                    ...ruleForm,
                    conditions: { ...ruleForm.conditions, includeNegativeAdjustments: checked }
                  })}
                />
              </div>
            </div>
            
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">动作配置</h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>发送通知</Label>
                  <Switch
                    checked={ruleForm.actions.sendNotification}
                    onCheckedChange={(checked) => setRuleForm({
                      ...ruleForm,
                      actions: { ...ruleForm.actions, sendNotification: checked }
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>通知优先级</Label>
                  <Select
                    value={ruleForm.actions.notificationPriority}
                    onValueChange={(value) => setRuleForm({
                      ...ruleForm,
                      actions: { ...ruleForm.actions, notificationPriority: value as 'low' | 'medium' | 'high' }
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">低</SelectItem>
                      <SelectItem value="medium">中</SelectItem>
                      <SelectItem value="high">高</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveRule}
              disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
            >
              {(createRuleMutation.isPending || updateRuleMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 审核对话框 */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>审核回滚建议</DialogTitle>
            <DialogDescription>
              查看建议详情并决定是否批准回滚
            </DialogDescription>
          </DialogHeader>
          {selectedSuggestion && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">关键词</span>
                  <span className="font-medium">{selectedSuggestion.keywordText}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">广告活动</span>
                  <span>{selectedSuggestion.campaignName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">出价变化</span>
                  <span className="font-mono">
                    ${selectedSuggestion.previousBid?.toFixed(2)} → ${selectedSuggestion.newBid?.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">预估利润</span>
                  <span className="font-mono">${selectedSuggestion.estimatedProfit?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">实际利润</span>
                  <span className={`font-mono ${selectedSuggestion.actualProfit < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    ${selectedSuggestion.actualProfit?.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">追踪天数</span>
                  <span>{selectedSuggestion.trackingDays}天</span>
                </div>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">{selectedSuggestion.reason}</p>
              </div>
              
              <div className="space-y-2">
                <Label>审核备注（可选）</Label>
                <Textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="输入审核备注..."
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleReview('reject')}
              disabled={reviewSuggestionMutation.isPending}
            >
              <XCircle className="w-4 h-4 mr-2" />
              拒绝
            </Button>
            <Button
              onClick={() => handleReview('approve')}
              disabled={reviewSuggestionMutation.isPending}
            >
              {reviewSuggestionMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              <CheckCircle className="w-4 h-4 mr-2" />
              批准
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
