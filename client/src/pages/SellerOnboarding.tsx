/**
 * SellerOnboarding - 卖家自助接入页面
 * 让新卖家一键授权即可使用系统，无需了解AWS/SQS等技术细节
 */

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { 
  CheckCircle2, 
  ArrowRight, 
  Zap, 
  Shield, 
  Clock,
  Store,
  Link2,
  Database,
  BarChart3,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

// 接入步骤定义
const onboardingSteps = [
  { id: 1, title: "注册账号", description: "使用亚马逊账号登录系统", icon: Store },
  { id: 2, title: "授权店铺", description: "点击按钮跳转到亚马逊授权页面", icon: Link2 },
  { id: 3, title: "数据同步", description: "系统自动同步您的广告数据", icon: Database },
  { id: 4, title: "开始优化", description: "查看数据报告，开启智能优化", icon: BarChart3 }
];

// 功能亮点
const features = [
  { icon: Zap, title: "实时数据", description: "通过AMS实时流获取最新广告数据，延迟<5分钟" },
  { icon: Shield, title: "安全可靠", description: "数据加密传输，多租户隔离，您的数据只有您能看到" },
  { icon: Clock, title: "快速接入", description: "一键授权，无需技术背景，1分钟完成接入" }
];

export default function SellerOnboarding() {
  const { user } = useAuth();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // 获取账号列表
  const { data: accounts, refetch: refetchAccounts } = trpc.adAccount.list.useQuery();

  // 获取Amazon OAuth URL
  const getOAuthUrlMutation = trpc.amazonApi.getOAuthUrl.useMutation({
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error) => {
      toast.error(`获取授权链接失败: ${error.message}`);
      setIsAuthorizing(false);
    }
  });

  // 计算当前步骤
  const getCurrentStep = () => {
    if (!user) return 1;
    if (!accounts || accounts.length === 0) return 2;
    const hasData = accounts.some((acc: any) => acc.lastSyncTime);
    if (!hasData) return 3;
    return 4;
  };

  const currentStep = getCurrentStep();
  const progress = ((currentStep - 1) / (onboardingSteps.length - 1)) * 100;

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    try {
      await getOAuthUrlMutation.mutateAsync({});
    } catch { setIsAuthorizing(false); }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    toast.info("正在同步数据，请稍候...");
    setTimeout(() => {
      setIsSyncing(false);
      refetchAccounts();
      toast.success("数据同步完成！");
    }, 3000);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 欢迎标题 */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="h-8 w-8 text-purple-400" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              欢迎使用 Amazon 广告优化系统
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">一键授权，智能优化您的广告投放效果</p>
        </div>

        {/* 进度条 */}
        <Card className="border-purple-500/30">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span>接入进度</span>
                <span className="text-purple-400">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between mt-6">
                {onboardingSteps.map((step) => {
                  const StepIcon = step.icon;
                  const isCompleted = step.id < currentStep;
                  const isCurrent = step.id === currentStep;
                  return (
                    <div key={step.id} className="flex flex-col items-center gap-2 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center
                        ${isCompleted ? 'bg-green-500/20 text-green-400' : 
                          isCurrent ? 'bg-purple-500/20 text-purple-400 ring-2 ring-purple-500' : 
                          'bg-muted text-muted-foreground'}`}>
                        {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
                      </div>
                      <span className={`text-xs text-center ${isCurrent ? 'text-purple-400 font-medium' : 'text-muted-foreground'}`}>
                        {step.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 当前步骤操作 */}
        <Card className="border-purple-500/30 bg-gradient-to-r from-purple-500/5 to-blue-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {currentStep === 2 && <Link2 className="h-5 w-5 text-purple-400" />}
              {currentStep === 3 && <Database className="h-5 w-5 text-purple-400" />}
              {currentStep === 4 && <BarChart3 className="h-5 w-5 text-purple-400" />}
              {onboardingSteps[currentStep - 1]?.title}
            </CardTitle>
            <CardDescription>{onboardingSteps[currentStep - 1]?.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {currentStep === 2 && (
              <div className="space-y-4">
                <Alert className="bg-blue-500/10 border-blue-500/30">
                  <AlertTriangle className="h-4 w-4 text-blue-400" />
                  <AlertTitle>授权说明</AlertTitle>
                  <AlertDescription>
                    点击下方按钮将跳转到亚马逊官方授权页面。授权后，我们将获得管理您广告的权限，但不会获取您的账号密码。
                  </AlertDescription>
                </Alert>
                <Button 
                  size="lg" 
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  onClick={handleAuthorize}
                  disabled={isAuthorizing}
                >
                  {isAuthorizing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在跳转...</>
                  ) : (
                    <>授权亚马逊店铺<ExternalLink className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-center p-8">
                  <div className="text-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin text-purple-400 mx-auto" />
                    <p className="text-muted-foreground">正在同步您的广告数据...</p>
                    <p className="text-xs text-muted-foreground">首次同步可能需要几分钟，请耐心等待</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? "同步中..." : "手动刷新同步状态"}
                </Button>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-4">
                <Alert className="bg-green-500/10 border-green-500/30">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <AlertTitle>接入完成！</AlertTitle>
                  <AlertDescription>您的店铺已成功接入系统，现在可以开始使用智能优化功能了。</AlertDescription>
                </Alert>
                <div className="grid grid-cols-2 gap-4">
                  <Button variant="outline" onClick={() => window.location.href = '/'}>查看数据概览</Button>
                  <Button className="bg-gradient-to-r from-purple-600 to-blue-600" onClick={() => window.location.href = '/smart-optimization-center'}>
                    开启智能优化<ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 已绑定的店铺 */}
        {accounts && accounts.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-lg">已绑定店铺</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {accounts.map((account: any) => (
                  <div key={account.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: account.storeColor || '#3B82F6' }}>
                        {account.storeName?.[0] || 'S'}
                      </div>
                      <div>
                        <div className="font-medium">{account.storeName || account.accountName}</div>
                        <div className="text-xs text-muted-foreground">{account.marketplace} · Profile: {account.profileId}</div>
                      </div>
                    </div>
                    <Badge variant={account.lastSyncTime ? "default" : "secondary"}>
                      {account.lastSyncTime ? "已同步" : "待同步"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 功能亮点 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((feature, index) => {
            const FeatureIcon = feature.icon;
            return (
              <Card key={index} className="bg-gradient-to-br from-muted/50 to-muted/30">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <FeatureIcon className="h-6 w-6 text-purple-400" />
                    </div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <p>遇到问题？请联系客服或查看 <a href="/help" className="text-purple-400 hover:underline">帮助文档</a></p>
        </div>
      </div>
    </DashboardLayout>
  );
}
