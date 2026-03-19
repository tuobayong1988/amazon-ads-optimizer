/**
 * ML预算优化组件
 * 
 * 基于机器学习的智能预算分配建议
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, DollarSign, Target, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { OptimizationVisualizer } from "@/components/OptimizationVisualizer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MLBudgetOptimizationProps {
  accountId: number | null;
}

export function MLBudgetOptimization({ accountId }: MLBudgetOptimizationProps) {
  const [objective, setObjective] = useState<'maximize_sales' | 'target_acos' | 'target_roas'>('maximize_sales');
  const [targetValue, setTargetValue] = useState<number>(30);

  // 获取预算分配建议
  const allocateMutation = trpc.mlOptimization.optimizeBudgetAllocation.useMutation();
  const allocation = allocateMutation.data;
  const isLoading = allocateMutation.isPending;
  const refetch = () => {
    if (accountId) {
      allocateMutation.mutate({
        performanceGroupId: String(accountId),
        totalBudget: 1000,
        daysOfHistory: 30,
      });
    }
  };

  if (!accountId) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>请先选择广告账户</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 优化目标选择 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">优化目标</CardTitle>
          <CardDescription>选择预算分配的优化目标</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">优化目标</label>
              <Select value={objective} onValueChange={(v: unknown) => setObjective(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maximize_sales">最大化销售额</SelectItem>
                  <SelectItem value="target_acos">目标ACoS</SelectItem>
                  <SelectItem value="target_roas">目标ROAS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {objective !== 'maximize_sales' && (
              <div>
                <label className="text-sm font-medium">
                  {objective === 'target_acos' ? '目标ACoS (%)' : '目标ROAS'}
                </label>
                <input
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-md"
                  min="0"
                  step={objective === 'target_acos' ? '1' : '0.1'}
                />
              </div>
            )}
          </div>

          <Button onClick={() => refetch()} className="w-full">
            <TrendingUp className="w-4 h-4 mr-2" />
            重新计算
          </Button>
        </CardContent>
      </Card>

      {/* 预算分配建议 */}
      {allocation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">预算分配建议</CardTitle>
            <CardDescription>
              基于历史表现数据的智能预算分配方案
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* 总体指标 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">总预算</div>
                  <div className="text-2xl font-bold">
                    ${(allocation.summary?.totalBudget || 0).toFixed(0)}
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">预期销售额</div>
                  <div className="text-2xl font-bold text-green-600">
                    ${(allocation.summary?.totalExpectedSales || 0).toFixed(0)}
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">预期ACoS</div>
                  <div className="text-2xl font-bold">
                    {(allocation.summary?.overallROAS ? (1 / allocation.summary.overallROAS * 100) : 0).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* 广告活动分配表 */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>广告活动</TableHead>
                    <TableHead className="text-right">当前预算</TableHead>
                    <TableHead className="text-right">建议预算</TableHead>
                    <TableHead className="text-right">变化</TableHead>
                    <TableHead className="text-right">预期销售额</TableHead>
                    <TableHead className="text-right">预期ACoS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(allocation.allocations || []).map((item: unknown) => {
                    const change = item.allocatedBudget - item.currentBudget;
                    const changePercent = (change / item.currentBudget) * 100;

                    return (
                      <TableRow key={item.campaignId}>
                        <TableCell className="font-medium">
                          {item.campaignName}
                        </TableCell>
                        <TableCell className="text-right">
                          ${item.currentBudget.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ${item.allocatedBudget.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={change > 0 ? 'default' : 'secondary'}>
                            {change > 0 ? '+' : ''}
                            {changePercent.toFixed(0)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          ${item.expectedSales.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.expectedAcos.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* 应用建议按钮 */}
              <Button className="w-full" size="lg">
                <Target className="w-4 h-4 mr-2" />
                应用预算分配建议
              </Button>

              {/* 优化决策可视化 */}
              <OptimizationVisualizer
                data={(allocation.allocations || []).map((a: unknown) => ({ value: a.allocatedBudget, sales: a.expectedSales }))}
                type="budget-optimization"
                currentValue={allocation.summary?.totalBudget || 0}
                suggestedValue={allocation.summary?.totalAllocated || 0}
                metric="Sales"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
