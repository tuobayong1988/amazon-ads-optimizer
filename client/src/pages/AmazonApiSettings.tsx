import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { useCurrentAccountId, setCurrentAccountId } from "@/components/AccountSwitcher";
import { ApiHealthMonitor } from "@/components/ApiHealthMonitor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import toast from "react-hot-toast";
import {
  Key, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Cloud, 
  Link2, 
  Database,
  Play,
  Loader2,
  Info,
  ExternalLink,
  Shield,
  Globe,
  Plus,
  Store,
  Trash2,
  Edit2,
  Star,
  StarOff,
  MoreVertical,
  AlertCircle,
  Settings,
  GripVertical,
  Download,
  Upload,
  FileJson,
  FileSpreadsheet,
  Eye
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 市场列表
const MARKETPLACES = [
  { id: "US", name: "美国", marketplaceId: "ATVPDKIKX0DER", flag: "🇺🇸" },
  { id: "CA", name: "加拿大", marketplaceId: "A2EUQ1WTGCTBG2", flag: "🇨🇦" },
  { id: "MX", name: "墨西哥", marketplaceId: "A1AM78C64UM0Y8", flag: "🇲🇽" },
  { id: "BR", name: "巴西", marketplaceId: "A2Q3Y263D00KWC", flag: "🇧🇷" },
  { id: "UK", name: "英国", marketplaceId: "A1F83G8C2ARO7P", flag: "🇬🇧" },
  { id: "DE", name: "德国", marketplaceId: "A1PA6795UKMFR9", flag: "🇩🇪" },
  { id: "FR", name: "法国", marketplaceId: "A13V1IB3VIYBER", flag: "🇫🇷" },
  { id: "IT", name: "意大利", marketplaceId: "APJ6JRA9NG5V4", flag: "🇮🇹" },
  { id: "ES", name: "西班牙", marketplaceId: "A1RKKUPIHCS9HS", flag: "🇪🇸" },
  { id: "NL", name: "荷兰", marketplaceId: "A1805IZSGTT6HS", flag: "🇳🇱" },
  { id: "SE", name: "瑞典", marketplaceId: "A2NODRKZP88ZB9", flag: "🇸🇪" },
  { id: "PL", name: "波兰", marketplaceId: "A1C3SOZRARQ6R3", flag: "🇵🇱" },
  { id: "JP", name: "日本", marketplaceId: "A1VC38T7YXB528", flag: "🇯🇵" },
  { id: "AU", name: "澳大利亚", marketplaceId: "A39IBJ37TRP1C6", flag: "🇦🇺" },
  { id: "SG", name: "新加坡", marketplaceId: "A19VAU5U5O7RUS", flag: "🇸🇬" },
  { id: "AE", name: "阿联酋", marketplaceId: "A2VIGQ35RCS4UG", flag: "🇦🇪" },
  { id: "SA", name: "沙特阿拉伯", marketplaceId: "A17E79C6D8DWNP", flag: "🇸🇦" },
  { id: "IN", name: "印度", marketplaceId: "A21TJRUUN4KGV", flag: "🇮🇳" },
];

// 预设颜色
const PRESET_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

interface AccountFormData {
  accountId: string;
  accountName: string;
  storeName: string;
  storeDescription: string;
  storeColor: string;
  marketplace: string;
  marketplaceId: string;
  profileId: string;
  sellerId: string;
  isDefault: boolean;
}

const initialFormData: AccountFormData = {
  accountId: "",
  accountName: "",
  storeName: "",
  storeDescription: "",
  storeColor: "#3B82F6",
  marketplace: "US",
  marketplaceId: "",
  profileId: "",
  sellerId: "",
  isDefault: false,
};

export default function AmazonApiSettings() {
  const { user, loading: authLoading } = useAuth();
  const globalAccountId = useCurrentAccountId();
  const [selectedAccountId, setSelectedAccountIdLocal] = useState<number | null>(null);
  
  // 同步全局账号ID到本地状态
  useEffect(() => {
    if (globalAccountId && globalAccountId !== selectedAccountId) {
      setSelectedAccountIdLocal(globalAccountId);
    }
  }, [globalAccountId]);
  
  // 设置账号ID时同时更新全局和本地状态
  const setSelectedAccountId = (id: number | null) => {
    setSelectedAccountIdLocal(id);
    if (id) {
      setCurrentAccountId(id);
    }
  };
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountFormData & { id: number } | null>(null);
  const [formData, setFormData] = useState<AccountFormData>(initialFormData);
  
  // 打开对话框时重置表单（但保留店铺名称）
  const handleOpenAddDialog = () => {
    setFormData({
      ...formData,
      accountId: "",
      accountName: "",
      storeDescription: "",
      storeColor: "#3B82F6",
      marketplace: "US",
      marketplaceId: "",
      profileId: "",
      sellerId: "",
      isDefault: false,
    });
    setIsAddDialogOpen(true);
  };
  
  // 关闭对话框时重置表单
  const handleCloseAddDialog = () => {
    setIsAddDialogOpen(false);
    setFormData(initialFormData);
  };
  const [credentials, setCredentials] = useState({
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    profileId: "",
    region: "NA" as "NA" | "EU" | "FE",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    step: 'idle' | 'sp' | 'sb' | 'sd' | 'adgroups' | 'keywords' | 'targets' | 'complete' | 'error';
    progress: number;
    current: string;
    results: {
      sp: number;
      sb: number;
      sd: number;
      adGroups: number;
      keywords: number;
      targets: number;
    };
    error?: string;
  }>({
    step: 'idle',
    progress: 0,
    current: '',
    results: { sp: 0, sb: 0, sd: 0, adGroups: 0, keywords: 0, targets: 0 }
  });
  const [authStep, setAuthStep] = useState<'idle' | 'oauth' | 'exchanging' | 'saving' | 'syncing' | 'complete' | 'error'>('idle');
  const [authProgress, setAuthProgress] = useState(0);
  const [authError, setAuthError] = useState<{ step: string; message: string; canRetry: boolean } | null>(null);
  const [lastSuccessfulStep, setLastSuccessfulStep] = useState<'idle' | 'exchanging' | 'saving' | 'syncing'>('idle');
  const [activeTab, setActiveTab] = useState("accounts");
  const [useIncrementalSync, setUseIncrementalSync] = useState(true);
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [showSyncConflicts, setShowSyncConflicts] = useState(false);
  const [showSyncQueue, setShowSyncQueue] = useState(false);
  const [showChangeSummary, setShowChangeSummary] = useState(false);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<string>('every_2_hours');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [selectedSyncJobId, setSelectedSyncJobId] = useState<number | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [importFormat, setImportFormat] = useState<"json" | "csv">("json");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importPreview, setImportPreview] = useState<Array<{ accountId: string; accountName: string; storeName?: string; marketplace: string; exists: boolean }> | null>(null);

  const utils = trpc.useUtils();

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery(undefined, {
    enabled: !!user,
  });

  // Fetch account stats
  const { data: accountStats } = trpc.adAccount.getStats.useQuery(undefined, {
    enabled: !!user,
  });

  // Get selected account
  const selectedAccount = useMemo(() => {
    if (!selectedAccountId || !accounts) return null;
    return accounts.find(a => a.id === selectedAccountId);
  }, [selectedAccountId, accounts]);

  // Fetch credentials status
  const { data: credentialsStatus, refetch: refetchStatus } = trpc.amazonApi.getCredentialsStatus.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // Fetch regions info
  const { data: regionsInfo } = trpc.amazonApi.getRegions.useQuery();

  // 当获取到已保存的凭证状态时，自动填充表单
  useEffect(() => {
    if (credentialsStatus?.hasCredentials) {
      setCredentials(prev => ({
        ...prev,
        clientId: credentialsStatus.clientId || prev.clientId,
        clientSecret: credentialsStatus.clientSecret || prev.clientSecret,
        refreshToken: credentialsStatus.refreshToken || prev.refreshToken,
        profileId: credentialsStatus.profileId || prev.profileId,
        region: (credentialsStatus.region as "NA" | "EU" | "FE") || prev.region,
      }));
    }
  }, [credentialsStatus]);

  // Create account mutation
  const createAccountMutation = trpc.adAccount.create.useMutation({
    onSuccess: () => {
      toast.success("店铺账号添加成功！");
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      setIsAddDialogOpen(false);
      // 保留店铺名称，只重置其他字段
      // 注意：不重置formData，以保留用户输入的店铺名称
    },
    onError: (error) => {
      toast.error(`添加失败: ${error.message}`);
    },
  });

  // Update account mutation
  const updateAccountMutation = trpc.adAccount.update.useMutation({
    onSuccess: () => {
      toast.success("店铺信息更新成功！");
      utils.adAccount.list.invalidate();
      setIsEditDialogOpen(false);
      setEditingAccount(null);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // Delete account mutation
  const deleteAccountMutation = trpc.adAccount.delete.useMutation({
    onSuccess: () => {
      toast.success("店铺账号已删除");
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      if (selectedAccountId === editingAccount?.id) {
        setSelectedAccountId(null);
      }
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  // Set default account mutation
  const setDefaultMutation = trpc.adAccount.setDefault.useMutation({
    onSuccess: () => {
      toast.success("已设为默认账号");
      utils.adAccount.list.invalidate();
    },
    onError: (error) => {
      toast.error(`设置失败: ${error.message}`);
    },
  });

  // Save credentials mutation
  const saveCredentialsMutation = trpc.amazonApi.saveCredentials.useMutation({
    onSuccess: (data) => {
      toast.success("API凭证保存成功！");
      
      // 显示自动同步结果
      if (data.syncResult) {
        if (data.syncResult.error) {
          toast.error(`自动同步失败: ${data.syncResult.error}`);
        } else {
          const { campaigns, adGroups, keywords, targets, performance } = data.syncResult;
          toast.success(
            `自动同步完成！\n广告活动: ${campaigns}, 广告组: ${adGroups}, 关键词: ${keywords}, 商品定位: ${targets}, 绩效数据: ${performance}`,
            { duration: 5000 }
          );
        }
      }
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      
      refetchStatus();
      setCredentials({
        clientId: "",
        clientSecret: "",
        refreshToken: "",
        profileId: "",
        region: "NA",
      });
    },
    onError: (error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });

  // Save multiple profiles mutation - 支持一次授权多站点
  const saveMultipleProfilesMutation = trpc.amazonApi.saveMultipleProfiles.useMutation({
    onSuccess: (data) => {
      toast.success(`多站点授权成功！已创建 ${data.results.length} 个站点账号`);
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      refetchStatus();
    },
    onError: (error) => {
      toast.error(`多站点授权失败: ${error.message}`);
    },
  });

  // 同步历史查询
  const { data: syncHistory, refetch: refetchSyncHistory } = trpc.amazonApi.getSyncHistory.useQuery(
    { accountId: selectedAccountId!, limit: 10 },
    { enabled: !!selectedAccountId && showSyncHistory }
  );

  // 同步统计查询
  const { data: syncStats } = trpc.amazonApi.getSyncStats.useQuery(
    { accountId: selectedAccountId!, days: 30 },
    { enabled: !!selectedAccountId && showSyncHistory }
  );

  // 同步冲突查询
  const { data: syncConflicts, refetch: refetchConflicts } = trpc.amazonApi.getSyncConflicts.useQuery(
    { accountId: selectedAccountId!, status: 'pending' },
    { enabled: !!selectedAccountId && showSyncConflicts }
  );

  // 待处理冲突数量
  const { data: pendingConflictsCount } = trpc.amazonApi.getPendingConflictsCount.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 同步队列查询
  const { data: syncQueue, refetch: refetchQueue } = trpc.amazonApi.getSyncQueue.useQuery(
    { status: undefined },
    { enabled: showSyncQueue }
  );

  // 队列统计
  const { data: queueStats } = trpc.amazonApi.getSyncQueueStats.useQuery(
    undefined,
    { enabled: showSyncQueue }
  );

  // 同步变更摘要查询
  const { data: changeSummary } = trpc.amazonApi.getSyncChangeSummary.useQuery(
    { syncJobId: selectedSyncJobId! },
    { enabled: !!selectedSyncJobId && showChangeSummary }
  );

  // 定时同步配置查询
  const { data: scheduleConfig, refetch: refetchScheduleConfig } = trpc.dataSync.getSchedules.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 创建/更新定时同步配置
  const createScheduleMutation = trpc.dataSync.createSchedule.useMutation({
    onSuccess: () => {
      toast.success('定时同步配置已保存');
      refetchScheduleConfig();
    },
    onError: (error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });

  const updateScheduleMutation = trpc.dataSync.updateSchedule.useMutation({
    onSuccess: () => {
      toast.success('定时同步配置已更新');
      refetchScheduleConfig();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const deleteScheduleMutation = trpc.dataSync.deleteSchedule.useMutation({
    onSuccess: () => {
      toast.success('定时同步已关闭');
      refetchScheduleConfig();
    },
    onError: (error) => {
      toast.error(`关闭失败: ${error.message}`);
    },
  });

  // 解决冲突mutation
  const resolveConflictMutation = trpc.amazonApi.resolveSyncConflict.useMutation({
    onSuccess: () => {
      toast.success('冲突已解决');
      refetchConflicts();
    },
    onError: (error) => {
      toast.error(`解决失败: ${error.message}`);
    },
  });

  // 添加到队列mutation
  const addToQueueMutation = trpc.amazonApi.addToSyncQueue.useMutation({
    onSuccess: () => {
      toast.success('已添加到同步队列');
      refetchQueue();
    },
    onError: (error) => {
      toast.error(`添加失败: ${error.message}`);
    },
  });

  // 取消任务mutation
  const cancelTaskMutation = trpc.amazonApi.cancelSyncTask.useMutation({
    onSuccess: () => {
      toast.success('任务已取消');
      refetchQueue();
    },
    onError: (error) => {
      toast.error(`取消失败: ${error.message}`);
    },
  });

  // Sync all mutation
  const syncAllMutation = trpc.amazonApi.syncAll.useMutation({
    onSuccess: (data) => {
      // 显示基本同步结果
      toast.success(`同步完成！广告活动: ${data.campaigns}, 广告组: ${data.adGroups}, 关键词: ${data.keywords}, 商品定位: ${data.targets}`);
      
      // 显示变更摘要
      if (data.changeSummary) {
        const cs = data.changeSummary;
        const changes = [];
        if (cs.campaignsCreated > 0) changes.push(`新增${cs.campaignsCreated}个广告活动`);
        if (cs.campaignsUpdated > 0) changes.push(`更新${cs.campaignsUpdated}个广告活动`);
        if (cs.adGroupsCreated > 0) changes.push(`新增${cs.adGroupsCreated}个广告组`);
        if (cs.adGroupsUpdated > 0) changes.push(`更新${cs.adGroupsUpdated}个广告组`);
        if (cs.keywordsCreated > 0) changes.push(`新增${cs.keywordsCreated}个关键词`);
        if (cs.keywordsUpdated > 0) changes.push(`更新${cs.keywordsUpdated}个关键词`);
        if (cs.conflictsDetected > 0) {
          toast(`检测到${cs.conflictsDetected}个数据冲突，请查看冲突列表`, { icon: '⚠️' });
        }
        if (changes.length > 0) {
          toast(`变更摘要: ${changes.join(', ')}`, { duration: 5000 });
        }
      }
      
      // 保存jobId用于查看详细变更
      if (data.jobId) {
        setSelectedSyncJobId(data.jobId);
      }
      
      refetchStatus();
      refetchSyncHistory();
      refetchConflicts();
    },
    onError: (error) => {
      toast.error(`同步失败: ${error.message}`);
    },
  });

  // Run optimization mutation
  const runOptimizationMutation = trpc.amazonApi.runAutoOptimization.useMutation({
    onSuccess: (data) => {
      toast.success(`优化完成！已优化: ${data.optimized}, 跳过: ${data.skipped}`);
    },
    onError: (error) => {
      toast.error(`优化失败: ${error.message}`);
    },
  });

  // Exchange authorization code for tokens mutation
  const exchangeCodeMutation = trpc.amazonApi.exchangeCode.useMutation({
    onSuccess: (data) => {
      if (data.success && data.refreshToken) {
        toast.success('Refresh Token获取成功！');
      }
    },
    onError: (error) => {
      toast.error(`换取失败: ${error.message}`);
    },
  });

  // Export accounts mutation
  const exportAccountsMutation = trpc.crossAccount.exportAccounts.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.data], { type: result.format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (error) => {
      toast.error(`导出失败: ${error.message}`);
    },
  });

  // Preview import mutation
  const previewImportMutation = trpc.crossAccount.previewImport.useMutation({
    onSuccess: (data) => {
      setImportPreview(data);
    },
    onError: (error) => {
      toast.error(`预览失败: ${error.message}`);
      setImportPreview(null);
    },
  });

  // Import accounts mutation
  const importAccountsMutation = trpc.crossAccount.importAccounts.useMutation({
    onSuccess: (result) => {
      toast.success(`导入完成！新增: ${result.imported}, 更新: ${result.updated}, 跳过: ${result.skipped}`);
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      setIsImportDialogOpen(false);
      setImportData("");
      setImportPreview(null);
    },
    onError: (error) => {
      toast.error(`导入失败: ${error.message}`);
    },
  });

  // 新的授权流程：只需要店铺名称，然后跳转到Amazon OAuth页面
  const handleAuthorizeAmazon = async () => {
    if (!formData.storeName) {
      toast.error("请输入店铺名称");
      return;
    }

    // 设置授权状态
    setAuthStep('oauth');
    
    // 调用最旧的授权流程，但不会选择市场
    // 稍后在授权回调中会自动为所有站点创建账号
    try {
      // 调用授权端点
      const result = await fetch('/api/trpc/auth.getAuthorizationUrl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json());
      
      if (result.result?.data?.url) {
        // 跳转Amazon OAuth页面
        window.location.href = result.result.data.url;
      }
    } catch (error) {
      toast.error("授权失败，请稍后重试");
      setAuthStep('idle');
    }
  };

  // 旧的创建账号流程（不再使用）
  const handleCreateAccount = async () => {
    if (!formData.accountId || !formData.accountName || !formData.marketplace) {
      toast.error("请填写必填字段");
      return;
    }

    const marketplace = MARKETPLACES.find(m => m.id === formData.marketplace);
    
    await createAccountMutation.mutateAsync({
      ...formData,
      marketplaceId: marketplace?.marketplaceId || formData.marketplaceId,
    });
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) return;
    
    await updateAccountMutation.mutateAsync({
      id: editingAccount.id,
      accountName: editingAccount.accountName,
      storeName: editingAccount.storeName,
      storeDescription: editingAccount.storeDescription,
      storeColor: editingAccount.storeColor,
      marketplace: editingAccount.marketplace,
      profileId: editingAccount.profileId,
      sellerId: editingAccount.sellerId,
    });
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm("确定要删除这个店铺账号吗？此操作不可恢复。")) return;
    await deleteAccountMutation.mutateAsync({ id });
  };

  const handleSetDefault = async (id: number) => {
    await setDefaultMutation.mutateAsync({ id });
  };

  const handleSaveCredentials = async () => {
    if (!selectedAccountId) {
      toast.error("请先选择广告账号");
      return;
    }
    
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken || !credentials.profileId) {
      toast.error("请填写所有必填字段");
      return;
    }

    setIsSaving(true);
    try {
      await saveCredentialsMutation.mutateAsync({
        accountId: selectedAccountId,
        ...credentials,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncAll = async () => {
    if (!selectedAccountId) {
      toast.error("请先选择广告账号");
      return;
    }

    setIsSyncing(true);
    setSyncProgress({
      step: 'sp',
      progress: 10,
      current: '正在同步 SP 商品推广广告...',
      results: { sp: 0, sb: 0, sd: 0, adGroups: 0, keywords: 0, targets: 0 }
    });

    try {
      // 模拟进度更新（因为API是一次性返回）
      const progressSteps = [
        { step: 'sp' as const, progress: 15, current: '正在同步 SP 商品推广广告...' },
        { step: 'sb' as const, progress: 30, current: '正在同步 SB 品牌广告...' },
        { step: 'sd' as const, progress: 45, current: '正在同步 SD 展示广告...' },
        { step: 'adgroups' as const, progress: 60, current: '正在同步广告组...' },
        { step: 'keywords' as const, progress: 75, current: '正在同步关键词...' },
        { step: 'targets' as const, progress: 90, current: '正在同步商品定位...' },
      ];

      // 启动进度动画
      let stepIndex = 0;
      const progressInterval = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setSyncProgress(prev => ({
            ...prev,
            step: progressSteps[stepIndex].step,
            progress: progressSteps[stepIndex].progress,
            current: progressSteps[stepIndex].current,
          }));
          stepIndex++;
        }
      }, 2000);

      const result = await syncAllMutation.mutateAsync({ 
        accountId: selectedAccountId,
        isIncremental: useIncrementalSync,
      });
      
      clearInterval(progressInterval);
      
      setSyncProgress({
        step: 'complete',
        progress: 100,
        current: '同步完成！',
        results: {
          sp: result.spCampaigns || 0,
          sb: result.sbCampaigns || 0,
          sd: result.sdCampaigns || 0,
          adGroups: result.adGroups || 0,
          keywords: result.keywords || 0,
          targets: result.targets || 0,
        }
      });

      // 3秒后重置进度
      setTimeout(() => {
        setSyncProgress({
          step: 'idle',
          progress: 0,
          current: '',
          results: { sp: 0, sb: 0, sd: 0, adGroups: 0, keywords: 0, targets: 0 }
        });
      }, 5000);
    } catch (error: any) {
      setSyncProgress(prev => ({
        ...prev,
        step: 'error',
        current: `同步失败: ${error.message || '未知错误'}`,
        error: error.message,
      }));
    } finally {
      setIsSyncing(false);
    }
  };

  const openEditDialog = (account: NonNullable<typeof accounts>[number]) => {
    setEditingAccount({
      id: account.id,
      accountId: account.accountId,
      accountName: account.accountName,
      storeName: account.storeName || "",
      storeDescription: account.storeDescription || "",
      storeColor: account.storeColor || "#3B82F6",
      marketplace: account.marketplace,
      marketplaceId: account.marketplaceId || "",
      profileId: account.profileId || "",
      sellerId: account.sellerId || "",
      isDefault: Boolean(account.isDefault),
    });
    setIsEditDialogOpen(true);
  };

  const getConnectionStatusBadge = (status: string | null) => {
    switch (status) {
      case 'connected':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />已连接</Badge>;
      case 'disconnected':
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />未连接</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />连接错误</Badge>;
      default:
        return <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" />待配置</Badge>;
    }
  };

  if (authLoading || accountsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* API连接状态监控 */}
        <ApiHealthMonitor showCard={false} />
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Amazon API 多账号管理</h1>
            <p className="text-muted-foreground mt-1">
              管理多个亚马逊卖家店铺账号，配置API凭证实现数据自动同步
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 导出按钮 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => exportAccountsMutation.mutate({ format: 'json' })}>
                  <FileJson className="h-4 w-4 mr-2" />
                  导出为JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAccountsMutation.mutate({ format: 'csv' })}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  导出为CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 导入按钮 */}
            <Button variant="outline" size="sm" onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              导入
            </Button>

            {/* 添加账号按钮 */}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleOpenAddDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  添加店铺账号
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>添加新店铺</DialogTitle>
                <DialogDescription>
                  输入店铺名称，然后通过Amazon OAuth授权。授权时可以选择要同步的站点（美国、加拿大、墨西哥等）。
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="storeName">店铺名称 *</Label>
                  <Input
                    id="storeName"
                    placeholder="例如：ElaraFit、My Store等"
                    value={formData.storeName}
                    onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                    className="text-base"
                  />
                  <p className="text-xs text-muted-foreground">
                    此名称将用于区分不同的店铺，所有授权的站点将显示在这个店铺下
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>店铺标识颜色（可选）</Label>
                  <div className="flex gap-2 flex-wrap">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          formData.storeColor === color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setFormData({ ...formData, storeColor: color })}
                      />
                    ))}
                    <Input
                      type="color"
                      value={formData.storeColor}
                      onChange={(e) => setFormData({ ...formData, storeColor: e.target.value })}
                      className="w-8 h-8 p-0 border-0 cursor-pointer"
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <p className="text-sm font-medium">下一步：授权Amazon API</p>
                  <p className="text-sm text-muted-foreground">
                    点击下方按鐐，将跳转到Amazon授权页面。在授权页面中，您可以选择要同步的所有站点。授权成功后，系统会自动为这些站点创建账号。
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleCloseAddDialog()}>
                  取消
                </Button>
                <Button 
                  onClick={handleAuthorizeAmazon}
                  disabled={!formData.storeName || authStep !== 'idle'}
                >
                  {authStep === 'oauth' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {authStep === 'oauth' ? '授权中...' : '授权Amazon API'}
                </Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards */}
        {accountStats && (
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">总账号数</p>
                    <p className="text-2xl font-bold">{accountStats.total}</p>
                  </div>
                  <Store className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">已连接</p>
                    <p className="text-2xl font-bold text-green-500">{accountStats.connected}</p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border-yellow-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">待配置</p>
                    <p className="text-2xl font-bold text-yellow-500">{accountStats.pending}</p>
                  </div>
                  <Settings className="h-8 w-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">连接错误</p>
                    <p className="text-2xl font-bold text-red-500">{accountStats.error}</p>
                  </div>
                  <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">市场覆盖</p>
                    <p className="text-2xl font-bold text-purple-500">{Object.keys(accountStats.byMarketplace).length}</p>
                  </div>
                  <Globe className="h-8 w-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="accounts">店铺账号列表</TabsTrigger>
            <TabsTrigger value="api-config" disabled={!selectedAccountId}>API配置</TabsTrigger>
            <TabsTrigger value="sync" disabled={!selectedAccountId}>数据同步</TabsTrigger>
            <TabsTrigger value="guide">接入指南</TabsTrigger>
          </TabsList>

          {/* Accounts List Tab */}
          <TabsContent value="accounts" className="space-y-4">
            {accounts && accounts.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {/* 按店铺名称分组显示多站点 */}
                {(() => {
                  // 按storeName分组
                  const groupedAccounts = accounts.reduce((groups, account) => {
                    const groupKey = account.storeName || account.accountName || 'default';
                    if (!groups[groupKey]) {
                      groups[groupKey] = [];
                    }
                    groups[groupKey].push(account);
                    return groups;
                  }, {} as Record<string, typeof accounts>);

                  return Object.entries(groupedAccounts).map(([storeName, storeAccounts]) => {
                    const primaryAccount = storeAccounts.find(a => a.isDefault) || storeAccounts[0];
                    const hasMultipleMarkets = storeAccounts.length > 1;
                    const isAnySelected = storeAccounts.some(a => a.id === selectedAccountId);
                    
                    return (
                      <Card 
                        key={storeName} 
                        className={`relative transition-all hover:shadow-lg ${
                          isAnySelected ? 'ring-2 ring-primary' : ''
                        }`}
                      >
                        {/* Color indicator */}
                        <div 
                          className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
                          style={{ backgroundColor: primaryAccount.storeColor || '#3B82F6' }}
                        />
                        
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                                style={{ backgroundColor: primaryAccount.storeColor || '#3B82F6' }}
                              >
                                {storeName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                  {storeName}
                                  {!!primaryAccount.isDefault && (
                                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                  )}
                                </CardTitle>
                                <CardDescription className="text-xs">
                                  {hasMultipleMarkets 
                                    ? `${storeAccounts.length} 个站点`
                                    : (() => {
                                        const mp = MARKETPLACES.find(m => m.id === primaryAccount.marketplace);
                                        return `${mp?.flag || ''} ${mp?.name || primaryAccount.marketplace}`;
                                      })()
                                  }
                                </CardDescription>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(primaryAccount); }}>
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  编辑店铺信息
                                </DropdownMenuItem>
                                {!primaryAccount.isDefault && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSetDefault(primaryAccount.id); }}>
                                    <Star className="h-4 w-4 mr-2" />
                                    设为默认
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-red-500"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteAccount(primaryAccount.id); }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  删除店铺
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {/* 站点列表 */}
                            <div className="space-y-2">
                              {storeAccounts.map((account) => {
                                const marketplace = MARKETPLACES.find(m => m.id === account.marketplace);
                                const isSelected = selectedAccountId === account.id;
                                return (
                                  <div 
                                    key={account.id}
                                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                                      isSelected 
                                        ? 'bg-primary/10 border border-primary/30' 
                                        : 'hover:bg-muted/50 border border-transparent'
                                    }`}
                                    onClick={() => setSelectedAccountId(account.id)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-lg">{marketplace?.flag || '🌐'}</span>
                                      <div>
                                        <div className="text-sm font-medium flex items-center gap-1">
                                          {marketplace?.name || account.marketplace}
                                          {!!account.isDefault && (
                                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">
                                          {account.accountId}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {getConnectionStatusBadge(account.connectionStatus)}
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                          <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <MoreVertical className="h-3 w-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem 
                                            onClick={(e) => { 
                                              e.stopPropagation(); 
                                              setSelectedAccountId(account.id);
                                              setActiveTab("api-config");
                                            }}
                                          >
                                            <Key className="h-4 w-4 mr-2" />
                                            配置API
                                          </DropdownMenuItem>
                                          <DropdownMenuItem 
                                            onClick={(e) => { 
                                              e.stopPropagation(); 
                                              setSelectedAccountId(account.id);
                                              setActiveTab("sync");
                                            }}
                                          >
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                            数据同步
                                          </DropdownMenuItem>
                                          {!account.isDefault && (
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSetDefault(account.id); }}>
                                              <Star className="h-4 w-4 mr-2" />
                                              设为默认
                                            </DropdownMenuItem>
                                          )}
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem 
                                            className="text-red-500"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            移除站点
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {/* 店铺描述 */}
                            {primaryAccount.storeDescription && (
                              <p className="text-xs text-muted-foreground pt-2 border-t line-clamp-2">
                                {primaryAccount.storeDescription}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  });
                })()}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Store className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">还没有添加店铺账号</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    添加您的亚马逊卖家店铺账号，开始管理广告数据
                  </p>
                  <Button onClick={handleOpenAddDialog}>
                    <Plus className="h-4 w-4 mr-2" />
                    添加第一个店铺
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* API Config Tab */}
          <TabsContent value="api-config" className="space-y-4">
            {selectedAccount && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: selectedAccount.storeColor || '#3B82F6' }}
                      >
                        {(selectedAccount.storeName || selectedAccount.accountName).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle>{selectedAccount.storeName || selectedAccount.accountName}</CardTitle>
                        <CardDescription>配置此账号的Amazon Advertising API凭证</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {credentialsStatus && (
                      <div className="mb-6 flex items-center gap-4">
                        <Badge variant={credentialsStatus.hasCredentials ? "default" : "secondary"}>
                          {credentialsStatus.hasCredentials ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              API已配置
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 mr-1" />
                              API未配置
                            </>
                          )}
                        </Badge>
                        {credentialsStatus.region && (
                          <Badge variant="outline">区域: {credentialsStatus.region}</Badge>
                        )}
                        {credentialsStatus.lastSyncAt && (
                          <span className="text-sm text-muted-foreground">
                            上次同步: {new Date(credentialsStatus.lastSyncAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Key className="h-5 w-5" />
                      API凭证配置
                    </CardTitle>
                    <CardDescription>
                      输入您的Amazon Advertising API凭证信息
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="clientId">Client ID *</Label>
                        <Input
                          id="clientId"
                          placeholder="amzn1.application-oa2-client.xxx"
                          value={credentials.clientId}
                          onChange={(e) => setCredentials({ ...credentials, clientId: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          从Amazon Developer Console获取的应用程序ID
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="clientSecret">Client Secret *</Label>
                        <Input
                          id="clientSecret"
                          type="password"
                          placeholder="输入Client Secret"
                          value={credentials.clientSecret}
                          onChange={(e) => setCredentials({ ...credentials, clientSecret: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          应用程序的密钥，请妥善保管
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="refreshToken">Refresh Token *</Label>
                        <Input
                          id="refreshToken"
                          type="password"
                          placeholder="Atzr|xxx"
                          value={credentials.refreshToken}
                          onChange={(e) => setCredentials({ ...credentials, refreshToken: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          OAuth授权后获得的刷新令牌
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="credProfileId">Profile ID *</Label>
                        <Input
                          id="credProfileId"
                          placeholder="1234567890"
                          value={credentials.profileId}
                          onChange={(e) => setCredentials({ ...credentials, profileId: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Amazon广告账号的Profile ID
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="region">API区域 *</Label>
                        <Select
                          value={credentials.region}
                          onValueChange={(value: "NA" | "EU" | "FE") => 
                            setCredentials({ ...credentials, region: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择API区域" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NA">北美 (NA) - 美国、加拿大、墨西哥、巴西</SelectItem>
                            <SelectItem value="EU">欧洲 (EU) - 英国、德国、法国、意大利、西班牙等</SelectItem>
                            <SelectItem value="FE">远东 (FE) - 日本、澳大利亚、新加坡</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          根据您的市场选择对应的API区域
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button onClick={handleSaveCredentials} disabled={isSaving}>
                        {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        保存凭证
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* OAuth授权卡片 */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ExternalLink className="h-5 w-5" />
                      快速授权（推荐）
                    </CardTitle>
                    <CardDescription>
                      使用预配置的开发者账户快速完成OAuth授权，获取Refresh Token
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>授权说明</AlertTitle>
                      <AlertDescription>
                        点击下方按钮将跳转到Amazon登录页面进行授权。授权成功后，您将被重定向到回调地址，
                        请从回调URL中复制授权码(code)，然后在下方输入框中粘贴以换取Refresh Token。
                      </AlertDescription>
                    </Alert>

                    <Alert className="bg-blue-900/20 border-blue-500/30 mb-4">
                      <Info className="h-4 w-4 text-blue-400" />
                      <AlertDescription className="text-blue-200 text-sm">
                        <strong>区域说明：</strong>授权后您将获得该区域内<strong>所有站点</strong>的广告数据访问权限。
                        例如，点击北美区域将同时授权美国、加拿大、墨西哥、巴西四个站点。
                      </AlertDescription>
                    </Alert>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Button 
                        variant="outline" 
                        className={`h-auto py-4 flex-col gap-2 ${credentials.region === 'NA' ? 'border-primary bg-primary/10' : ''}`}
                        onClick={() => {
                          setCredentials({ ...credentials, region: 'NA' });
                          window.open(
                            `https://www.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                            '_blank'
                          );
                          toast.success('已打开北美区域授权页面，授权后将获得美国、加拿大、墨西哥、巴西站点的数据访问权限');
                        }}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">🇺🇸 北美区域 (NA)</span>
                        <span className="text-xs text-muted-foreground">包含: 🇺🇸美国 🇨加拿大 🇲墨西哥 🇧巴西</span>
                      </Button>
                      <Button 
                        variant="outline" 
                        className={`h-auto py-4 flex-col gap-2 ${credentials.region === 'EU' ? 'border-primary bg-primary/10' : ''}`}
                        onClick={() => {
                          setCredentials({ ...credentials, region: 'EU' });
                          window.open(
                            `https://eu.account.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                            '_blank'
                          );
                          toast.success('已打开欧洲区域授权页面，授权后将获得英国、德国、法国等站点的数据访问权限');
                        }}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">🇪🇺 欧洲区域 (EU)</span>
                        <span className="text-xs text-muted-foreground">包含: 🇬英国 🇩德国 🇫法国 🇮意大利 🇪西班牙等</span>
                      </Button>
                      <Button 
                        variant="outline" 
                        className={`h-auto py-4 flex-col gap-2 ${credentials.region === 'FE' ? 'border-primary bg-primary/10' : ''}`}
                        onClick={() => {
                          setCredentials({ ...credentials, region: 'FE' });
                          window.open(
                            `https://apac.account.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                            '_blank'
                          );
                          toast.success('已打开远东区域授权页面，授权后将获得日本、澳大利亚、新加坡站点的数据访问权限');
                        }}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">🌏 远东区域 (FE)</span>
                        <span className="text-xs text-muted-foreground">包含: 🇯日本 🇦澳大利亚 🇸新加坡</span>
                      </Button>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h4 className="font-medium">换取Refresh Token</h4>
                      <p className="text-sm text-muted-foreground">
                        授权成功后，您将被重定向到 <code className="bg-muted px-1 rounded">https://sellerps.com?code=xxx</code>，
                        请复制URL中的code参数值并粘贴到下方输入框：
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="粘贴授权码 (code)"
                          id="authCode"
                          className="flex-1"
                        />
                        <Button 
                          onClick={async () => {
                            const codeInput = document.getElementById('authCode') as HTMLInputElement;
                            const code = codeInput?.value;
                            if (!code) {
                              toast.error('请输入授权码');
                              return;
                            }
                            try {
                              // 步骤1: 换取Token
                              setAuthStep('exchanging');
                              setAuthProgress(25);
                              
                              // 使用后端环境变量中的凭证，确保安全性
                              const result = await exchangeCodeMutation.mutateAsync({
                                code,
                                region: credentials.region, // 传递当前选择的区域
                              });
                              
                              if (result.success && result.refreshToken) {
                                setAuthProgress(50);
                                
                                // 自动填充所有凭证字段 - 优先使用服务器返回的凭证
                                const newCredentials: typeof credentials = {
                                  // 优先使用服务器返回的凭证，回退到当前状态
                                  clientId: result.clientId || credentials.clientId,
                                  clientSecret: result.clientSecret || credentials.clientSecret,
                                  refreshToken: result.refreshToken,
                                  // 如果获取到了Profile列表，自动选择第一个，否则保持当前选择
                                  profileId: (result.profiles && result.profiles.length > 0) 
                                    ? result.profiles[0].profileId 
                                    : credentials.profileId,
                                  region: credentials.region,
                                };
                                
                                console.log('[Auth] 换取Token成功，新凭证:', {
                                  clientIdPrefix: newCredentials.clientId?.substring(0, 30) + '...',
                                  hasClientSecret: !!newCredentials.clientSecret,
                                  hasRefreshToken: !!newCredentials.refreshToken,
                                  profileId: newCredentials.profileId,
                                  region: newCredentials.region,
                                });
                                
                                // 检查必填字段
                                if (!newCredentials.clientId || !newCredentials.clientSecret) {
                                  toast.error('缺少Client ID或Client Secret，请检查系统配置');
                                  setAuthStep('idle');
                                  setAuthProgress(0);
                                  return;
                                }
                                
                                if (!newCredentials.profileId) {
                                  toast.error('缺少Profile ID，请选择一个广告配置文件');
                                  setAuthStep('idle');
                                  setAuthProgress(0);
                                  return;
                                }
                                
                                setCredentials(newCredentials);
                                setAuthProgress(75);
                                
                                // 步骤2: 自动保存凭证 - 支持多站点
                                setAuthStep('saving');
                                
                                // 如果检测到多个profiles，自动为所有站点创建账号
                                if (result.profiles && result.profiles.length > 0) {
                                  // 使用当前表单中的店铺名称，如果没有则使用默认名称
                                  const storeName = formData.storeName || '我的店铺';
                                  
                                  await saveMultipleProfilesMutation.mutateAsync({
                                    storeName,
                                    clientId: newCredentials.clientId,
                                    clientSecret: newCredentials.clientSecret,
                                    refreshToken: newCredentials.refreshToken,
                                    region: newCredentials.region,
                                    profiles: result.profiles.map(p => ({
                                      profileId: p.profileId,
                                      countryCode: p.countryCode,
                                      currencyCode: (p as any).currencyCode || 'USD',
                                      accountName: (p as any).accountInfo?.name || p.accountName || storeName,
                                    })),
                                  });
                                } else if (selectedAccountId) {
                                  // 如果只有一个profile或已选择账号，使用原有逻辑
                                  await saveCredentialsMutation.mutateAsync({
                                    accountId: selectedAccountId,
                                    ...newCredentials,
                                  });
                                }
                                
                                setAuthProgress(100);
                                setAuthStep('complete');
                                
                                toast.success(
                                  result.profiles && result.profiles.length > 0
                                    ? `授权完成！已自动创建 ${result.profiles.length} 个站点账号并同步数据。`
                                    : '授权完成！已自动保存凭证。'
                                );
                                
                                codeInput.value = '';
                                
                                // 3秒后重置状态
                                setTimeout(() => {
                                  setAuthStep('idle');
                                  setAuthProgress(0);
                                }, 3000);
                              }
                            } catch (error: any) {
                              setAuthStep('error');
                              setAuthError({
                                step: '换取Token',
                                message: error.message || '授权码无效或已过期',
                                canRetry: true
                              });
                              toast.error(`换取失败: ${error.message}`);
                            }
                          }}
                          disabled={authStep !== 'idle' && authStep !== 'error'}
                        >
                          {authStep !== 'idle' && authStep !== 'error' ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Key className="h-4 w-4 mr-2" />
                          )}
                          {authStep === 'idle' && '换取Token'}
                          {authStep === 'error' && '重试换取'}
                          {authStep === 'exchanging' && '换取中...'}
                          {authStep === 'saving' && '保存中...'}
                          {authStep === 'syncing' && '同步中...'}
                          {authStep === 'complete' && '完成!'}
                        </Button>
                      </div>
                      
                      {/* 授权进度指示器 - 增强版 */}
                      {authStep !== 'idle' && (
                        <div className={`mt-6 p-4 rounded-lg border ${
                          authStep === 'error' 
                            ? 'bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/30 dark:to-orange-950/30 border-red-200 dark:border-red-800'
                            : 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800'
                        }`}>
                          {/* 标题 */}
                          <div className="flex items-center gap-2 mb-4">
                            <div className="relative">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                                authStep === 'error' ? 'bg-red-500/20' : 'bg-primary/20'
                              }`}>
                                {authStep === 'complete' ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : authStep === 'error' ? (
                                  <XCircle className="h-5 w-5 text-red-500" />
                                ) : (
                                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                )}
                              </div>
                            </div>
                            <div>
                              <h4 className={`font-semibold text-sm ${authStep === 'error' ? 'text-red-600 dark:text-red-400' : ''}`}>
                                {authStep === 'complete' ? '授权完成' : authStep === 'error' ? '授权失败' : '正在授权...'}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {authStep === 'exchanging' && '步骤 1/4: 正在与亚马逊服务器通信'}
                                {authStep === 'saving' && '步骤 3/4: 正在保存凭证并同步数据'}
                                {authStep === 'syncing' && '步骤 4/4: 正在拉取广告数据'}
                                {authStep === 'complete' && '所有步骤已完成'}
                                {authStep === 'error' && authError && `失败于: ${authError.step}`}
                              </p>
                            </div>
                          </div>
                          
                          {/* 进度条 */}
                          <div className="relative mb-4">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                              <div 
                                className={`h-3 rounded-full transition-all duration-700 ease-out ${
                                  authStep === 'complete' 
                                    ? 'bg-gradient-to-r from-green-400 to-green-500' 
                                    : authStep === 'error'
                                      ? 'bg-gradient-to-r from-red-400 to-red-500'
                                      : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                                }`}
                                style={{ width: `${authProgress}%` }}
                              />
                            </div>
                            <div className={`absolute right-0 top-0 -mt-1 text-xs font-medium ${
                              authStep === 'error' ? 'text-red-500' : 'text-primary'
                            }`}>
                              {authProgress}%
                            </div>
                          </div>
                          
                          {/* 步骤指示器 */}
                          <div className="grid grid-cols-4 gap-2">
                            {/* 步骤1: 生成链接 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 10 
                                  ? 'bg-green-500 text-white' 
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                              }`}>
                                {authProgress >= 10 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : (
                                  <span className="text-xs font-bold">1</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 10 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'
                              }`}>
                                生成链接
                              </span>
                            </div>
                            
                            {/* 步骤2: 换取Token */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 50 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'exchanging' 
                                    ? 'bg-blue-500 text-white animate-pulse' 
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                              }`}>
                                {authProgress >= 50 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'exchanging' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">2</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 50 
                                  ? 'text-green-600 dark:text-green-400 font-medium' 
                                  : authStep === 'exchanging' 
                                    ? 'text-blue-600 dark:text-blue-400 font-medium' 
                                    : 'text-muted-foreground'
                              }`}>
                                换取Token
                              </span>
                            </div>
                            
                            {/* 步骤3: 保存凭证 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 75 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'saving' 
                                    ? 'bg-blue-500 text-white animate-pulse' 
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                              }`}>
                                {authProgress >= 75 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'saving' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">3</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 75 
                                  ? 'text-green-600 dark:text-green-400 font-medium' 
                                  : authStep === 'saving' 
                                    ? 'text-blue-600 dark:text-blue-400 font-medium' 
                                    : 'text-muted-foreground'
                              }`}>
                                保存凭证
                              </span>
                            </div>
                            
                            {/* 步骤4: 同步数据 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 100 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'syncing' 
                                    ? 'bg-blue-500 text-white animate-pulse' 
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                              }`}>
                                {authProgress >= 100 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'syncing' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">4</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 100 
                                  ? 'text-green-600 dark:text-green-400 font-medium' 
                                  : authStep === 'syncing' 
                                    ? 'text-blue-600 dark:text-blue-400 font-medium' 
                                    : 'text-muted-foreground'
                              }`}>
                                同步数据
                              </span>
                            </div>
                          </div>
                          
                          {/* 当前操作详情 */}
                          <div className="mt-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-md">
                            <div className="flex items-center gap-2 text-sm">
                              {authStep !== 'complete' && authStep !== 'error' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                              {authStep === 'complete' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                              {authStep === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                              <span className={
                                authStep === 'complete' ? 'text-green-600 dark:text-green-400' : 
                                authStep === 'error' ? 'text-red-600 dark:text-red-400' : 
                                'text-muted-foreground'
                              }>
                                {authStep === 'exchanging' && '正在与 Amazon Advertising API 通信，换取访问令牌...'}
                                {authStep === 'saving' && '正在验证凭证并保存到数据库，同时同步广告数据...'}
                                {authStep === 'syncing' && '正在从亚马逊拉取 SP/SB/SD 广告活动数据...'}
                                {authStep === 'complete' && '授权流程已完成！您现在可以开始管理广告了。'}
                                {authStep === 'error' && authError && authError.message}
                              </span>
                            </div>
                          </div>
                          
                          {/* 错误恢复操作 */}
                          {authStep === 'error' && authError && (
                            <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/30 rounded-md border border-red-200 dark:border-red-800">
                              <h5 className="font-medium text-red-700 dark:text-red-400 mb-2">授权失败</h5>
                              <p className="text-sm text-red-600 dark:text-red-300 mb-3">
                                {authError.step === '换取Token' && '授权码无效或已过期。请重新生成授权链接并完成授权，然后立即粘贴新的授权码。'}
                                {authError.step === '保存凭证' && '凭证保存失败。请检查网络连接并重试。'}
                                {authError.step === '同步数据' && '数据同步失败。您可以稍后在“数据同步”标签中手动同步。'}
                              </p>
                              <div className="flex gap-2">
                                {authError.canRetry && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-red-300 text-red-700 hover:bg-red-100"
                                    onClick={() => {
                                      setAuthStep('idle');
                                      setAuthProgress(0);
                                      setAuthError(null);
                                    }}
                                  >
                                    <RefreshCw className="h-4 w-4 mr-1" />
                                    重新开始
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={() => {
                                    setAuthStep('idle');
                                    setAuthProgress(0);
                                    setAuthError(null);
                                  }}
                                >
                                  关闭
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Alert variant="default" className="bg-amber-50 border-amber-200">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-800">回调地址说明</AlertTitle>
                      <AlertDescription className="text-amber-700">
                        当前配置的回调地址为 <code className="bg-amber-100 px-1 rounded">https://sellerps.com</code>。
                        授权成功后您将被重定向到该地址，请从浏览器地址栏复制完整的URL中的code参数。
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>

                {/* 紫鸟浏览器专用手动授权卡片 */}
                <Card className="border-purple-500/30 bg-purple-950/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-400">
                      <Shield className="h-5 w-5" />
                      紫鸟浏览器专用授权（中国大陆卖家）
                    </CardTitle>
                    <CardDescription>
                      如果您使用紫鸟浏览器管理亚马逊店铺，请使用此方式完成授权
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Alert className="bg-purple-900/30 border-purple-500/30">
                      <Info className="h-4 w-4 text-purple-400" />
                      <AlertTitle className="text-purple-300">授权流程说明</AlertTitle>
                      <AlertDescription className="text-purple-200 space-y-2">
                        <p><strong>步骤1:</strong> 复制下方的授权链接</p>
                        <p><strong>步骤2:</strong> 在紫鸟浏览器中打开该链接，登录您的亚马逊卖家账户并授权</p>
                        <p><strong>步骤3:</strong> 授权完成后，从浏览器地址栏复制<strong>完整的URL</strong></p>
                        <p><strong>步骤4:</strong> 将复制的URL粘贴到下方输入框，系统会自动提取授权码</p>
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-3">
                      <Label className="text-purple-400 font-medium">选择市场区域并复制授权链接</Label>
                      <Alert className="bg-yellow-900/20 border-yellow-500/30 mb-3">
                        <AlertCircle className="h-4 w-4 text-yellow-400" />
                        <AlertDescription className="text-yellow-200 text-sm">
                          <strong>重要提示：</strong>授权后您将获得该区域内<strong>所有站点</strong>的广告数据访问权限。
                          例如，选择北美区域将同时获得美国、加拿大、墨西哥、巴西四个站点的授权。
                        </AlertDescription>
                      </Alert>
                      <div className="grid gap-3">
                        {[
                          { 
                            region: 'NA' as const, 
                            name: '🇺🇸 北美区域 (NA)', 
                            desc: '包含站点：美国 (US)、加拿大 (CA)、墨西哥 (MX)、巴西 (BR)', 
                            url: 'https://www.amazon.com/ap/oa',
                            sites: [
                              { flag: '🇺🇸', name: '美国', code: 'US' },
                              { flag: '🇨🇦', name: '加拿大', code: 'CA' },
                              { flag: '🇲🇽', name: '墨西哥', code: 'MX' },
                              { flag: '🇧🇷', name: '巴西', code: 'BR' },
                            ]
                          },
                          { 
                            region: 'EU' as const, 
                            name: '🇪🇺 欧洲区域 (EU)', 
                            desc: '包含站点：英国 (UK)、德国 (DE)、法国 (FR)、意大利 (IT)、西班牙 (ES) 等', 
                            url: 'https://eu.account.amazon.com/ap/oa',
                            sites: [
                              { flag: '🇬🇧', name: '英国', code: 'UK' },
                              { flag: '🇩🇪', name: '德国', code: 'DE' },
                              { flag: '🇫🇷', name: '法国', code: 'FR' },
                              { flag: '🇮🇹', name: '意大利', code: 'IT' },
                              { flag: '🇪🇸', name: '西班牙', code: 'ES' },
                              { flag: '🇳🇱', name: '荷兰', code: 'NL' },
                              { flag: '🇸🇪', name: '瑞典', code: 'SE' },
                              { flag: '🇵🇱', name: '波兰', code: 'PL' },
                            ]
                          },
                          { 
                            region: 'FE' as const, 
                            name: '🌏 远东区域 (FE)', 
                            desc: '包含站点：日本 (JP)、澳大利亚 (AU)、新加坡 (SG)', 
                            url: 'https://apac.account.amazon.com/ap/oa',
                            sites: [
                              { flag: '🇯🇵', name: '日本', code: 'JP' },
                              { flag: '🇦🇺', name: '澳大利亚', code: 'AU' },
                              { flag: '🇸🇬', name: '新加坡', code: 'SG' },
                            ]
                          },
                        ].map((item) => {
                          const authUrl = `${item.url}?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`;
                          const isSelected = credentials.region === item.region;
                          return (
                            <div 
                              key={item.region} 
                              className={`p-4 rounded-lg border transition-all cursor-pointer ${
                                isSelected 
                                  ? 'bg-purple-600/30 border-purple-400' 
                                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/50'
                              }`}
                              onClick={() => setCredentials({ ...credentials, region: item.region })}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                    isSelected ? 'border-purple-400 bg-purple-400' : 'border-purple-500'
                                  }`}>
                                    {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                                  </div>
                                  <span className="font-semibold text-purple-200">{item.name}</span>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-purple-500/30 text-purple-300 hover:bg-purple-900/30"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCredentials({ ...credentials, region: item.region });
                                    navigator.clipboard.writeText(authUrl);
                                    toast.success(
                                      <div>
                                        <strong>{item.name}</strong>授权链接已复制！<br/>
                                        <span className="text-sm">授权后将获得以下站点数据访问权限：<br/>
                                        {item.sites.map(s => `${s.flag} ${s.name}`).join('、')}</span>
                                      </div>
                                    );
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  复制链接
                                </Button>
                              </div>
                              <div className="text-xs text-purple-400 mb-2">{item.desc}</div>
                              <div className="flex flex-wrap gap-1">
                                {item.sites.map(site => (
                                  <span key={site.code} className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-900/40 rounded text-xs text-purple-300">
                                    {site.flag} {site.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <Separator className="bg-purple-500/20" />

                    <div className="space-y-3">
                      <Label className="text-purple-400 font-medium">粘贴授权完成后的URL</Label>
                      <p className="text-sm text-purple-300">
                        授权完成后，浏览器地址栏会显示类似 <code className="bg-purple-900/50 px-1 rounded">https://sellerps.com?code=ANxxxxxx&scope=...</code> 的URL，
                        请复制完整的URL粘贴到下方：
                      </p>
                      <Textarea
                        placeholder="粘贴完整的回调URL，例如: https://sellerps.com?code=ANxxxxxx&scope=advertising::campaign_management"
                        id="manualAuthUrl"
                        className="min-h-[80px] font-mono text-sm bg-purple-900/20 border-purple-500/30"
                      />
                      <Button 
                        className="w-full bg-purple-600 hover:bg-purple-700"
                        onClick={async () => {
                          const urlInput = document.getElementById('manualAuthUrl') as HTMLTextAreaElement;
                          const inputValue = urlInput?.value?.trim();
                          if (!inputValue) {
                            toast.error('请粘贴授权完成后的URL');
                            return;
                          }
                          
                          // 尝试从 URL 中提取 code
                          let code = '';
                          try {
                            const url = new URL(inputValue);
                            code = url.searchParams.get('code') || '';
                          } catch {
                            // 如果不是有效URL，尝试直接使用输入值作为code
                            code = inputValue;
                          }
                          
                          if (!code) {
                            toast.error('无法从 URL 中提取授权码。请确保复制了完整的回调 URL。');
                            return;
                          }
                          
                          try {
                            // 步骤1: 换取Token
                            setAuthStep('exchanging');
                            setAuthProgress(25);
                            
                            // 使用后端环境变量中的凭证，确保安全性
                            const result = await exchangeCodeMutation.mutateAsync({
                              code,
                              region: credentials.region, // 传递当前选择的区域
                            });
                            
                            if (result.success && result.refreshToken) {
                              setAuthProgress(50);
                              
                              // 自动填充所有凭证字段 - 优先使用服务器返回的凭证
                              const newCredentials: typeof credentials = {
                                // 优先使用服务器返回的凭证，回退到当前状态
                                clientId: result.clientId || credentials.clientId,
                                clientSecret: result.clientSecret || credentials.clientSecret,
                                refreshToken: result.refreshToken,
                                // 如果获取到了Profile列表，自动选择第一个，否则保持当前选择
                                profileId: (result.profiles && result.profiles.length > 0) 
                                  ? result.profiles[0].profileId 
                                  : credentials.profileId,
                                region: credentials.region,
                              };
                              
                              console.log('[Auth] 紫鸟浏览器授权成功，新凭证:', {
                                clientIdPrefix: newCredentials.clientId?.substring(0, 30) + '...',
                                hasClientSecret: !!newCredentials.clientSecret,
                                hasRefreshToken: !!newCredentials.refreshToken,
                                profileId: newCredentials.profileId,
                                region: newCredentials.region,
                              });
                              
                              // 检查必填字段
                              if (!newCredentials.clientId || !newCredentials.clientSecret) {
                                toast.error('缺少Client ID或Client Secret，请检查系统配置');
                                setAuthStep('idle');
                                setAuthProgress(0);
                                return;
                              }
                              
                              if (!newCredentials.profileId) {
                                toast.error('缺少Profile ID，请选择一个广告配置文件');
                                setAuthStep('idle');
                                setAuthProgress(0);
                                return;
                              }
                              
                              setCredentials(newCredentials);
                              setAuthProgress(75);
                              
                              // 步骤2: 自动保存凭证 - 支持多站点
                              setAuthStep('saving');
                              
                              // 如果检测到多个profiles，自动为所有站点创建账号
                              if (result.profiles && result.profiles.length > 0) {
                                const storeName = formData.storeName || '我的店铺';
                                
                                await saveMultipleProfilesMutation.mutateAsync({
                                  storeName,
                                  clientId: newCredentials.clientId,
                                  clientSecret: newCredentials.clientSecret,
                                  refreshToken: newCredentials.refreshToken,
                                  region: newCredentials.region,
                                  profiles: result.profiles.map(p => ({
                                    profileId: p.profileId,
                                    countryCode: p.countryCode,
                                    currencyCode: (p as any).currencyCode || 'USD',
                                    accountName: (p as any).accountInfo?.name || p.accountName || storeName,
                                  })),
                                });
                              } else if (selectedAccountId) {
                                await saveCredentialsMutation.mutateAsync({
                                  accountId: selectedAccountId,
                                  ...newCredentials,
                                });
                              }
                              
                              setAuthProgress(100);
                              setAuthStep('complete');
                              
                              toast.success(
                                result.profiles && result.profiles.length > 0
                                  ? `授权完成！已自动创建 ${result.profiles.length} 个站点账号并同步数据。`
                                  : '授权完成！已自动保存凭证。'
                              );
                              
                              urlInput.value = '';
                              
                              // 3秒后重置状态
                              setTimeout(() => {
                                setAuthStep('idle');
                                setAuthProgress(0);
                              }, 3000);
                            }
                          } catch (error: any) {
                            setAuthStep('error');
                            setAuthError({
                              step: '换取Token',
                              message: error.message || '授权码无效或已过期',
                              canRetry: true
                            });
                            toast.error(`授权失败: ${error.message}`);
                          }
                        }}
                        disabled={authStep !== 'idle' && authStep !== 'error'}
                      >
                        {authStep !== 'idle' && authStep !== 'error' ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Key className="h-4 w-4 mr-2" />
                        )}
                        {authStep === 'idle' && '提取授权码并换取 Token'}
                        {authStep === 'error' && '重试授权'}
                        {authStep === 'exchanging' && '正在换取Token...'}
                        {authStep === 'saving' && '正在保存凭证...'}
                        {authStep === 'syncing' && '正在同步数据...'}
                        {authStep === 'complete' && '授权完成!'}
                      </Button>
                      
                      {/* 授权进度指示器 - 增强版 (紫鸟浏览器专用) */}
                      {authStep !== 'idle' && (
                        <div className="mt-6 p-4 bg-gradient-to-r from-purple-900/40 to-indigo-900/40 rounded-lg border border-purple-500/30">
                          {/* 标题 */}
                          <div className="flex items-center gap-2 mb-4">
                            <div className="relative">
                              <div className="h-8 w-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                                {authStep === 'complete' ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                                ) : (
                                  <Loader2 className="h-5 w-5 text-purple-400 animate-spin" />
                                )}
                              </div>
                            </div>
                            <div>
                              <h4 className="font-semibold text-sm text-purple-100">
                                {authStep === 'complete' ? '授权完成' : '正在授权...'}
                              </h4>
                              <p className="text-xs text-purple-300">
                                {authStep === 'exchanging' && '步骤 1/4: 正在与亚马逊服务器通信'}
                                {authStep === 'saving' && '步骤 3/4: 正在保存凭证并同步数据'}
                                {authStep === 'syncing' && '步骤 4/4: 正在拉取广告数据'}
                                {authStep === 'complete' && '所有步骤已完成'}
                                {authStep === 'error' && authError && `失败于: ${authError.step}`}
                              </p>
                            </div>
                          </div>
                          
                          {/* 进度条 */}
                          <div className="relative mb-4">
                            <div className="w-full bg-purple-900/50 rounded-full h-3 overflow-hidden">
                              <div 
                                className={`h-3 rounded-full transition-all duration-700 ease-out ${
                                  authStep === 'complete' 
                                    ? 'bg-gradient-to-r from-green-400 to-green-500' 
                                    : 'bg-gradient-to-r from-purple-400 to-indigo-400'
                                }`}
                                style={{ width: `${authProgress}%` }}
                              />
                            </div>
                            <div className="absolute right-0 top-0 -mt-1 text-xs font-medium text-purple-300">
                              {authProgress}%
                            </div>
                          </div>
                          
                          {/* 步骤指示器 */}
                          <div className="grid grid-cols-4 gap-2">
                            {/* 步骤1: 生成链接 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 10 
                                  ? 'bg-green-500 text-white' 
                                  : 'bg-purple-800/50 text-purple-400'
                              }`}>
                                {authProgress >= 10 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : (
                                  <span className="text-xs font-bold">1</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 10 ? 'text-green-400 font-medium' : 'text-purple-400'
                              }`}>
                                生成链接
                              </span>
                            </div>
                            
                            {/* 步骤2: 换取Token */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 50 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'exchanging' 
                                    ? 'bg-purple-500 text-white animate-pulse' 
                                    : 'bg-purple-800/50 text-purple-400'
                              }`}>
                                {authProgress >= 50 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'exchanging' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">2</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 50 
                                  ? 'text-green-400 font-medium' 
                                  : authStep === 'exchanging' 
                                    ? 'text-purple-300 font-medium' 
                                    : 'text-purple-400'
                              }`}>
                                换取Token
                              </span>
                            </div>
                            
                            {/* 步骤3: 保存凭证 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 75 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'saving' 
                                    ? 'bg-purple-500 text-white animate-pulse' 
                                    : 'bg-purple-800/50 text-purple-400'
                              }`}>
                                {authProgress >= 75 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'saving' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">3</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 75 
                                  ? 'text-green-400 font-medium' 
                                  : authStep === 'saving' 
                                    ? 'text-purple-300 font-medium' 
                                    : 'text-purple-400'
                              }`}>
                                保存凭证
                              </span>
                            </div>
                            
                            {/* 步骤4: 同步数据 */}
                            <div className="flex flex-col items-center">
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1 transition-all ${
                                authProgress >= 100 
                                  ? 'bg-green-500 text-white' 
                                  : authStep === 'syncing' 
                                    ? 'bg-purple-500 text-white animate-pulse' 
                                    : 'bg-purple-800/50 text-purple-400'
                              }`}>
                                {authProgress >= 100 ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : authStep === 'syncing' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className="text-xs font-bold">4</span>
                                )}
                              </div>
                              <span className={`text-xs text-center ${
                                authProgress >= 100 
                                  ? 'text-green-400 font-medium' 
                                  : authStep === 'syncing' 
                                    ? 'text-purple-300 font-medium' 
                                    : 'text-purple-400'
                              }`}>
                                同步数据
                              </span>
                            </div>
                          </div>
                          
                          {/* 当前操作详情 */}
                          <div className="mt-4 p-3 bg-purple-900/30 rounded-md">
                            <div className="flex items-center gap-2 text-sm">
                              {authStep !== 'complete' && authStep !== 'error' && <Loader2 className="h-4 w-4 animate-spin text-purple-400" />}
                              {authStep === 'complete' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                              {authStep === 'error' && <XCircle className="h-4 w-4 text-red-400" />}
                              <span className={
                                authStep === 'complete' ? 'text-green-400' : 
                                authStep === 'error' ? 'text-red-400' : 
                                'text-purple-300'
                              }>
                                {authStep === 'exchanging' && '正在与 Amazon Advertising API 通信，换取访问令牌...'}
                                {authStep === 'saving' && '正在验证凭证并保存到数据库，同时同步广告数据...'}
                                {authStep === 'syncing' && '正在从亚马逊拉取 SP/SB/SD 广告活动数据...'}
                                {authStep === 'complete' && '授权流程已完成！您现在可以开始管理广告了。'}
                                {authStep === 'error' && authError && authError.message}
                              </span>
                            </div>
                          </div>
                          
                          {/* 错误恢复操作 */}
                          {authStep === 'error' && authError && (
                            <div className="mt-4 p-4 bg-red-900/30 rounded-md border border-red-500/30">
                              <h5 className="font-medium text-red-400 mb-2">授权失败</h5>
                              <p className="text-sm text-red-300 mb-3">
                                {authError.step === '换取Token' && '授权码无效或已过期。请重新生成授权链接并完成授权，然后立即粘贴新的授权后URL。'}
                                {authError.step === '保存凭证' && '凭证保存失败。请检查网络连接并重试。'}
                                {authError.step === '同步数据' && '数据同步失败。您可以稍后在“数据同步”标签中手动同步。'}
                              </p>
                              <div className="flex gap-2">
                                {authError.canRetry && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-red-500/50 text-red-400 hover:bg-red-900/30"
                                    onClick={() => {
                                      setAuthStep('idle');
                                      setAuthProgress(0);
                                      setAuthError(null);
                                    }}
                                  >
                                    <RefreshCw className="h-4 w-4 mr-1" />
                                    重新开始
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-400 hover:text-red-300"
                                  onClick={() => {
                                    setAuthStep('idle');
                                    setAuthProgress(0);
                                    setAuthError(null);
                                  }}
                                >
                                  关闭
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Alert className="bg-green-900/20 border-green-500/30">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <AlertTitle className="text-green-300">安全说明</AlertTitle>
                      <AlertDescription className="text-green-200">
                        此授权流程不会影响您的亚马逊卖家账户安全。我们只通过亚马逊官方 API 读取广告数据，
                        不会模拟登录您的卖家中心，也不会触发亚马逊的 IP 风控。
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Sync Tab */}
          <TabsContent value="sync" className="space-y-4">
            {selectedAccount && (<>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    数据同步
                  </CardTitle>
                  <CardDescription>
                    从Amazon Advertising API同步广告数据到本地系统
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>同步说明</AlertTitle>
                    <AlertDescription>
                      点击同步按钮将从Amazon API拉取最新的广告活动、广告组、关键词和商品定位数据。
                      首次同步可能需要较长时间，请耐心等待。
                    </AlertDescription>
                  </Alert>

                  {/* 同步选项 */}
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="incremental-sync"
                        checked={useIncrementalSync}
                        onCheckedChange={setUseIncrementalSync}
                      />
                      <Label htmlFor="incremental-sync" className="text-sm cursor-pointer">
                        增量同步
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        (只同步上次同步后有变化的数据，减少API调用次数)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowScheduleSettings(!showScheduleSettings)}
                        className={Array.isArray(scheduleConfig) && scheduleConfig.length > 0 && scheduleConfig[0]?.isEnabled ? 'text-green-500' : ''}
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
                        定时同步
                        {Array.isArray(scheduleConfig) && scheduleConfig.length > 0 && scheduleConfig[0]?.isEnabled && (
                          <Badge variant="secondary" className="ml-1 h-5 px-1 bg-green-500/20 text-green-500">已开启</Badge>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSyncQueue(!showSyncQueue)}
                      >
                        <Database className="h-4 w-4 mr-1" />
                        队列
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSyncConflicts(!showSyncConflicts)}
                        className={pendingConflictsCount && pendingConflictsCount > 0 ? 'text-yellow-500' : ''}
                      >
                        <AlertCircle className="h-4 w-4 mr-1" />
                        冲突
                        {pendingConflictsCount && pendingConflictsCount > 0 && (
                          <Badge variant="destructive" className="ml-1 h-5 px-1">{pendingConflictsCount}</Badge>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSyncHistory(!showSyncHistory)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {showSyncHistory ? '隐藏历史' : '查看历史'}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Button 
                      onClick={() => {
                        handleSyncAll();
                      }} 
                      disabled={isSyncing || !selectedAccountId}
                    >
                      {isSyncing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      {isSyncing ? "同步中..." : (useIncrementalSync ? "增量同步" : "全量同步")}
                    </Button>

                    <Button 
                      variant="outline" 
                      onClick={() => runOptimizationMutation.mutate({ accountId: selectedAccountId!, performanceGroupId: 0 })}
                      disabled={runOptimizationMutation.isPending || !credentialsStatus?.hasCredentials}
                    >
                      {runOptimizationMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      运行自动优化
                    </Button>
                  </div>

                  {/* 同步进度指示器 */}
                  {syncProgress.step !== 'idle' && (
                    <div className="mt-4 p-4 bg-muted/50 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">同步进度</span>
                        <span className="text-sm text-muted-foreground">{syncProgress.progress}%</span>
                      </div>
                      
                      {/* 进度条 */}
                      <div className="w-full bg-muted rounded-full h-2 mb-4">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            syncProgress.step === 'error' ? 'bg-red-500' : 
                            syncProgress.step === 'complete' ? 'bg-green-500' : 
                            'bg-primary'
                          }`}
                          style={{ width: `${syncProgress.progress}%` }}
                        />
                      </div>
                      
                      {/* 步骤指示器 */}
                      <div className="grid grid-cols-6 gap-2 mb-4">
                        {[
                          { key: 'sp', label: 'SP广告', icon: '📦' },
                          { key: 'sb', label: 'SB广告', icon: '🎯' },
                          { key: 'sd', label: 'SD广告', icon: '📺' },
                          { key: 'adgroups', label: '广告组', icon: '📂' },
                          { key: 'keywords', label: '关键词', icon: '🔑' },
                          { key: 'targets', label: '商品定位', icon: '🎯' },
                        ].map((item, index) => {
                          const stepOrder = ['sp', 'sb', 'sd', 'adgroups', 'keywords', 'targets', 'complete'];
                          const currentIndex = stepOrder.indexOf(syncProgress.step);
                          const itemIndex = stepOrder.indexOf(item.key);
                          const isActive = syncProgress.step === item.key;
                          const isComplete = currentIndex > itemIndex || syncProgress.step === 'complete';
                          
                          return (
                            <div 
                              key={item.key}
                              className={`flex flex-col items-center p-2 rounded-md text-center ${
                                isActive ? 'bg-primary/20 border border-primary' :
                                isComplete ? 'bg-green-500/20 border border-green-500/30' :
                                'bg-muted border border-transparent'
                              }`}
                            >
                              <span className="text-lg mb-1">{item.icon}</span>
                              <span className={`text-xs ${
                                isActive ? 'text-primary font-medium' :
                                isComplete ? 'text-green-500' :
                                'text-muted-foreground'
                              }`}>
                                {item.label}
                              </span>
                              {isComplete && (
                                <CheckCircle2 className="h-3 w-3 text-green-500 mt-1" />
                              )}
                              {isActive && (
                                <Loader2 className="h-3 w-3 text-primary mt-1 animate-spin" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* 当前操作 */}
                      <div className="flex items-center gap-2 text-sm">
                        {syncProgress.step !== 'complete' && syncProgress.step !== 'error' && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        {syncProgress.step === 'complete' && (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        {syncProgress.step === 'error' && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className={`${
                          syncProgress.step === 'error' ? 'text-red-500' :
                          syncProgress.step === 'complete' ? 'text-green-500' :
                          'text-muted-foreground'
                        }`}>
                          {syncProgress.current}
                        </span>
                      </div>
                      
                      {/* 同步结果 */}
                      {syncProgress.step === 'complete' && (
                        <div className="mt-4 grid grid-cols-3 gap-4">
                          <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                            <div className="text-2xl font-bold text-blue-500">
                              {syncProgress.results.sp + syncProgress.results.sb + syncProgress.results.sd}
                            </div>
                            <div className="text-xs text-muted-foreground">广告活动</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              SP:{syncProgress.results.sp} SB:{syncProgress.results.sb} SD:{syncProgress.results.sd}
                            </div>
                          </div>
                          <div className="text-center p-3 bg-green-500/10 rounded-lg">
                            <div className="text-2xl font-bold text-green-500">{syncProgress.results.adGroups}</div>
                            <div className="text-xs text-muted-foreground">广告组</div>
                          </div>
                          <div className="text-center p-3 bg-purple-500/10 rounded-lg">
                            <div className="text-2xl font-bold text-purple-500">
                              {syncProgress.results.keywords + syncProgress.results.targets}
                            </div>
                            <div className="text-xs text-muted-foreground">关键词/定位</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              关键词:{syncProgress.results.keywords} 定位:{syncProgress.results.targets}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* 错误恢复 */}
                      {syncProgress.step === 'error' && (
                        <div className="mt-4 flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSyncProgress({
                                step: 'idle',
                                progress: 0,
                                current: '',
                                results: { sp: 0, sb: 0, sd: 0, adGroups: 0, keywords: 0, targets: 0 }
                              });
                            }}
                          >
                            关闭
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSyncAll()}
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            重试
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!credentialsStatus?.hasCredentials && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>未配置API凭证</AlertTitle>
                      <AlertDescription>
                        请先在“API配置”标签页中配置Amazon API凭证后再进行数据同步。
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {/* 同步历史记录卡片 */}
              {showSyncHistory && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      同步历史记录
                    </CardTitle>
                    <CardDescription>
                      最近30天的同步记录和统计信息
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 同步统计 */}
                    {syncStats && (
                      <div className="grid grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{syncStats.totalSyncs}</div>
                          <div className="text-xs text-muted-foreground">总同步次数</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-500">{syncStats.successfulSyncs}</div>
                          <div className="text-xs text-muted-foreground">成功</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-500">{syncStats.failedSyncs}</div>
                          <div className="text-xs text-muted-foreground">失败</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{syncStats.totalRecordsSynced}</div>
                          <div className="text-xs text-muted-foreground">同步记录数</div>
                        </div>
                      </div>
                    )}

                    {/* 同步历史列表 */}
                    <div className="space-y-2">
                      {syncHistory && syncHistory.jobs && syncHistory.jobs.length > 0 ? (
                        syncHistory.jobs.map((job: any) => (
                          <div key={job.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${
                                job.status === 'completed' ? 'bg-green-500' :
                                job.status === 'failed' ? 'bg-red-500' :
                                job.status === 'running' ? 'bg-yellow-500 animate-pulse' :
                                'bg-gray-500'
                              }`} />
                              <div>
                                <div className="text-sm font-medium">
                                  {job.syncType === 'full' ? '全量同步' : '增量同步'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(job.startedAt).toLocaleString('zh-CN')}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-sm">
                                  同步: {job.recordsSynced || 0} | 跳过: {job.recordsSkipped || 0}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {job.durationMs ? `耗时: ${(job.durationMs / 1000).toFixed(1)}秒` : ''}
                                  {job.retryCount && job.retryCount > 0 ? ` | 重试: ${job.retryCount}次` : ''}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedSyncJobId(job.id);
                                  setShowChangeSummary(true);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Badge variant={job.status === 'completed' ? 'default' : job.status === 'failed' ? 'destructive' : 'secondary'}>
                                {job.status === 'completed' ? '完成' :
                                 job.status === 'failed' ? '失败' :
                                 job.status === 'running' ? '进行中' : job.status}
                              </Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          暂无同步记录
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 变更摘要卡片 */}
              {showChangeSummary && changeSummary && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        同步变更摘要
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowChangeSummary(false)}>
                        关闭
                      </Button>
                    </div>
                    <CardDescription>
                      本次同步的数据变更详情
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
                        <div className="text-lg font-bold text-green-500">
                          {(changeSummary.campaignsCreated || 0) + (changeSummary.adGroupsCreated || 0) + (changeSummary.keywordsCreated || 0) + (changeSummary.targetsCreated || 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">新增记录</div>
                        <div className="text-xs text-green-500 mt-1">
                          广告:{changeSummary.campaignsCreated || 0} 组:{changeSummary.adGroupsCreated || 0} 词:{changeSummary.keywordsCreated || 0}
                        </div>
                      </div>
                      <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <div className="text-lg font-bold text-blue-500">
                          {(changeSummary.campaignsUpdated || 0) + (changeSummary.adGroupsUpdated || 0) + (changeSummary.keywordsUpdated || 0) + (changeSummary.targetsUpdated || 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">更新记录</div>
                        <div className="text-xs text-blue-500 mt-1">
                          广告:{changeSummary.campaignsUpdated || 0} 组:{changeSummary.adGroupsUpdated || 0} 词:{changeSummary.keywordsUpdated || 0}
                        </div>
                      </div>
                      <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                        <div className="text-lg font-bold text-red-500">
                          {(changeSummary.campaignsDeleted || 0) + (changeSummary.adGroupsDeleted || 0) + (changeSummary.keywordsDeleted || 0) + (changeSummary.targetsDeleted || 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">删除记录</div>
                      </div>
                      <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                        <div className="text-lg font-bold text-yellow-500">
                          {changeSummary.conflictsDetected || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">检测到冲突</div>
                        {(changeSummary.conflictsDetected || 0) > 0 && (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-xs text-yellow-500"
                            onClick={() => setShowSyncConflicts(true)}
                          >
                            查看冲突
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 同步冲突卡片 */}
              {showSyncConflicts && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-yellow-500" />
                        数据冲突
                        {pendingConflictsCount && pendingConflictsCount > 0 && (
                          <Badge variant="destructive">{pendingConflictsCount}</Badge>
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowSyncConflicts(false)}>
                        关闭
                      </Button>
                    </div>
                    <CardDescription>
                      同步时检测到的数据冲突，请选择处理方式
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {syncConflicts && syncConflicts.length > 0 ? (
                      syncConflicts.map((conflict: any) => (
                        <div key={conflict.id} className="p-4 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="font-medium">{conflict.entityName}</div>
                              <div className="text-xs text-muted-foreground">
                                类型: {conflict.entityType} | ID: {conflict.entityId}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-yellow-500 border-yellow-500">
                              {conflict.conflictType === 'data_mismatch' ? '数据不一致' : conflict.conflictType}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-4 mb-3">
                            <div className="p-2 bg-muted/50 rounded text-xs">
                              <div className="font-medium mb-1">本地数据</div>
                              <div className="text-muted-foreground">
                                {conflict.conflictFields?.map((field: string) => (
                                  <div key={field}>{field}: {JSON.stringify(conflict.localData?.[field])}</div>
                                ))}
                              </div>
                            </div>
                            <div className="p-2 bg-muted/50 rounded text-xs">
                              <div className="font-medium mb-1">远程数据</div>
                              <div className="text-muted-foreground">
                                {conflict.conflictFields?.map((field: string) => (
                                  <div key={field}>{field}: {JSON.stringify(conflict.remoteData?.[field])}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resolveConflictMutation.mutate({
                                conflictId: conflict.id,
                                resolution: 'use_local',
                              })}
                            >
                              使用本地
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resolveConflictMutation.mutate({
                                conflictId: conflict.id,
                                resolution: 'use_remote',
                              })}
                            >
                              使用远程
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground"
                              onClick={() => resolveConflictMutation.mutate({
                                conflictId: conflict.id,
                                resolution: 'manual',
                                notes: '用户忽略',
                              })}
                            >
                              忽略
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无待处理的冲突
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 定时同步设置卡片 */}
              {showScheduleSettings && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <RefreshCw className="h-5 w-5" />
                        定时同步设置
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowScheduleSettings(false)}>
                        关闭
                      </Button>
                    </div>
                    <CardDescription>
                      设置自动同步频率，系统将按设定的时间间隔自动同步数据
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Switch
                          id="schedule-enabled"
                          checked={scheduleConfig && scheduleConfig.length > 0 && scheduleConfig[0]?.isEnabled}
                          onCheckedChange={(checked) => {
                            if (scheduleConfig && scheduleConfig.length > 0) {
                              updateScheduleMutation.mutate({
                                id: scheduleConfig[0].id!,
                                isEnabled: checked,
                              });
                            } else if (checked && selectedAccountId) {
                              createScheduleMutation.mutate({
                                accountId: selectedAccountId,
                                syncType: 'all',
                                frequency: scheduleFrequency as any,
                                isEnabled: true,
                              });
                            }
                          }}
                        />
                        <Label htmlFor="schedule-enabled" className="text-sm font-medium cursor-pointer">
                          启用定时同步
                        </Label>
                      </div>
                      {scheduleConfig && scheduleConfig.length > 0 && scheduleConfig[0]?.isEnabled && (
                        <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                          已启用
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label>同步频率</Label>
                      <Select
                        value={scheduleConfig && scheduleConfig.length > 0 ? scheduleConfig[0]?.frequency : scheduleFrequency}
                        onValueChange={(value) => {
                          setScheduleFrequency(value);
                          if (scheduleConfig && scheduleConfig.length > 0) {
                            updateScheduleMutation.mutate({
                              id: scheduleConfig[0].id!,
                              frequency: value as any,
                            });
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择同步频率" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">每小时</SelectItem>
                          <SelectItem value="every_2_hours">每2小时</SelectItem>
                          <SelectItem value="every_4_hours">每4小时</SelectItem>
                          <SelectItem value="every_6_hours">每6小时</SelectItem>
                          <SelectItem value="every_12_hours">每12小时</SelectItem>
                          <SelectItem value="daily">每天</SelectItem>
                          <SelectItem value="weekly">每周</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {scheduleConfig && scheduleConfig.length > 0 && (
                      <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">上次同步</span>
                          <span>{scheduleConfig[0]?.lastRunAt ? new Date(scheduleConfig[0].lastRunAt).toLocaleString('zh-CN') : '未执行'}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">下次同步</span>
                          <span>{scheduleConfig[0]?.nextRunAt ? new Date(scheduleConfig[0].nextRunAt).toLocaleString('zh-CN') : '-'}</span>
                        </div>
                      </div>
                    )}

                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>定时同步说明</AlertTitle>
                      <AlertDescription>
                        启用定时同步后，系统将按设定的频率自动从 Amazon API 拉取最新数据。
                        默认使用增量同步以减少 API 调用次数。
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}

              {/* 同步队列卡片 */}
              {showSyncQueue && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        同步任务队列
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowSyncQueue(false)}>
                        关闭
                      </Button>
                    </div>
                    <CardDescription>
                      管理多账号同步任务
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 队列统计 */}
                    {queueStats && (
                      <div className="grid grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-yellow-500">{queueStats.queuedTasks || 0}</div>
                          <div className="text-xs text-muted-foreground">等待中</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-500">{queueStats.runningTasks || 0}</div>
                          <div className="text-xs text-muted-foreground">运行中</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-500">{queueStats.completedTasks || 0}</div>
                          <div className="text-xs text-muted-foreground">已完成</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold">
                            {queueStats.totalEstimatedTimeMs 
                              ? `${Math.ceil(queueStats.totalEstimatedTimeMs / 60000)}分钟`
                              : '-'
                            }
                          </div>
                          <div className="text-xs text-muted-foreground">预计总时间</div>
                        </div>
                      </div>
                    )}

                    {/* 添加到队列按钮 */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (selectedAccountId && selectedAccount) {
                            addToQueueMutation.mutate({
                              accountId: selectedAccountId,
                              accountName: selectedAccount.accountName,
                            });
                          }
                        }}
                        disabled={!selectedAccountId || addToQueueMutation.isPending}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        添加当前账号到队列
                      </Button>
                    </div>

                    {/* 队列列表 */}
                    <div className="space-y-2">
                      {syncQueue && syncQueue.length > 0 ? (
                        syncQueue.map((task: any) => (
                          <div key={task.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${
                                task.status === 'completed' ? 'bg-green-500' :
                                task.status === 'failed' ? 'bg-red-500' :
                                task.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                task.status === 'cancelled' ? 'bg-gray-500' :
                                'bg-yellow-500'
                              }`} />
                              <div>
                                <div className="text-sm font-medium">{task.accountName || `账号 #${task.accountId}`}</div>
                                <div className="text-xs text-muted-foreground">
                                  {task.syncType === 'full' ? '全量同步' : task.syncType}
                                  {task.progress > 0 && task.status === 'running' && (
                                    <span className="ml-2">进度: {task.progress}%</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.status === 'pending' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => cancelTaskMutation.mutate({ taskId: task.id })}
                                >
                                  取消
                                </Button>
                              )}
                              <Badge variant={
                                task.status === 'completed' ? 'default' :
                                task.status === 'failed' ? 'destructive' :
                                task.status === 'running' ? 'secondary' :
                                'outline'
                              }>
                                {task.status === 'pending' ? '等待中' :
                                 task.status === 'running' ? '运行中' :
                                 task.status === 'completed' ? '完成' :
                                 task.status === 'failed' ? '失败' :
                                 task.status === 'cancelled' ? '已取消' : task.status}
                              </Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          队列为空
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>)}
          </TabsContent>

          {/* Guide Tab */}
          <TabsContent value="guide" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Amazon Advertising API 接入指南
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold">第一步：创建Amazon Developer账号</h3>
                  <p className="text-muted-foreground">
                    访问 <a href="https://developer.amazon.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Amazon Developer Console <ExternalLink className="inline h-3 w-3" />
                    </a> 创建开发者账号。
                  </p>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold">第二步：创建安全配置文件</h3>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>登录Amazon Developer Console</li>
                    <li>进入 "Login with Amazon" 控制台</li>
                    <li>创建新的安全配置文件</li>
                    <li>记录 Client ID 和 Client Secret</li>
                  </ol>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold">第三步：申请Amazon Advertising API访问权限</h3>
                  <p className="text-muted-foreground">
                    访问 <a href="https://advertising.amazon.com/API" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Amazon Advertising API <ExternalLink className="inline h-3 w-3" />
                    </a> 申请API访问权限。审批通常需要1-3个工作日。
                  </p>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold">第四步：获取Refresh Token</h3>
                  <p className="text-muted-foreground">
                    完成OAuth授权流程后，您将获得Refresh Token。这个令牌用于获取访问令牌，请妥善保管。
                  </p>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold">第五步：获取Profile ID</h3>
                  <p className="text-muted-foreground">
                    Profile ID是您的Amazon广告账号标识。您可以通过调用 <code className="bg-muted px-1 rounded">/v2/profiles</code> API获取。
                  </p>
                </div>

                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertTitle>安全提示</AlertTitle>
                  <AlertDescription>
                    请勿将您的API凭证分享给他人。所有凭证信息都将加密存储在我们的服务器上。
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>编辑店铺信息</DialogTitle>
              <DialogDescription>
                修改店铺账号的基本信息
              </DialogDescription>
            </DialogHeader>
            {editingAccount && (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="editAccountName">系统账号名称</Label>
                    <Input
                      id="editAccountName"
                      value={editingAccount.accountName}
                      onChange={(e) => setEditingAccount({ ...editingAccount, accountName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editStoreName">店铺名称</Label>
                    <Input
                      id="editStoreName"
                      value={editingAccount.storeName}
                      onChange={(e) => setEditingAccount({ ...editingAccount, storeName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="editStoreDescription">店铺备注</Label>
                  <Textarea
                    id="editStoreDescription"
                    value={editingAccount.storeDescription}
                    onChange={(e) => setEditingAccount({ ...editingAccount, storeDescription: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>店铺标识颜色</Label>
                  <div className="flex gap-2 flex-wrap">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          editingAccount.storeColor === color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setEditingAccount({ ...editingAccount, storeColor: color })}
                      />
                    ))}
                    <Input
                      type="color"
                      value={editingAccount.storeColor}
                      onChange={(e) => setEditingAccount({ ...editingAccount, storeColor: e.target.value })}
                      className="w-8 h-8 p-0 border-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="editProfileId">Profile ID</Label>
                    <Input
                      id="editProfileId"
                      value={editingAccount.profileId}
                      onChange={(e) => setEditingAccount({ ...editingAccount, profileId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editSellerId">卖家ID</Label>
                    <Input
                      id="editSellerId"
                      value={editingAccount.sellerId}
                      onChange={(e) => setEditingAccount({ ...editingAccount, sellerId: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleUpdateAccount} disabled={updateAccountMutation.isPending}>
                {updateAccountMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                保存修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 导入账号对话框 */}
        <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>导入店铺账号</DialogTitle>
              <DialogDescription>
                从 JSON 或 CSV 文件导入店铺账号配置
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-4">
                <Label>文件格式</Label>
                <div className="flex gap-2">
                  <Button
                    variant={importFormat === 'json' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setImportFormat('json')}
                  >
                    <FileJson className="h-4 w-4 mr-2" />
                    JSON
                  </Button>
                  <Button
                    variant={importFormat === 'csv' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setImportFormat('csv')}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>粘贴数据内容</Label>
                <Textarea
                  placeholder={importFormat === 'json' 
                    ? '[{"accountId": "xxx", "accountName": "xxx", "marketplace": "US"}]'
                    : 'accountId,accountName,marketplace\nxxx,xxx,US'
                  }
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={importOverwrite}
                  onCheckedChange={setImportOverwrite}
                />
                <Label>覆盖已存在的账号</Label>
              </div>

              {importData && (
                <Button
                  variant="outline"
                  onClick={() => previewImportMutation.mutate({ data: importData, format: importFormat })}
                  disabled={previewImportMutation.isPending}
                >
                  {previewImportMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Eye className="h-4 w-4 mr-2" />
                  预览导入
                </Button>
              )}

              {importPreview && importPreview.length > 0 && (
                <div className="border rounded-lg p-4 space-y-2">
                  <p className="text-sm font-medium">预览结果 ({importPreview.length} 个账号)</p>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {importPreview.map((account, index) => (
                      <div key={index} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.storeName || account.accountName}</span>
                          <Badge variant="outline" className="text-xs">
                            {MARKETPLACES.find(m => m.id === account.marketplace)?.flag} {account.marketplace}
                          </Badge>
                        </div>
                        {account.exists ? (
                          <Badge variant="secondary" className="text-xs">
                            {importOverwrite ? '将更新' : '将跳过'}
                          </Badge>
                        ) : (
                          <Badge className="text-xs bg-green-500/20 text-green-500">新增</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsImportDialogOpen(false);
                setImportData("");
                setImportPreview(null);
              }}>
                取消
              </Button>
              <Button
                onClick={() => importAccountsMutation.mutate({
                  data: importData,
                  format: importFormat,
                  overwrite: importOverwrite,
                })}
                disabled={!importData || importAccountsMutation.isPending}
              >
                {importAccountsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                确认导入
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
