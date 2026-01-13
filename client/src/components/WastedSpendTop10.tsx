/**
 * 浪费资金Top10排行榜组件
 * 展示花费高但转化为0的关键词
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Ban, DollarSign, MousePointer, Eye, TrendingDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface WastedKeyword {
  id: string;
  keyword: string;
  matchType: "broad" | "phrase" | "exact";
  campaignName: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  cpc: number;
}

interface WastedSpendTop10Props {
  keywords: WastedKeyword[];
  totalWastedSpend: number;
  onNegateKeyword?: (keywordId: string) => void;
  onNegateAll?: () => void;
}

const matchTypeLabels: Record<string, string> = {
  broad: "广泛",
  phrase: "词组",
  exact: "精确",
};

const matchTypeColors: Record<string, string> = {
  broad: "bg-blue-500/10 text-blue-500",
  phrase: "bg-purple-500/10 text-purple-500",
  exact: "bg-green-500/10 text-green-500",
};

export function WastedSpendTop10({
  keywords,
  totalWastedSpend,
  onNegateKeyword,
  onNegateAll,
}: WastedSpendTop10Props) {
  const maxSpend = Math.max(...keywords.map(k => k.spend), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            浪费资金 Top 10
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground">
              总浪费: <span className="text-red-500 font-bold">${totalWastedSpend.toFixed(2)}</span>
            </div>
            {keywords.length > 0 && (
              <Button variant="destructive" size="sm" onClick={onNegateAll}>
                <Ban className="w-4 h-4 mr-1" />
                一键否定全部
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {keywords.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <DollarSign className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm">太棒了！暂无明显浪费资金的关键词</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keywords.map((keyword, index) => (
              <div
                key={keyword.id}
                className="group relative p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-red-500">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{keyword.keyword}</span>
                        <Badge variant="secondary" className={matchTypeColors[keyword.matchType]}>
                          {matchTypeLabels[keyword.matchType]}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {keyword.campaignName}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              <MousePointer className="w-3 h-3" />
                              {keyword.clicks}
                            </TooltipTrigger>
                            <TooltipContent>点击数</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {keyword.impressions.toLocaleString()}
                            </TooltipTrigger>
                            <TooltipContent>曝光数</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <span className="flex items-center gap-1">
                          CTR: {keyword.ctr.toFixed(2)}%
                        </span>
                        <span className="flex items-center gap-1">
                          CPC: ${keyword.cpc.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-lg font-bold text-red-500">
                      ${keyword.spend.toFixed(2)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-red-500 hover:text-red-600 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onNegateKeyword?.(keyword.id)}
                    >
                      <Ban className="w-3 h-3 mr-1" />
                      否定
                    </Button>
                  </div>
                </div>
                {/* 花费进度条 */}
                <div className="mt-2">
                  <Progress
                    value={(keyword.spend / maxSpend) * 100}
                    className="h-1 bg-red-500/10"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        
        {keywords.length > 0 && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <TrendingDown className="w-4 h-4 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <span className="font-medium text-yellow-500">优化建议：</span>
                <span className="text-muted-foreground">
                  这些关键词花费了 ${totalWastedSpend.toFixed(2)} 但没有产生任何转化。
                  建议将它们添加为否定关键词以节省广告预算。
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default WastedSpendTop10;
