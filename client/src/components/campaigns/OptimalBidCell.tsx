/**
 * v394: OptimalBidCell - 利润最大化出价点显示组件（带一键采纳按钮）
 * 从Campaigns.tsx拆分为独立组件，支持lazy loading
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  CircleDollarSign,
} from "lucide-react";

interface OptimalBidCellProps {
  campaignId: string;
  accountId: number;
  onApplySuccess?: () => void;
}

export default function OptimalBidCell({ campaignId, accountId, onApplySuccess }: OptimalBidCellProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  
  const { data, isLoading, error, refetch } = trpc.placement.getCampaignOptimalBids.useQuery(
    { campaignId, accountId },
    { 
      enabled: !!campaignId && !!accountId,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );
  
  const applyOptimalBids = trpc.placement.applyCampaignOptimalBids.useMutation({
    onSuccess: (result) => {
      toast.success(`已应用${result.summary.appliedCount}个关键词的最优出价，预估利润提升$${result.summary.totalExpectedProfitIncrease}`);
      setShowConfirmDialog(false);
      setIsApplying(false);
      refetch();
      onApplySuccess?.();
    },
    onError: (error) => {
      toast.error(`应用失败: ${error.message}`);
      setIsApplying(false);
    },
  });

  const handleApply = () => {
    setIsApplying(true);
    applyOptimalBids.mutate({
      campaignId,
      accountId,
      minBidDifferencePercent: 5,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-xs">计算中...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">暂无数据</span>
      </div>
    );
  }

  const { summary, keywords } = data;
  
  if (summary.analyzedKeywords === 0) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">无市场曲线数据</span>
      </div>
    );
  }

  const bidDiff = summary.avgOptimalBid - summary.avgCurrentBid;
  const bidDiffPercent = summary.avgCurrentBid > 0 
    ? ((bidDiff / summary.avgCurrentBid) * 100).toFixed(1) 
    : '0';
  const isIncrease = bidDiff > 0;
  const isSignificant = Math.abs(bidDiff) > summary.avgCurrentBid * 0.05;
  const hasAdjustments = summary.keywordsNeedIncrease > 0 || summary.keywordsNeedDecrease > 0;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <CircleDollarSign className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-sm font-medium">${summary.avgOptimalBid.toFixed(2)}</span>
          </div>
          {isSignificant && (
            <div className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
              isIncrease 
                ? 'bg-green-500/10 text-green-600' 
                : 'bg-red-500/10 text-red-600'
            }`}>
              {isIncrease ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{isIncrease ? '+' : ''}{bidDiffPercent}%</span>
            </div>
          )}
          {hasAdjustments && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfirmDialog(true);
              }}
            >
              <CheckCircle2 className="w-3 h-3 mr-0.5" />
              采纳
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>当前: ${summary.avgCurrentBid.toFixed(2)}</span>
          <span>·</span>
          <span className="text-green-600">↑{summary.keywordsNeedIncrease}</span>
          <span className="text-red-600">↓{summary.keywordsNeedDecrease}</span>
        </div>
      </div>
      
      {/* 确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="w-5 h-5 text-blue-500" />
              确认应用最优出价
            </DialogTitle>
            <DialogDescription>
              将根据利润最大化算法调整以下关键词的出价
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* 汇总信息 */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">待调整关键词</p>
                <p className="text-lg font-semibold">{summary.keywordsNeedIncrease + summary.keywordsNeedDecrease}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">平均调整幅度</p>
                <p className={`text-lg font-semibold ${isIncrease ? 'text-green-600' : 'text-red-600'}`}>
                  {isIncrease ? '+' : ''}{bidDiffPercent}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">预估利润提升</p>
                <p className="text-lg font-semibold text-green-600">${(summary.totalMaxProfit * 0.1).toFixed(2)}</p>
              </div>
            </div>
            
            {/* 调整明细 */}
            <div className="max-h-48 overflow-y-auto space-y-2">
              <p className="text-xs text-muted-foreground font-medium">调整明细（显示前10个）</p>
              {keywords.slice(0, 10).map((kw: any) => (
                <div key={kw.keywordId} className="flex items-center justify-between text-xs p-2 bg-muted/20 rounded">
                  <span className="truncate max-w-[200px]" title={kw.keywordText}>{kw.keywordText}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">${kw.currentBid.toFixed(2)}</span>
                    <span>→</span>
                    <span className={kw.recommendation === 'increase' ? 'text-green-600' : kw.recommendation === 'decrease' ? 'text-red-600' : ''}>
                      ${kw.optimalBid.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
              {keywords.length > 10 && (
                <p className="text-xs text-muted-foreground text-center">还有 {keywords.length - 10} 个关键词...</p>
              )}
            </div>
            
            {/* 警告信息 */}
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-700">
                <p className="font-medium">注意事项</p>
                <p>出价调整将立即生效，差距低于5%的关键词将被跳过</p>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} disabled={isApplying}>
              取消
            </Button>
            <Button onClick={handleApply} disabled={isApplying}>
              {isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  应用中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  确认应用
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
