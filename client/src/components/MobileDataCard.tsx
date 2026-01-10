import { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { ChevronRight } from "lucide-react";

interface MobileDataCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * 移动端数据卡片组件
 * 用于在移动端显示关键指标数据
 */
export function MobileDataCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  onClick,
  className = "",
}: MobileDataCardProps) {
  const isMobile = useIsMobile();

  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className={`text-muted-foreground ${isMobile ? "text-xs" : "text-sm"}`}>
            {title}
          </p>
          <p className={`font-bold text-foreground ${isMobile ? "text-xl mt-1" : "text-2xl mt-2"}`}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 ml-2">
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${
          trend.isPositive ? "text-green-500" : "text-red-500"
        }`}>
          <span>{trend.isPositive ? "↑" : "↓"}</span>
          <span>{Math.abs(trend.value).toFixed(1)}%</span>
          <span className="text-muted-foreground">vs 上期</span>
        </div>
      )}
      {onClick && (
        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`relative text-left w-full bg-card rounded-lg p-4 border border-border/50 active:bg-muted/50 transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`bg-card rounded-lg p-4 border border-border/50 ${className}`}>
      {content}
    </div>
  );
}

/**
 * 移动端数据卡片网格组件
 * 在移动端显示2列，平板3列，桌面4列
 */
export function MobileDataCardGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 ${className}`}>
      {children}
    </div>
  );
}

/**
 * 移动端列表卡片组件
 * 用于显示列表项数据
 */
export function MobileListCard({
  title,
  items,
  onItemClick,
  emptyMessage = "暂无数据",
}: {
  title: string;
  items: { id: string | number; label: string; value: string | number; subtitle?: string }[];
  onItemClick?: (id: string | number) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="bg-card rounded-lg border border-border/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50">
        <h3 className="font-medium text-sm">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-muted-foreground text-sm">
          {emptyMessage}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick?.(item.id)}
              className="flex items-center justify-between w-full px-4 py-3 text-left active:bg-muted/50 transition-colors"
              disabled={!onItemClick}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.label}</p>
                {item.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm font-medium">{item.value}</span>
                {onItemClick && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
