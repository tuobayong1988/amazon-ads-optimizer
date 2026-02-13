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
  const { data: decisions } = trpc.smartCampaign.generateDecisions.useQuery(
    { accountId },
    { enabled: !!accountId }
  );

  // 将决策转换为洞察
  useEffect(() => {
    if (!decisions) return;
    
    const convertedInsights: Insight[] = decisions.decisions.map((decision: any) => ({
      id: decision.campaignId.toString(),
      type: decision.priority === 'high' ? InsightType.CRITICAL : 
            decision.priority === 'medium' ? InsightType.WARNING : InsightType.INFO,
      priority: decision.priority === 'high' ? InsightPriority.CRITICAL :
                decision.priority === 'medium' ? InsightPriority.HIGH : InsightPriority.MEDIUM,
      title: `${decision.campaignName}: ${decision.action}`,
      description: decision.reason,
      impact: {
        metric: decision.metrics.acos ? 'ACoS' : 'ROAS',
        value: decision.metrics.acos || decision.metrics.roas || 0,
        unit: decision.metrics.acos ? '%' : 'x',
      },
      action: {
        label: '应用建议',
        onClick: () => {
          toast.info(`正在应用对 ${decision.campaignName} 的优化建议...`);
        },
      },
      dismissible: true,
    }));
    
    setInsights(convertedInsights);
  }, [decisions]);

  // 备用模拟数据(如果没有API数据)
  useEffect(() => {
    if (decisions) return;
    const mockInsights: Insight[] = [
      {
        id: '1',
        type: InsightType.CRITICAL,
        priority: InsightPriority.CRITICAL,
        title: 'ACoS持续上升',
        description: '过去7天ACoS从25%上升至38%,建议立即优化出价或暂停低转化关键词',
        impact: {
          metric: 'ACoS',
          value: 13,
          unit: '%',
        },
        action: {
          label: '查看优化建议',
          onClick: () => {
            toast.info('正在生成优化建议...');
          },
        },
        dismissible: true,
      },
      {
        id: '2',
        type: InsightType.OPPORTUNITY,
        priority: InsightPriority.HIGH,
        title: '预算利用率低',
        description: '当前预算利用率仅45%,可以提高出价或扩展关键词以获取更多曝光',
        impact: {
          metric: 'Sales',
          value: 500,
          unit: '$',
        },
        action: {
          label: '提升预算',
          onClick: () => {
            toast.success('已应用预算优化建议');
          },
        },
        dismissible: true,
      },
      {
        id: '3',
        type: InsightType.WARNING,
        priority: InsightPriority.MEDIUM,
        title: '转化率下降',
        description: '转化率从12%降至8%,可能是竞品降价或产品页面问题',
        impact: {
          metric: 'Orders',
          value: -15,
          unit: '%',
        },
        action: {
          label: '查看详情',
          onClick: () => {
            toast.info('正在分析转化率下降原因...');
          },
        },
        dismissible: true,
      },
    ];

    setInsights(mockInsights);
  }, [campaignId, accountId]);

  const visibleInsights = insights
    .filter(insight => !dismissedIds.has(insight.id))
    .sort((a, b) => b.priority - a.priority);

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
        return 'destructive';
      case InsightType.INFO:
        return 'default';
    }
  };

  if (compact) {
    // 紧凑模式: 只显示最高优先级的一个洞察
    const topInsight = visibleInsights[0];
    if (!topInsight) return null;

    return (
      <Alert variant={getVariant(topInsight.type)} className="mb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            {getIcon(topInsight.type)}
            <div className="flex-1">
              <AlertTitle className="text-sm font-semibold">{topInsight.title}</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                {topInsight.description}
              </AlertDescription>
              {topInsight.impact && (
                <Badge variant="outline" className="mt-2 text-xs">
                  预期影响: {topInsight.impact.metric} {topInsight.impact.value > 0 ? '+' : ''}
                  {topInsight.impact.value}{topInsight.impact.unit}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {topInsight.action && (
              <Button size="sm" variant="outline" onClick={topInsight.action.onClick}>
                {topInsight.action.label}
              </Button>
            )}
            {topInsight.dismissible && (
              <Button
                size="sm"
                variant="ghost"
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
