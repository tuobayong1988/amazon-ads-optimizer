/**
 * OperationConfirmDialog - 关键操作确认弹窗组件
 * 用于预算调整、竞价修改等关键操作的二次确认和变更预览
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  Target,
  Loader2,
  CheckCircle2,
  Info
} from "lucide-react";

// 变更项类型
export interface ChangeItem {
  id: string | number;
  name: string;
  field: string;
  fieldLabel: string;
  oldValue: number | string;
  newValue: number | string;
  unit?: string;
  changePercent?: number;
}

// 操作类型
export type OperationType = 
  | "budget_adjustment" 
  | "bid_modification" 
  | "status_change" 
  | "batch_operation"
  | "campaign_pause"
  | "campaign_enable";

interface OperationConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  operationType: OperationType;
  title?: string;
  description?: string;
  changes: ChangeItem[];
  affectedCount?: number;
  warningMessage?: string;
  isLoading?: boolean;
  requireConfirmation?: boolean;
}

const operationConfig: Record<OperationType, { 
  icon: React.ReactNode; 
  title: string; 
  color: string;
  riskLevel: "low" | "medium" | "high";
}> = {
  budget_adjustment: {
    icon: <DollarSign className="w-5 h-5" />,
    title: "预算调整确认",
    color: "text-blue-500",
    riskLevel: "medium",
  },
  bid_modification: {
    icon: <Target className="w-5 h-5" />,
    title: "竞价修改确认",
    color: "text-green-500",
    riskLevel: "medium",
  },
  status_change: {
    icon: <AlertTriangle className="w-5 h-5" />,
    title: "状态变更确认",
    color: "text-yellow-500",
    riskLevel: "low",
  },
  batch_operation: {
    icon: <AlertTriangle className="w-5 h-5" />,
    title: "批量操作确认",
    color: "text-orange-500",
    riskLevel: "high",
  },
  campaign_pause: {
    icon: <AlertTriangle className="w-5 h-5" />,
    title: "暂停广告活动确认",
    color: "text-red-500",
    riskLevel: "high",
  },
  campaign_enable: {
    icon: <CheckCircle2 className="w-5 h-5" />,
    title: "启用广告活动确认",
    color: "text-green-500",
    riskLevel: "low",
  },
};

export default function OperationConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  operationType,
  title,
  description,
  changes,
  affectedCount,
  warningMessage,
  isLoading = false,
  requireConfirmation = true,
}: OperationConfirmDialogProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const config = operationConfig[operationType];

  const handleConfirm = async () => {
    if (requireConfirmation && !isConfirmed) return;
    await onConfirm();
    setIsConfirmed(false);
  };

  const handleClose = () => {
    setIsConfirmed(false);
    onClose();
  };

  const formatValue = (value: number | string, unit?: string) => {
    if (typeof value === "number") {
      if (unit === "%") {
        return `${value.toFixed(2)}%`;
      }
      if (unit === "$" || unit === "¥") {
        return `${unit}${value.toFixed(2)}`;
      }
      return value.toLocaleString();
    }
    return value;
  };

  const getChangeIcon = (oldValue: number | string, newValue: number | string) => {
    if (typeof oldValue === "number" && typeof newValue === "number") {
      if (newValue > oldValue) {
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      } else if (newValue < oldValue) {
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      }
    }
    return <ArrowRight className="w-4 h-4 text-muted-foreground" />;
  };

  const getRiskBadge = (riskLevel: "low" | "medium" | "high") => {
    switch (riskLevel) {
      case "low":
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30">低风险</Badge>;
      case "medium":
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">中风险</Badge>;
      case "high":
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">高风险</Badge>;
    }
  };

  // 计算变更统计
  const totalChanges = changes.length;
  const increaseCount = changes.filter(c => 
    typeof c.oldValue === "number" && typeof c.newValue === "number" && c.newValue > c.oldValue
  ).length;
  const decreaseCount = changes.filter(c => 
    typeof c.oldValue === "number" && typeof c.newValue === "number" && c.newValue < c.oldValue
  ).length;

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className={config.color}>{config.icon}</span>
            {title || config.title}
            {getRiskBadge(config.riskLevel)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description || "请确认以下变更内容，此操作将立即生效"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {/* 影响范围统计 */}
          {(affectedCount || totalChanges > 0) && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{affectedCount || totalChanges}</p>
                    <p className="text-sm text-muted-foreground">受影响项目</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-500">{increaseCount}</p>
                    <p className="text-sm text-muted-foreground">增加</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-500">{decreaseCount}</p>
                    <p className="text-sm text-muted-foreground">减少</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 警告信息 */}
          {warningMessage && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-600 dark:text-yellow-400">{warningMessage}</p>
            </div>
          )}

          {/* 变更详情列表 */}
          {changes.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Info className="w-4 h-4" />
                变更详情预览
              </h4>
              <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                {changes.slice(0, 20).map((change, index) => (
                  <div key={change.id || index} className="p-3 hover:bg-muted/50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{change.name}</p>
                        <p className="text-sm text-muted-foreground">{change.fieldLabel}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm text-muted-foreground">
                          {formatValue(change.oldValue, change.unit)}
                        </span>
                        {getChangeIcon(change.oldValue, change.newValue)}
                        <span className="text-sm font-medium">
                          {formatValue(change.newValue, change.unit)}
                        </span>
                        {change.changePercent !== undefined && (
                          <Badge variant="outline" className={
                            change.changePercent > 0 ? "text-green-500" : "text-red-500"
                          }>
                            {change.changePercent > 0 ? "+" : ""}{change.changePercent.toFixed(1)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {changes.length > 20 && (
                  <div className="p-3 text-center text-sm text-muted-foreground">
                    还有 {changes.length - 20} 项变更...
                  </div>
                )}
              </div>
            </div>
          )}

          <Separator />

          {/* 确认复选框 */}
          {requireConfirmation && (
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="confirm" 
                checked={isConfirmed} 
                onCheckedChange={(checked) => setIsConfirmed(checked as boolean)}
              />
              <Label htmlFor="confirm" className="text-sm">
                我已确认以上变更内容，了解此操作将立即生效且可能影响广告投放效果
              </Label>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose} disabled={isLoading}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={(requireConfirmation && !isConfirmed) || isLoading}
            className={config.riskLevel === "high" ? "bg-red-500 hover:bg-red-600" : ""}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              "确认执行"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// 便捷的Hook用于管理确认弹窗状态
export function useOperationConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<{
    operationType: OperationType;
    title?: string;
    description?: string;
    changes: ChangeItem[];
    affectedCount?: number;
    warningMessage?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const showConfirm = (options: {
    operationType: OperationType;
    title?: string;
    description?: string;
    changes: ChangeItem[];
    affectedCount?: number;
    warningMessage?: string;
    onConfirm: () => void | Promise<void>;
  }) => {
    setConfig(options);
    setIsOpen(true);
  };

  const handleConfirm = async () => {
    if (!config) return;
    setIsLoading(true);
    try {
      await config.onConfirm();
      setIsOpen(false);
      setConfig(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setConfig(null);
  };

  return {
    isOpen,
    isLoading,
    showConfirm,
    dialogProps: config ? {
      isOpen,
      onClose: handleClose,
      onConfirm: handleConfirm,
      operationType: config.operationType,
      title: config.title,
      description: config.description,
      changes: config.changes,
      affectedCount: config.affectedCount,
      warningMessage: config.warningMessage,
      isLoading,
    } : null,
  };
}
