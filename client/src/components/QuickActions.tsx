/**
 * 快速操作按钮组件
 * 鼠标悬停时显示快捷操作：+预算、暂停、调整竞价
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pause, Play, TrendingUp, TrendingDown, DollarSign, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface QuickActionsProps {
  campaignId: string;
  accountId: number;
  currentBudget: number;
  status: string;
  onBudgetChange?: (newBudget: number) => void;
  onStatusChange?: (newStatus: string) => void;
  onBidChange?: (multiplier: number) => void;
}

export function QuickActions({ campaignId, accountId, currentBudget, status, onBudgetChange, onStatusChange, onBidChange }: QuickActionsProps) {
  const [budgetAmount, setBudgetAmount] = useState("20");
  const [bidAdjustment, setBidAdjustment] = useState("10");
  const [isLoading, setIsLoading] = useState(false);

  const handleAddBudget = () => {
    const amount = parseFloat(budgetAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("请输入有效的预算金额"); return; }
    setIsLoading(true);
    setTimeout(() => {
      onBudgetChange?.((Number(currentBudget) || 0) + amount);
      toast.success(`预算已增加 $${amount}`);
      setIsLoading(false);
    }, 500);
  };

  const handleToggleStatus = () => {
    setIsLoading(true);
    setTimeout(() => {
      const newStatus = status === "enabled" ? "paused" : "enabled";
      onStatusChange?.(newStatus);
      toast.success(status === "enabled" ? "广告活动已暂停" : "广告活动已启用");
      setIsLoading(false);
    }, 500);
  };

  const handleAdjustBid = (direction: "up" | "down") => {
    const percentage = parseFloat(bidAdjustment);
    if (isNaN(percentage) || percentage <= 0) { toast.error("请输入有效的调整比例"); return; }
    setIsLoading(true);
    const multiplier = direction === "up" ? 1 + percentage / 100 : 1 - percentage / 100;
    setTimeout(() => {
      onBidChange?.(multiplier);
      toast.success(`竞价已${direction === "up" ? "提高" : "降低"} ${percentage}%`);
      setIsLoading(false);
    }, 500);
  };

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <TooltipProvider>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10">
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>增加预算</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-56" align="end">
            <div className="space-y-3">
              <div className="text-sm font-medium">增加预算</div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <Input type="number" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} placeholder="20" className="h-8" />
              </div>
              <div className="text-xs text-muted-foreground">当前预算: ${(Number(currentBudget) || 0).toFixed(2)}</div>
              <Button size="sm" className="w-full" onClick={handleAddBudget} disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                确认增加 ${budgetAmount}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${status === "enabled" ? "text-yellow-500 hover:text-yellow-600 hover:bg-yellow-500/10" : "text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"}`} onClick={handleToggleStatus} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "enabled" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{status === "enabled" ? "暂停广告活动" : "启用广告活动"}</TooltipContent>
        </Tooltip>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-purple-500 hover:text-purple-600 hover:bg-purple-500/10">
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>调整竞价</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-64" align="end">
            <div className="space-y-3">
              <div className="text-sm font-medium">调整竞价</div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">调整比例</Label>
                <Input type="number" value={bidAdjustment} onChange={(e) => setBidAdjustment(e.target.value)} placeholder="10" className="h-8" />
                <span className="text-sm">%</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => handleAdjustBid("down")} disabled={isLoading}>
                  <TrendingDown className="h-4 w-4 mr-1" />降低
                </Button>
                <Button size="sm" variant="outline" className="text-green-500 hover:text-green-600" onClick={() => handleAdjustBid("up")} disabled={isLoading}>
                  <TrendingUp className="h-4 w-4 mr-1" />提高
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </div>
  );
}

export default QuickActions;
