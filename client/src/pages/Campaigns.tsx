import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import OperationConfirmDialog, { useOperationConfirm } from "@/components/OperationConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Search, 
  MoreHorizontal,
  Loader2,
  RefreshCw,
  Zap,
  Target,
  Megaphone,
  Monitor,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings2,
  Pause,
  Play,
  DollarSign,
  RotateCcw
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

// 广告活动类型配置
const campaignTypes = [
  { value: "all", label: "全部类型", icon: null, count: 0 },
  { value: "sp_auto", label: "SP 自动", icon: Zap, color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  { value: "sp_manual", label: "SP 手动", icon: Target, color: "bg-green-500/10 text-green-500 border-green-500/20" },
  { value: "sb", label: "SB 品牌", icon: Megaphone, color: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  { value: "sd", label: "SD 展示", icon: Monitor, color: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
];

// 计费方式映射
const billingTypeLabels: Record<string, string> = {
  cpc: "CPC (按点击)",
  vcpm: "vCPM (按千次展示)",
  cpm: "CPM (按千次展示)",
};

// 列配置
type ColumnKey = 'campaignName' | 'campaignType' | 'billingType' | 'createdAt' | 'status' | 
  'dailyBudget' | 'dailySpend' | 'impressions' | 'clicks' | 'ctr' | 'totalSpend' | 
  'dailySales' | 'totalSales' | 'acos' | 'roas' | 'performanceGroup' | 'actions';

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  minWidth: string;
  align?: 'left' | 'right' | 'center';
  sortable: boolean;
  defaultVisible: boolean;
  sticky?: boolean;
}

const columns: ColumnConfig[] = [
  { key: 'campaignName', label: '广告活动名称', minWidth: '250px', align: 'left', sortable: true, defaultVisible: true, sticky: true },
  { key: 'campaignType', label: '类型', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'billingType', label: '计费方式', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'createdAt', label: '创建日期', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'status', label: '状态', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'dailyBudget', label: '日预算', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'dailySpend', label: '当日花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'impressions', label: '曝光', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'clicks', label: '点击', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'ctr', label: '点击率', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'totalSpend', label: '累计花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'dailySales', label: '日销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'totalSales', label: '累计销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'acos', label: 'ACoS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'roas', label: 'ROAS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'performanceGroup', label: '所属绩效组', minWidth: '120px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'actions', label: '操作', minWidth: '120px', align: 'center', sortable: false, defaultVisible: true },
];

// 排序字段类型
type SortField = Exclude<ColumnKey, 'actions'>;
type SortDirection = 'asc' | 'desc';

// localStorage key
const COLUMN_VISIBILITY_KEY = 'campaigns_column_visibility';

export default function Campaigns() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  
  // 列显示状态
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    const saved = localStorage.getItem(COLUMN_VISIBILITY_KEY);
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set(columns.filter(c => c.defaultVisible).map(c => c.key));
      }
    }
    return new Set(columns.filter(c => c.defaultVisible).map(c => c.key));
  });

  // 编辑预算弹窗状态
  const [editBudgetDialog, setEditBudgetDialog] = useState<{
    open: boolean;
    campaignId: number | null;
    campaignName: string;
    currentBudget: number;
    newBudget: string;
  }>({
    open: false,
    campaignId: null,
    campaignName: '',
    currentBudget: 0,
    newBudget: '',
  });
  
  // 确认弹窗状态
  const { showConfirm, dialogProps } = useOperationConfirm();

  // 保存列显示设置到localStorage
  useEffect(() => {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns]);

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch campaigns
  const { data: campaigns, isLoading, refetch } = trpc.campaign.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // Fetch performance groups for assignment
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // Update campaign mutation
  const updateCampaign = trpc.campaign.update.useMutation({
    onSuccess: () => {
      toast.success("广告活动已更新");
      refetch();
    },
  });

  // Assign to performance group
  const assignToGroup = trpc.performanceGroup.assignCampaign.useMutation({
    onSuccess: () => {
      toast.success("已分配到绩效组");
      refetch();
    },
  });

  // Filter campaigns
  const filteredCampaigns = campaigns?.filter((campaign) => {
    const matchesSearch = campaign.campaignName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || campaign.campaignType === typeFilter;
    return matchesSearch && matchesType;
  });

  // 获取绩效组名称
  const getPerformanceGroupName = (groupId: number | null | undefined) => {
    if (!groupId) return "-";
    const group = performanceGroups?.find(g => g.id === groupId);
    return group?.name || "-";
  };

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 获取排序图标
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // 排序后的数据
  const sortedCampaigns = useMemo(() => {
    if (!filteredCampaigns) return [];
    if (!sortField) return filteredCampaigns;
    
    return [...filteredCampaigns].sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField) {
        case 'campaignName':
          aValue = a.campaignName.toLowerCase();
          bValue = b.campaignName.toLowerCase();
          break;
        case 'campaignType':
          aValue = a.campaignType;
          bValue = b.campaignType;
          break;
        case 'billingType':
          aValue = (a as any).billingType || 'cpc';
          bValue = (b as any).billingType || 'cpc';
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt || 0).getTime();
          bValue = new Date(b.createdAt || 0).getTime();
          break;
        case 'status':
          aValue = a.status || '';
          bValue = b.status || '';
          break;
        case 'dailyBudget':
          aValue = parseFloat((a as any).dailyBudget || '0');
          bValue = parseFloat((b as any).dailyBudget || '0');
          break;
        case 'dailySpend':
          aValue = parseFloat((a as any).dailySpend || '0');
          bValue = parseFloat((b as any).dailySpend || '0');
          break;
        case 'impressions':
          aValue = a.impressions || 0;
          bValue = b.impressions || 0;
          break;
        case 'clicks':
          aValue = a.clicks || 0;
          bValue = b.clicks || 0;
          break;
        case 'ctr':
          aValue = a.impressions ? (a.clicks || 0) / a.impressions : 0;
          bValue = b.impressions ? (b.clicks || 0) / b.impressions : 0;
          break;
        case 'totalSpend':
          aValue = parseFloat(a.spend || '0');
          bValue = parseFloat(b.spend || '0');
          break;
        case 'dailySales':
          aValue = parseFloat((a as any).dailySales || '0');
          bValue = parseFloat((b as any).dailySales || '0');
          break;
        case 'totalSales':
          aValue = parseFloat(a.sales || '0');
          bValue = parseFloat(b.sales || '0');
          break;
        case 'acos':
          aValue = parseFloat(a.acos || '0');
          bValue = parseFloat(b.acos || '0');
          break;
        case 'roas':
          aValue = parseFloat(a.roas || '0');
          bValue = parseFloat(b.roas || '0');
          break;
        case 'performanceGroup':
          aValue = getPerformanceGroupName((a as any).performanceGroupId);
          bValue = getPerformanceGroupName((b as any).performanceGroupId);
          break;
        default:
          return 0;
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredCampaigns, sortField, sortDirection, performanceGroups]);

  // 计算各类型数量
  const typeCounts = campaigns?.reduce((acc, campaign) => {
    acc[campaign.campaignType] = (acc[campaign.campaignType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const getCampaignTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      sp_auto: "SP 自动",
      sp_manual: "SP 手动",
      sb: "SB 品牌",
      sd: "SD 展示",
    };
    return labels[type] || type;
  };

  const getCampaignTypeConfig = (type: string) => {
    return campaignTypes.find(t => t.value === type) || campaignTypes[0];
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      enabled: { label: "投放中", className: "bg-green-500/10 text-green-500 border-green-500/20" },
      paused: { label: "已暂停", className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
      archived: { label: "已归档", className: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
    };
    const config = statusConfig[status] || { label: status, className: "bg-gray-500/10 text-gray-500" };
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  // 计算点击率
  const calculateCTR = (clicks: number, impressions: number) => {
    if (!impressions || impressions === 0) return "-";
    return ((clicks / impressions) * 100).toFixed(2) + "%";
  };

  // 格式化日期
  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  // 切换列显示
  const toggleColumn = (key: ColumnKey) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(key)) {
      // 至少保留广告活动名称列
      if (key !== 'campaignName') {
        newVisible.delete(key);
      }
    } else {
      newVisible.add(key);
    }
    setVisibleColumns(newVisible);
  };

  // 重置为默认列
  const resetColumns = () => {
    setVisibleColumns(new Set(columns.filter(c => c.defaultVisible).map(c => c.key)));
  };

  // 处理暂停/启用操作
  const handleToggleStatus = (campaign: any) => {
    const newStatus = campaign.status === "enabled" ? "paused" : "enabled";
    const isHighRisk = campaign.status === "enabled";
    
    showConfirm({
      operationType: newStatus === "paused" ? 'campaign_pause' : 'campaign_enable',
      title: newStatus === "paused" ? '暂停广告活动' : '启用广告活动',
      description: `您即将${newStatus === "paused" ? '暂停' : '启用'}广告活动"${campaign.campaignName}"`,
      changes: [{
        id: campaign.id,
        name: campaign.campaignName,
        field: 'status',
        fieldLabel: '状态',
        oldValue: campaign.status === "enabled" ? '启用中' : '已暂停',
        newValue: newStatus === "paused" ? '已暂停' : '启用中',
      }],
      warningMessage: isHighRisk 
        ? '暂停广告活动将立即停止广告展示，可能影响销售' 
        : undefined,
      onConfirm: () => {
        updateCampaign.mutate({
          id: campaign.id,
          status: newStatus,
        });
      },
    });
  };

  // 处理编辑预算
  const handleEditBudget = (campaign: any) => {
    setEditBudgetDialog({
      open: true,
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      currentBudget: parseFloat((campaign as any).dailyBudget || '0'),
      newBudget: (campaign as any).dailyBudget || '0',
    });
  };

  // 确认编辑预算
  const confirmEditBudget = () => {
    const newBudget = parseFloat(editBudgetDialog.newBudget);
    if (isNaN(newBudget) || newBudget < 0) {
      toast.error("请输入有效的预算金额");
      return;
    }

    showConfirm({
      operationType: 'budget_adjustment',
      title: '修改日预算',
      description: `您即将修改广告活动"${editBudgetDialog.campaignName}"的日预算`,
      changes: [{
        id: editBudgetDialog.campaignId!,
        name: editBudgetDialog.campaignName,
        field: 'dailyBudget',
        fieldLabel: '日预算',
        oldValue: `$${editBudgetDialog.currentBudget.toFixed(2)}`,
        newValue: `$${newBudget.toFixed(2)}`,
      }],
      warningMessage: newBudget > editBudgetDialog.currentBudget * 2 
        ? '新预算超过原预算的2倍，请确认是否正确' 
        : undefined,
      onConfirm: () => {
        updateCampaign.mutate({
          id: editBudgetDialog.campaignId!,
          dailyBudget: newBudget.toString(),
        });
        setEditBudgetDialog({ open: false, campaignId: null, campaignName: '', currentBudget: 0, newBudget: '' });
      },
    });
  };

  // 渲染单元格内容
  const renderCell = (campaign: any, columnKey: ColumnKey) => {
    const typeConfig = getCampaignTypeConfig(campaign.campaignType);
    const dailySpend = parseFloat((campaign as any).dailySpend || "0");
    const totalSpend = parseFloat(campaign.spend || "0");
    const dailySales = parseFloat((campaign as any).dailySales || "0");
    const totalSales = parseFloat(campaign.sales || "0");
    const dailyBudget = parseFloat((campaign as any).dailyBudget || "0");
    const impressions = campaign.impressions || 0;
    const clicks = campaign.clicks || 0;

    switch (columnKey) {
      case 'campaignName':
        return (
          <div className="max-w-[250px] truncate font-medium" title={campaign.campaignName}>
            {campaign.campaignName}
          </div>
        );
      case 'campaignType':
        return (
          <Badge variant="outline" className={typeConfig.color}>
            {getCampaignTypeLabel(campaign.campaignType)}
          </Badge>
        );
      case 'billingType':
        return (
          <span className="text-sm text-muted-foreground">
            {billingTypeLabels[(campaign as any).billingType] || "CPC (按点击)"}
          </span>
        );
      case 'createdAt':
        return (
          <span className="text-sm text-muted-foreground">
            {formatDate(campaign.createdAt)}
          </span>
        );
      case 'status':
        return getStatusBadge(campaign.status || 'paused');
      case 'dailyBudget':
        return <span className="tabular-nums font-medium">${dailyBudget.toFixed(2)}</span>;
      case 'dailySpend':
        return (
          <span className={`tabular-nums ${dailySpend > dailyBudget * 0.9 ? "text-orange-500" : ""}`}>
            ${dailySpend.toFixed(2)}
          </span>
        );
      case 'impressions':
        return <span className="tabular-nums">{impressions.toLocaleString()}</span>;
      case 'clicks':
        return <span className="tabular-nums">{clicks.toLocaleString()}</span>;
      case 'ctr':
        return <span className="tabular-nums">{calculateCTR(clicks, impressions)}</span>;
      case 'totalSpend':
        return <span className="tabular-nums font-medium">${totalSpend.toFixed(2)}</span>;
      case 'dailySales':
        return <span className="tabular-nums text-green-600">${dailySales.toFixed(2)}</span>;
      case 'totalSales':
        return <span className="tabular-nums text-green-600 font-medium">${totalSales.toFixed(2)}</span>;
      case 'acos':
        const acos = parseFloat(campaign.acos || "0");
        return (
          <span className={`tabular-nums ${acos > 30 ? "text-red-500" : acos > 20 ? "text-orange-500" : "text-green-500"}`}>
            {acos.toFixed(1)}%
          </span>
        );
      case 'roas':
        const roas = parseFloat(campaign.roas || "0");
        return (
          <span className={`tabular-nums ${roas < 2 ? "text-red-500" : roas < 3 ? "text-orange-500" : "text-green-500"}`}>
            {roas.toFixed(2)}
          </span>
        );
      case 'performanceGroup':
        return (
          <Select
            value={(campaign as any).performanceGroupId?.toString() || ""}
            onValueChange={(value) => {
              assignToGroup.mutate({
                campaignId: campaign.id,
                performanceGroupId: parseInt(value),
              });
            }}
          >
            <SelectTrigger className="h-8 w-[110px]">
              <SelectValue placeholder="选择绩效组" />
            </SelectTrigger>
            <SelectContent>
              {performanceGroups?.map((group) => (
                <SelectItem key={group.id} value={group.id.toString()}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'actions':
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleToggleStatus(campaign)}
              title={campaign.status === "enabled" ? "暂停" : "启用"}
            >
              {campaign.status === "enabled" ? (
                <Pause className="w-4 h-4 text-yellow-500" />
              ) : (
                <Play className="w-4 h-4 text-green-500" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleEditBudget(campaign)}
              title="编辑预算"
            >
              <DollarSign className="w-4 h-4 text-blue-500" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                  查看关键词
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                  查看竞价日志
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">广告活动</h1>
            <p className="text-muted-foreground">
              管理和优化您的亚马逊广告活动
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 列设置 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="w-4 h-4 mr-2" />
                  列设置
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>显示列</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.filter(c => c.key !== 'campaignName').map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={visibleColumns.has(column.key)}
                    onCheckedChange={() => toggleColumn(column.key)}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={resetColumns}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重置为默认
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => window.location.href = '/data-sync'}>
              <RefreshCw className="w-4 h-4 mr-2" />
              同步数据
            </Button>
          </div>
        </div>

        {/* 广告类型筛选标签 */}
        <div className="flex flex-wrap gap-3">
          {campaignTypes.map((type) => {
            const count = type.value === "all" 
              ? campaigns?.length || 0 
              : typeCounts[type.value] || 0;
            const isActive = typeFilter === type.value;
            const Icon = type.icon;
            
            return (
              <Button
                key={type.value}
                variant={isActive ? "default" : "outline"}
                className={`h-auto py-3 px-4 ${isActive ? "" : "hover:bg-accent"}`}
                onClick={() => setTypeFilter(type.value)}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="w-4 h-4" />}
                  <span>{type.label}</span>
                  <Badge variant="secondary" className="ml-1">
                    {count}
                  </Badge>
                </div>
              </Button>
            );
          })}
        </div>

        {/* 搜索框 */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索广告活动名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        {/* Campaigns Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {typeFilter === "all" ? "全部广告活动" : getCampaignTypeLabel(typeFilter) + " 广告活动"}
                </CardTitle>
                <CardDescription>
                  共 {sortedCampaigns.length} 个广告活动
                  {sortField && (
                    <span className="ml-2 text-primary">
                      · 按{columns.find(c => c.key === sortField)?.label}
                      {sortDirection === 'asc' ? '升序' : '降序'}排列
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : sortedCampaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {columns.filter(col => visibleColumns.has(col.key)).map((column) => (
                        <TableHead 
                          key={column.key}
                          className={`min-w-[${column.minWidth}] ${column.sticky ? 'sticky left-0 bg-muted/50 z-10' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                          style={{ minWidth: column.minWidth }}
                        >
                          {column.sortable ? (
                            <button
                              className="flex items-center gap-1 hover:text-primary transition-colors"
                              onClick={() => handleSort(column.key as SortField)}
                            >
                              {column.label}
                              {getSortIcon(column.key as SortField)}
                            </button>
                          ) : (
                            column.label
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCampaigns.map((campaign) => (
                      <TableRow key={campaign.id} className="hover:bg-muted/30">
                        {columns.filter(col => visibleColumns.has(col.key)).map((column) => (
                          <TableCell 
                            key={column.key}
                            className={`${column.sticky ? 'sticky left-0 bg-background z-10' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                          >
                            {renderCell(campaign, column.key)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-16">
                <RefreshCw className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">暂无广告活动</h3>
                <p className="text-muted-foreground mb-4">
                  请先连接Amazon API同步您的广告数据
                </p>
                <Button onClick={() => window.location.href = '/data-sync'}>
                  同步数据
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 编辑预算弹窗 */}
      <Dialog open={editBudgetDialog.open} onOpenChange={(open) => !open && setEditBudgetDialog({ ...editBudgetDialog, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑日预算</DialogTitle>
            <DialogDescription>
              修改广告活动 "{editBudgetDialog.campaignName}" 的日预算
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>当前日预算</Label>
              <div className="text-lg font-semibold">${editBudgetDialog.currentBudget.toFixed(2)}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newBudget">新日预算</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="newBudget"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editBudgetDialog.newBudget}
                  onChange={(e) => setEditBudgetDialog({ ...editBudgetDialog, newBudget: e.target.value })}
                  className="pl-9"
                  placeholder="输入新的日预算"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBudgetDialog({ ...editBudgetDialog, open: false })}>
              取消
            </Button>
            <Button onClick={confirmEditBudget}>
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 操作确认弹窗 */}
      {dialogProps && <OperationConfirmDialog {...dialogProps} />}
    </DashboardLayout>
  );
}
