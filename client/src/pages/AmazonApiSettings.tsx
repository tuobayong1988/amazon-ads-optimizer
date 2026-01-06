import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
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
import { toast } from "sonner";
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
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountFormData & { id: number } | null>(null);
  const [formData, setFormData] = useState<AccountFormData>(initialFormData);
  const [credentials, setCredentials] = useState({
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    profileId: "",
    region: "NA" as "NA" | "EU" | "FE",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("accounts");
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

  // Create account mutation
  const createAccountMutation = trpc.adAccount.create.useMutation({
    onSuccess: () => {
      toast.success("店铺账号添加成功！");
      utils.adAccount.list.invalidate();
      utils.adAccount.getStats.invalidate();
      setIsAddDialogOpen(false);
      setFormData(initialFormData);
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
    onSuccess: () => {
      toast.success("API凭证保存成功！");
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

  // Sync all mutation
  const syncAllMutation = trpc.amazonApi.syncAll.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成！广告活动: ${data.campaigns}, 广告组: ${data.adGroups}, 关键词: ${data.keywords}, 商品定位: ${data.targets}`);
      refetchStatus();
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
    try {
      await syncAllMutation.mutateAsync({ accountId: selectedAccountId });
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
      isDefault: account.isDefault || false,
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
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  添加店铺账号
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>添加新店铺账号</DialogTitle>
                <DialogDescription>
                  添加一个新的亚马逊卖家店铺账号到系统中
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="accountId">Amazon账号ID *</Label>
                    <Input
                      id="accountId"
                      placeholder="例如: A1B2C3D4E5F6G7"
                      value={formData.accountId}
                      onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accountName">系统账号名称 *</Label>
                    <Input
                      id="accountName"
                      placeholder="用于系统内部识别"
                      value={formData.accountName}
                      onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                    />
                  </div>
                </div>
                
                <Separator />
                <p className="text-sm font-medium">店铺自定义信息</p>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="storeName">店铺名称</Label>
                    <Input
                      id="storeName"
                      placeholder="您的店铺品牌名称"
                      value={formData.storeName}
                      onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="marketplace">市场 *</Label>
                    <Select
                      value={formData.marketplace}
                      onValueChange={(value) => setFormData({ ...formData, marketplace: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择市场" />
                      </SelectTrigger>
                      <SelectContent>
                        {MARKETPLACES.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.flag} {m.name} ({m.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="storeDescription">店铺备注</Label>
                  <Textarea
                    id="storeDescription"
                    placeholder="添加一些备注信息..."
                    value={formData.storeDescription}
                    onChange={(e) => setFormData({ ...formData, storeDescription: e.target.value })}
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
                <p className="text-sm font-medium">API配置信息（可选，稍后配置）</p>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="profileId">Profile ID</Label>
                    <Input
                      id="profileId"
                      placeholder="Amazon广告Profile ID"
                      value={formData.profileId}
                      onChange={(e) => setFormData({ ...formData, profileId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sellerId">卖家ID</Label>
                    <Input
                      id="sellerId"
                      placeholder="Amazon卖家ID"
                      value={formData.sellerId}
                      onChange={(e) => setFormData({ ...formData, sellerId: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="isDefault"
                    checked={formData.isDefault}
                    onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                  />
                  <Label htmlFor="isDefault">设为默认账号</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleCreateAccount} disabled={createAccountMutation.isPending}>
                  {createAccountMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  添加账号
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
                {accounts.map((account) => {
                  const marketplace = MARKETPLACES.find(m => m.id === account.marketplace);
                  return (
                    <Card 
                      key={account.id} 
                      className={`relative cursor-pointer transition-all hover:shadow-lg ${
                        selectedAccountId === account.id ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => setSelectedAccountId(account.id)}
                    >
                      {/* Color indicator */}
                      <div 
                        className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
                        style={{ backgroundColor: account.storeColor || '#3B82F6' }}
                      />
                      
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                              style={{ backgroundColor: account.storeColor || '#3B82F6' }}
                            >
                              {(account.storeName || account.accountName).charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <CardTitle className="text-base flex items-center gap-2">
                                {account.storeName || account.accountName}
                                {account.isDefault && (
                                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                )}
                              </CardTitle>
                              <CardDescription className="text-xs">
                                {marketplace?.flag} {marketplace?.name || account.marketplace}
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
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(account); }}>
                                <Edit2 className="h-4 w-4 mr-2" />
                                编辑信息
                              </DropdownMenuItem>
                              {!account.isDefault && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSetDefault(account.id); }}>
                                  <Star className="h-4 w-4 mr-2" />
                                  设为默认
                                </DropdownMenuItem>
                              )}
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
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-red-500"
                                onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除账号
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">账号ID</span>
                            <span className="font-mono text-xs">{account.accountId}</span>
                          </div>
                          {account.sellerId && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">卖家ID</span>
                              <span className="font-mono text-xs">{account.sellerId}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">连接状态</span>
                            {getConnectionStatusBadge(account.connectionStatus)}
                          </div>
                          {account.storeDescription && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                              {account.storeDescription}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Store className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">还没有添加店铺账号</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    添加您的亚马逊卖家店铺账号，开始管理广告数据
                  </p>
                  <Button onClick={() => setIsAddDialogOpen(true)}>
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

                    <div className="grid gap-4 md:grid-cols-3">
                      <Button 
                        variant="outline" 
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => window.open(
                          `https://www.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                          '_blank'
                        )}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">北美 (NA)</span>
                        <span className="text-xs text-muted-foreground">美国、加拿大、墨西哥、巴西</span>
                      </Button>
                      <Button 
                        variant="outline" 
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => window.open(
                          `https://eu.account.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                          '_blank'
                        )}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">欧洲 (EU)</span>
                        <span className="text-xs text-muted-foreground">英国、德国、法国、意大利等</span>
                      </Button>
                      <Button 
                        variant="outline" 
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => window.open(
                          `https://apac.account.amazon.com/ap/oa?client_id=${import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6'}&scope=advertising::campaign_management&redirect_uri=https://sellerps.com&response_type=code`,
                          '_blank'
                        )}
                      >
                        <Globe className="h-6 w-6" />
                        <span className="font-semibold">远东 (FE)</span>
                        <span className="text-xs text-muted-foreground">日本、澳大利亚、新加坡</span>
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
                              const result = await exchangeCodeMutation.mutateAsync({
                                code,
                                clientId: import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6',
                                clientSecret: import.meta.env.VITE_AMAZON_ADS_CLIENT_SECRET || '',
                                redirectUri: 'https://sellerps.com',
                              });
                              if (result.success && result.refreshToken) {
                                setCredentials(prev => ({ ...prev, refreshToken: result.refreshToken }));
                                toast.success('Refresh Token获取成功！已自动填入上方表单。');
                                codeInput.value = '';
                              }
                            } catch (error: any) {
                              toast.error(`换取失败: ${error.message}`);
                            }
                          }}
                          disabled={exchangeCodeMutation.isPending}
                        >
                          {exchangeCodeMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Key className="h-4 w-4 mr-2" />
                          )}
                          换取Token
                        </Button>
                      </div>
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
              </>
            )}
          </TabsContent>

          {/* Sync Tab */}
          <TabsContent value="sync" className="space-y-4">
            {selectedAccount && (
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

                  <div className="flex items-center gap-4">
                    <Button onClick={handleSyncAll} disabled={isSyncing || !credentialsStatus?.hasCredentials}>
                      {isSyncing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      {isSyncing ? "同步中..." : "立即同步"}
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

                  {!credentialsStatus?.hasCredentials && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>未配置API凭证</AlertTitle>
                      <AlertDescription>
                        请先在"API配置"标签页中配置Amazon API凭证后再进行数据同步。
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
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
