import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Plus, 
  Target, 
  Settings, 
  Trash2, 
  Play, 
  Pause,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  Loader2,
  Bot,
  Activity,
  CheckCircle2,
  Filter,
  Search,
  Layers,
  ArrowRight,
  Eye
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// 筛选条件类型
interface FilterCondition {
  field: string;
  operator: string;
  value: string | number;
}

// 创建优化目标的表单组件
function CreateOptimizationTargetDialog({ 
  open, 
  onOpenChange, 
  onSuccess 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState("target_acos");
  const [targetValue, setTargetValue] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [maxBid, setMaxBid] = useState("");
  
  // 筛选条件
  const [filterAccountId, setFilterAccountId] = useState<string>("all");
  const [filterCampaignName, setFilterCampaignName] = useState("");
  const [filterCampaignType, setFilterCampaignType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterMinConversions, setFilterMinConversions] = useState("");
  const [filterMinSpend, setFilterMinSpend] = useState("");
  const [filterMaxAcos, setFilterMaxAcos] = useState("");
  
  // 选中的广告活动
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<number[]>([]);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取广告活动列表
  const { data: campaignsData, isLoading: campaignsLoading } = trpc.campaign.list.useQuery(
    { accountId: filterAccountId === "all" ? undefined : parseInt(filterAccountId) },
    { enabled: step === 2 }
  );

  // 创建优化目标
  const createMutation = trpc.performanceGroup.create.useMutation({
    onSuccess: () => {
      toast.success("优化目标创建成功");
      resetForm();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  // 筛选广告活动
  const filteredCampaigns = useMemo(() => {
    if (!campaignsData) return [];
    
    return campaignsData.filter(campaign => {
      // 按名称筛选
      if (filterCampaignName && !campaign.campaignName?.toLowerCase().includes(filterCampaignName.toLowerCase())) {
        return false;
      }
      // 按类型筛选
      if (filterCampaignType !== "all") {
        const campaignType = campaign.campaignType?.toLowerCase() || '';
        if (filterCampaignType === "SP") {
          // SP包括sp_auto和sp_manual
          if (!campaignType.startsWith('sp')) {
            return false;
          }
        } else if (filterCampaignType === "SB") {
          if (campaignType !== 'sb') {
            return false;
          }
        } else if (filterCampaignType === "SD") {
          if (campaignType !== 'sd') {
            return false;
          }
        }
      }
      // 按状态筛选
      if (filterStatus !== "all") {
        const campaignStatus = campaign.campaignStatus?.toLowerCase() || '';
        if (filterStatus === "enabled" && campaignStatus !== 'enabled') {
          return false;
        }
        if (filterStatus === "paused" && campaignStatus !== 'paused') {
          return false;
        }
      }
      // 按最小转化数筛选
      if (filterMinConversions && (campaign.orders || 0) < parseInt(filterMinConversions)) {
        return false;
      }
      // 按最小花费筛选
      if (filterMinSpend && parseFloat(campaign.spend || "0") < parseFloat(filterMinSpend)) {
        return false;
      }
      // 按最大ACoS筛选
      if (filterMaxAcos && parseFloat(campaign.acos || "0") > parseFloat(filterMaxAcos)) {
        return false;
      }
      return true;
    });
  }, [campaignsData, filterCampaignName, filterCampaignType, filterStatus, filterMinConversions, filterMinSpend, filterMaxAcos]);

  const resetForm = () => {
    setStep(1);
    setName("");
    setDescription("");
    setTargetType("target_acos");
    setTargetValue("");
    setDailyBudget("");
    setMaxBid("");
    setFilterAccountId("all");
    setFilterCampaignName("");
    setFilterCampaignType("all");
    setFilterStatus("all");
    setFilterMinConversions("");
    setFilterMinSpend("");
    setFilterMaxAcos("");
    setSelectedCampaignIds([]);
  };

  const handleSelectAll = () => {
    if (selectedCampaignIds.length === filteredCampaigns.length) {
      setSelectedCampaignIds([]);
    } else {
      setSelectedCampaignIds(filteredCampaigns.map(c => c.id));
    }
  };

  const handleToggleCampaign = (campaignId: number) => {
    setSelectedCampaignIds(prev => 
      prev.includes(campaignId) 
        ? prev.filter(id => id !== campaignId)
        : [...prev, campaignId]
    );
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("请输入优化目标名称");
      return;
    }
    if (selectedCampaignIds.length === 0) {
      toast.error("请至少选择一个广告活动");
      return;
    }
    
    const accountId = filterAccountId === "all" 
      ? (accounts?.[0]?.id || 1) 
      : parseInt(filterAccountId);

    createMutation.mutate({
      accountId,
      name: name.trim(),
      description: description.trim() || undefined,
      targetType: targetType as any,
      targetValue: targetValue ? parseFloat(targetValue) : undefined,
      dailyBudget: dailyBudget ? parseFloat(dailyBudget) : undefined,
      maxBid: maxBid ? parseFloat(maxBid) : undefined,
      campaignIds: selectedCampaignIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            创建优化目标
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "第一步：设置优化目标的基本信息和优化参数"}
            {step === 2 && "第二步：通过筛选条件选择要纳入优化的广告活动"}
            {step === 3 && "第三步：确认并创建优化目标"}
          </DialogDescription>
        </DialogHeader>

        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-2 py-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === step ? "bg-primary text-primary-foreground" : 
                s < step ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {s < step ? <CheckCircle2 className="w-4 h-4" /> : s}
              </div>
              {s < 3 && <div className={`w-12 h-0.5 ${s < step ? "bg-green-500" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* 第一步：基本信息 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>优化目标名称 *</Label>
                <Input 
                  placeholder="例如：高转化关键词优化" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>选择账号</Label>
                <Select value={filterAccountId} onValueChange={setFilterAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择账号" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有账号</SelectItem>
                    {accounts?.map(account => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.accountName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>描述（可选）</Label>
              <Input 
                placeholder="描述这个优化目标的用途..." 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>优化目标类型</Label>
                <Select value={targetType} onValueChange={setTargetType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maximize_sales">销售最大化 - 在预算内最大化销售额</SelectItem>
                    <SelectItem value="target_acos">目标ACoS - 控制广告成本销售比</SelectItem>
                    <SelectItem value="target_roas">目标ROAS - 控制广告投资回报率</SelectItem>
                    <SelectItem value="target_cpa">目标转化成本 - 控制每次转化的成本</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {targetType === "target_acos" && "目标ACoS (%)"}
                  {targetType === "target_roas" && "目标ROAS"}
                  {targetType === "target_cpa" && "目标CPA ($)"}
                  {targetType === "maximize_sales" && "目标值（可选）"}
                </Label>
                <Input 
                  type="number"
                  placeholder={
                    targetType === "target_acos" ? "例如: 25" :
                    targetType === "target_roas" ? "例如: 4.0" :
                    targetType === "target_cpa" ? "例如: 15" : "可选"
                  }
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>每日费用上限 ($)</Label>
                <Input 
                  type="number"
                  placeholder="例如: 100" 
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>最高出价 ($)</Label>
                <Input 
                  type="number"
                  placeholder="例如: 2.50" 
                  value={maxBid}
                  onChange={(e) => setMaxBid(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">限制单次点击的最高出价</p>
              </div>
            </div>
          </div>
        )}

        {/* 第二步：筛选广告活动 */}
        {step === 2 && (
          <div className="space-y-4">
            {/* 筛选条件 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  筛选条件
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">广告活动名称</Label>
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input 
                        className="pl-8"
                        placeholder="搜索名称..." 
                        value={filterCampaignName}
                        onChange={(e) => setFilterCampaignName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">广告类型</Label>
                    <Select value={filterCampaignType} onValueChange={setFilterCampaignType}>
                      <SelectTrigger>
                        <SelectValue placeholder="全部类型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="SP">SP 商品推广</SelectItem>
                        <SelectItem value="SB">SB 品牌推广</SelectItem>
                        <SelectItem value="SD">SD 展示广告</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">运行状态</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger>
                        <SelectValue placeholder="全部状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="enabled">投放中</SelectItem>
                        <SelectItem value="paused">已暂停</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">最小转化数</Label>
                    <Input 
                      type="number"
                      placeholder="例如: 10" 
                      value={filterMinConversions}
                      onChange={(e) => setFilterMinConversions(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">最小花费 ($)</Label>
                    <Input 
                      type="number"
                      placeholder="例如: 100" 
                      value={filterMinSpend}
                      onChange={(e) => setFilterMinSpend(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">最大ACoS (%)</Label>
                    <Input 
                      type="number"
                      placeholder="例如: 50" 
                      value={filterMaxAcos}
                      onChange={(e) => setFilterMaxAcos(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 广告活动列表 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    符合条件的广告活动
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {filteredCampaigns.length} 个广告活动
                    </Badge>
                    <Badge variant="secondary">
                      已选择 {selectedCampaignIds.length} 个
                    </Badge>
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      {selectedCampaignIds.length === filteredCampaigns.length ? "取消全选" : "全选"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {campaignsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCampaigns.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    没有符合条件的广告活动
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-2">
                    {filteredCampaigns.map(campaign => (
                      <div 
                        key={campaign.id}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedCampaignIds.includes(campaign.id) 
                            ? "border-primary bg-primary/5" 
                            : "border-border hover:bg-muted/50"
                        }`}
                        onClick={() => handleToggleCampaign(campaign.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox 
                            checked={selectedCampaignIds.includes(campaign.id)}
                            onCheckedChange={() => handleToggleCampaign(campaign.id)}
                          />
                          <div>
                            <div className="font-medium text-sm">{campaign.campaignName}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {campaign.campaignType}
                              </Badge>
                              <span>花费: ${parseFloat(campaign.spend || "0").toFixed(2)}</span>
                              <span>销售: ${parseFloat(campaign.sales || "0").toFixed(2)}</span>
                              <span>ACoS: {parseFloat(campaign.acos || "0").toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                        <Badge variant={campaign.campaignStatus === "enabled" ? "default" : "secondary"}>
                          {campaign.campaignStatus === "enabled" ? "投放中" : "已暂停"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 第三步：确认 */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">优化目标概览</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">名称</Label>
                    <p className="font-medium">{name || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">优化类型</Label>
                    <p className="font-medium">
                      {targetType === "maximize_sales" && "销售最大化"}
                      {targetType === "target_acos" && `目标ACoS: ${targetValue || "-"}%`}
                      {targetType === "target_roas" && `目标ROAS: ${targetValue || "-"}`}
                      {targetType === "target_cpa" && `目标CPA: $${targetValue || "-"}`}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">每日费用上限</Label>
                    <p className="font-medium">{dailyBudget ? `$${dailyBudget}` : "未设置"}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">最高出价</Label>
                    <p className="font-medium">{maxBid ? `$${maxBid}` : "未设置"}</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <Label className="text-xs text-muted-foreground">已选择的广告活动</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedCampaignIds.length === 0 ? (
                      <p className="text-muted-foreground">未选择广告活动</p>
                    ) : (
                      <>
                        <Badge variant="secondary" className="text-sm">
                          共 {selectedCampaignIds.length} 个广告活动
                        </Badge>
                        {filteredCampaigns
                          .filter(c => selectedCampaignIds.includes(c.id))
                          .slice(0, 5)
                          .map(c => (
                            <Badge key={c.id} variant="outline">{c.campaignName}</Badge>
                          ))
                        }
                        {selectedCampaignIds.length > 5 && (
                          <Badge variant="outline">+{selectedCampaignIds.length - 5} 更多</Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Bot className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-500">算法将自动介入优化</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    创建后，我们的优化算法将根据您设定的目标，自动优化所选广告活动的出价、广告位、投放词等，以实现最佳效果。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between">
          <div>
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                上一步
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)}>
                下一步 <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                创建优化目标
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 优化目标卡片组件
function OptimizationTargetCard({ 
  target, 
  onManage,
  onRefresh 
}: { 
  target: any; 
  onManage: () => void;
  onRefresh: () => void;
}) {
  const [isActive, setIsActive] = useState(target.status === "active");

  const toggleStatus = trpc.performanceGroup.toggleStatus.useMutation({
    onSuccess: () => {
      toast.success(isActive ? "已暂停优化" : "已启用优化");
      onRefresh();
    },
    onError: (error) => {
      toast.error(`操作失败: ${error.message}`);
      setIsActive(!isActive);
    },
  });

  const handleToggle = () => {
    setIsActive(!isActive);
    toggleStatus.mutate({ id: target.id, status: isActive ? "paused" : "active" });
  };

  const getTargetTypeLabel = () => {
    switch (target.targetType) {
      case "maximize_sales": return "销售最大化";
      case "target_acos": return `目标ACoS`;
      case "target_roas": return `目标ROAS`;
      case "target_cpa": return `目标CPA`;
      default: return target.targetType;
    }
  };

  const getTargetValueDisplay = () => {
    if (!target.targetValue) return null;
    switch (target.targetType) {
      case "target_acos": return `${target.targetValue}%`;
      case "target_roas": return target.targetValue;
      case "target_cpa": return `$${target.targetValue}`;
      default: return target.targetValue;
    }
  };

  return (
    <Card className="relative overflow-hidden">
      {/* 状态指示条 */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
      
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <div>
              <CardTitle className="text-base">{target.name}</CardTitle>
              <CardDescription className="text-xs">
                {target.campaignCount || 0} 个广告活动
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "优化中" : "已暂停"}
            </Badge>
            <Switch checked={isActive} onCheckedChange={handleToggle} />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* 优化目标信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">优化类型</p>
            <p className="font-medium text-sm flex items-center gap-1">
              {target.targetType === "maximize_sales" && <TrendingUp className="w-4 h-4 text-green-500" />}
              {target.targetType === "target_acos" && <Percent className="w-4 h-4 text-blue-500" />}
              {target.targetType === "target_roas" && <BarChart3 className="w-4 h-4 text-purple-500" />}
              {target.targetType === "target_cpa" && <DollarSign className="w-4 h-4 text-orange-500" />}
              {getTargetTypeLabel()}
              {getTargetValueDisplay() && (
                <span className="text-primary ml-1">{getTargetValueDisplay()}</span>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">每日费用上限</p>
            <p className="font-medium text-sm">
              {target.dailyBudget ? `$${target.dailyBudget}` : "未设置"}
            </p>
          </div>
        </div>

        {/* KPI汇总 */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">花费</p>
            <p className="font-medium text-sm">${(target.totalSpend || 0).toFixed(0)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">销售</p>
            <p className="font-medium text-sm">${(target.totalSales || 0).toFixed(0)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">ACoS</p>
            <p className="font-medium text-sm">{(target.avgAcos || 0).toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">ROAS</p>
            <p className="font-medium text-sm">{(target.avgRoas || 0).toFixed(2)}</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onManage}>
            <Settings className="w-4 h-4 mr-1" />
            管理
          </Button>
          <Button variant="default" size="sm" className="flex-1">
            <Play className="w-4 h-4 mr-1" />
            执行优化
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// 主页面组件
export default function OptimizationTargets() {
  const [, setLocation] = useLocation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const currentAccountId = accounts?.[0]?.id;

  // 获取优化目标列表（使用performanceGroup API）
  const { data: targets, isLoading, refetch } = trpc.performanceGroup.list.useQuery(
    { accountId: currentAccountId! },
    { enabled: !!currentAccountId }
  );

  // 获取广告活动统计
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: currentAccountId },
    { enabled: !!currentAccountId }
  );

  // 统计数据
  const stats = useMemo(() => {
    const managedCampaigns = campaigns?.filter(c => c.optimizationStatus === "managed").length || 0;
    const unmanagedCampaigns = campaigns?.filter(c => c.optimizationStatus !== "managed").length || 0;
    const activeTargets = targets?.filter(t => t.status === "active").length || 0;
    const pausedTargets = targets?.filter(t => t.status !== "active").length || 0;
    
    return {
      totalTargets: targets?.length || 0,
      managedCampaigns,
      unmanagedCampaigns,
      activeTargets,
      pausedTargets,
    };
  }, [targets, campaigns]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">优化目标</h1>
            <p className="text-muted-foreground">
              创建自定义优化目标，通过筛选条件纳入广告活动，由算法自动介入优化
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            创建优化目标
          </Button>
        </div>

        {/* 统计概览 */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">优化目标总数</p>
                  <p className="text-3xl font-bold">{stats.totalTargets}</p>
                </div>
                <Target className="w-10 h-10 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">已介入广告活动</p>
                  <p className="text-3xl font-bold">{stats.managedCampaigns}</p>
                </div>
                <Bot className="w-10 h-10 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">未介入广告活动</p>
                  <p className="text-3xl font-bold">{stats.unmanagedCampaigns}</p>
                </div>
                <Activity className="w-10 h-10 text-orange-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">优化中 / 已暂停</p>
                  <p className="text-3xl font-bold">{stats.activeTargets}/{stats.pausedTargets}</p>
                </div>
                <BarChart3 className="w-10 h-10 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 优化目标列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : targets && targets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {targets.map(target => (
              <OptimizationTargetCard 
                key={target.id}
                target={target}
                onManage={() => setLocation(`/optimization-targets/${target.id}`)}
                onRefresh={refetch}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Target className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">还没有优化目标</h3>
              <p className="text-muted-foreground text-center mb-4">
                创建您的第一个优化目标，通过筛选条件选择广告活动，<br />
                让算法自动优化以实现您的目标。
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                创建优化目标
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 创建优化目标弹窗 */}
      <CreateOptimizationTargetDialog 
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={refetch}
      />
    </DashboardLayout>
  );
}
