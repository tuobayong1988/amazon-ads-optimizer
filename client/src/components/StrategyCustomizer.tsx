/**
 * StrategyCustomizer - 策略自定义编辑器
 * 
 * 允许用户创建、编辑和组合自己的策略模板
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Save, Copy, Trash2, Plus } from "lucide-react";

// 自定义策略模板
export interface CustomStrategyTemplate {
  id: string;
  name: string;
  description: string;
  isCustom: boolean;
  targetAcos: number;
  minAcos: number;
  maxAcos: number;
  bidMultiplier: number;
  budgetMultiplier: number;
  advancedSettings?: {
    maxBidIncreasePercent?: number;
    maxBidDecreasePercent?: number;
    minBidChangePercent?: number;
    cooldownPeriodHours?: number;
    aggressiveness?: number; // 0-1
  };
}

interface StrategyCustomizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: CustomStrategyTemplate; // 编辑模式
  onSave: (template: CustomStrategyTemplate) => void;
}

export function StrategyCustomizer({ open, onOpenChange, template, onSave }: StrategyCustomizerProps) {
  const [formData, setFormData] = useState<CustomStrategyTemplate>(
    template || {
      id: `custom-${Date.now()}`,
      name: '',
      description: '',
      isCustom: true,
      targetAcos: 25,
      minAcos: 15,
      maxAcos: 35,
      bidMultiplier: 1.0,
      budgetMultiplier: 1.0,
      advancedSettings: {
        maxBidIncreasePercent: 30,
        maxBidDecreasePercent: 20,
        minBidChangePercent: 5,
        cooldownPeriodHours: 24,
        aggressiveness: 0.5,
      },
    }
  );

  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error('请输入策略名称');
      return;
    }

    if (formData.targetAcos < formData.minAcos || formData.targetAcos > formData.maxAcos) {
      toast.error('目标ACoS必须在最小值和最大值之间');
      return;
    }

    onSave(formData);
    toast.success(template ? '策略已更新' : '策略已创建');
    onOpenChange(false);
  };

  const handleDuplicate = () => {
    const duplicated: CustomStrategyTemplate = {
      ...formData,
      id: `custom-${Date.now()}`,
      name: `${formData.name} (副本)`,
    };
    setFormData(duplicated);
    toast.success('已创建副本');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? '编辑策略模板' : '创建自定义策略'}
          </DialogTitle>
          <DialogDescription>
            自定义策略参数以适应您的业务需求
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">基础设置</TabsTrigger>
            <TabsTrigger value="advanced">高级设置</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            {/* 策略名称 */}
            <div className="space-y-2">
              <Label htmlFor="name">策略名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如: 我的激进增长策略"
              />
            </div>

            {/* 策略描述 */}
            <div className="space-y-2">
              <Label htmlFor="description">策略描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="描述此策略的适用场景和目标"
                rows={3}
              />
            </div>

            {/* ACoS目标 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ACoS目标范围</CardTitle>
                <CardDescription>设置可接受的广告成本销售比范围</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>目标ACoS</Label>
                    <span className="text-sm font-semibold">{formData.targetAcos}%</span>
                  </div>
                  <Slider
                    value={[formData.targetAcos]}
                    onValueChange={([value]) => setFormData({ ...formData, targetAcos: value })}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="minAcos">最小ACoS</Label>
                    <Input
                      id="minAcos"
                      type="number"
                      value={formData.minAcos}
                      onChange={(e) => setFormData({ ...formData, minAcos: parseFloat(e.target.value) || 0 })}
                      min={0}
                      max={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxAcos">最大ACoS</Label>
                    <Input
                      id="maxAcos"
                      type="number"
                      value={formData.maxAcos}
                      onChange={(e) => setFormData({ ...formData, maxAcos: parseFloat(e.target.value) || 100 })}
                      min={0}
                      max={200}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 出价和预算倍数 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">出价和预算调整</CardTitle>
                <CardDescription>相对于建议值的调整倍数</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>出价倍数</Label>
                    <span className="text-sm font-semibold">{formData.bidMultiplier.toFixed(2)}x</span>
                  </div>
                  <Slider
                    value={[formData.bidMultiplier * 100]}
                    onValueChange={([value]) => setFormData({ ...formData, bidMultiplier: value / 100 })}
                    min={50}
                    max={200}
                    step={5}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.bidMultiplier < 1 ? '降低出价' : formData.bidMultiplier > 1 ? '提高出价' : '保持出价'}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>预算倍数</Label>
                    <span className="text-sm font-semibold">{formData.budgetMultiplier.toFixed(2)}x</span>
                  </div>
                  <Slider
                    value={[formData.budgetMultiplier * 100]}
                    onValueChange={([value]) => setFormData({ ...formData, budgetMultiplier: value / 100 })}
                    min={40}
                    max={300}
                    step={10}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.budgetMultiplier < 1 ? '降低预算' : formData.budgetMultiplier > 1 ? '提高预算' : '保持预算'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">出价调整限制</CardTitle>
                <CardDescription>控制单次出价调整的幅度</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maxBidIncrease">最大涨幅 (%)</Label>
                    <Input
                      id="maxBidIncrease"
                      type="number"
                      value={formData.advancedSettings?.maxBidIncreasePercent || 30}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          advancedSettings: {
                            ...formData.advancedSettings,
                            maxBidIncreasePercent: parseFloat(e.target.value) || 30,
                          },
                        })
                      }
                      min={0}
                      max={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxBidDecrease">最大降幅 (%)</Label>
                    <Input
                      id="maxBidDecrease"
                      type="number"
                      value={formData.advancedSettings?.maxBidDecreasePercent || 20}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          advancedSettings: {
                            ...formData.advancedSettings,
                            maxBidDecreasePercent: parseFloat(e.target.value) || 20,
                          },
                        })
                      }
                      min={0}
                      max={100}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="minBidChange">最小调整幅度 (%)</Label>
                  <Input
                    id="minBidChange"
                    type="number"
                    value={formData.advancedSettings?.minBidChangePercent || 5}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        advancedSettings: {
                          ...formData.advancedSettings,
                          minBidChangePercent: parseFloat(e.target.value) || 5,
                        },
                      })
                    }
                    min={0}
                    max={50}
                  />
                  <p className="text-xs text-muted-foreground">
                    低于此幅度的调整将被忽略
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">优化频率控制</CardTitle>
                <CardDescription>避免过度频繁的调整</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cooldown">冷却期 (小时)</Label>
                  <Input
                    id="cooldown"
                    type="number"
                    value={formData.advancedSettings?.cooldownPeriodHours || 24}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        advancedSettings: {
                          ...formData.advancedSettings,
                          cooldownPeriodHours: parseFloat(e.target.value) || 24,
                        },
                      })
                    }
                    min={1}
                    max={168}
                  />
                  <p className="text-xs text-muted-foreground">
                    同一广告活动在此时间内不会被重复优化
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">激进程度</CardTitle>
                <CardDescription>控制整体优化的激进程度</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>激进程度</Label>
                    <span className="text-sm font-semibold">
                      {((formData.advancedSettings?.aggressiveness || 0.5) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Slider
                    value={[(formData.advancedSettings?.aggressiveness || 0.5) * 100]}
                    onValueChange={([value]) =>
                      setFormData({
                        ...formData,
                        advancedSettings: {
                          ...formData.advancedSettings,
                          aggressiveness: value / 100,
                        },
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>保守</span>
                    <span>激进</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between">
          <div>
            {template && (
              <Button variant="outline" onClick={handleDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                复制
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
