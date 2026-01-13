/**
 * 策略模板库组件
 * 提供预设的优化策略模板，让用户一键应用
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, Shield, Target, TrendingUp, Zap, Star, CheckCircle2, ArrowRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  targetAcos: number;
  bidAdjustment: string;
  budgetStrategy: string;
  negativeStrategy: string;
  daypartingEnabled: boolean;
  recommended?: boolean;
  tags: string[];
}

interface StrategyTemplatesProps {
  currentAcos: number;
  onApplyTemplate: (template: StrategyTemplate) => void;
}

const templates: StrategyTemplate[] = [
  {
    id: "aggressive-growth",
    name: "激进增长",
    description: "适合新品推广期或需要快速抢占市场份额的场景。接受较高的ACoS换取更多曝光和销量。",
    icon: <Rocket className="w-5 h-5" />,
    color: "text-red-500",
    targetAcos: 40,
    bidAdjustment: "高于建议竞价20-30%",
    budgetStrategy: "预算上限提高50%",
    negativeStrategy: "仅否定完全无效词（点击>20，转化=0）",
    daypartingEnabled: false,
    tags: ["新品推广", "市场份额", "高曝光"],
  },
  {
    id: "balanced",
    name: "平衡增长",
    description: "在控制成本的同时追求稳定增长。适合大多数成熟产品的日常运营。",
    icon: <Target className="w-5 h-5" />,
    color: "text-blue-500",
    targetAcos: 25,
    bidAdjustment: "根据边际效益动态调整",
    budgetStrategy: "预算利用率保持80-90%",
    negativeStrategy: "否定ACoS>50%的关键词",
    daypartingEnabled: true,
    recommended: true,
    tags: ["日常运营", "稳定增长", "推荐"],
  },
  {
    id: "profit-focused",
    name: "利润优先",
    description: "严格控制广告成本，追求最大化利润。适合利润率较低或需要控制支出的产品。",
    icon: <Shield className="w-5 h-5" />,
    color: "text-green-500",
    targetAcos: 15,
    bidAdjustment: "低于建议竞价10-20%",
    budgetStrategy: "严格控制预算，不超支",
    negativeStrategy: "积极否定ACoS>30%的关键词",
    daypartingEnabled: true,
    tags: ["成本控制", "高利润", "保守"],
  },
  {
    id: "seasonal-boost",
    name: "旺季冲刺",
    description: "针对Prime Day、黑五等大促期间的特殊策略。短期内最大化销量。",
    icon: <Zap className="w-5 h-5" />,
    color: "text-yellow-500",
    targetAcos: 35,
    bidAdjustment: "大促期间提高30-50%",
    budgetStrategy: "预算翻倍，确保不断货",
    negativeStrategy: "暂停否定，保持最大曝光",
    daypartingEnabled: false,
    tags: ["大促", "Prime Day", "黑五"],
  },
  {
    id: "brand-defense",
    name: "品牌防御",
    description: "保护品牌词不被竞争对手抢占。适合有一定品牌知名度的卖家。",
    icon: <Star className="w-5 h-5" />,
    color: "text-purple-500",
    targetAcos: 10,
    bidAdjustment: "品牌词高竞价，非品牌词正常",
    budgetStrategy: "品牌词预算优先保障",
    negativeStrategy: "保护品牌词，否定竞品词",
    daypartingEnabled: false,
    tags: ["品牌保护", "防御策略"],
  },
];

export function StrategyTemplates({ currentAcos, onApplyTemplate }: StrategyTemplatesProps) {
  // 根据当前ACoS推荐策略
  const getRecommendedTemplate = () => {
    if (currentAcos > 35) return "profit-focused";
    if (currentAcos < 15) return "aggressive-growth";
    return "balanced";
  };

  const recommendedId = getRecommendedTemplate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-500" />
          策略模板库
        </CardTitle>
        <CardDescription>
          选择预设的优化策略模板，一键应用到您的广告活动
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isRecommended = template.id === recommendedId;
            return (
              <div
                key={template.id}
                className={`relative p-4 rounded-lg border transition-all hover:shadow-md ${
                  isRecommended
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {isRecommended && (
                  <Badge className="absolute -top-2 -right-2 bg-primary">
                    推荐
                  </Badge>
                )}
                
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${template.color}`}>
                    {template.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold">{template.name}</h3>
                    <div className="text-xs text-muted-foreground">
                      目标ACoS: {template.targetAcos}%
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {template.description}
                </p>
                
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span className="text-muted-foreground">{template.bidAdjustment}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span className="text-muted-foreground">{template.budgetStrategy}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span className="text-muted-foreground">
                      分时调价: {template.daypartingEnabled ? "启用" : "关闭"}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-1 mb-4">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
                
                <Button
                  className="w-full"
                  variant={isRecommended ? "default" : "outline"}
                  onClick={() => onApplyTemplate(template)}
                >
                  应用此策略
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            );
          })}
        </div>
        
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium mb-1">如何选择策略？</p>
              <ul className="text-muted-foreground space-y-1">
                <li>• 新品期选择"激进增长"，快速积累评价和排名</li>
                <li>• 稳定期选择"平衡增长"，兼顾销量和利润</li>
                <li>• 利润率低时选择"利润优先"，严格控制ACoS</li>
                <li>• 大促期间切换"旺季冲刺"，最大化销量</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StrategyTemplates;
