/**
 * 预算滑块模拟器组件
 * 用人话解释边际效益，让用户拖动滑块预览效果
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, TrendingDown, DollarSign, Target, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface BudgetSimulatorProps {
  currentBudget: number;
  currentSpend: number;
  currentSales: number;
  currentAcos: number;
  marginalCost: number; // 边际成本
  marginalRevenue: number; // 边际收益
  elasticity: number; // 弹性系数
  onApply?: (newBudget: number) => void;
}

export function BudgetSimulator({
  currentBudget,
  currentSpend,
  currentSales,
  currentAcos,
  marginalCost,
  marginalRevenue,
  elasticity,
  onApply,
}: BudgetSimulatorProps) {
  const [budgetMultiplier, setBudgetMultiplier] = useState(100); // 100% = 当前预算
  
  // 计算预测值
  const predictions = useMemo(() => {
    const multiplier = budgetMultiplier / 100;
    const budgetChange = multiplier - 1;
    
    // 基于弹性系数计算预测
    const predictedSpend = currentSpend * multiplier;
    
    // 销售额变化 = 预算变化 * 弹性系数 * 边际收益/边际成本
    const revenueMultiplier = 1 + budgetChange * elasticity * (marginalRevenue / Math.max(marginalCost, 0.01));
    const predictedSales = currentSales * Math.max(revenueMultiplier, 0.5); // 最低50%
    
    const predictedAcos = predictedSales > 0 ? (predictedSpend / predictedSales) * 100 : 0;
    const predictedRoas = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
    
    // 计算变化
    const spendChange = ((predictedSpend - currentSpend) / currentSpend) * 100;
    const salesChange = ((predictedSales - currentSales) / currentSales) * 100;
    const acosChange = predictedAcos - currentAcos;
    
    // 判断是否推荐
    const isRecommended = budgetMultiplier >= 90 && budgetMultiplier <= 130 && 
      (marginalRevenue > marginalCost || budgetMultiplier <= 100);
    
    return {
      newBudget: currentBudget * multiplier,
      predictedSpend,
      predictedSales,
      predictedAcos,
      predictedRoas,
      spendChange,
      salesChange,
      acosChange,
      isRecommended,
    };
  }, [budgetMultiplier, currentBudget, currentSpend, currentSales, currentAcos, marginalCost, marginalRevenue, elasticity]);

  // 生成人话解释
  const getExplanation = () => {
    if (budgetMultiplier === 100) {
      return "保持当前预算不变";
    }
    
    if (budgetMultiplier > 100) {
      const increase = budgetMultiplier - 100;
      if (marginalRevenue > marginalCost) {
        return `增加 ${increase}% 预算，预计能带来更多销售。因为每多花 $1 广告费，平均能带来 $${(marginalRevenue / marginalCost).toFixed(2)} 的销售额。`;
      } else {
        return `增加 ${increase}% 预算可能不划算。因为当前每多花 $1 广告费，只能带来 $${(marginalRevenue / marginalCost).toFixed(2)} 的销售额，低于成本。`;
      }
    } else {
      const decrease = 100 - budgetMultiplier;
      if (marginalRevenue < marginalCost) {
        return `减少 ${decrease}% 预算是明智的。当前边际投入产出比较低，减少预算可以提高整体效率。`;
      } else {
        return `减少 ${decrease}% 预算会损失一些销售机会，但可以降低ACoS。`;
      }
    }
  };

  // 获取推荐预算
  const getRecommendedBudget = () => {
    if (marginalRevenue > marginalCost * 1.5) {
      return Math.min(150, Math.round(100 * (marginalRevenue / marginalCost)));
    } else if (marginalRevenue < marginalCost * 0.8) {
      return Math.max(70, Math.round(100 * (marginalRevenue / marginalCost)));
    }
    return 100;
  };

  const recommendedBudget = getRecommendedBudget();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calculator className="w-5 h-5 text-blue-500" />
            预算模拟器
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>拖动滑块预览不同预算下的预期效果。基于历史数据和边际效益分析计算。</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 当前状态 */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">当前预算</div>
            <div className="text-lg font-bold">${currentBudget.toFixed(0)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">当前花费</div>
            <div className="text-lg font-bold">${currentSpend.toFixed(0)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">当前销售额</div>
            <div className="text-lg font-bold">${currentSales.toFixed(0)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">当前ACoS</div>
            <div className="text-lg font-bold">{currentAcos.toFixed(1)}%</div>
          </div>
        </div>

        {/* 滑块 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">调整预算</span>
            <div className="flex items-center gap-2">
              <Badge variant={predictions.isRecommended ? "default" : "secondary"}>
                {budgetMultiplier}%
              </Badge>
              {recommendedBudget !== 100 && budgetMultiplier !== recommendedBudget && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setBudgetMultiplier(recommendedBudget)}
                >
                  推荐: {recommendedBudget}%
                </Button>
              )}
            </div>
          </div>
          <Slider
            value={[budgetMultiplier]}
            onValueChange={(value) => setBudgetMultiplier(value[0])}
            min={50}
            max={200}
            step={5}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>-50%</span>
            <span>当前</span>
            <span>+100%</span>
          </div>
        </div>

        {/* 预测结果 */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">预测预算</div>
            <div className="text-lg font-bold text-blue-500">
              ${predictions.newBudget.toFixed(0)}
            </div>
            <div className={`text-xs ${predictions.spendChange >= 0 ? "text-yellow-500" : "text-green-500"}`}>
              {predictions.spendChange >= 0 ? "+" : ""}{predictions.spendChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">预测销售额</div>
            <div className="text-lg font-bold text-green-500">
              ${predictions.predictedSales.toFixed(0)}
            </div>
            <div className={`text-xs ${predictions.salesChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {predictions.salesChange >= 0 ? "+" : ""}{predictions.salesChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">预测ACoS</div>
            <div className={`text-lg font-bold ${predictions.predictedAcos <= currentAcos ? "text-green-500" : "text-red-500"}`}>
              {predictions.predictedAcos.toFixed(1)}%
            </div>
            <div className={`text-xs ${predictions.acosChange <= 0 ? "text-green-500" : "text-red-500"}`}>
              {predictions.acosChange >= 0 ? "+" : ""}{predictions.acosChange.toFixed(1)}%
            </div>
          </div>
          <div className="p-3 bg-card border rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">预测ROAS</div>
            <div className="text-lg font-bold text-purple-500">
              {predictions.predictedRoas.toFixed(2)}
            </div>
          </div>
        </div>

        {/* 人话解释 */}
        <div className={`p-4 rounded-lg border ${predictions.isRecommended ? "bg-green-500/10 border-green-500/20" : "bg-yellow-500/10 border-yellow-500/20"}`}>
          <div className="flex items-start gap-3">
            {predictions.isRecommended ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
            )}
            <div>
              <p className="text-sm leading-relaxed">{getExplanation()}</p>
              <div className="mt-2 text-xs text-muted-foreground">
                边际成本: ${marginalCost.toFixed(2)} | 边际收益: ${marginalRevenue.toFixed(2)} | 弹性系数: {elasticity.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* 应用按钮 */}
        {budgetMultiplier !== 100 && (
          <Button
            className="w-full"
            onClick={() => onApply?.(predictions.newBudget)}
          >
            <Target className="w-4 h-4 mr-2" />
            应用新预算: ${predictions.newBudget.toFixed(0)}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default BudgetSimulator;
