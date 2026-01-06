import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useRoute, useLocation } from "wouter";
import { 
  ArrowLeft,
  Target, 
  Settings, 
  Play, 
  Pause,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  Loader2,
  Plus,
  Minus,
  Search,
  CheckCircle2,
  AlertCircle,
  Activity,
  Zap,
  Save,
  RefreshCw
} from "lucide-react";

// 优化目标类型
const OPTIMIZATION_TYPES = [
  { value: 'maximize_revenue', label: '销售最大化', description: '在预算内最大化销售额' },
  { value: 'target_acos', label: '目标ACoS', description: '控制广告成本销售比' },
  { value: 'target_roas', label: '目标ROAS', description: '控制广告投资回报率' },
  { value: 'target_cpa', label: '目标转化成本', description: '控制每次转化的成本' },
];

// 优化大类
const OPTIMIZATION_CATEGORIES = [
  { value: 'revenue', label: '销售额', description: '追求销售转化' },
  { value: 'vcpm', label: 'vCPM', description: '追求品牌曝光' },
];

export default function PerformanceGroupDetail() {
  const [, params] = useRoute("/performance-groups/:id");
  const [, setLocation] = useLocation();
  const groupId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("overview");
  const [showAddCampaignsDialog, setShowAddCampaignsDialog] = useState(false);
  const [showEditGoalDialog, setShowEditGoalDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  
  // 目标设置状态
  const [editingGoal, setEditingGoal] = useState({
    category: 'revenue',
    type: 'maximize_revenue',
    targetValue: '',
    dailyBudget: '',
    maxBid: '',
  });

  // 获取绩效组详情
  const { data: group, isLoading: groupLoading, refetch: refetchGroup } = trpc.performanceGroup.getById.useQuery(
    { id: groupId! },
    { enabled: !!groupId }
  );

  // 获取绩效组内的广告活动
  const { data: groupCampaigns, isLoading: campaignsLoading, refetch: refetchCampaigns } = trpc.performanceGroup.getCampaigns.useQuery(
    { groupId: groupId! },
    { enabled: !!groupId }
  );

  // 获取可添加的广告活动（未加入任何绩效组的）
  const { data: availableCampaigns, isLoading: availableLoading } = trpc.campaign.listUnassigned.useQuery(
    { accountId: group?.accountId },
    { enabled: !!group?.accountId && showAddCampaignsDialog }
  );

  // 获取绩效组KPI汇总
  const { data: kpiSummary, isLoading: kpiLoading } = trpc.performanceGroup.getKpiSummary.useQuery(
    { groupId: groupId! },
    { enabled: !!groupId }
  );

  // 添加广告活动到绩效组
  const addCampaignsMutation = trpc.performanceGroup.addCampaigns.useMutation({
    onSuccess: () => {
      toast.success("广告活动已添加到绩效组");
      setShowAddCampaignsDialog(false);
      setSelectedCampaigns([]);
      refetchCampaigns();
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`添加失败: ${error.message}`);
    },
  });

  // 从绩效组移除广告活动
  const removeCampaignMutation = trpc.performanceGroup.removeCampaign.useMutation({
    onSuccess: () => {
      toast.success("广告活动已从绩效组移除");
      refetchCampaigns();
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`移除失败: ${error.message}`);
    },
  });

  // 更新绩效组目标
  const updateGoalMutation = trpc.performanceGroup.updateGoal.useMutation({
    onSuccess: () => {
      toast.success("优化目标已更新");
      setShowEditGoalDialog(false);
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 筛选可添加的广告活动
  const filteredAvailableCampaigns = useMemo(() => {
    if (!availableCampaigns) return [];
    if (!searchQuery) return availableCampaigns;
    return availableCampaigns.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableCampaigns, searchQuery]);

  // 处理添加广告活动
  const handleAddCampaigns = () => {
    if (selectedCampaigns.length === 0) {
      toast.error("请选择要添加的广告活动");
      return;
    }
    addCampaignsMutation.mutate({
      groupId: groupId!,
      campaignIds: selectedCampaigns,
    });
  };

  // 处理移除广告活动
  const handleRemoveCampaign = (campaignId: number) => {
    removeCampaignMutation.mutate({
      groupId: groupId!,
      campaignId,
    });
  };

  // 处理更新目标
  const handleUpdateGoal = () => {
    updateGoalMutation.mutate({
      groupId: groupId!,
      goalType: editingGoal.type,
      targetValue: editingGoal.targetValue ? parseFloat(editingGoal.targetValue) : undefined,
      dailyBudget: editingGoal.dailyBudget ? parseFloat(editingGoal.dailyBudget) : undefined,
      maxBid: editingGoal.maxBid ? parseFloat(editingGoal.maxBid) : undefined,
    });
  };

  // 打开编辑目标对话框
  const openEditGoalDialog = () => {
    if (group) {
      setEditingGoal({
        category: 'revenue',
        type: group.goalType || 'maximize_revenue',
        targetValue: group.targetAcos?.toString() || group.targetRoas?.toString() || '',
        dailyBudget: group.dailyBudget?.toString() || '',
        maxBid: group.maxBid?.toString() || '',
      });
    }
    setShowEditGoalDialog(true);
  };

  if (groupLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!group) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertCircle className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground">绩效组不存在</p>
          <Button onClick={() => setLocation("/performance-groups")}>
            返回绩效组列表
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const goalTypeLabel = OPTIMIZATION_TYPES.find(t => t.value === group.goalType)?.label || '未设置';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 顶部导航和标题 */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/performance-groups")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <p className="text-muted-foreground">
              {group.accountName} | {groupCampaigns?.length || 0} 个广告活动
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={group.status === 'active' ? 'default' : 'secondary'}>
              {group.status === 'active' ? '优化中' : '已暂停'}
            </Badge>
            <Button variant="outline" size="sm" onClick={openEditGoalDialog}>
              <Settings className="w-4 h-4 mr-2" />
              编辑目标
            </Button>
          </div>
        </div>

        {/* KPI概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>目标类型</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                {goalTypeLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {group.goalType === 'target_acos' && (
                <p className="text-sm text-muted-foreground">目标ACoS: {group.targetAcos}%</p>
              )}
              {group.goalType === 'target_roas' && (
                <p className="text-sm text-muted-foreground">目标ROAS: {group.targetRoas}x</p>
              )}
              {group.goalType === 'maximize_revenue' && (
                <p className="text-sm text-muted-foreground">每日预算: ${group.dailyBudget || '-'}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>30天花费</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-orange-500" />
                ${kpiSummary?.totalSpend?.toFixed(2) || '0.00'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                日均: ${((kpiSummary?.totalSpend || 0) / 30).toFixed(2)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>30天销售额</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                ${kpiSummary?.totalRevenue?.toFixed(2) || '0.00'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                转化: {kpiSummary?.totalConversions || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>实际ACoS</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <Percent className="w-5 h-5 text-blue-500" />
                {kpiSummary?.acos?.toFixed(2) || '0.00'}%
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                ROAS: {kpiSummary?.roas?.toFixed(2) || '0.00'}x
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 主要内容区域 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="campaigns">广告活动 ({groupCampaigns?.length || 0})</TabsTrigger>
            <TabsTrigger value="scenario">场景模拟</TabsTrigger>
          </TabsList>

          {/* 概览Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 目标设置卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    优化目标设置
                  </CardTitle>
                  <CardDescription>当前绩效组的优化目标和参数</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">优化类型</span>
                    <span className="font-medium">{goalTypeLabel}</span>
                  </div>
                  {group.targetAcos && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">目标ACoS</span>
                      <span className="font-medium">{group.targetAcos}%</span>
                    </div>
                  )}
                  {group.targetRoas && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">目标ROAS</span>
                      <span className="font-medium">{group.targetRoas}x</span>
                    </div>
                  )}
                  {group.dailyBudget && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">每日费用上限</span>
                      <span className="font-medium">${group.dailyBudget}</span>
                    </div>
                  )}
                  {group.maxBid && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">最高出价</span>
                      <span className="font-medium">${group.maxBid}</span>
                    </div>
                  )}
                  <Button variant="outline" className="w-full" onClick={openEditGoalDialog}>
                    <Settings className="w-4 h-4 mr-2" />
                    编辑目标
                  </Button>
                </CardContent>
              </Card>

              {/* 绩效趋势卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    绩效趋势
                  </CardTitle>
                  <CardDescription>过去30天的绩效变化</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    <Activity className="w-8 h-8 mr-2" />
                    趋势图表开发中...
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 广告活动Tab */}
          <TabsContent value="campaigns" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>广告活动管理</CardTitle>
                    <CardDescription>
                      管理绩效组内的广告活动，加入的广告活动将被算法自动优化
                    </CardDescription>
                  </div>
                  <Button onClick={() => setShowAddCampaignsDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    添加广告活动
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {campaignsLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : groupCampaigns && groupCampaigns.length > 0 ? (
                  <div className="space-y-2">
                    {groupCampaigns.map((campaign: any) => (
                      <div 
                        key={campaign.id} 
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${campaign.status === 'enabled' ? 'bg-green-500' : 'bg-gray-400'}`} />
                          <div>
                            <p className="font-medium">{campaign.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {campaign.campaignType} | 花费: ${campaign.spend?.toFixed(2) || '0.00'} | ACoS: {campaign.acos?.toFixed(2) || '0.00'}%
                            </p>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleRemoveCampaign(campaign.id)}
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mb-2" />
                    <p>暂无广告活动</p>
                    <p className="text-sm">点击"添加广告活动"将广告活动加入此绩效组</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 场景模拟Tab */}
          <TabsContent value="scenario" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  场景模拟预测
                </CardTitle>
                <CardDescription>
                  基于历史数据预测不同花费水平下的预期效果
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 预测曲线图 */}
                  <div className="h-64 border rounded-lg flex items-center justify-center text-muted-foreground">
                    <BarChart3 className="w-8 h-8 mr-2" />
                    花费-销售额预测曲线开发中...
                  </div>
                  
                  {/* 预测指标卡片 */}
                  <div className="space-y-4">
                    <h4 className="font-medium">预测指标</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测点击数</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测转化数</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测CPC</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测ACoS</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测ROAS</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测销售额</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      * 预测基于历史数据计算，实际结果可能因市场竞争等因素而有所不同
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 添加广告活动对话框 */}
        <Dialog open={showAddCampaignsDialog} onOpenChange={setShowAddCampaignsDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>添加广告活动到绩效组</DialogTitle>
              <DialogDescription>
                选择要添加到"{group.name}"的广告活动
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-2 gap-4 h-96">
              {/* 左侧：可选广告活动 */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder="搜索广告活动..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8"
                  />
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  可选广告活动: {filteredAvailableCampaigns.length}个
                </p>
                <ScrollArea className="h-72">
                  {availableLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : filteredAvailableCampaigns.length > 0 ? (
                    <div className="space-y-2">
                      {filteredAvailableCampaigns.map((campaign: any) => (
                        <div 
                          key={campaign.id}
                          className="flex items-center gap-2 p-2 border rounded hover:bg-muted/50 cursor-pointer"
                          onClick={() => {
                            if (selectedCampaigns.includes(campaign.id)) {
                              setSelectedCampaigns(prev => prev.filter(id => id !== campaign.id));
                            } else {
                              setSelectedCampaigns(prev => [...prev, campaign.id]);
                            }
                          }}
                        >
                          <Checkbox 
                            checked={selectedCampaigns.includes(campaign.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedCampaigns(prev => [...prev, campaign.id]);
                              } else {
                                setSelectedCampaigns(prev => prev.filter(id => id !== campaign.id));
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{campaign.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {campaign.campaignType} | ACoS: {campaign.acos?.toFixed(2) || '0'}%
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <p className="text-sm">没有可添加的广告活动</p>
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* 右侧：已选择的广告活动 */}
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">
                  已选择: {selectedCampaigns.length}个
                </p>
                <ScrollArea className="h-80">
                  {selectedCampaigns.length > 0 ? (
                    <div className="space-y-2">
                      {selectedCampaigns.map(id => {
                        const campaign = availableCampaigns?.find((c: any) => c.id === id);
                        if (!campaign) return null;
                        return (
                          <div 
                            key={id}
                            className="flex items-center justify-between p-2 border rounded bg-primary/5"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{campaign.name}</p>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setSelectedCampaigns(prev => prev.filter(cid => cid !== id))}
                            >
                              <Minus className="w-4 h-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <p className="text-sm">请从左侧选择广告活动</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddCampaignsDialog(false)}>
                取消
              </Button>
              <Button 
                onClick={handleAddCampaigns}
                disabled={selectedCampaigns.length === 0 || addCampaignsMutation.isPending}
              >
                {addCampaignsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                添加 {selectedCampaigns.length} 个广告活动
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 编辑目标对话框 */}
        <Dialog open={showEditGoalDialog} onOpenChange={setShowEditGoalDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>编辑优化目标</DialogTitle>
              <DialogDescription>
                设置绩效组的优化目标和参数
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>优化目标类型</Label>
                <Select 
                  value={editingGoal.type} 
                  onValueChange={(value) => setEditingGoal(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPTIMIZATION_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        <div>
                          <p>{type.label}</p>
                          <p className="text-xs text-muted-foreground">{type.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(editingGoal.type === 'target_acos' || editingGoal.type === 'target_roas' || editingGoal.type === 'target_cpa') && (
                <div className="space-y-2">
                  <Label>
                    {editingGoal.type === 'target_acos' ? '目标ACoS (%)' : 
                     editingGoal.type === 'target_roas' ? '目标ROAS (倍)' : '目标转化成本 ($)'}
                  </Label>
                  <Input 
                    type="number"
                    value={editingGoal.targetValue}
                    onChange={(e) => setEditingGoal(prev => ({ ...prev, targetValue: e.target.value }))}
                    placeholder={editingGoal.type === 'target_acos' ? '例如: 30' : 
                                editingGoal.type === 'target_roas' ? '例如: 3.0' : '例如: 15'}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>每日费用上限 ($)</Label>
                <Input 
                  type="number"
                  value={editingGoal.dailyBudget}
                  onChange={(e) => setEditingGoal(prev => ({ ...prev, dailyBudget: e.target.value }))}
                  placeholder="例如: 100"
                />
              </div>

              <div className="space-y-2">
                <Label>最高出价 ($)</Label>
                <Input 
                  type="number"
                  value={editingGoal.maxBid}
                  onChange={(e) => setEditingGoal(prev => ({ ...prev, maxBid: e.target.value }))}
                  placeholder="例如: 2.50"
                />
                <p className="text-xs text-muted-foreground">
                  限制单次点击的最高出价，防止出价过高
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditGoalDialog(false)}>
                取消
              </Button>
              <Button 
                onClick={handleUpdateGoal}
                disabled={updateGoalMutation.isPending}
              >
                {updateGoalMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
