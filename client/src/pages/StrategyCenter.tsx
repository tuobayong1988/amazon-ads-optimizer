/**
 * StrategyCenter - 策略中心
 * 合并原有的优化目标、广告活动管理、自动化配置功能
 */

import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { 
  Target,
  Megaphone,
  Bot,
  Settings,
  Play,
  Pause,
  RefreshCw,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  BarChart3,
  Zap,
  Shield,
  Clock
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function StrategyCenter() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("targets");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取优化目标（绩效组）
  const performanceGroupsQuery = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取广告活动列表
  const campaignsQuery = trpc.campaign.list.useQuery(
    { accountId: accountId },
    { enabled: !!accountId }
  );

  // 获取自动化配置
  const automationConfigQuery = trpc.automation.getConfig.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 刷新所有数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        performanceGroupsQuery.refetch(),
        campaignsQuery.refetch(),
        automationConfigQuery.refetch(),
      ]);
      toast.success("数据刷新成功");
    } catch (err) {
      toast.error("刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  };

  // 计算策略摘要
  const strategySummary = useMemo(() => {
    const groups = performanceGroupsQuery.data || [];
    const campaigns = campaignsQuery.data || [];
    const config = automationConfigQuery.data;

    const activeGroups = groups.filter((g: any) => g.status === 'active').length;
    const enabledCampaigns = campaigns.filter((c: any) => c.state === 'enabled').length;
    const automationEnabled = config?.enabled || false;

    return {
      totalGroups: groups.length,
      activeGroups,
      totalCampaigns: campaigns.length,
      enabledCampaigns,
      automationEnabled,
      automationMode: (config as any)?.executionMode || 'supervised'
    };
  }, [performanceGroupsQuery.data, campaignsQuery.data, automationConfigQuery.data]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'enabled': return 'text-green-400 bg-green-500/20';
      case 'paused': return 'text-yellow-400 bg-yellow-500/20';
      case 'archived':
      case 'disabled': return 'text-gray-400 bg-gray-500/20';
      default: return 'text-blue-400 bg-blue-500/20';
    }
  };

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.strategyCenter} />
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-7 w-7 text-blue-400" />
              策略中心
            </h1>
            <p className="text-muted-foreground mt-1">
              优化目标、广告活动、自动化配置的统一管理
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={accountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[180px]">
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 策略摘要卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-blue-500/20">
                  <Target className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">优化目标</p>
                  <p className="text-2xl font-bold">{strategySummary.activeGroups}/{strategySummary.totalGroups}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-purple-500/20">
                  <Megaphone className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">广告活动</p>
                  <p className="text-2xl font-bold">{strategySummary.enabledCampaigns}/{strategySummary.totalCampaigns}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-full ${strategySummary.automationEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                  <Bot className={`h-6 w-6 ${strategySummary.automationEnabled ? 'text-green-400' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">自动化</p>
                  <p className="text-2xl font-bold">{strategySummary.automationEnabled ? '已启用' : '已禁用'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-orange-500/20">
                  <Shield className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">执行模式</p>
                  <p className="text-2xl font-bold capitalize">{strategySummary.automationMode}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 主要标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="targets" className="gap-2">
              <Target className="h-4 w-4" />
              优化目标
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-2">
              <Megaphone className="h-4 w-4" />
              广告活动
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-2">
              <Bot className="h-4 w-4" />
              自动化配置
            </TabsTrigger>
          </TabsList>

          {/* 优化目标Tab */}
          <TabsContent value="targets" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">优化目标（绩效组）</h2>
              <Link href="/optimization-targets">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  管理目标
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {performanceGroupsQuery.data?.map((group: any) => (
                <Card key={group.id} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      <Badge className={getStatusColor(group.status)}>
                        {group.status === 'active' ? '活跃' : group.status === 'paused' ? '暂停' : '归档'}
                      </Badge>
                    </div>
                    <CardDescription>{group.description || '无描述'}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">目标ACoS</p>
                        <p className="font-medium">{group.targetAcos}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">目标ROAS</p>
                        <p className="font-medium">{typeof group.targetRoas === 'number' ? group.targetRoas.toFixed(1) : (parseFloat(group.targetRoas as any) || 0).toFixed(1) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">广告活动数</p>
                        <p className="font-medium">{group.campaignCount || 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) || (
                <p className="col-span-2 text-center text-muted-foreground py-8">暂无优化目标</p>
              )}
            </div>
          </TabsContent>

          {/* 广告活动Tab */}
          <TabsContent value="campaigns" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">广告活动</h2>
              <Link href="/campaigns">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  管理活动
                </Button>
              </Link>
            </div>
            <div className="space-y-3">
              {campaignsQuery.data?.slice(0, 10).map((campaign: any) => (
                <Card key={campaign.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${getStatusColor(campaign.state)}`}>
                          {campaign.state === 'enabled' ? (
                            <Play className="h-4 w-4" />
                          ) : (
                            <Pause className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{campaign.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {campaign.campaignType} · {campaign.targetingType}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <p className="text-muted-foreground">日预算</p>
                          <p className="font-medium">${typeof campaign.dailyBudget === 'number' ? campaign.dailyBudget.toFixed(2) : (parseFloat(campaign.dailyBudget) || 0).toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">花费</p>
                          <p className="font-medium">${typeof campaign.spend === 'number' ? campaign.spend.toFixed(2) : (parseFloat(campaign.spend as any) || 0).toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">ACoS</p>
                          <p className="font-medium">{typeof campaign.acos === 'number' ? campaign.acos.toFixed(1) : (parseFloat(campaign.acos as any) || 0).toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) || (
                <p className="text-center text-muted-foreground py-8">暂无广告活动</p>
              )}
            </div>
          </TabsContent>

          {/* 自动化配置Tab */}
          <TabsContent value="automation" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">自动化配置</h2>
              <Link href="/automation-control">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  高级设置
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 自动化状态 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    自动化状态
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">自动优化</p>
                      <p className="text-sm text-muted-foreground">启用后系统将自动执行优化建议</p>
                    </div>
                    <Switch checked={automationConfigQuery.data?.enabled || false} disabled />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">执行模式</p>
                      <p className="text-sm text-muted-foreground">
                        {(automationConfigQuery.data as any)?.executionMode === 'full_auto' ? '全自动执行' :
                         (automationConfigQuery.data as any)?.executionMode === 'supervised' ? '监督执行' : '审批执行'}
                      </p>
                    </div>
                    <Badge variant="secondary">{(automationConfigQuery.data as any)?.executionMode || 'supervised'}</Badge>
                  </div>
                </CardContent>
              </Card>

              {/* 安全边界 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    安全边界
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm">最大竞价调整</p>
                    <p className="font-medium">{(automationConfigQuery.data as any)?.maxBidAdjustment || 30}%</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm">最大预算调整</p>
                    <p className="font-medium">{(automationConfigQuery.data as any)?.maxBudgetAdjustment || 50}%</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm">每日执行上限</p>
                    <p className="font-medium">{(automationConfigQuery.data as any)?.dailyExecutionLimit || 100}次</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm">置信度阈值</p>
                    <p className="font-medium">{(automationConfigQuery.data as any)?.confidenceThreshold || 70}%</p>
                  </div>
                </CardContent>
              </Card>

              {/* 启用的任务类型 */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    启用的自动化任务
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { key: 'bid_optimization', label: '竞价优化', icon: DollarSign },
                      { key: 'budget_adjustment', label: '预算调整', icon: BarChart3 },
                      { key: 'negative_keywords', label: '否定词管理', icon: XCircle },
                      { key: 'traffic_isolation', label: '流量隔离', icon: Shield },
                    ].map(({ key, label, icon: Icon }) => {
                      const enabled = (automationConfigQuery.data as any)?.enabledTypes?.includes(key);
                      return (
                        <div key={key} className={`p-4 rounded-lg border ${enabled ? 'border-green-500/50 bg-green-500/10' : 'border-muted bg-muted/30'}`}>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-5 w-5 ${enabled ? 'text-green-400' : 'text-muted-foreground'}`} />
                            <span className={enabled ? 'text-green-400' : 'text-muted-foreground'}>{label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {enabled ? '已启用' : '未启用'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
