import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { useOnboarding } from "@/components/OnboardingWizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Settings as SettingsIcon, 
  Building2, 
  Sliders, 
  Clock,
  Save,
  Loader2,
  AlertCircle,
  RotateCcw,
  Rocket
} from "lucide-react";

export default function Settings() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const { resetOnboarding, savedProgress } = useOnboarding();

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading, refetch } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;
  const selectedAccount = accounts?.find(a => a.id === accountId);

  // Update account mutation
  const updateAccount = trpc.adAccount.update.useMutation({
    onSuccess: () => {
      toast.success("设置已保存");
      refetch();
    },
    onError: (error) => {
      toast.error("保存失败: " + error.message);
    },
  });

  if (accountsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">暂无广告账号</h2>
          <p className="text-muted-foreground mb-4">请先连接Amazon API同步您的广告账号</p>
          <Button onClick={() => window.location.href = '/amazon-api'}>
            连接Amazon API
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.settings} />
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">优化设置</h1>
          <p className="text-muted-foreground">
            配置账号级和广告活动级的优化参数
          </p>
        </div>

        {/* Account Selector */}
        {accounts.length > 1 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Label>选择账号</Label>
                <Select
                  value={accountId?.toString()}
                  onValueChange={(value) => setSelectedAccountId(parseInt(value))}
                >
                  <SelectTrigger className="w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.accountName} ({account.marketplace})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Settings Tabs */}
        <Tabs defaultValue="account" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
            <TabsTrigger value="account">
              <Building2 className="w-4 h-4 mr-2" />
              账号设置
            </TabsTrigger>
            <TabsTrigger value="optimization">
              <Sliders className="w-4 h-4 mr-2" />
              优化参数
            </TabsTrigger>
            <TabsTrigger value="intraday">
              <Clock className="w-4 h-4 mr-2" />
              日内竞价
            </TabsTrigger>
            <TabsTrigger value="guide">
              <Rocket className="w-4 h-4 mr-2" />
              引导设置
            </TabsTrigger>
          </TabsList>

          {/* Account Settings */}
          <TabsContent value="account">
            <AccountSettingsForm 
              account={selectedAccount} 
              onSave={(data) => updateAccount.mutate({ id: accountId!, ...data })}
              isLoading={updateAccount.isPending}
            />
          </TabsContent>

          {/* Optimization Parameters */}
          <TabsContent value="optimization">
            <OptimizationSettingsForm 
              account={selectedAccount}
              onSave={(data) => updateAccount.mutate({ id: accountId!, ...data })}
              isLoading={updateAccount.isPending}
            />
          </TabsContent>

          {/* Intraday Bidding */}
          <TabsContent value="intraday">
            <IntradayBiddingSettings 
              account={selectedAccount}
              onSave={(data) => updateAccount.mutate({ id: accountId!, ...data })}
              isLoading={updateAccount.isPending}
            />
          </TabsContent>

          {/* Guide Settings */}
          <TabsContent value="guide">
            <Card>
              <CardHeader>
                <CardTitle>引导设置</CardTitle>
                <CardDescription>
                  管理首次登录引导流程和系统入门向导
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 引导进度状态 */}
                {savedProgress && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-full">
                        <Rocket className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-blue-900 dark:text-blue-100">您有未完成的引导流程</p>
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                          当前进度：{savedProgress === 'connect' ? '连接Amazon API' : savedProgress === 'sync' ? '数据同步' : savedProgress}
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => {
                          window.location.href = '/dashboard';
                        }}
                      >
                        继续完成
                      </Button>
                    </div>
                  </div>
                )}

                {/* 重新开始引导 */}
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">重新开始引导</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      如果您想重新了解系统功能或重新配置Amazon API连接，可以重新开始引导流程。
                    </p>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        resetOnboarding();
                        toast.success("引导已重置，即将跳转到仪表盘");
                        setTimeout(() => {
                          window.location.href = '/dashboard';
                        }, 1000);
                      }}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      重新开始引导
                    </Button>
                  </div>

                  <Separator />

                  {/* 引导内容说明 */}
                  <div>
                    <h4 className="font-medium mb-2">引导包含内容</h4>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">1</div>
                        <span>欢迎介绍 - 了解系统核心功能</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">2</div>
                        <span>连接Amazon API - 授权广告账号访问</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">3</div>
                        <span>数据同步 - 首次同步广告数据</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">4</div>
                        <span>完成设置 - 开始使用系统</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function AccountSettingsForm({ 
  account, 
  onSave, 
  isLoading 
}: { 
  account: any; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    accountName: account?.accountName || "",
    status: account?.status || "active",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          账号基本设置
        </CardTitle>
        <CardDescription>
          管理广告账号的基本信息
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="accountName">账号名称</Label>
            <Input
              id="accountName"
              value={formData.accountName}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountId">账号ID</Label>
            <Input
              id="accountId"
              value={account?.accountId || ""}
              disabled
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="marketplace">市场</Label>
            <Input
              id="marketplace"
              value={account?.marketplace || ""}
              disabled
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">状态</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="paused">暂停</SelectItem>
                <SelectItem value="archived">归档</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button onClick={() => onSave(formData)} disabled={isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            保存设置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptimizationSettingsForm({ 
  account, 
  onSave, 
  isLoading 
}: { 
  account: any; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    defaultMaxBid: account?.defaultMaxBid || "10.00",
    conversionValueType: account?.conversionValueType || "sales",
    conversionValueSource: account?.conversionValueSource || "platform",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sliders className="w-5 h-5" />
          优化参数设置
        </CardTitle>
        <CardDescription>
          配置出价优化的全局参数，这些设置将应用于所有广告活动（除非在广告活动级别覆盖）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="defaultMaxBid">默认最高出价 ($)</Label>
            <Input
              id="defaultMaxBid"
              type="number"
              step="0.01"
              value={formData.defaultMaxBid}
              onChange={(e) => setFormData({ ...formData, defaultMaxBid: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              优化算法不会将出价调整到超过此值
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conversionValueType">转换值类型</Label>
            <Select
              value={formData.conversionValueType}
              onValueChange={(value) => setFormData({ ...formData, conversionValueType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">销售额</SelectItem>
                <SelectItem value="units">销售单位数</SelectItem>
                <SelectItem value="custom">自定义值</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              用于计算ROAS和优化目标的转换值类型
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conversionValueSource">转换值来源</Label>
            <Select
              value={formData.conversionValueSource}
              onValueChange={(value) => setFormData({ ...formData, conversionValueSource: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="platform">平台数据</SelectItem>
                <SelectItem value="custom">自定义数据</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              转换值数据的来源
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <h4 className="font-medium">出价调整限制</h4>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium">单次调整上限</p>
              <p className="text-2xl font-bold text-primary">25%</p>
              <p className="text-xs text-muted-foreground">每次出价调整不超过当前出价的25%</p>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium">最低出价</p>
              <p className="text-2xl font-bold text-primary">$0.02</p>
              <p className="text-xs text-muted-foreground">出价不会低于此值</p>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium">数据要求</p>
              <p className="text-2xl font-bold text-primary">5次点击</p>
              <p className="text-xs text-muted-foreground">至少需要5次点击才会进行优化</p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button onClick={() => onSave(formData)} disabled={isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            保存设置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IntradayBiddingSettings({ 
  account, 
  onSave, 
  isLoading 
}: { 
  account: any; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [intradayEnabled, setIntradayEnabled] = useState(account?.intradayBiddingEnabled || false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          日内竞价设置
        </CardTitle>
        <CardDescription>
          启用日内竞价后，系统将在一天内多次调整出价，快速响应市场变化
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="space-y-1">
            <Label htmlFor="intradayEnabled" className="text-base font-medium">
              启用日内竞价
            </Label>
            <p className="text-sm text-muted-foreground">
              根据实时数据在一天内多次调整出价
            </p>
          </div>
          <Switch
            id="intradayEnabled"
            checked={intradayEnabled}
            onCheckedChange={setIntradayEnabled}
          />
        </div>

        {intradayEnabled && (
          <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium">日内竞价规则</h4>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>调整频率</Label>
                <Select defaultValue="4">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">每天2次</SelectItem>
                    <SelectItem value="4">每天4次</SelectItem>
                    <SelectItem value="6">每天6次</SelectItem>
                    <SelectItem value="8">每天8次</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>最大日内调整幅度</Label>
                <Select defaultValue="30">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">±10%</SelectItem>
                    <SelectItem value="20">±20%</SelectItem>
                    <SelectItem value="30">±30%</SelectItem>
                    <SelectItem value="50">±50%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              日内竞价将根据每个时段的历史表现自动调整出价，在高转化时段提高出价，低转化时段降低出价
            </p>
          </div>
        )}

        <Separator />

        <div className="flex justify-end">
          <Button 
            onClick={() => onSave({ intradayBiddingEnabled: intradayEnabled })} 
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            保存设置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
