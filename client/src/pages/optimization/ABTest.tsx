import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { PageMeta, PAGE_META_CONFIG } from '@/components/PageMeta';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  FlaskConical, Play, Pause, CheckCircle, XCircle, TrendingUp, TrendingDown, 
  BarChart3, Plus, Trash2, Zap, Target, Award, ArrowRight, Copy, 
  Activity, Clock, AlertTriangle, CheckCircle2
} from 'lucide-react';
import ABTestCharts from '@/components/ABTestCharts';

import { useGlobalAccountId } from "@/hooks/useGlobalAccountId";
export default function ABTest() {
  const { user } = useAuth();
  // v399: 使用全局店铺选择器替代本地状态
  const { accountId: selectedAccountId, accounts, isLoading: accountsLoading } = useGlobalAccountId();
  const setSelectedAccountId = (_: unknown) => {}; // v399: 由全局选择器控制，本地setter为no-op
const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // 获取账号列表
  // 获取A/B测试列表
  const { data: tests, refetch: refetchTests } = trpc.abTest.list.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // v276: 获取实验统计概览
  const { data: overview } = trpc.abTest.overview.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取测试详情
  const { data: testDetails } = trpc.abTest.get.useQuery(
    { testId: selectedTestId! },
    { enabled: !!selectedTestId }
  );

  // 获取测试分析结果
  const { data: analysisResults } = trpc.abTest.analyze.useQuery(
    { testId: selectedTestId! },
    { enabled: !!selectedTestId && (testDetails?.test?.status === 'running' || testDetails?.test?.status === 'completed') }
  );

  // v276: 获取每日趋势
  const { data: dailyTrend } = trpc.abTest.getDailyTrend.useQuery(
    { testId: selectedTestId! },
    { enabled: !!selectedTestId && (testDetails?.test?.status === 'running' || testDetails?.test?.status === 'completed') }
  );

  // 创建测试
  const createTestMutation = trpc.abTest.create.useMutation({
    onSuccess: () => {
      toast.success('A/B测试创建成功');
      setCreateDialogOpen(false);
      refetchTests();
    },
    onError: (error: unknown) => {
      // @ts-ignore
      toast.error(error.message);
    },
  });

  // v276: 从模板创建
  const createFromTemplateMutation = trpc.abTest.createFromTemplate.useMutation({
    onSuccess: () => {
      toast.success('从模板创建实验成功');
      setTemplateDialogOpen(false);
      refetchTests();
    },
    // @ts-ignore
    onError: (error: unknown) => {
      // @ts-ignore
      toast.error(error.message);
    },
  });

  // v276: 应用获胜策略
  const applyWinnerMutation = trpc.abTest.applyWinnerStrategy.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
    },
    onError: (error: unknown) => {
      // @ts-ignore
      toast.error(error.message);
    },
  });

  // 启动测试
  const startTestMutation = trpc.abTest.start.useMutation({
    onSuccess: () => {
      toast.success('测试已启动');
      refetchTests();
    },
  });

  // 暂停测试
  const pauseTestMutation = trpc.abTest.pause.useMutation({
    onSuccess: () => {
      toast.success('测试已暂停');
      refetchTests();
    },
  });

  // 结束测试
  const completeTestMutation = trpc.abTest.complete.useMutation({
    onSuccess: () => {
      toast.success('测试已结束');
      refetchTests();
    },
  });

  // 删除测试
  const deleteTestMutation = trpc.abTest.delete.useMutation({
    onSuccess: () => {
      toast.success('测试已删除');
      setSelectedTestId(null);
      refetchTests();
    },
  });

  // 创建测试表单状态
  const [newTest, setNewTest] = useState({
    testName: '',
    testDescription: '',
    testType: 'budget_allocation' as const,
    targetMetric: 'roas' as const,
    durationDays: 14,
    trafficSplit: 0.5,
  });

  // v276: 模板选择状态
  const [selectedTemplate, setSelectedTemplate] = useState<string>('cascade_vs_single');

  const handleCreateTest = () => {
    if (!selectedAccountId) return;
    createTestMutation.mutate({
      accountId: selectedAccountId,
      ...newTest,
      controlConfig: { strategy: 'current' },
      treatmentConfig: { strategy: 'optimized' },
    });
  };

  const handleCreateFromTemplate = () => {
    // @ts-ignore
    if (!selectedAccountId) return;
    createFromTemplateMutation.mutate({
      accountId: selectedAccountId,
      // @ts-ignore
      template: selectedTemplate as unknown,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon: unknown }> = {
      draft: { variant: 'secondary', label: '草稿', icon: Clock },
      running: { variant: 'default', label: '运行中', icon: Activity },
      paused: { variant: 'outline', label: '已暂停', icon: Pause },
      completed: { variant: 'default', label: '已完成', icon: CheckCircle2 },
      cancelled: { variant: 'destructive', label: '已取消', icon: XCircle },
    };
    // @ts-ignore
    const config = statusConfig[status] || { variant: 'secondary', label: status, icon: Clock };
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {/* @ts-ignore */}
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getWinnerIcon = (winner: string) => {
    if (winner === 'treatment') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (winner === 'control') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <BarChart3 className="h-4 w-4 text-gray-500" />;
  };

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.abTesting} />
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <FlaskConical className="h-6 w-6 text-purple-500" />
              A/B测试实验中心
            </h1>
            <p className="text-muted-foreground text-sm">闭环A/B测试框架 — 科学评估优化策略效果</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <Select
              value={selectedAccountId?.toString() || ''}
              onValueChange={(value) => setSelectedAccountId(Number(value))}
            >
              {/* @ts-ignore */}
              <SelectTrigger className="w-[200px]">
                {/* @ts-ignore */}
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account: unknown) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {/* @ts-ignore */}
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* v276: 模板快速创建按钮 */}
            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!selectedAccountId}>
                  <Zap className="h-4 w-4 mr-2" />
                  快速创建
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>从模板快速创建实验</DialogTitle>
                  <DialogDescription>选择预设的实验模板，一键创建标准化A/B测试</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div 
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedTemplate === 'cascade_vs_single' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-accent/50'}`}
                    onClick={() => setSelectedTemplate('cascade_vs_single')}
                  >
                    <div className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-purple-500" />
                      <span className="font-medium">Cascade Ensemble vs Single</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">对比Cascade Ensemble融合模式与传统Single模式的ROAS表现</p>
                  </div>
                  <div 
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedTemplate === 'fusion_threshold' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-accent/50'}`}
                    onClick={() => setSelectedTemplate('fusion_threshold')}
                  >
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-blue-500" />
                      <span className="font-medium">融合阈值对比</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">对比10% vs 20%融合阈值对算法融合效果的影响</p>
                  </div>
                  <div 
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedTemplate === 'exploration_rate' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'hover:bg-accent/50'}`}
                    onClick={() => setSelectedTemplate('exploration_rate')}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-green-500" />
                      <span className="font-medium">探索率对比</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">对比不同探索率范围对算法学习效率的影响</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>取消</Button>
                  <Button onClick={handleCreateFromTemplate}>
                    <Zap className="h-4 w-4 mr-2" />
                    创建实验
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* 自定义创建按钮 */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={!selectedAccountId}>
                  <Plus className="h-4 w-4 mr-2" />
                  自定义创建
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>创建自定义A/B测试</DialogTitle>
                  <DialogDescription>配置新的A/B测试参数</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>测试名称</Label>
                    <Input
                      value={newTest.testName}
                      onChange={(e) => setNewTest({ ...newTest, testName: e.target.value })}
                      placeholder="输入测试名称"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>测试描述</Label>
                    <Input
                      value={newTest.testDescription}
                      onChange={(e) => setNewTest({ ...newTest, testDescription: e.target.value })}
                      placeholder="输入测试描述"
                    // @ts-ignore
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>测试类型</Label>
                    <Select
                      value={newTest.testType}
                      onValueChange={(value) => 
                        setNewTest({ ...newTest, testType: value as unknown })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="budget_allocation">预算分配</SelectItem>
                        <SelectItem value="bid_strategy">出价策略</SelectItem>
                        <SelectItem value="targeting">定向策略</SelectItem>
                      {/* @ts-ignore */}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>目标指标</Label>
                    <Select
                      value={newTest.targetMetric}
                      onValueChange={(value) => 
                        setNewTest({ ...newTest, targetMetric: value as unknown })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="roas">ROAS</SelectItem>
                        <SelectItem value="acos">ACoS</SelectItem>
                        <SelectItem value="conversions">转化数</SelectItem>
                        <SelectItem value="revenue">收入</SelectItem>
                        <SelectItem value="profit">利润</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>测试时长（天）</Label>
                      <Input
                        type="number"
                        value={newTest.durationDays}
                        onChange={(e) => setNewTest({ ...newTest, durationDays: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>实验组流量比例</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="0.9"
                        value={newTest.trafficSplit}
                        onChange={(e) => setNewTest({ ...newTest, trafficSplit: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
                  <Button onClick={handleCreateTest} disabled={!newTest.testName}>创建</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* v276: 实验统计概览卡片 */}
        {overview && selectedAccountId && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold">{overview.total}</p>
                    <p className="text-xs text-muted-foreground">总实验数</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-green-600">{overview.running}</p>
                    <p className="text-xs text-muted-foreground">运行中</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold text-blue-600">{overview.completed}</p>
                    <p className="text-xs text-muted-foreground">已完成</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="text-2xl font-bold">{overview.draft}</p>
                    <p className="text-xs text-muted-foreground">草稿</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-2xl font-bold">{(overview.avgConfidence * 100).toFixed(0)}%</p>
                    <p className="text-xs text-muted-foreground">平均置信度</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 测试列表 */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                测试列表
              </CardTitle>
              <CardDescription>
                {tests ? `共 ${tests.length} 个实验` : '选择账号查看实验'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {tests?.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10">
                    <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
                      <FlaskConical className="h-7 w-7 text-blue-400/50" />
                    </div>
                    {/* @ts-ignore */}
                    <h3 className="text-sm font-semibold mb-1">开始您的第一个A/B实验</h3>
                    <p className="text-xs text-muted-foreground text-center max-w-xs mb-3">
                      通过A/B测试对比不同的竞价策略、关键词组合或广告创意，找到最优方案。
                    </p>
                    {/* @ts-ignore */}
                    <p className="text-xs text-muted-foreground">点击上方"快速创建"或"自定义创建"开始</p>
                  </div>
                )}
                {tests?.map((test: unknown) => (
                  <div
                    // @ts-ignore
                    key={test.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      // @ts-ignore
                      selectedTestId === test.id ? 'bg-accent border-primary' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => setSelectedTestId(test.id)}
                  >
                    <div className="flex items-center justify-between">
                      {/* @ts-ignore */}
                      <span className="font-medium text-sm">{test.testName}</span>
                      {/* @ts-ignore */}
                      {getStatusBadge(test.status)}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {(test as any).testType === 'budget_allocation' ? '预算分配' : 
                         // @ts-ignore
                         test.testType === 'bid_strategy' ? '出价策略' : '定向策略'}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        目标: {(test as any).targetMetric?.toUpperCase()}
                      </span>
                    </div>
                    {/* @ts-ignore */}
                    {test.startDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {/* @ts-ignore */}
                        {new Date(test.startDate).toLocaleDateString('zh-CN')}
                        {(test as any).endDate && ` → ${new Date((test as any).endDate).toLocaleDateString('zh-CN')}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 测试详情 */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {testDetails ? (
                  <>
                    <Target className="h-5 w-5 text-purple-500" />
                    {testDetails.test.testName}
                  </>
                ) : (
                  '测试详情'
                )}
              </CardTitle>
              <CardDescription>
                {testDetails ? testDetails.test.testDescription || '选择一个测试查看详情' : '选择一个测试查看详情'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testDetails ? (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="results">结果分析</TabsTrigger>
                    <TabsTrigger value="feedback">闭环反馈</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">状态</p>
                        {getStatusBadge(testDetails.test.status)}
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">目标指标</p>
                        <p className="font-medium">{testDetails.test.targetMetric?.toUpperCase()}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">对照组广告活动</p>
                        <p className="font-medium">{testDetails.campaignCount.control} 个</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">实验组广告活动</p>
                        <p className="font-medium">{testDetails.campaignCount.treatment} 个</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">置信水平</p>
                        <p className="font-medium">{(parseFloat(testDetails.test.confidenceLevel || '0.95') * 100).toFixed(0)}%</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">最小样本量</p>
                        <p className="font-medium">{testDetails.test.minSampleSize}</p>
                      </div>
                    </div>

                    {/* 时间进度条 */}
                    {testDetails.test.startDate && testDetails.test.endDate && (
                      <div className="space-y-2 pt-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>开始: {new Date(testDetails.test.startDate).toLocaleDateString('zh-CN')}</span>
                          <span>结束: {new Date(testDetails.test.endDate).toLocaleDateString('zh-CN')}</span>
                        </div>
                        <Progress 
                          value={Math.min(100, Math.max(0,
                            ((Date.now() - new Date(testDetails.test.startDate).getTime()) / 
                            (new Date(testDetails.test.endDate).getTime() - new Date(testDetails.test.startDate).getTime())) * 100
                          ))} 
                        />
                      </div>
                    )}

                    <div className="flex gap-2 pt-4 flex-wrap">
                      {testDetails.test.status === 'draft' && (
                        <Button onClick={() => startTestMutation.mutate({ testId: testDetails.test.id })}>
                          <Play className="h-4 w-4 mr-2" />
                          启动测试
                        </Button>
                      )}
                      {testDetails.test.status === 'running' && (
                        <>
                          <Button variant="outline" onClick={() => pauseTestMutation.mutate({ testId: testDetails.test.id })}>
                            <Pause className="h-4 w-4 mr-2" />
                            暂停
                          </Button>
                          <Button onClick={() => completeTestMutation.mutate({ testId: testDetails.test.id })}>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            结束测试
                          </Button>
                        </>
                      )}
                      {testDetails.test.status === 'paused' && (
                        <Button onClick={() => startTestMutation.mutate({ testId: testDetails.test.id })}>
                          <Play className="h-4 w-4 mr-2" />
                          继续测试
                        </Button>
                      )}
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => deleteTestMutation.mutate({ testId: testDetails.test.id })}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        删除
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="results" className="space-y-4">
                    {analysisResults ? (
                      <>
                        <div className="p-4 rounded-lg bg-accent">
                          <div className="flex items-center gap-2">
                            {getWinnerIcon(analysisResults.overallWinner)}
                            <span className="font-medium">
                              {analysisResults.overallWinner === 'treatment' ? '实验组胜出' :
                               analysisResults.overallWinner === 'control' ? '对照组胜出' : '结果不确定'}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {analysisResults.recommendation}
                          </p>
                        {/* @ts-ignore */}
                        </div>

                        {/* @ts-ignore */}
                        {/* 指标对比表格 */}
                        {/* @ts-ignore */}
                        {analysisResults.metrics && analysisResults.metrics.length > 0 && (
                          <div className="overflow-x-auto">
                            {/* @ts-ignore */}
                            <table className="w-full text-sm">
                              <thead>
                                {/* @ts-ignore */}
                                <tr className="border-b">
                                  <th className="text-left p-2">指标</th>
                                  <th className="text-right p-2">对照组</th>
                                  <th className="text-right p-2">实验组</th>
                                  <th className="text-right p-2">差异</th>
                                  <th className="text-right p-2">p值</th>
                                  <th className="text-center p-2">显著性</th>
                                </tr>
                              </thead>
                              <tbody>
                                {analysisResults.metrics.map((m: unknown, idx: number) => (
                                  <tr key={idx} className="border-b">
                                    {/* @ts-ignore */}
                                    <td className="p-2 font-medium">{m.metricName?.toUpperCase()}</td>
                                    {/* @ts-ignore */}
                                    <td className="p-2 text-right">{(m.controlValue || 0).toFixed(4)}</td>
                                    {/* @ts-ignore */}
                                    <td className="p-2 text-right">{(m.treatmentValue || 0).toFixed(4)}</td>
                                    {/* @ts-ignore */}
                                    <td className={`p-2 text-right ${m.relativeDifference > 0 ? 'text-green-600' : m.relativeDifference < 0 ? 'text-red-600' : ''}`}>
                                      {(m as any).relativeDifference > 0 ? '+' : ''}{((m as any).relativeDifference || 0).toFixed(2)}%
                                    </td>
                                    {/* @ts-ignore */}
                                    <td className="p-2 text-right">{(m.pValue || 0).toFixed(4)}</td>
                                    <td className="p-2 text-center">
                                      {/* @ts-ignore */}
                                      {m.isSignificant ? (
                                        <Badge variant="default" className="bg-green-500">显著</Badge>
                                      ) : (
                                        <Badge variant="secondary">不显著</Badge>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* 可视化图表 */}
                        <ABTestCharts 
                          // @ts-ignore
                          analysisResults={analysisResults as unknown} 
                          testName={testDetails?.test?.testName}
                        />
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">
                          {testDetails.test.status === 'draft' ? '请先启动测试' : '数据收集中，稍后将显示分析结果'}
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  {/* v276: 闭环反馈Tab */}
                  <TabsContent value="feedback" className="space-y-4">
                    <div className="p-4 rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20">
                      <h3 className="font-medium flex items-center gap-2">
                        <Award className="h-5 w-5 text-purple-500" />
                        闭环反馈机制
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        当实验结果显著时，可将获胜策略自动应用到优化引擎，实现"实验→验证→应用"的完整闭环。
                      </p>
                    </div>

                    {testDetails.test.status === 'completed' && analysisResults ? (
                      <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-accent">
                          <div className="flex items-center gap-2">
                            {getWinnerIcon(analysisResults.overallWinner)}
                            <span className="font-medium">
                              实验结论: {analysisResults.overallWinner === 'treatment' ? '实验组策略更优' :
                                        analysisResults.overallWinner === 'control' ? '当前策略更优' : '无显著差异'}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{analysisResults.recommendation}</p>
                        </div>

                        {analysisResults.overallWinner !== 'inconclusive' && (
                          <Button 
                            className="w-full"
                            onClick={() => applyWinnerMutation.mutate({ testId: testDetails.test.id, applyToAll: true })}
                            disabled={applyWinnerMutation.isPending}
                          >
                            <ArrowRight className="h-4 w-4 mr-2" />
                            应用获胜策略到优化引擎
                          </Button>
                        )}

                        {analysisResults.overallWinner === 'inconclusive' && (
                          <div className="p-4 rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-900/20">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-yellow-500" />
                              <span className="font-medium text-yellow-700 dark:text-yellow-400">建议</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              实验结果不显著，建议延长实验周期或增加样本量后重新评估。
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">
                          {testDetails.test.status === 'running' ? '实验运行中，完成后可查看闭环反馈选项' : '请先完成实验'}
                        </p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="text-center py-12">
                  <FlaskConical className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">请从左侧选择一个测试查看详情</p>
                  <p className="text-xs text-muted-foreground mt-1">或创建新的A/B测试实验</p>
                </div>
              )}
            </CardContent>
          {/* @ts-ignore */}
          </Card>
        {/* @ts-ignore */}
        </div>

        {/* v276: 最近完成的实验结果 */}
        {/* @ts-ignore */}
        {overview && overview.recentResults && overview.recentResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-yellow-500" />
                最近完成的实验
              </CardTitle>
              {/* @ts-ignore */}
              <CardDescription>最近5个已完成实验的结果概览</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">实验名称</th>
                      <th className="text-center p-2">目标指标</th>
                      <th className="text-center p-2">显著指标数</th>
                      <th className="text-center p-2">结论</th>
                      <th className="text-right p-2">完成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentResults.map((r: unknown) => (
                      <tr key={r.testId} className="border-b hover:bg-accent/50 cursor-pointer" onClick={() => setSelectedTestId(r.testId)}>
                        {/* @ts-ignore */}
                        <td className="p-2 font-medium">{r.testName}</td>
                        {/* @ts-ignore */}
                        <td className="p-2 text-center">{r.targetMetric?.toUpperCase()}</td>
                        {/* @ts-ignore */}
                        <td className="p-2 text-center">{r.significantCount}/{r.totalMetrics}</td>
                        <td className="p-2 text-center">
                          {/* @ts-ignore */}
                          {r.hasWinner ? (
                            <Badge variant="default" className="bg-green-500">有显著结论</Badge>
                          ) : (
                            <Badge variant="secondary">无显著差异</Badge>
                          )}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {(r as any).completedAt ? new Date((r as any).completedAt).toLocaleDateString('zh-CN') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
