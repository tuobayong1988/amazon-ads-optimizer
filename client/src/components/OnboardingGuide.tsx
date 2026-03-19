/**
 * 新用户 Onboarding 引导组件
 * P1优化: 首次登录分步引导 + 可随时重新触发
 */
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Rocket, ArrowRight, ArrowLeft, X, CheckCircle2,
  Globe, Target, BarChart3, Zap, Settings, Users,
  Sparkles, ChevronRight
} from "lucide-react";

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 PPCOPT',
    description: '这是一个智能广告优化系统，帮助您自动管理和优化Amazon广告投放。让我们花1分钟快速了解核心功能。',
    icon: Sparkles,
    iconColor: 'text-amber-400',
    bgColor: 'from-amber-500/20 to-orange-500/20',
  },
  {
    id: 'connect-api',
    title: 'Step 1: 连接 Amazon API',
    description: '首先，您需要连接Amazon Advertising API来同步广告数据。前往 Amazon API 设置页面，按照引导完成授权。',
    icon: Globe,
    iconColor: 'text-blue-400',
    bgColor: 'from-blue-500/20 to-cyan-500/20',
    action: { label: '前往API设置', route: '/amazon-api' },
  },
  {
    id: 'view-dashboard',
    title: 'Step 2: 查看数据概览',
    description: '数据同步完成后，运营指挥中心将展示所有广告账户的核心KPI：花费、销售额、ACoS、ROAS等。您可以自定义时间范围和卡片布局。',
    icon: BarChart3,
    iconColor: 'text-green-400',
    bgColor: 'from-green-500/20 to-emerald-500/20',
    action: { label: '查看数据概览', route: '/' },
  },
  {
    id: 'create-strategy',
    title: 'Step 3: 创建优化策略',
    description: '在策略管理中心，您可以从预设模板快速创建优化策略，也可以自定义优化目标。系统将自动对目标下的广告活动执行竞价、位置、预算等优化。',
    icon: Target,
    iconColor: 'text-purple-400',
    bgColor: 'from-purple-500/20 to-violet-500/20',
    action: { label: '创建优化策略', route: '/strategy-center' },
  },
  {
    id: 'prelaunch',
    title: 'Step 4: 探索预发布引擎',
    description: '如果您正在准备新品上架，预发布引擎可以帮您自动完成从关键词研究到广告框架搭建的全流程（M1→M7），一键生成并部署广告活动。',
    icon: Rocket,
    iconColor: 'text-indigo-400',
    bgColor: 'from-indigo-500/20 to-blue-500/20',
    action: { label: '进入预发布引擎', route: '/prelaunch' },
  },
  {
    id: 'complete',
    title: '准备就绪！',
    description: '您已了解系统的核心功能。系统将7x24小时自动监控和优化您的广告表现。如有问题，可随时在设置中重新查看引导。',
    icon: CheckCircle2,
    iconColor: 'text-green-400',
    bgColor: 'from-green-500/20 to-emerald-500/20',
  },
];

export function OnboardingGuide({ onComplete }: { onComplete: () => void }) {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const step = ONBOARDING_STEPS[currentStep];

  const updatePreferences = trpc.user.updatePreferences.useMutation();

  const handleComplete = () => {
    updatePreferences.mutate(
      { key: 'onboardingCompleted', value: true },
      { onSuccess: () => onComplete() }
    );
  };

  const handleSkip = () => {
    handleComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4 border-primary/20 shadow-2xl">
        <CardContent className="p-0">
          {/* 进度条 */}
          <div className="flex gap-1 p-4 pb-0">
            {ONBOARDING_STEPS.map((_: unknown, idx: unknown) => (
              <div
                key={idx}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  idx <= currentStep ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* 内容 */}
          <div className="p-6">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.bgColor} flex items-center justify-center mb-4`}>
              <step.icon className={`w-8 h-8 ${step.iconColor}`} />
            </div>

            <h2 className="text-xl font-bold mb-2">{step.title}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              {step.description}
            </p>

            {step.action && (
              <Button
                variant="outline"
                size="sm"
                className="mb-4"
                onClick={() => {
                  onComplete();
                  setLocation(step.action!.route);
                }}
              >
                {step.action.label}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>

          {/* 底部操作 */}
          <div className="flex items-center justify-between p-4 pt-0 border-t border-border/30 mt-2">
            <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
              <X className="w-4 h-4 mr-1" />
              跳过引导
            </Button>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(s => s - 1)}>
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  上一步
                </Button>
              )}
              {currentStep < ONBOARDING_STEPS.length - 1 ? (
                <Button size="sm" onClick={() => setCurrentStep(s => s + 1)}>
                  下一步
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={handleComplete} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  开始使用
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 通用空状态组件
 * P1优化: 为各页面提供一致的空状态体验
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionRoute,
  onAction,
  secondaryActionLabel,
  secondaryActionRoute,
  onSecondaryAction,
}: {
  icon: unknown;
  title: string;
  description: string;
  actionLabel?: string;
  actionRoute?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  secondaryActionRoute?: string;
  onSecondaryAction?: () => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mb-6">
        <Icon className="w-10 h-10 text-muted-foreground/50" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm text-center max-w-md mb-6 leading-relaxed">
        {description}
      </p>
      <div className="flex items-center gap-3">
        {actionLabel && (
          <Button
            onClick={() => {
              if (onAction) onAction();
              else if (actionRoute) setLocation(actionRoute);
            }}
          >
            {actionLabel}
          </Button>
        )}
        {secondaryActionLabel && (
          <Button
            variant="outline"
            onClick={() => {
              if (onSecondaryAction) onSecondaryAction();
              else if (secondaryActionRoute) setLocation(secondaryActionRoute);
            }}
          >
            {secondaryActionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 数据概览未选择品牌时的引导卡片
 */
export function NoBrandSelectedGuide() {
  const [, setLocation] = useLocation();

  return (
    <Card className="border-dashed border-primary/30 bg-gradient-to-br from-blue-500/5 to-purple-500/5">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
          <Globe className="w-8 h-8 text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">连接您的Amazon广告账户</h3>
        <p className="text-muted-foreground text-sm text-center max-w-md mb-6">
          系统需要连接Amazon Advertising API才能同步和优化您的广告数据。
          完成API授权后，这里将展示您所有广告账户的核心KPI指标。
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={() => setLocation('/amazon-api')}>
            <Globe className="w-4 h-4 mr-2" />
            连接 Amazon API
          </Button>
          <Button variant="outline" onClick={() => setLocation('/settings')}>
            <Settings className="w-4 h-4 mr-2" />
            系统设置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
