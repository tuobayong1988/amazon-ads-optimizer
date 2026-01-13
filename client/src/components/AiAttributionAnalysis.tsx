/**
 * AI归因分析组件
 * 解释AI做了什么优化，让用户知道为什么这么优化
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Brain, TrendingDown, TrendingUp, Ban, DollarSign, Target, AlertTriangle, CheckCircle2, Pause, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface OptimizationAction {
  type: "negative_keyword" | "bid_decrease" | "bid_increase" | "budget_adjust" | "pause_campaign";
  description: string;
  impact: string;
  count?: number;
  keywords?: string[];
  campaigns?: string[];
}

interface AiAttributionAnalysisProps {
  acosChange: number;
  roasChange: number;
  spendChange: number;
  salesChange: number;
  actions: OptimizationAction[];
  isAutoMode: boolean;
  onModeChange: (auto: boolean) => void;
  onEmergencyStop?: () => void;
}

const actionIcons: Record<string, React.ReactNode> = {
  negative_keyword: <Ban className="w-4 h-4 text-red-500" />,
  bid_decrease: <TrendingDown className="w-4 h-4 text-orange-500" />,
  bid_increase: <TrendingUp className="w-4 h-4 text-green-500" />,
  budget_adjust: <DollarSign className="w-4 h-4 text-blue-500" />,
  pause_campaign: <Pause className="w-4 h-4 text-yellow-500" />,
};

const actionLabels: Record<string, string> = {
  negative_keyword: "否定关键词",
  bid_decrease: "降低竞价",
  bid_increase: "提高竞价",
  budget_adjust: "调整预算",
  pause_campaign: "暂停广告",
};

export function AiAttributionAnalysis({
  acosChange,
  roasChange,
  spendChange,
  salesChange,
  actions,
  isAutoMode,
  onModeChange,
  onEmergencyStop,
}: AiAttributionAnalysisProps) {
  // 生成归因分析文案
  const generateAttributionText = () => {
    const parts: string[] = [];
    
    if (acosChange < 0) {
      parts.push(`ACoS 下降 ${Math.abs(acosChange).toFixed(1)}%`);
    } else if (acosChange > 0) {
      parts.push(`ACoS 上升 ${acosChange.toFixed(1)}%`);
    }

    const negativeActions = actions.filter(a => a.type === "negative_keyword");
    const bidDecreaseActions = actions.filter(a => a.type === "bid_decrease");
    const bidIncreaseActions = actions.filter(a => a.type === "bid_increase");

    if (negativeActions.length > 0) {
      const totalKeywords = negativeActions.reduce((sum, a) => sum + (a.count || 0), 0);
      if (totalKeywords > 0) {
        parts.push(`自动否决了 ${totalKeywords} 个低效词`);
      }
    }

    if (bidDecreaseActions.length > 0) {
      const totalCampaigns = bidDecreaseActions.reduce((sum, a) => sum + (a.count || 0), 0);
      if (totalCampaigns > 0) {
        parts.push(`降低了 ${totalCampaigns} 个广告活动的竞价`);
      }
    }

    if (bidIncreaseActions.length > 0) {
      const totalCampaigns = bidIncreaseActions.reduce((sum, a) => sum + (a.count || 0), 0);
      if (totalCampaigns > 0) {
        parts.push(`提高了 ${totalCampaigns} 个高效广告活动的竞价`);
      }
    }

    return parts.join("，");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            AI优化归因分析
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="auto-mode" checked={isAutoMode} onCheckedChange={onModeChange} />
              <Label htmlFor="auto-mode" className="text-sm">
                {isAutoMode ? "自动执行" : "人工复核"}
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p><strong>自动执行</strong>：AI直接执行优化操作</p>
                    <p><strong>人工复核</strong>：AI生成建议，需人工确认后执行</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {isAutoMode && (
              <Button variant="destructive" size="sm" onClick={onEmergencyStop}>
                <AlertTriangle className="w-4 h-4 mr-1" />
                紧急刹车
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 归因分析摘要 */}
        <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
              <Brain className="w-4 h-4 text-purple-500" />
            </div>
            <div>
              <p className="text-sm leading-relaxed">
                {generateAttributionText() || "暂无优化操作记录"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                基于过去7天的数据分析
              </p>
            </div>
          </div>
        </div>

        {/* 优化效果指标 */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">ACoS变化</div>
            <div className={`text-lg font-bold ${acosChange <= 0 ? "text-green-500" : "text-red-500"}`}>
              {acosChange > 0 ? "+" : ""}{acosChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">ROAS变化</div>
            <div className={`text-lg font-bold ${roasChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {roasChange > 0 ? "+" : ""}{roasChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">花费变化</div>
            <div className={`text-lg font-bold ${spendChange <= 0 ? "text-green-500" : "text-yellow-500"}`}>
              {spendChange > 0 ? "+" : ""}{spendChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">销售额变化</div>
            <div className={`text-lg font-bold ${salesChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {salesChange > 0 ? "+" : ""}{salesChange.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* 具体操作列表 */}
        {actions.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">优化操作详情</div>
            <div className="space-y-2">
              {actions.map((action, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    {actionIcons[action.type]}
                    <div>
                      <div className="text-sm font-medium">{action.description}</div>
                      <div className="text-xs text-muted-foreground">{action.impact}</div>
                    </div>
                  </div>
                  <Badge variant="secondary">{actionLabels[action.type]}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {actions.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm">当前广告表现良好，暂无需要优化的操作</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AiAttributionAnalysis;
