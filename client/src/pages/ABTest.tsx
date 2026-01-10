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
import { FlaskConical, Play, Pause, CheckCircle, XCircle, TrendingUp, TrendingDown, BarChart3, Plus, Trash2 } from 'lucide-react';
import ABTestCharts from '@/components/ABTestCharts';

export default function ABTest() {
  const { user } = useAuth();
  // toast from sonner
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();

  // 获取A/B测试列表
  const { data: tests, refetch: refetchTests } = trpc.abTest.list.useQuery(
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
    { enabled: !!selectedTestId && testDetails?.test?.status === 'running' }
  );

  // 创建测试
  const createTestMutation = trpc.abTest.create.useMutation({
    onSuccess: () => {
      toast.success('A/B测试创建成功');
      setCreateDialogOpen(false);
      refetchTests();
    },
    onError: (error) => {
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

  const handleCreateTest = () => {
    if (!selectedAccountId) return;
    createTestMutation.mutate({
      accountId: selectedAccountId,
      ...newTest,
      controlConfig: { strategy: 'current' },
      treatmentConfig: { strategy: 'optimized' },
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      draft: { variant: 'secondary', label: '草稿' },
      running: { variant: 'default', label: '运行中' },
      paused: { variant: 'outline', label: '已暂停' },
      completed: { variant: 'default', label: '已完成' },
      cancelled: { variant: 'destructive', label: '已取消' },
    };
    const config = statusConfig[status] || { variant: 'secondary', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">A/B测试</h1>
            <p className="text-muted-foreground">对比不同预算分配策略的实际效果</p>
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
                  创建测试
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>创建A/B测试</DialogTitle>
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
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>测试类型</Label>
                    <Select
                      value={newTest.testType}
                      onValueChange={(value) => 
                        setNewTest({ ...newTest, testType: value as any })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="budget_allocation">预算分配</SelectItem>
                        <SelectItem value="bid_strategy">出价策略</SelectItem>
                        <SelectItem value="targeting">定向策略</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>目标指标</Label>
                    <Select
                      value={newTest.targetMetric}
                      onValueChange={(value) => 
                        setNewTest({ ...newTest, targetMetric: value as any })
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
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={handleCreateTest} disabled={!newTest.testName}>
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 测试列表 */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                测试列表
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {tests?.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">暂无测试</p>
                )}
                {tests?.map((test) => (
                  <div
                    key={test.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedTestId === test.id ? 'bg-accent border-primary' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => setSelectedTestId(test.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{test.testName}</span>
                      {getStatusBadge(test.status)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {test.testType === 'budget_allocation' ? '预算分配' : 
                       test.testType === 'bid_strategy' ? '出价策略' : '定向策略'}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 测试详情 */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>测试详情</CardTitle>
              <CardDescription>
                {testDetails ? testDetails.test.testName : '选择一个测试查看详情'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testDetails ? (
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="results">结果分析</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">状态</p>
                        {getStatusBadge(testDetails.test.status)}
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">目标指标</p>
                        <p className="font-medium">{testDetails.test.targetMetric.toUpperCase()}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">对照组广告活动</p>
                        <p className="font-medium">{testDetails.campaignCount.control} 个</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">实验组广告活动</p>
                        <p className="font-medium">{testDetails.campaignCount.treatment} 个</p>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
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
                        </div>

                        {/* 可视化图表 */}
                        <ABTestCharts 
                          analysisResults={analysisResults as any} 
                          testName={testDetails?.test?.testName}
                        />
                      </>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        测试运行中，数据收集后将显示分析结果
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  请从左侧选择一个测试查看详情
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
