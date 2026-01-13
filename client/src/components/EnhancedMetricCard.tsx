import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Zap, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkline } from "@/components/Sparkline";

interface EnhancedMetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  change?: number;
  isInverse?: boolean;
  sparklineData?: Array<{ value: number }>;
  isRealtime?: boolean;
  realtimeDelay?: string;
  gradientFrom?: string;
  gradientTo?: string;
  borderColor?: string;
  tooltip?: string;
}

export function EnhancedMetricCard({
  title, value, icon, change, isInverse = false, sparklineData, isRealtime = false, realtimeDelay, tooltip
}: EnhancedMetricCardProps) {
  const getChangeColor = () => {
    if (change === undefined) return "text-muted-foreground";
    if (isInverse) return change <= 0 ? "text-green-500" : "text-red-500";
    return change >= 0 ? "text-green-500" : "text-red-500";
  };
  const formatChange = (val: number) => (val >= 0 ? "+" : "") + val.toFixed(1) + "%";

  return (
    <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20 relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{title}</span>
          <div className="flex items-center gap-1">
            {isRealtime && <Zap className="w-4 h-4 text-green-500 animate-pulse" />}
            {icon}
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <span className="text-2xl font-bold">{value}</span>
            {change !== undefined && (
              <div className={"text-xs mt-1 flex items-center gap-1 " + getChangeColor()}>
                {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {formatChange(change)} vs.上期
              </div>
            )}
          </div>
          {sparklineData && sparklineData.length > 0 && (
            <div className="w-16 h-8">
              <Sparkline data={sparklineData} color={change !== undefined && ((isInverse && change > 0) || (!isInverse && change < 0)) ? "#ef4444" : "#22c55e"} height={32} width={64} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface TacosMetricCardProps {
  adSpend: number;
  totalSales: number;
  change?: number;
  isRealtime?: boolean;
}

export function TacosMetricCard({ adSpend, totalSales, change, isRealtime = false }: TacosMetricCardProps) {
  const tacos = totalSales > 0 ? (adSpend / totalSales) * 100 : 0;
  return (
    <Card className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 border-pink-500/20 relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">TACoS</span>
          <div className="flex items-center gap-1">
            {isRealtime && <Zap className="w-4 h-4 text-green-500 animate-pulse" />}
            <Badge variant="outline" className="text-xs bg-pink-500/10 border-pink-500/30">老板关注</Badge>
          </div>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold">{tacos.toFixed(1)}%</span>
          {change !== undefined && (
            <div className={"text-xs mt-1 flex items-center gap-1 " + (change <= 0 ? "text-green-500" : "text-red-500")}>
              {change <= 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
              {(change >= 0 ? "+" : "") + change.toFixed(1)}% vs.上期
            </div>
          )}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          广告花费 ${adSpend.toFixed(0)} / 总销售 ${totalSales.toFixed(0)}
        </div>
      </CardContent>
    </Card>
  );
}

export default EnhancedMetricCard;
