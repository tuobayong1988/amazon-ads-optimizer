import { useState, ReactNode } from "react";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/useMobile";

interface MobileFilterPanelProps {
  children: ReactNode;
  activeFiltersCount?: number;
  onClearAll?: () => void;
  title?: string;
}

/**
 * 移动端筛选器面板组件
 * 在移动端显示为可折叠面板，在桌面端直接显示内容
 */
export function MobileFilterPanel({
  children,
  activeFiltersCount = 0,
  onClearAll,
  title = "筛选条件",
}: MobileFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isMobile = useIsMobile();

  // 桌面端直接显示内容
  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-3">
      {/* 折叠按钮 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg active:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {activeFiltersCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeFiltersCount > 0 && onClearAll && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
            >
              <X className="w-3 h-3 mr-1" />
              清除
            </Button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* 筛选内容 */}
      {isExpanded && (
        <div className="space-y-4 p-3 bg-card rounded-lg border border-border/50 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 移动端筛选器行组件
 * 用于在移动端垂直堆叠筛选器
 */
export function MobileFilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();

  if (!isMobile) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground whitespace-nowrap">{label}:</span>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * 移动端筛选器标签组件
 * 显示当前激活的筛选条件
 */
export function MobileActiveFilters({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: { key: string; label: string; value: string }[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className="text-xs text-muted-foreground">当前筛选:</span>
      {filters.map((filter) => (
        <Badge
          key={filter.key}
          variant="secondary"
          className="flex items-center gap-1 pr-1"
        >
          <span className="text-xs">
            {filter.label}: {filter.value}
          </span>
          <button
            onClick={() => onRemove(filter.key)}
            className="ml-1 hover:bg-muted rounded-full p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onClearAll}
      >
        清除全部
      </Button>
    </div>
  );
}
