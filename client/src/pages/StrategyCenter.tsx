import { getCurrencySymbol } from "@/utils/currency";
/**
 * StrategyCenter - 策略中心（统一入口）
 * 合并原有的优化目标、策略模板功能
 * 布局：策略模板库 → 已创建的优化目标列表
 */
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  Trash2,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  Zap,
  Shield,
  Eye,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { StrategyTemplates } from "@/components/StrategyTemplates";
import { useCurrentStore, useCurrentMarketplace } from "@/components/GlobalAccountSelector";

// 优化目标类型映射
const OPTIMIZATION_GOAL_LABELS: Record<string, string> = {
  target_acos: "目标ACoS",
  target_roas: "目标ROAS",
  maximize_sales: "最大化销售额",
  daily_spend_limit: "每日花费上限",
  daily_cost: "每日花费",
  balanced: "均衡优化",
};

// 策略模板名称映射（包含所有可能的模板ID变体）
const STRATEGY_TEMPLATE_LABELS: Record<string, { name: string; color: string; icon: string }> = {
  // 完整ID格式（数据库中实际存储的值）
  "aggressive-growth": { name: "激进增长", color: "text-red-400 bg-red-500/20", icon: "🔥" },
  "balanced": { name: "平衡增长", color: "text-blue-400 bg-blue-500/20", icon: "⚖️" },
  "profit-focused": { name: "利润优先", color: "text-green-400 bg-green-500/20", icon: "🛡️" },
  "seasonal-boost": { name: "旺季冲刺", color: "text-yellow-400 bg-yellow-500/20", icon: "⚡" },
  "brand-defense": { name: "品牌防御", color: "text-purple-400 bg-purple-500/20", icon: "🏰" },
  // 简短ID格式（兼容旧数据）
  "aggressive": { name: "激进增长", color: "text-red-400 bg-red-500/20", icon: "🔥" },
  "conservative": { name: "利润优先", color: "text-green-400 bg-green-500/20", icon: "🛡️" },
  "seasonal": { name: "旺季冲刺", color: "text-yellow-400 bg-yellow-500/20", icon: "⚡" },
  "brand_defense": { name: "品牌防御", color: "text-purple-400 bg-purple-500/20", icon: "🏰" },
  // 中文名称格式（兼容直接存储中文名的情况）
  "激进增长": { name: "激进增长", color: "text-red-400 bg-red-500/20", icon: "🔥" },
  "平衡增长": { name: "平衡增长", color: "text-blue-400 bg-blue-500/20", icon: "⚖️" },
  "利润优先": { name: "利润优先", color: "text-green-400 bg-green-500/20", icon: "🛡️" },
  "旺季冲刺": { name: "旺季冲刺", color: "text-yellow-400 bg-yellow-500/20", icon: "⚡" },
  "品牌防御": { name: "品牌防御", color: "text-purple-400 bg-purple-500/20", icon: "🏰" },
};

export default function StrategyCenter() {
  const [, setLocation] = useLocation();
  const currentStore = useCurrentStore();
  const currentMarketplace = useCurrentMarketplace();
  const currencySymbol = getCurrencySymbol(currentMarketplace);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<{ id: number; name: string } | null>(null);

  // 获取账号列表
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery();
  
  // 根据店铺+站点查找对应的accountId
  const accountId = useMemo(() => {
    if (!accounts || accounts.length === 0) return null;
    
    // 如果有选中的店铺和站点，精确匹配
    if (currentStore && currentMarketplace) {
      const account = accounts.find(a => 
        (a.storeName || a.accountName) === currentStore && 
        a.marketplace === currentMarketplace
      );
      if (account) return account.id;
    }
    
    // 如果只有店铺，匹配第一个站点
    if (currentStore) {
      const account = accounts.find(a => 
        (a.storeName || a.accountName) === currentStore
      );
      if (account) return account.id;
    }
    
    // 兜底：使用第一个账号
    return accounts[0]?.id || null;
  }, [accounts, currentStore, currentMarketplace]);

  // 获取优化目标（绩效组）
  const performanceGroupsQuery = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 更新绩效组状态的mutation
  const updateGroupMutation = trpc.performanceGroup.update.useMutation({
    onSuccess: () => {
      performanceGroupsQuery.refetch();
      toast.success("状态更新成功");
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message}`);
    }
  });

  // 删除绩效组的mutation
  const deleteGroupMutation = trpc.performanceGroup.delete.useMutation({
    onSuccess: () => {
      performanceGroupsQuery.refetch();
      toast.success("删除成功");
    },
    onError: (error: any) => {
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

  // 删除优化目标
  const handleDeleteGroup = (groupId: number, groupName: string) => {
    setGroupToDelete({ id: groupId, name: groupName });
    setDeleteDialogOpen(true);
  };

  // 确认删除
  const confirmDelete = () => {
    if (groupToDelete) {
      deleteGroupMutation.mutate({ id: groupToDelete.id });
    }
    setDeleteDialogOpen(false);
    setGroupToDelete(null);
  };

  // 刷新所有数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await performanceGroupsQuery.refetch();
      toast.success("数据刷新成功");
    } catch (err) {
      toast.error("刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  };

  const groups = performanceGroupsQuery.data || [];
  const activeGroups = groups.filter((g: any) => g.status === 'active');
  const totalCampaigns = groups.reduce((sum: number, g: any) => sum + (g.campaignCount || 0), 0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-500/20';
      case 'paused': return 'text-yellow-400 bg-yellow-500/20';
      case 'archived': return 'text-gray-400 bg-gray-500/20';
      default: return 'text-blue-400 bg-blue-500/20';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return '优化中';
      case 'paused': return '已暂停';
      case 'archived': return '已归档';
      default: return status;
    }
  };

  // 加载状态
  if (accountsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">加载中...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.strategyCenter} />
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-7 w-7 text-blue-400" />
              策略管理
            </h1>
            <p className="text-muted-foreground mt-1">
              创建优化目标，分配广告活动，系统将自动执行优化策略
            </p>
          </div>
          <div className="flex items-center gap-3">
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

        {/* 统计概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-blue-500/20">
                  <Target className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">优化目标</p>
                  <p className="text-2xl font-bold">{activeGroups.length}<span className="text-sm text-muted-foreground font-normal">/{groups.length}</span></p>
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
                  <p className="text-sm text-muted-foreground">管理的广告活动</p>
                  <p className="text-2xl font-bold">{totalCampaigns}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-full ${activeGroups.length > 0 ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                  <Bot className={`h-6 w-6 ${activeGroups.length > 0 ? 'text-green-400' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">自动优化</p>
                  <p className="text-2xl font-bold">{activeGroups.length > 0 ? '运行中' : '未启用'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-orange-500/20">
                  <Zap className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">优化模块</p>
                  <p className="text-2xl font-bold">7<span className="text-sm text-muted-foreground font-normal">个</span></p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 优化目标列表 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-400" />
              我的优化目标
            </h2>
            <Link href="/optimization-targets">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                新建优化目标
              </Button>
            </Link>
          </div>

          {performanceGroupsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">加载优化目标...</span>
            </div>
          ) : groups.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Target className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">暂无优化目标</p>
                <p className="text-muted-foreground text-center mb-4">
                  从上方策略模板库选择一个策略，或手动创建优化目标，<br/>
                  系统将自动对目标下的广告活动执行竞价、位置、预算等优化
                </p>
                <Link href="/optimization-targets">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    创建第一个优化目标
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {groups.map((group: any) => {
                const goalLabel = OPTIMIZATION_GOAL_LABELS[group.optimizationGoal] || '未设置';
                const templateInfo = group.strategyTemplateName 
                  ? STRATEGY_TEMPLATE_LABELS[group.strategyTemplateName] || { name: group.strategyTemplateName, color: "text-blue-400 bg-blue-500/20", icon: "📋" }
                  : null;
                
                return (
                  <Card 
                    key={group.id} 
                    className="hover:border-primary/50 transition-all cursor-pointer hover:shadow-md group"
                    onClick={() => handleGoToDetail(group.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base truncate mr-2">{group.name}</CardTitle>
                        <Badge className={getStatusColor(group.status)}>
                          {getStatusText(group.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {templateInfo && (
                          <Badge variant="outline" className={templateInfo.color}>
                            {templateInfo.icon} {templateInfo.name}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-muted-foreground">
                          {goalLabel}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* 核心指标 */}
                      <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                        <div>
                          <p className="text-muted-foreground text-xs">广告活动</p>
                          <p className="font-semibold text-lg">{group.campaignCount || 0}</p>
                        </div>
                        {group.optimizationGoal === 'target_acos' || group.targetAcos ? (
                          <div>
                            <p className="text-muted-foreground text-xs">目标ACoS</p>
                            <p className="font-semibold text-lg">{group.targetAcos || '-'}%</p>
                          </div>
                        ) : group.optimizationGoal === 'target_roas' || group.targetRoas ? (
                          <div>
                            <p className="text-muted-foreground text-xs">目标ROAS</p>
                            <p className="font-semibold text-lg">{typeof group.targetRoas === 'number' ? group.targetRoas.toFixed(1) : (parseFloat(group.targetRoas) || 0).toFixed(1)}</p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-muted-foreground text-xs">目标ACoS</p>
                            <p className="font-semibold text-lg">{group.targetAcos || '-'}%</p>
                          </div>
                        )}
                        <div>
                          <p className="text-muted-foreground text-xs">每日预算</p>
                          <p className="font-semibold text-lg">{group.dailyBudget ? `${currencySymbol}${parseFloat(group.dailyBudget).toFixed(0)}` : '-'}</p>
                        </div>
                      </div>

                      {/* 绩效数据 */}
                      {(group.totalSpend > 0 || group.totalSales > 0) && (
                        <div className="grid grid-cols-3 gap-3 text-sm mb-3 p-2 bg-muted/30 rounded-lg">
                          <div>
                            <p className="text-muted-foreground text-xs">30天花费</p>
                            <p className="font-medium">{currencySymbol}{(group.totalSpend || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">30天销售</p>
                            <p className="font-medium">{currencySymbol}{(group.totalSales || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">实际ACoS</p>
                            <p className={`font-medium ${group.avgAcos > (parseFloat(group.targetAcos) || 30) ? 'text-red-400' : 'text-green-400'}`}>
                              {(group.avgAcos || 0).toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 自动优化状态 */}
                      <div className="flex items-center justify-between py-2 border-t border-border/50">
                        <div className="flex items-center gap-2 text-sm">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">自动优化</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {group.status === 'active' ? (
                            <Badge className="bg-green-500/20 text-green-400 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              已启用
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-500/20 text-gray-400 text-xs">
                              <Pause className="h-3 w-3 mr-1" />
                              已暂停
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* 优化模块指示器 */}
                      <div className="flex items-center gap-1 py-2 text-xs text-muted-foreground">
                        <span>优化模块：</span>
                        <Badge variant="outline" className="text-xs px-1 py-0">竞价</Badge>
                        <Badge variant="outline" className="text-xs px-1 py-0">位置</Badge>
                        <Badge variant="outline" className="text-xs px-1 py-0">分时</Badge>
                        <Badge variant="outline" className="text-xs px-1 py-0">预算</Badge>
                        <Badge variant="outline" className="text-xs px-1 py-0">搜索词</Badge>
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
                          管理
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
                            <><Pause className="h-4 w-4 mr-1" />暂停</>
                          ) : (
                            <><Play className="h-4 w-4 mr-1" />启用</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
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
                );
              })}
            </div>
          )}
        </div>
        {/* 策略模板库 */}
        <StrategyTemplates
          currentAcos={25}
          onApplyTemplate={(template) => {
            setLocation(`/optimization-targets?template=${encodeURIComponent(template.id)}&name=${encodeURIComponent(template.name)}&targetAcos=${template.targetAcos}`);
          }}
        />
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除优化目标 "{groupToDelete?.name}" 吗？
              此操作不可撤销，关联的广告活动将不再属于此优化目标。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
