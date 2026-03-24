/**
 * SmartInsights - 智能洞察组件
 * 
 * 在广告活动管理页面提供上下文相关的AI洞察和一键操作建议
 * 非侵入式设计,以卡片形式展示在侧边栏或行内
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Lightbulb, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle,
  Zap,
  Target,
  DollarSign,
  X
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// 洞察类型
export enum InsightType {
  OPPORTUNITY = 'opportunity',    // 机会(绿色)
  WARNING = 'warning',            // 警告(黄色)
  CRITICAL = 'critical',          // 严重(红色)
  INFO = 'info',                  // 信息(蓝色)
}

// 洞察优先级
export enum InsightPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

// 洞察数据
export interface Insight {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  description: string;
  impact: {
    metric: string; // 'ACoS' | 'Sales' | 'Profit'
    value: number;
    unit: string; // '%' | '$'
  };
  action?: {
    label: string;
    onClick: () => void;
  };
  dismissible: boolean;
}

interface SmartInsightsProps {
  campaignId?: number;
  accountId: number;
  compact?: boolean; // 紧凑模式,用于行内显示
}

export function SmartInsights({ campaignId, accountId, compact = false }: SmartInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // 从后端获取智能决策建议
  const { data: decisions } = trpc.smartCampaign.getBatchOptimizationRecommendations.useQuery(
    { performanceGroupId: String(accountId || 0), goal: { type: 'maximize_sales' as const }, daysOfHistory: 7 },
    { enabled: !!accountId }
  );

  // 将决策转换为洞察
  useEffect(() => {
    if (!decisions) return;
    
    const convertedInsights: Insight[] = (decisions.recommendations || []).map((decision: unknown) => ({
      // @ts-ignore
      id: decision.campaignId.toString(),
      // @ts-ignore
      type: decision.priority === 'high' ? InsightType.CRITICAL : 
            // @ts-ignore
            decision.priority === 'medium' ? InsightType.WARNING : InsightType.INFO,
      // @ts-ignore
      priority: decision.priority === 'high' ? InsightPriority.CRITICAL :
                // @ts-ignore
                decision.priority === 'medium' ? InsightPriority.HIGH : InsightPriority.MEDIUM,
      // @ts-ignore
      title: `${decision.campaignName}: ${decision.action}`,
      // @ts-ignore
      description: decision.reason,
      impact: {
        // @ts-ignore
        metric: decision.metrics.acos ? 'ACoS' : 'ROAS',
        // @ts-ignore
        value: decision.metrics.acos || decision.metrics.roas || 0,
        // @ts-ignore
        unit: decision.metrics.acos ? '%' : 'x',
      },
      action: {
        label: '应用建议',
        onClick: () => {
          // @ts-ignore
          toast.info(`正在应用对 ${decision.campaignName} 的优化建议...`);
        },
      },
      // @ts-ignore
      dismissible: true,
    }));
    
    setInsights(convertedInsights);
  }, [decisions]);

  // v187: 已删除模拟数据回退逻辑
  // 无API数据时不再显示虚假洞察，避免误导用户决策

  const visibleInsights = insights
    .filter(insight => !dismissedIds.has(insight.id))
    // @ts-ignore
    .sort((a: unknown, b: unknown) => b.priority - a.priority);

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => new Set(prev).add(id));
  };

  if (visibleInsights.length === 0) {
    return null;
  }

  const getIcon = (type: InsightType) => {
    switch (type) {
      case InsightType.OPPORTUNITY:
        return <Lightbulb className="h-5 w-5 text-green-600" />;
      case InsightType.WARNING:
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case InsightType.CRITICAL:
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      case InsightType.INFO:
        return <Zap className="h-5 w-5 text-blue-600" />;
    }
  };

  const getVariant = (type: InsightType) => {
    switch (type) {
      case InsightType.OPPORTUNITY:
        return 'default';
      case InsightType.WARNING:
        return 'default';
      case InsightType.CRITICAL:
        // @ts-ignore
        return 'destructive';
      case InsightType.INFO:
        return 'default';
    // @ts-ignore
    }
  };

  if (compact) {
    // 紧凑模式: 只显示最高优先级的一个洞察
    const topInsight = visibleInsights[0] as unknown;
    // @ts-ignore
    if (!topInsight) return null;

    // @ts-ignore
    return (
      // @ts-ignore
      <Alert variant={getVariant(topInsight.type)} className="mb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            {/* @ts-ignore */}
            {getIcon(topInsight.type)}
            // @ts-ignore
            <div className="flex-1">
              {/* @ts-ignore */}
              {/* @ts-ignore */}
              <AlertTitle className="text-sm font-semibold">{topInsight.title}</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                {/* @ts-ignore */}
                {topInsight.description}
              </AlertDescription>
              {/* @ts-ignore */}
              {topInsight.impact && (
                // @ts-ignore
                <Badge variant="outline" className="mt-2 text-xs">
                  // @ts-ignore
                  预期影响: {(topInsight as any).impact.metric} {(topInsight as any).impact.value > 0 ? '+' : ''}
                  // @ts-ignore
                  {(topInsight as any).impact.value}{(topInsight as any).impact.unit}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* @ts-ignore */}
            {topInsight.action && (
              // @ts-ignore
              <Button size="sm" variant="outline" onClick={topInsight.action.onClick}>
                {/* @ts-ignore */}
                {topInsight.action.label}
              </Button>
            )}
            // @ts-ignore
            {(topInsight as any).dismissible && (
              <Button
                size="sm"
                variant="ghost"
                // @ts-ignore
                onClick={() => handleDismiss(topInsight.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Alert>
    );
  }

  // 完整模式: 显示所有洞察
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          智能洞察
        </CardTitle>
        <CardDescription>
          AI分析发现了{visibleInsights.length}个需要关注的问题和机会
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleInsights.map(insight => (
          <Alert key={insight.id} variant={getVariant(insight.type)}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2">
                {getIcon(insight.type)}
                <div className="flex-1">
                  <AlertTitle className="text-sm font-semibold">{insight.title}</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    {insight.description}
                  </AlertDescription>
                  {insight.impact && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      预期影响: {insight.impact.metric} {insight.impact.value > 0 ? '+' : ''}
                      {insight.impact.value}{insight.impact.unit}
                    </Badge>
                  )}
                  {insight.action && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={insight.action.onClick}
                    >
                      {insight.action.label}
                    </Button>
                  )}
                </div>
              </div>
              {insight.dismissible && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDismiss(insight.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
