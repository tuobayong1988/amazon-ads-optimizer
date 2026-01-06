import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
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
  AlertCircle
} from "lucide-react";

export default function Settings() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

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
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
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
