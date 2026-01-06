/**
 * OnboardingWizard - 首次登录引导流程组件
 * 引导用户完成Amazon API授权和首次数据同步
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Rocket,
  Cloud,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Zap,
  BarChart3,
  Shield,
  Loader2,
  ExternalLink,
  PartyPopper
} from "lucide-react";

interface OnboardingWizardProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onPause?: (step: OnboardingStep) => void;
  initialStep?: OnboardingStep;
}

type OnboardingStep = "welcome" | "connect" | "sync" | "complete";

const ONBOARDING_STORAGE_KEY = "amazon-ads-optimizer-onboarding-completed";
const ONBOARDING_PROGRESS_KEY = "amazon-ads-optimizer-onboarding-progress";

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [savedProgress, setSavedProgress] = useState<OnboardingStep | null>(null);

  // 检查是否有已授权的账号
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery();

  useEffect(() => {
    if (accountsLoading) return;

    // 检查本地存储中是否已完成引导
    const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    
    // 检查是否有保存的进度
    const progress = localStorage.getItem(ONBOARDING_PROGRESS_KEY) as OnboardingStep | null;
    if (progress) {
      setSavedProgress(progress);
    }
    
    // 如果没有完成引导且没有已授权账号，显示引导
    if (!completed && (!accounts || accounts.length === 0)) {
      setShowOnboarding(true);
    }
    
    setIsChecking(false);
  }, [accounts, accountsLoading]);

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    localStorage.removeItem(ONBOARDING_PROGRESS_KEY);
    setShowOnboarding(false);
  };

  const skipOnboarding = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "skipped");
    localStorage.removeItem(ONBOARDING_PROGRESS_KEY);
    setShowOnboarding(false);
  };

  const pauseOnboarding = (step: OnboardingStep) => {
    localStorage.setItem(ONBOARDING_PROGRESS_KEY, step);
    setShowOnboarding(false);
  };

  const resumeOnboarding = () => {
    setShowOnboarding(true);
  };

  const resetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    localStorage.removeItem(ONBOARDING_PROGRESS_KEY);
    setSavedProgress(null);
    setShowOnboarding(true);
  };

  return {
    showOnboarding,
    isChecking: isChecking || accountsLoading,
    completeOnboarding,
    skipOnboarding,
    pauseOnboarding,
    resumeOnboarding,
    resetOnboarding,
    savedProgress,
    hasAccounts: accounts && accounts.length > 0
  };
}

export default function OnboardingWizard({ isOpen, onComplete, onSkip, onPause, initialStep }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(initialStep || "welcome");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // 获取账号列表
  const { data: accounts, refetch: refetchAccounts } = trpc.adAccount.list.useQuery();
  const hasAccounts = accounts && accounts.length > 0;

  // 创建同步任务
  const createSyncJob = trpc.dataSync.createJob.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("数据同步已启动");
        // 模拟同步进度
        simulateSyncProgress();
      } else {
        toast.error(result.message || "同步启动失败");
        setIsSyncing(false);
      }
    },
    onError: (error) => {
      toast.error(`同步失败: ${error.message}`);
      setIsSyncing(false);
    }
  });

  const simulateSyncProgress = () => {
    setSyncProgress(0);
    const interval = setInterval(() => {
      setSyncProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsSyncing(false);
          setCurrentStep("complete");
          return 100;
        }
        return prev + 10;
      });
    }, 500);
  };

  const steps: { id: OnboardingStep; title: string; description: string }[] = [
    { id: "welcome", title: "欢迎使用", description: "了解系统功能" },
    { id: "connect", title: "连接API", description: "授权Amazon账号" },
    { id: "sync", title: "同步数据", description: "获取广告数据" },
    { id: "complete", title: "设置完成", description: "开始优化" }
  ];

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handleConnectApi = () => {
    setIsConnecting(true);
    // 跳转到Amazon API设置页面
    window.location.href = "/amazon-api";
  };

  const handleStartSync = () => {
    if (!accounts || accounts.length === 0) {
      toast.error("请先连接Amazon API");
      return;
    }

    setIsSyncing(true);
    createSyncJob.mutate({
      accountId: accounts[0].id,
      syncType: "all"
    });
  };

  const handleNext = () => {
    switch (currentStep) {
      case "welcome":
        setCurrentStep("connect");
        break;
      case "connect":
        if (hasAccounts) {
          setCurrentStep("sync");
        } else {
          handleConnectApi();
        }
        break;
      case "sync":
        if (!isSyncing) {
          handleStartSync();
        }
        break;
      case "complete":
        onComplete();
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case "connect":
        setCurrentStep("welcome");
        break;
      case "sync":
        setCurrentStep("connect");
        break;
      case "complete":
        setCurrentStep("sync");
        break;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="p-6 rounded-full bg-primary/10">
                <Rocket className="w-16 h-16 text-primary" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">欢迎使用亚马逊广告优化系统</h3>
              <p className="text-muted-foreground">
                让我们花几分钟时间完成初始设置，开启您的智能广告优化之旅
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-primary/20">
                <CardContent className="pt-6 text-center">
                  <Zap className="w-8 h-8 mx-auto mb-2 text-yellow-500" />
                  <h4 className="font-medium">智能优化</h4>
                  <p className="text-sm text-muted-foreground">AI驱动的竞价和预算优化</p>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                  <h4 className="font-medium">数据分析</h4>
                  <p className="text-sm text-muted-foreground">全面的绩效监控和报告</p>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-6 text-center">
                  <Shield className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <h4 className="font-medium">安全可靠</h4>
                  <p className="text-sm text-muted-foreground">数据加密和权限管理</p>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      case "connect":
        return (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="p-6 rounded-full bg-blue-500/10">
                <Cloud className="w-16 h-16 text-blue-500" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">连接Amazon Advertising API</h3>
              <p className="text-muted-foreground">
                授权系统访问您的亚马逊广告账号，实现数据自动同步
              </p>
            </div>
            
            {hasAccounts ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                  <div>
                    <p className="font-medium text-green-600">已连接 {accounts.length} 个账号</p>
                    <p className="text-sm text-muted-foreground">
                      {accounts.map(a => a.accountName).join(", ")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">连接步骤：</h4>
                  <ol className="text-sm text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <Badge variant="outline" className="mt-0.5">1</Badge>
                      <span>点击下方按钮进入API设置页面</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Badge variant="outline" className="mt-0.5">2</Badge>
                      <span>选择要连接的市场并点击"开始授权"</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Badge variant="outline" className="mt-0.5">3</Badge>
                      <span>在Amazon页面登录并授权访问</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Badge variant="outline" className="mt-0.5">4</Badge>
                      <span>授权完成后返回此页面继续</span>
                    </li>
                  </ol>
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleConnectApi}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      正在跳转...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      前往连接Amazon API
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        );

      case "sync":
        return (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="p-6 rounded-full bg-green-500/10">
                <RefreshCw className={`w-16 h-16 text-green-500 ${isSyncing ? 'animate-spin' : ''}`} />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">同步广告数据</h3>
              <p className="text-muted-foreground">
                从Amazon获取您的广告活动、关键词和绩效数据
              </p>
            </div>

            {isSyncing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>正在同步数据...</span>
                    <span>{syncProgress}%</span>
                  </div>
                  <Progress value={syncProgress} />
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground text-center">
                    首次同步可能需要几分钟时间，请耐心等待
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">将同步以下数据：</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      广告活动和广告组
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      关键词和ASIN定位
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      历史绩效数据
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      预算和竞价设置
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        );

      case "complete":
        return (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="p-6 rounded-full bg-yellow-500/10">
                <PartyPopper className="w-16 h-16 text-yellow-500" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">设置完成！</h3>
              <p className="text-muted-foreground">
                恭喜！您已完成所有初始设置，现在可以开始使用系统了
              </p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
                <div>
                  <p className="font-medium text-green-600">所有设置已完成</p>
                  <p className="text-sm text-muted-foreground">
                    系统已准备就绪，点击"开始使用"进入仪表盘
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-primary">{accounts?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">已连接账号</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-green-500">✓</p>
                  <p className="text-sm text-muted-foreground">数据已同步</p>
                </CardContent>
              </Card>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[600px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            初始设置向导
          </DialogTitle>
          <DialogDescription>
            完成以下步骤开始使用亚马逊广告优化系统
          </DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="py-4">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  index <= currentStepIndex 
                    ? 'bg-primary text-primary-foreground' 
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {index < currentStepIndex ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    index + 1
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-12 md:w-20 h-1 mx-1 ${
                    index < currentStepIndex ? 'bg-primary' : 'bg-muted'
                  }`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            {steps.map(step => (
              <span key={step.id} className="w-16 text-center">{step.title}</span>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="py-4">
          {renderStepContent()}
        </div>

        <DialogFooter className="flex justify-between">
          <div className="flex gap-2">
            {currentStep !== "welcome" && currentStep !== "complete" && (
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                上一步
              </Button>
            )}
            {currentStep === "welcome" && (
              <Button variant="ghost" onClick={onSkip}>
                跳过引导
              </Button>
            )}
            {currentStep !== "welcome" && currentStep !== "complete" && (
              <Button 
                variant="ghost" 
                onClick={() => {
                  if (onPause) {
                    onPause(currentStep);
                    toast.info("引导进度已保存，您可以稍后继续");
                  } else {
                    onSkip();
                  }
                }}
              >
                稍后完成
              </Button>
            )}
          </div>
          <Button 
            onClick={handleNext}
            disabled={
              (currentStep === "connect" && !hasAccounts && isConnecting) ||
              (currentStep === "sync" && isSyncing)
            }
          >
            {currentStep === "complete" ? (
              <>
                开始使用
                <CheckCircle2 className="w-4 h-4 ml-2" />
              </>
            ) : currentStep === "sync" && !isSyncing ? (
              <>
                开始同步
                <RefreshCw className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                {currentStep === "connect" && hasAccounts ? "下一步" : "继续"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
