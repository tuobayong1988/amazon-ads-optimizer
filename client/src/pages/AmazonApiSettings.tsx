import { useState } from "react";
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
  Globe
} from "lucide-react";

export default function AmazonApiSettings() {
  const { user, loading: authLoading } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [credentials, setCredentials] = useState({
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    profileId: "",
    region: "NA" as "NA" | "EU" | "FE",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery(undefined, {
    enabled: !!user,
  });

  // Fetch credentials status
  const { data: credentialsStatus, refetch: refetchStatus } = trpc.amazonApi.getCredentialsStatus.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // Fetch regions info
  const { data: regionsInfo } = trpc.amazonApi.getRegions.useQuery();

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
        <div>
          <h1 className="text-2xl font-bold">Amazon Advertising API 集成</h1>
          <p className="text-muted-foreground mt-1">
            配置Amazon广告API凭证，实现数据自动同步和出价优化
          </p>
        </div>

        {/* Account Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              选择广告账号
            </CardTitle>
            <CardDescription>
              选择要配置API集成的Amazon广告账号
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(value) => setSelectedAccountId(parseInt(value))}
            >
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="选择广告账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName} ({account.marketplace})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedAccountId && credentialsStatus && (
              <div className="mt-4 flex items-center gap-4">
                <Badge variant={credentialsStatus.hasCredentials ? "default" : "secondary"}>
                  {credentialsStatus.hasCredentials ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      已配置
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 mr-1" />
                      未配置
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

        {selectedAccountId && (
          <Tabs defaultValue="setup" className="space-y-4">
            <TabsList>
              <TabsTrigger value="setup">API设置</TabsTrigger>
              <TabsTrigger value="sync">数据同步</TabsTrigger>
              <TabsTrigger value="guide">接入指南</TabsTrigger>
            </TabsList>

            {/* API Setup Tab */}
            <TabsContent value="setup" className="space-y-4">
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
                      <Label htmlFor="profileId">Profile ID *</Label>
                      <Input
                        id="profileId"
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
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NA">北美 (NA) - US, CA, MX, BR</SelectItem>
                          <SelectItem value="EU">欧洲 (EU) - UK, DE, FR, IT, ES, etc.</SelectItem>
                          <SelectItem value="FE">远东 (FE) - JP, AU, SG</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        根据您的市场选择对应的API区域
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex justify-end">
                    <Button onClick={handleSaveCredentials} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          验证并保存中...
                        </>
                      ) : (
                        <>
                          <Shield className="h-4 w-4 mr-2" />
                          验证并保存凭证
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sync Tab */}
            <TabsContent value="sync" className="space-y-4">
              {!credentialsStatus?.hasCredentials ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>未配置API凭证</AlertTitle>
                  <AlertDescription>
                    请先在"API设置"标签页配置您的Amazon广告API凭证
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Cloud className="h-5 w-5" />
                        数据同步
                      </CardTitle>
                      <CardDescription>
                        从Amazon广告平台同步最新数据到本地系统
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="bg-muted/50">
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">广告活动</p>
                                <p className="text-xs text-muted-foreground">Campaigns</p>
                              </div>
                              <Database className="h-8 w-8 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-muted/50">
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">广告组</p>
                                <p className="text-xs text-muted-foreground">Ad Groups</p>
                              </div>
                              <Database className="h-8 w-8 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-muted/50">
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">关键词</p>
                                <p className="text-xs text-muted-foreground">Keywords</p>
                              </div>
                              <Database className="h-8 w-8 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-muted/50">
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">绩效数据</p>
                                <p className="text-xs text-muted-foreground">Performance</p>
                              </div>
                              <Database className="h-8 w-8 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="flex gap-4">
                        <Button onClick={handleSyncAll} disabled={isSyncing} className="flex-1">
                          {isSyncing ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              同步中...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              同步所有数据
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Play className="h-5 w-5" />
                        自动优化
                      </CardTitle>
                      <CardDescription>
                        基于同步的数据运行出价优化算法，并将调整同步到Amazon
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Alert className="mb-4">
                        <Info className="h-4 w-4" />
                        <AlertTitle>注意</AlertTitle>
                        <AlertDescription>
                          自动优化将根据绩效组的目标设置计算最优出价，并通过API直接调整Amazon广告的出价。
                          建议先在"绩效组"页面配置好优化目标后再运行。
                        </AlertDescription>
                      </Alert>
                      <Button variant="outline" disabled>
                        <Play className="h-4 w-4 mr-2" />
                        运行自动优化（需选择绩效组）
                      </Button>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            {/* Guide Tab */}
            <TabsContent value="guide" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5" />
                    Amazon Advertising API 接入指南
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">步骤1: 创建Amazon Developer账号</h3>
                    <p className="text-muted-foreground">
                      访问 Amazon Developer Console 创建开发者账号，并申请 Amazon Advertising API 访问权限。
                    </p>
                    <Button variant="outline" asChild>
                      <a href="https://developer.amazon.com/" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        访问 Amazon Developer Console
                      </a>
                    </Button>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">步骤2: 创建LWA应用</h3>
                    <p className="text-muted-foreground">
                      在 Security Profile 中创建一个新的 Login with Amazon (LWA) 应用，获取 Client ID 和 Client Secret。
                    </p>
                    <div className="bg-muted p-4 rounded-lg">
                      <p className="text-sm font-mono">
                        Redirect URI: {window.location.origin}/api/amazon/callback
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">步骤3: 获取授权</h3>
                    <p className="text-muted-foreground">
                      使用OAuth 2.0流程获取用户授权，获得 Refresh Token。您需要：
                    </p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-1">
                      <li>构建授权URL并引导用户授权</li>
                      <li>处理回调获取授权码</li>
                      <li>使用授权码换取 Access Token 和 Refresh Token</li>
                    </ul>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">步骤4: 获取Profile ID</h3>
                    <p className="text-muted-foreground">
                      使用获取的 Token 调用 /v2/profiles 接口获取您的广告账号 Profile ID。
                    </p>
                    <div className="bg-muted p-4 rounded-lg">
                      <pre className="text-sm font-mono whitespace-pre-wrap">
{`GET https://advertising-api.amazon.com/v2/profiles
Authorization: Bearer {access_token}
Amazon-Advertising-API-ClientId: {client_id}`}
                      </pre>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">API区域说明</h3>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4">
                          <h4 className="font-medium">北美 (NA)</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            美国、加拿大、墨西哥、巴西
                          </p>
                          <p className="text-xs font-mono mt-2">
                            advertising-api.amazon.com
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4">
                          <h4 className="font-medium">欧洲 (EU)</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            英国、德国、法国、意大利、西班牙等
                          </p>
                          <p className="text-xs font-mono mt-2">
                            advertising-api-eu.amazon.com
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4">
                          <h4 className="font-medium">远东 (FE)</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            日本、澳大利亚、新加坡
                          </p>
                          <p className="text-xs font-mono mt-2">
                            advertising-api-fe.amazon.com
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>需要帮助？</AlertTitle>
                    <AlertDescription>
                      如果您在接入过程中遇到问题，请参考 
                      <a 
                        href="https://advertising.amazon.com/API/docs/en-us" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="underline ml-1"
                      >
                        Amazon Advertising API 官方文档
                      </a>
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
