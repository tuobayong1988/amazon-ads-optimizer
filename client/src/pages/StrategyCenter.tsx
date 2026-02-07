/**
 * StrategyCenter - 策略中心
 * 合并原有的优化目标、广告活动管理、自动化配置功能
 * 布局顺序：策略模板库 → 优化目标 → 统计信息
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
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
  Clock,
  Archive,
  Eye
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { StrategyTemplates } from "@/components/StrategyTemplates";
import { useCurrentAccountId, setCurrentAccountId } from "@/components/AccountSwitcher";

export default function StrategyCenter() {
  const [, setLocation] = useLocation();
  const globalAccountId = useCurrentAccountId();
  const [activeTab, setActiveTab] = useState("targets");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 优先使用全局选择的accountId，只有在用户从未选择过账号时才使用默认值
  // 并且在使用默认值时同步更新localStorage，避免下次访问时再次出现不一致
  const accountId = useMemo(() => {
    if (globalAccountId) return globalAccountId;
    if (accounts?.[0]?.id) {
      // 用户从未选择过账号，使用第一个账号并保存到localStorage
      setCurrentAccountId(accounts[0].id);
      return accounts[0].id;
    }
    return null;
  }, [globalAccountId, accounts]);

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

  // 更新绩效组状态的mutation
  const updateGroupMutation = trpc.performanceGroup.update.useMutation({
    onSuccess: () => {
      performanceGroupsQuery.refetch();
      toast.success("状态更新成功");
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    }
  });

  // 删除绩效组的mutation
  const deleteGroupMutation = trpc.performanceGroup.delete.useMutation({
    onSuccess: () => {
      performanceGroupsQuery.refetch();
      toast.success("删除成功");
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    }
  });

  // 点击优化目标跳转到详情页
  const handleGoToDetail = (groupId: number) => {
    setLocation(`/optimization-targets/${groupId}`);
  };

  // 切换优化目标状态（启用/暂停）
  const handleToggleStatus = (groupId: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    updateGroupMutation.mutate({
      id: groupId,
      status: newStatus
    });
  };

  // 归档优化目标
  const handleArchiveGroup = (groupId: number) => {
    updateGroupMutation.mutate({
      id: groupId,
      status: 'archived'
    });
  };

  // 删除优化目标
  const handleDeleteGroup = (groupId: number, groupName: string) => {
    if (confirm(`确定要删除优化目标 "${groupName}" 吗？此操作不可撤销。`)) {
      deleteGroupMutation.mutate({ id: groupId });
    }
  };

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

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return '活跃';
      case 'paused': return '暂停';
      case 'archived': return '归档';
      default: return status;
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
              onValueChange={(v) => setCurrentAccountId(parseInt(v))}
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

        {/* 1. 策略模板库 - 放在页面上部 */}
        <StrategyTemplates
          currentAcos={25}
          onApplyTemplate={(template) => {
            toast.success(`已应用策略模板: ${template.name}`);
          }}
        />

        {/* 2. 优化目标（绩效组）- 放在页面中间 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-400" />
              优化目标（绩效组）
            </h2>
            <Link href="/optimization-targets">
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                管理目标
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {performanceGroupsQuery.data?.map((group: any) => (
              <Card 
                key={group.id} 
                className="hover:border-primary/50 transition-all cursor-pointer hover:shadow-md"
                onClick={() => handleGoToDetail(group.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <Badge className={getStatusColor(group.status)}>
                      {getStatusText(group.status)}
                    </Badge>
                  </div>
                  <CardDescription>
                    {group.description || '无描述'}
                    {group.strategyTemplate && (
                      <span className="ml-2 text-blue-400">策略: {group.strategyTemplate}</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-4">
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
                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGoToDetail(group.id);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      查看详情
                    </Button>
                    <Button
                      variant={group.status === 'active' ? 'secondary' : 'default'}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStatus(group.id, group.status);
                      }}
                      disabled={group.status === 'archived'}
                    >
                      {group.status === 'active' ? (
                        <>
                          <Pause className="h-4 w-4 mr-1" />
                          暂停
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1" />
                          启用
                        </>
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group.id, group.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!performanceGroupsQuery.data || performanceGroupsQuery.data.length === 0) && (
              <p className="col-span-full text-center text-muted-foreground py-8">
                暂无优化目标，请先从策略模板库中选择一个策略模板创建优化目标
              </p>
            )}
          </div>
        </div>

        {/* 3. 策略摘要卡片 - 放在页面底部 */}
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

        {/* 策略模板库 - 显示在页面上部 */}
        <StrategyTemplates
          currentAcos={25}
          onApplyTemplate={(template) => {
            toast.success(`已应用策略模板: ${template.name}`);
          }}
        />

        {/* 主要标签页 - 优化目标、广告活动、自动化配置 */}
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
                <Card 
                  key={group.id} 
                  className="hover:border-primary/50 transition-all cursor-pointer hover:shadow-md"
                  onClick={() => handleGoToDetail(group.id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      <Badge className={getStatusColor(group.status)}>
                        {getStatusText(group.status)}
                      </Badge>
                    </div>
                    <CardDescription>{group.description || '无描述'}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-sm mb-4">
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
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGoToDetail(group.id);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        查看详情
                      </Button>
                      <Button
                        variant={group.status === 'active' ? 'secondary' : 'default'}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(group.id, group.status);
                        }}
                        disabled={group.status === 'archived'}
                      >
                        {group.status === 'active' ? (
                          <>
                            <Pause className="h-4 w-4 mr-1" />
                            暂停
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-1" />
                            启用
                          </>
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.id, group.name);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
