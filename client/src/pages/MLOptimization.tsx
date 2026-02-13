/**
 * ML优化页面
 * 机器学习出价优化和预算分配
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Loader2, TrendingUp, DollarSign, Target, BarChart3 } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function MLOptimization() {
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [optimizationGoal, setOptimizationGoal] = useState<'maximize_sales' | 'target_acos' | 'target_roas'>('maximize_sales');
  const [targetValue, setTargetValue] = useState<number>(30);
  const [totalBudget, setTotalBudget] = useState<number>(1000);

  // 获取广告活动列表
  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      // 实际应该调用TRPC API
      return [
        { id: 1, name: '高效活动', currentBid: 1.5, currentBudget: 200 },
        { id: 2, name: '低效活动', currentBid: 2.0, currentBudget: 150 },
        { id: 3, name: '上升趋势活动', currentBid: 1.2, currentBudget: 300 },
      ];
    },
  });

  // 获取出价推荐
  const bidRecommendationMutation = useMutation({
    mutationFn: async (campaignId: number) => {
      // 调用TRPC API
      return trpc.mlOptimization.getBidRecommendation.mutate({
        campaignId,
        optimizationGoal,
        targetValue: optimizationGoal !== 'maximize_sales' ? targetValue : undefined,
      });
    },
  });

  // 获取预算分配建议
  const budgetAllocationMutation = useMutation({
    mutationFn: async () => {
      const campaignIds = campaigns?.map((c) => c.id) || [];
      return trpc.mlOptimization.optimizeBudgetAllocation.mutate({
        campaignIds,
        totalBudget,
        optimizationGoal,
        targetValue: optimizationGoal !== 'maximize_sales' ? targetValue : undefined,
      });
    },
  });

  const handleGetBidRecommendation = () => {
    if (selectedCampaign) {
      bidRecommendationMutation.mutate(selectedCampaign);
    }
  };

  const handleGetBudgetAllocation = () => {
    budgetAllocationMutation.mutate();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">机器学习优化</h1>
          <p className="text-muted-foreground mt-2">
            使用机器学习算法优化出价和预算分配
          </p>
        </div>
      </div>

      {/* 优化目标设置 */}
      <Card>
        <CardHeader>
          <CardTitle>优化目标设置</CardTitle>
          <CardDescription>选择您的优化目标和参数</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>优化目标</Label>
              <Select value={optimizationGoal} onValueChange={(v: any) => setOptimizationGoal(v)}>
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

            {optimizationGoal !== 'maximize_sales' && (
              <div className="space-y-2">
                <Label>
                  {optimizationGoal === 'target_acos' ? '目标ACoS (%)' : '目标ROAS'}
                </Label>
                <Input
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(Number(e.target.value))}
                  placeholder={optimizationGoal === 'target_acos' ? '30' : '3.0'}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>总预算 ($)</Label>
              <Input
                type="number"
                value={totalBudget}
                onChange={(e) => setTotalBudget(Number(e.target.value))}
                placeholder="1000"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 出价优化 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              出价优化
            </CardTitle>
            <CardDescription>为单个广告活动获取最优出价推荐</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>选择广告活动</Label>
              <Select
                value={selectedCampaign?.toString()}
                onValueChange={(v) => setSelectedCampaign(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择广告活动" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns?.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id.toString()}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleGetBidRecommendation}
              disabled={!selectedCampaign || bidRecommendationMutation.isPending}
              className="w-full"
            >
              {bidRecommendationMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              获取出价推荐
            </Button>

            {bidRecommendationMutation.data && (
              <div className="space-y-3 mt-4">
                <Alert>
                  <TrendingUp className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>当前出价:</span>
                        <span className="font-semibold">
                          ${bidRecommendationMutation.data.currentBid.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>推荐出价:</span>
                        <span className="font-semibold text-green-600">
                          ${bidRecommendationMutation.data.recommendedBid.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>预期销售额:</span>
                        <span className="font-semibold">
                          ${bidRecommendationMutation.data.expectedSales.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>预期花费:</span>
                        <span className="font-semibold">
                          ${bidRecommendationMutation.data.expectedSpend.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>置信度:</span>
                        <span className="font-semibold">
                          {(bidRecommendationMutation.data.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>

                {bidRecommendationMutation.data.modelPerformance && (
                  <div className="text-sm text-muted-foreground">
                    <div>模型R²: {bidRecommendationMutation.data.modelPerformance.r2.toFixed(3)}</div>
                    <div>RMSE: {bidRecommendationMutation.data.modelPerformance.rmse.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 预算分配优化 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              预算分配优化
            </CardTitle>
            <CardDescription>智能分配预算到各个广告活动</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              基于边际效益分析,将预算优先分配给回报率最高的广告活动
            </div>

            <Button
              onClick={handleGetBudgetAllocation}
              disabled={budgetAllocationMutation.isPending}
              className="w-full"
            >
              {budgetAllocationMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              获取预算分配建议
            </Button>

            {budgetAllocationMutation.data && (
              <div className="space-y-3 mt-4">
                <div className="space-y-2">
                  {budgetAllocationMutation.data.allocations.map((allocation: any) => {
                    const campaign = campaigns?.find((c) => c.id === allocation.campaignId);
                    return (
                      <div key={allocation.campaignId} className="border rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">{campaign?.name}</span>
                          <span className="text-lg font-semibold text-green-600">
                            ${allocation.allocatedBudget.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex justify-between">
                            <span>预期销售额:</span>
                            <span>${allocation.expectedSales.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>预期ROAS:</span>
                            <span>{allocation.expectedRoas.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Alert>
                  <BarChart3 className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>总预期销售额:</span>
                        <span className="font-semibold">
                          ${budgetAllocationMutation.data.totalExpectedSales.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>总预期ROAS:</span>
                        <span className="font-semibold">
                          {budgetAllocationMutation.data.totalExpectedRoas.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 模型性能可视化 */}
      {bidRecommendationMutation.data?.historicalData && (
        <Card>
          <CardHeader>
            <CardTitle>历史数据与预测</CardTitle>
            <CardDescription>查看模型训练数据和预测结果</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={bidRecommendationMutation.data.historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bid" label={{ value: '出价 ($)', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: '销售额 ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="actualSales" stroke="#8884d8" name="实际销售额" />
                <Line type="monotone" dataKey="predictedSales" stroke="#82ca9d" name="预测销售额" strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
